import { ConflictException } from "@nestjs/common";
import { addDays, eventDates, localDate, rehearsalDates, type EventDate, type EventTiming } from "@oneverse/core";
import type { Prisma } from "@oneverse/db";

/**
 * Bookings (issue #565, ADR 0013): an event's dates book the rooms and
 * resources it takes, a room from its setup time before to its teardown
 * time after. Two bookings of a room never overlap, and a resource is never
 * booked more times at once than there are of it: the second event is
 * refused, naming the one holding it. Bookings aren't rows of their own:
 * they're worked out from the events' dates, as the calendar is.
 *
 * An organisation's event books once, for all its groups: its groups' parts
 * carry its rooms but are the same booking.
 */

/** How far ahead an event's dates are checked: a series for ever is checked two years ahead. */
export const BOOKING_HORIZON_DAYS = 730;

const ROOM = { select: { id: true, name: true, setupMinutes: true, teardownMinutes: true } } as const;
const USES = { select: { resourceId: true, quantity: true, resource: { select: { name: true, quantity: true } } } } as const;
const DATES = { select: { date: true, movedFrom: true, cancelled: true, startTime: true, title: true } } as const;
const TIMING = { date: true, startTime: true, durationMinutes: true, timeZone: true, repeatEveryWeeks: true, repeatUntil: true } as const;
const TEAM_HOLDER = {
  id: true,
  title: true,
  organizationEventId: true,
  daysBefore: true,
  ...TIMING,
  dates: DATES,
  rooms: ROOM,
  resources: USES,
  team: { select: { name: true } },
  rehearsalFor: { select: { ...TIMING, dates: DATES } },
} as const;
const ORGANIZATION_HOLDER = {
  id: true,
  title: true,
  ...TIMING,
  rooms: ROOM,
  resources: USES,
  organization: { select: { name: true } },
  // Its dates' own changes are its groups' parts' (cancelled, moved): one is enough, they follow it - the first by name, the one changed first.
  teamEvents: { select: { dates: DATES }, take: 1, orderBy: { team: { name: "asc" } } },
} as const;

type TeamHolderRow = Prisma.TeamEventGetPayload<{ select: typeof TEAM_HOLDER }>;
type OrganizationHolderRow = Prisma.OrganizationEventGetPayload<{ select: typeof ORGANIZATION_HOLDER }>;
type TimingRow = { date: Date; startTime: string; durationMinutes: number; timeZone: string; repeatEveryWeeks: number | null; repeatUntil: Date | null };
type DateRow = { date: Date; movedFrom: Date | null; cancelled: boolean; startTime: string | null; title: string | null };

export interface BookedRoom {
  id: string;
  name: string;
  setupMinutes: number;
  teardownMinutes: number;
}

export interface BookedResource {
  resourceId: string;
  name: string;
  /** How many this booking takes. */
  quantity: number;
  /** How many there are. */
  available: number;
}

/** What books: an event (an organisation's for all its groups), its rooms and resources, and its dates in the range checked. */
export interface Holder {
  /** One per booking: an organisation's event's groups' parts share it. */
  key: string;
  kind: "team" | "organization";
  eventId: string;
  title: string;
  /** Its team's or organisation's name. */
  owner: string;
  rooms: BookedRoom[];
  resources: BookedResource[];
  /** Its dates, cancelled ones left out. */
  dates: Pick<EventDate, "date" | "startsAt" | "endsAt" | "title">[];
}

/** One clash: on the event's `date`, the room or resource `what` is already booked by another event. */
export interface BookingClash {
  date: string;
  kind: "room" | "resource";
  /** The room's or resource's id and name. */
  id: string;
  what: string;
  /** The event holding it. */
  eventId: string;
  eventKind: "team" | "organization";
  event: string;
  owner: string;
  /** The other event's date that holds it, and when. */
  heldOn: string;
  startsAt: string;
  endsAt: string;
}

const MINUTE = 60_000;
const at = (instant: string) => new Date(instant).getTime();
const dateText = (date: Date) => date.toISOString().slice(0, 10);

function timingOf(row: TimingRow, dates: DateRow[]): EventTiming {
  return {
    date: dateText(row.date),
    startTime: row.startTime,
    durationMinutes: row.durationMinutes,
    timeZone: row.timeZone,
    repeat: row.repeatEveryWeeks ? { everyWeeks: row.repeatEveryWeeks, until: row.repeatUntil ? dateText(row.repeatUntil) : null } : null,
    moves: dates.flatMap((one) => (one.movedFrom ? [{ from: dateText(one.movedFrom), to: dateText(one.date) }] : [])),
  };
}

const changesOf = (dates: DateRow[]) => dates.map((one) => ({ date: dateText(one.date), cancelled: one.cancelled, startTime: one.startTime, title: one.title }));
const rooms = (rows: BookedRoom[]) => rows.map(({ id, name, setupMinutes, teardownMinutes }) => ({ id, name, setupMinutes, teardownMinutes }));
const resources = (rows: { resourceId: string; quantity: number; resource: { name: string; quantity: number } }[]) =>
  rows.map((row) => ({ resourceId: row.resourceId, name: row.resource.name, quantity: row.quantity, available: row.resource.quantity }));
const shown = (dates: EventDate[]) => dates.filter((one) => !one.cancelled).map(({ date, startsAt, endsAt, title }) => ({ date, startsAt, endsAt, title }));

function teamHolder(row: TeamHolderRow, from: string, to: string): Holder {
  const dates = row.rehearsalFor
    ? rehearsalDates(timingOf(row.rehearsalFor, row.rehearsalFor.dates), { daysBefore: row.daysBefore ?? 0, startTime: row.startTime, durationMinutes: row.durationMinutes }, from, to, changesOf(row.rehearsalFor.dates))
    : eventDates(timingOf(row, row.dates), from, to, changesOf(row.dates));
  return { key: `team:${row.id}`, kind: "team", eventId: row.id, title: row.title, owner: row.team.name, rooms: rooms(row.rooms), resources: resources(row.resources), dates: shown(dates) };
}

function organizationHolder(row: OrganizationHolderRow, from: string, to: string): Holder {
  const changes = row.teamEvents[0]?.dates ?? [];
  return {
    key: `organization:${row.id}`,
    kind: "organization",
    eventId: row.id,
    title: row.title,
    owner: row.organization.name,
    rooms: rooms(row.rooms),
    resources: resources(row.resources),
    dates: shown(eventDates(timingOf(row, changes), from, to, changesOf(changes))),
  };
}

/** When a date holds a room: from its setup before to its teardown after. */
function heldWindow(date: { startsAt: string; endsAt: string }, room: BookedRoom | null): [number, number] {
  return [at(date.startsAt) - (room?.setupMinutes ?? 0) * MINUTE, at(date.endsAt) + (room?.teardownMinutes ?? 0) * MINUTE];
}

const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/**
 * Where an event's dates clash with others' (pure, for the tests): a room
 * two of them hold at once - setup and teardown included, with the room's
 * own times - or a resource booked more times at once than there are.
 * Dates of the same booking never clash with each other.
 */
export function bookingClashes(subject: Holder, others: readonly Holder[]): BookingClash[] {
  const clashes: BookingClash[] = [];
  const seen = new Set<string>();
  const add = (date: string, kind: BookingClash["kind"], id: string, what: string, other: Holder, held: Holder["dates"][number]) => {
    const key = `${date}|${kind}|${id}|${other.key}|${held.date}`;
    if (seen.has(key)) return;
    seen.add(key);
    clashes.push({ date, kind, id, what, eventId: other.eventId, eventKind: other.kind, event: held.title || other.title, owner: other.owner, heldOn: held.date, startsAt: held.startsAt, endsAt: held.endsAt });
  };
  const rest = others.filter((other) => other.key !== subject.key);
  for (const date of subject.dates) {
    for (const room of subject.rooms) {
      const mine = heldWindow(date, room);
      for (const other of rest) {
        if (!other.rooms.some((one) => one.id === room.id)) continue;
        for (const held of other.dates) if (overlaps(mine, heldWindow(held, room))) add(date.date, "room", room.id, room.name, other, held);
      }
    }
    for (const use of subject.resources) {
      const mine = heldWindow(date, null);
      // The other bookings of it while this date has it, and the most of it they take at once.
      const during = rest.flatMap((other) => {
        const taken = other.resources.find((one) => one.resourceId === use.resourceId);
        return taken ? other.dates.filter((held) => overlaps(mine, heldWindow(held, null))).map((held) => ({ other, held, quantity: taken.quantity, window: heldWindow(held, null) })) : [];
      });
      if (during.length === 0) continue;
      const points = [mine[0], ...during.map((one) => one.window[0]).filter((point) => point > mine[0] && point < mine[1])];
      const most = Math.max(...points.map((point) => during.filter((one) => one.window[0] <= point && point < one.window[1]).reduce((sum, one) => sum + one.quantity, 0)));
      if (most + use.quantity <= use.available) continue;
      for (const one of during) add(date.date, "resource", use.resourceId, use.name, one.other, one.held);
    }
  }
  return clashes.sort((a, b) => a.date.localeCompare(b.date) || a.what.localeCompare(b.what));
}

/** The bookings that may meet an event's dates: others taking any of its rooms or resources, not over before `from`. */
async function othersTaking(db: Prisma.TransactionClient, subject: Holder, from: string, to: string): Promise<Holder[]> {
  const roomIds = subject.rooms.map((room) => room.id);
  const resourceIds = subject.resources.map((use) => use.resourceId);
  const taking = [...(roomIds.length ? [{ rooms: { some: { id: { in: roomIds } } } }] : []), ...(resourceIds.length ? [{ resources: { some: { resourceId: { in: resourceIds } } } }] : [])];
  const since = new Date(`${addDays(from, -1)}T00:00:00.000Z`);
  // Not over: a series going on, a date on or after `from` (a one-off, or a date moved there), or a rehearsal (its event's dates).
  const coming = [{ date: { gte: since } }, { repeatEveryWeeks: { not: null }, OR: [{ repeatUntil: null }, { repeatUntil: { gte: since } }] }];
  const [teams, organizations] = await Promise.all([
    db.teamEvent.findMany({ where: { organizationEventId: null, AND: [{ OR: taking }, { OR: [...coming, { dates: { some: { date: { gte: since } } } }, { rehearsalForId: { not: null } }] }] }, select: TEAM_HOLDER }),
    db.organizationEvent.findMany({ where: { AND: [{ OR: taking }, { OR: [...coming, { teamEvents: { some: { dates: { some: { date: { gte: since } } } } } }] }] }, select: ORGANIZATION_HOLDER }),
  ]);
  return [...teams.map((row) => teamHolder(row, from, to)), ...organizations.map((row) => organizationHolder(row, from, to))];
}

/** What books for an event: itself, or for a group's part, its organisation's event. Null: nothing found. */
async function holderOf(db: Prisma.TransactionClient, event: { teamEventId: string } | { organizationEventId: string }, from: (timeZone: string) => string): Promise<{ holder: Holder; from: string; to: string } | null> {
  let organizationEventId = "organizationEventId" in event ? event.organizationEventId : null;
  if ("teamEventId" in event) {
    const row = await db.teamEvent.findUnique({ where: { id: event.teamEventId }, select: TEAM_HOLDER });
    if (!row) return null;
    if (!row.organizationEventId) {
      const start = from(row.timeZone);
      const to = addDays(start, BOOKING_HORIZON_DAYS);
      return { holder: teamHolder(row, start, to), from: start, to };
    }
    organizationEventId = row.organizationEventId;
  }
  const row = await db.organizationEvent.findUnique({ where: { id: organizationEventId! }, select: ORGANIZATION_HOLDER });
  if (!row) return null;
  const start = from(row.timeZone);
  const to = addDays(start, BOOKING_HORIZON_DAYS);
  return { holder: organizationHolder(row, start, to), from: start, to };
}

/**
 * Where an event's coming dates clash with other bookings, as it is in
 * `db` (inside the transaction that changed it, so a refusal undoes the
 * change). Dates already over aren't checked.
 */
export async function eventClashes(db: Prisma.TransactionClient, event: { teamEventId: string } | { organizationEventId: string }, now = new Date()): Promise<Clashes> {
  const found = await holderOf(db, event, (timeZone) => localDate(now, timeZone));
  if (!found || (found.holder.rooms.length === 0 && found.holder.resources.length === 0)) return Object.assign([], { dates: 0 });
  const coming = { ...found.holder, dates: found.holder.dates.filter((date) => at(date.endsAt) > now.getTime()) };
  return Object.assign(bookingClashes(coming, await othersTaking(db, coming, found.from, found.to)), { dates: coming.dates.length });
}

/** An event's clashes, and how many of its coming dates were checked. */
export type Clashes = BookingClash[] & { dates: number };

/** A clash's sentence: "Main hall is booked on 2026-12-06 by Carol service (Youth)". */
export function clashMessage(clash: BookingClash): string {
  return `${clash.what} is booked on ${clash.date} by ${clash.event} (${clash.owner})`;
}

/**
 * Refuses the change (409) when an event's coming dates clash: each clash
 * named, and listed in `clashes` for the forms - a series can be saved
 * again with `skipClashes` to book only its free dates.
 */
export function refuseClashes(clashes: readonly BookingClash[], dates?: number): void {
  if (clashes.length === 0) return;
  const messages = [...new Set(clashes.map(clashMessage))];
  // `freeDates`: how many of its coming dates are free - none, and booking the free ones makes no sense.
  const free = dates === undefined ? undefined : dates - clashingDates(clashes).length;
  throw new ConflictException({ statusCode: 409, error: "Conflict", code: "BOOKING_CLASH", message: messages.slice(0, 10), clashes: clashes.slice(0, 200), ...(free === undefined ? {} : { freeDates: free }) });
}

/** The dates of an event that clash, once each. */
export const clashingDates = (clashes: readonly BookingClash[]) => [...new Set(clashes.map((clash) => clash.date))].sort();
