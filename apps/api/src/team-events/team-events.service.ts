import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { addDays, asksOpenTo, MUSIC_LEADER, partKey, withAsks, callAt, daysBetween, eventDates, eventFallsOn, EVENT_ONLY_PARTS, INSTRUMENTS, OWN_TEAM, localDate, rehearsalDates, TECH_ROLES, type EventDate, type EventPart, type EventTiming } from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import { NotificationsService, type NotificationInput } from "../notifications/notifications.service.js";
import { eventLocation } from "../locations/locations.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { signedUpFor, signupKey } from "./signups.js";
import type { CreateTeamEventDto, SetTeamEventDateAsksDto, UpdateTeamCalendarDto, UpdateTeamEventDateDto, UpdateTeamEventDto } from "./dto/team-events.dto.js";

/** The longest range of dates asked for at once. */
const MAX_RANGE_DAYS = 400;

export type EventRow = Prisma.TeamEventGetPayload<{ include: { dates: { include: { setlist: { select: { id: true; _count: { select: { items: true } } } } } } } }>;

export const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
export const dateText = (date: Date) => date.toISOString().slice(0, 10);

export function timingOf(event: EventRow): EventTiming {
  return {
    date: dateText(event.date),
    startTime: event.startTime,
    durationMinutes: event.durationMinutes,
    timeZone: event.timeZone,
    repeat: event.repeatEveryWeeks ? { everyWeeks: event.repeatEveryWeeks, until: event.repeatUntil ? dateText(event.repeatUntil) : null } : null,
  };
}

export function changesOf(event: EventRow) {
  return event.dates.map((row) => ({ date: dateText(row.date), cancelled: row.cancelled, startTime: row.startTime, title: row.title }));
}

/**
 * The parts an event needs (issue #235, phase 7), as stored; on a date
 * (issue #549), with what that date asks for besides (withAsks: the
 * instruments its music lead asked for from the set).
 */
export function partsOf(event: { parts: Prisma.JsonValue; dates?: { date: Date; asks?: Prisma.JsonValue }[] }, date?: string): EventPart[] {
  const parts = Array.isArray(event.parts) ? (event.parts as unknown as EventPart[]) : [];
  if (!date) return parts;
  return withAsks(parts, asksOn(event, date));
}

/**
 * Someone's groups and the groups above them (issue #549): a place open to
 * "Tech" is open to the members of Media, Sound and Lights under it.
 */
export async function withGroupsAbove(prisma: PrismaClientLike, teamIds: Iterable<string>): Promise<Set<string>> {
  const reach = new Set(teamIds);
  let next = [...reach];
  // Groups nest a few levels at most; the guard stops a loop.
  for (let depth = 0; next.length > 0 && depth < 10; depth++) {
    const parents = (await prisma.team.findMany({ where: { id: { in: next }, parentId: { not: null } }, select: { parentId: true } })).map((row) => row.parentId!).filter((id) => !reach.has(id));
    parents.forEach((id) => reach.add(id));
    next = parents;
  }
  return reach;
}

type PrismaClientLike = { team: { findMany: (args: { where: { id: { in: string[] }; parentId: { not: null } }; select: { parentId: true } }) => Promise<{ parentId: string | null }[]> } };

/** What a date asks for besides its event's parts (issue #549). */
export function asksOn(event: { dates?: { date: Date; asks?: Prisma.JsonValue }[] }, date: string): EventPart[] {
  const asks = event.dates?.find((row) => dateText(row.date) === date)?.asks;
  return Array.isArray(asks) ? (asks as unknown as EventPart[]) : [];
}

/** The organisation's event a group's event is part of (issue #241). */
export type Planned = { organizationEventId: string; organizationId: string; organizationName: string; hostName: string | null };

/** What a rehearsal date is for: its event, the date, and its title. */
export type RehearsalOf = { eventId: string; date: string; title: string };

/** A rehearsal's dates (issue #235, phase 7), from its event's: `parent` is the event it's for. */
export function rehearsalDatesOf(rehearsal: EventRow, parent: EventRow, from: string, to: string) {
  return rehearsalDates(timingOf(parent), { daysBefore: rehearsal.daysBefore ?? 0, startTime: rehearsal.startTime, durationMinutes: rehearsal.durationMinutes }, from, to, changesOf(parent));
}

export const withDates = { dates: { include: { setlist: { select: { id: true, _count: { select: { items: true } } } } } } } as const;

/**
 * A team's calendar (issue #235): its events, the dates they fall on, and
 * each date's set - made ahead of time (the team's `setsAheadWeeks`, by the
 * daily job, or on demand) and kept in step with its date: the same date
 * and title, deleted when its date is cancelled or goes while it's still
 * empty, kept (no longer the event's) when it has songs.
 */
@Injectable()
export class TeamEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Who signed up for an event's coming dates, from `today` (signedUpFor): each date and its people. */
  private async signedUp(eventId: string, today: string): Promise<{ date: string; userId: string }[]> {
    const where = { eventId, date: { gte: day(today) } };
    const [answers, lineup] = await Promise.all([
      this.prisma.client.teamEventAnswer.findMany({ where: { ...where, answer: "AVAILABLE" }, select: { date: true } }),
      this.prisma.client.teamEventAssignment.findMany({ where, select: { date: true } }),
    ]);
    const dates = [...new Set([...answers, ...lineup].map((row) => dateText(row.date)))];
    const people = await signedUpFor(this.prisma.client, dates.map((date) => ({ eventId, date })));
    return dates.flatMap((date) => (people.get(signupKey(eventId, date)) ?? []).map((userId) => ({ date, userId })));
  }

  private async teamName(teamId: string): Promise<string> {
    return (await this.prisma.client.team.findUnique({ where: { id: teamId }, select: { name: true } }))?.name ?? "";
  }

  /**
   * What changed for the people signed up for a date, as their notification
   * (issue #236): cancelled (or gone), another time or another title; none if
   * nothing they'd see changed.
   */
  private dateNotice(before: EventRow, after: EventRow | null, date: string): Pick<NotificationInput, "kind" | "data"> | null {
    const [was] = eventDates(timingOf(before), date, date, changesOf(before));
    if (!was || was.cancelled) return null;
    const [now] = after && eventFallsOn(timingOf(after), date) ? eventDates(timingOf(after), date, date, changesOf(after)) : [];
    const wasTitle = was.title || before.title;
    if (!now || now.cancelled) return { kind: "EVENT_DATE_CANCELLED", data: { event: wasTitle, date } };
    const title = now.title || after!.title;
    if (now.startTime === was.startTime && title === wasTitle) return null;
    return { kind: "EVENT_DATE_CHANGED", data: { event: title, date, startTime: now.startTime } };
  }

  /** The people signed up for an event's coming dates told what changed for theirs; `by` made the change and isn't. */
  private async notifyDates(before: EventRow, after: EventRow | null, signedUp: { date: string; userId: string }[], by: string | null) {
    if (signedUp.length === 0) return;
    const team = await this.teamName(before.teamId);
    const notices = new Map<string, ReturnType<TeamEventsService["dateNotice"]>>();
    const sent: NotificationInput[] = [];
    for (const { date, userId } of signedUp) {
      if (!notices.has(date)) notices.set(date, this.dateNotice(before, after, date));
      const notice = notices.get(date);
      if (notice) sent.push({ userId, kind: notice.kind, data: { ...notice.data, team }, url: "/calendar", teamId: before.teamId });
    }
    await this.notifications.notify(sent, by);
  }

  private summary(event: EventRow) {
    return {
      id: event.id,
      teamId: event.teamId,
      title: event.title,
      date: dateText(event.date),
      startTime: event.startTime,
      durationMinutes: event.durationMinutes,
      callMinutes: event.callMinutes,
      timeZone: event.timeZone,
      place: event.place,
      locationId: event.locationId,
      note: event.note,
      repeat: event.rehearsalForId ? null : (timingOf(event).repeat ?? null),
      parts: partsOf(event),
      rehearsalFor: event.rehearsalForId ? { eventId: event.rehearsalForId, daysBefore: event.daysBefore ?? 0 } : null,
      organizationEventId: event.organizationEventId,
      typeId: event.typeId,
      withSet: event.withSet,
      // Asked to become its organisation's (issue #549), waiting for its admins.
      transferRequestedAt: event.transferRequestedAt?.toISOString() ?? null,
    };
  }

  /** The event a rehearsal is for: one of the same team's, itself not a rehearsal, not the rehearsal itself. */
  private async rehearsalParent(teamId: string, eventId: string, self: string | null = null) {
    const parent = await this.prisma.client.teamEvent.findFirst({ where: { id: eventId, teamId } });
    if (!parent || parent.rehearsalForId || parent.id === self) throw new BadRequestException(["rehearsalFor.eventId must be another of the team's events, not a rehearsal"]);
    return parent;
  }

  /** An event type (issue #523): one of the team's. */
  private async checkType(teamId: string, typeId: string | null | undefined): Promise<string | null | undefined> {
    if (!typeId) return typeId;
    // The team's own, or its organisation's (issue #528).
    const organizationId = (await this.prisma.client.team.findUnique({ where: { id: teamId }, select: { organizationId: true } }))?.organizationId;
    const type = await this.prisma.client.teamEventType.findFirst({ where: { id: typeId, OR: [{ teamId }, ...(organizationId ? [{ organizationId }] : [])] }, select: { id: true } });
    if (!type) throw new BadRequestException(["typeId must be one of the team's event types"]);
    return type.id;
  }

  /**
   * Parts that name an instrument or role must be one: built in, or an
   * admin's custom instrument. A team's (`teamId`), or an organisation's
   * event type's (`{ organizationId }`, issue #528): no group's positions,
   * and its places open to the group the event is made in (OWN_TEAM) or
   * to named groups of its own.
   */
  async checkParts(parts: EventPart[] | undefined, owner: string | { organizationId: string }): Promise<Prisma.InputJsonValue | undefined> {
    if (!parts) return undefined;
    const teamId = typeof owner === "string" ? owner : null;
    // The group's own positions (issue #241): its, not another group's.
    const positionIds = parts.map((part) => part.position).filter((id): id is string => !!id);
    if (!teamId && positionIds.length > 0) throw new BadRequestException(["parts: an organisation's event type can't ask for a group's positions"]);
    const positions = new Map(teamId ? (await this.prisma.client.teamPosition.findMany({ where: { teamId, id: { in: positionIds } }, select: { id: true, name: true } })).map((row) => [row.id, row.name]) : []);
    const strangers = positionIds.filter((id) => !positions.has(id));
    if (strangers.length > 0) throw new BadRequestException(strangers.map((id) => `parts: "${id}" isn't one of the team's positions`));
    const keys = parts.map((part) => part.part).filter((key): key is string => !!key);
    const known = new Set<string>([...INSTRUMENTS, ...TECH_ROLES, ...EVENT_ONLY_PARTS]);
    const custom = new Set((await this.prisma.client.customInstrument.findMany({ where: { id: { in: keys.filter((key) => !known.has(key)) } }, select: { id: true } })).map((row) => row.id));
    const unknown = keys.filter((key) => !known.has(key) && !custom.has(key));
    if (unknown.length > 0) throw new BadRequestException(unknown.map((key) => `parts: "${key}" isn't an instrument or a role`));
    // Open places (issue #528): to the team itself or groups of its organisation, no other.
    const openTo = [...new Set(parts.flatMap((part) => part.openTo ?? []))];
    const mine = (id: string) => (teamId ? id === teamId : id === OWN_TEAM);
    if (openTo.some((id) => !mine(id))) {
      const organizationId = teamId ? (await this.prisma.client.team.findUnique({ where: { id: teamId }, select: { organizationId: true } }))?.organizationId : (owner as { organizationId: string }).organizationId;
      const near = new Set(organizationId ? (await this.prisma.client.team.findMany({ where: { organizationId, id: { in: openTo } }, select: { id: true } })).map((row) => row.id) : []);
      const far = openTo.filter((id) => !mine(id) && !near.has(id));
      if (far.length > 0) throw new BadRequestException(far.map((id) => `parts: "${id}" isn't this team or a group of its organisation`));
    }
    // What a part asks beyond its count (issue #528): only when set.
    // Who leads the set (issue #559): kept only when said, as Host and Music leader lead it otherwise.
    const extra = (part: EventPart) => ({ ...(part.required && { required: true }), ...(part.openTo?.length && { openTo: [...new Set(part.openTo)] }), ...(typeof part.leadsSet === "boolean" && { leadsSet: part.leadsSet }) });
    // A position keeps its name beside it, as it's shown (renaming it renames it there too).
    return parts.map((part) => ({
      ...(part.position ? { position: part.position, name: positions.get(part.position)!, count: part.count } : part.part ? { part: part.part, count: part.count } : { name: part.name, count: part.count }),
      ...extra(part),
    }));
  }

  async list(teamId: string) {
    const events = await this.prisma.client.teamEvent.findMany({ where: { teamId }, include: withDates, orderBy: { date: "asc" } });
    const planned = await this.plannedBy(events);
    return events.map((event) => ({ ...this.summary(event), planned: planned.get(event.organizationEventId ?? "") ?? null }));
  }

  /** The organisations' events some of these are a group's part of (issue #241): which, and who hosts it. */
  private async plannedBy(events: { organizationEventId: string | null }[]) {
    const ids = [...new Set(events.map((event) => event.organizationEventId).filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map<string, Planned>();
    const rows = await this.prisma.client.organizationEvent.findMany({
      where: { id: { in: ids } },
      select: { id: true, organizationId: true, organization: { select: { name: true } }, host: { select: { displayName: true } } },
    });
    return new Map<string, Planned>(rows.map((row) => [row.id, { organizationEventId: row.id, organizationId: row.organizationId, organizationName: row.organization.name, hostName: row.host?.displayName ?? null }]));
  }

  /** Refused for a group's part of an organisation's event, whose timing is the organisation's (issue #241). */
  private notPlanned(event: { organizationEventId: string | null }, planned: boolean) {
    if (event.organizationEventId && !planned) throw new BadRequestException(["This event is planned by its organisation: change it there"]);
  }

  private async find(teamId: string, eventId: string): Promise<EventRow> {
    const event = await this.prisma.client.teamEvent.findFirst({ where: { id: eventId, teamId }, include: withDates });
    if (!event) throw new NotFoundException("Event not found");
    return event;
  }

  async get(teamId: string, eventId: string) {
    const event = await this.find(teamId, eventId);
    return { ...this.summary(event), planned: (await this.plannedBy([event])).get(event.organizationEventId ?? "") ?? null };
  }

  /** `organizationEventId`: a group's part of an organisation's event (issue #241), made by it. */
  async create(teamId: string, userId: string, dto: CreateTeamEventDto, organizationEventId: string | null = null) {
    if (dto.repeat?.until && dto.repeat.until < dto.date) throw new BadRequestException(["repeat.until must not be before date"]);
    // A rehearsal (issue #235, phase 7): its dates are its event's; no repeat, parts or set of its own.
    const parent = dto.rehearsalFor ? await this.rehearsalParent(teamId, dto.rehearsalFor.eventId) : null;
    // Where it takes place (issue #320): its place is the location's name unless given.
    const location = dto.locationId ? await eventLocation(this.prisma, { teamId }, dto.locationId) : null;
    const event = await this.prisma.client.teamEvent.create({
      data: {
        teamId,
        title: dto.title,
        date: day(dto.date),
        startTime: dto.startTime,
        durationMinutes: dto.durationMinutes ?? 90,
        callMinutes: dto.callMinutes ?? null,
        timeZone: dto.timeZone,
        place: dto.place || location?.name || null,
        locationId: location?.id ?? null,
        note: dto.note || null,
        repeatEveryWeeks: parent ? null : (dto.repeat?.everyWeeks ?? null),
        repeatUntil: !parent && dto.repeat?.until ? day(dto.repeat.until) : null,
        parts: parent ? undefined : await this.checkParts(dto.parts, teamId),
        rehearsalForId: parent?.id ?? null,
        daysBefore: parent ? dto.rehearsalFor!.daysBefore : null,
        organizationEventId,
        typeId: (await this.checkType(teamId, dto.typeId)) ?? null,
        // Left out: a set for a Songverse team, none for a group that only plans (issue #531).
        withSet: dto.withSet ?? (await this.usesSongverse(teamId)),
        createdByUserId: userId,
      },
      include: withDates,
    });
    await this.makeSets(event.id);
    return this.summary(await this.find(teamId, event.id));
  }

  /** `planned`: the change comes from the organisation's event it's a group's part of (issue #241). */
  async update(teamId: string, eventId: string, dto: UpdateTeamEventDto, by: string | null = null, planned = false) {
    const before = await this.find(teamId, eventId);
    // The group's admins choose its parts, its call time and whether it has sets; the rest is the organisation's.
    if (Object.keys(dto).some((key) => !["parts", "callMinutes", "withSet"].includes(key) && dto[key as keyof UpdateTeamEventDto] !== undefined)) this.notPlanned(before, planned);
    const signedUp = await this.signedUp(eventId, localDate(new Date(), before.timeZone));
    const repeat = dto.repeat === undefined ? timingOf(before).repeat : dto.repeat;
    const date = dto.date ?? dateText(before.date);
    if (repeat?.until && repeat.until < date) throw new BadRequestException(["repeat.until must not be before date"]);
    const location = dto.locationId ? await eventLocation(this.prisma, { teamId }, dto.locationId) : null;
    await this.prisma.client.teamEvent.update({
      where: { id: eventId },
      data: {
        title: dto.title,
        date: dto.date ? day(dto.date) : undefined,
        startTime: dto.startTime,
        durationMinutes: dto.durationMinutes,
        callMinutes: dto.callMinutes,
        timeZone: dto.timeZone,
        // Another location, no place given: the location's name.
        place: dto.place === undefined && location && location.id !== before.locationId ? location.name : dto.place,
        locationId: dto.locationId,
        note: dto.note,
        repeatEveryWeeks: dto.repeat === undefined ? undefined : (dto.repeat?.everyWeeks ?? null),
        repeatUntil: dto.repeat === undefined ? undefined : dto.repeat?.until ? day(dto.repeat.until) : null,
        parts: await this.checkParts(dto.parts, teamId),
        typeId: await this.checkType(teamId, dto.typeId),
        withSet: dto.withSet,
        ...(dto.rehearsalFor === undefined
          ? {}
          : dto.rehearsalFor === null
            ? { rehearsalForId: null, daysBefore: null }
            : { rehearsalForId: (await this.rehearsalParent(teamId, dto.rehearsalFor.eventId, eventId)).id, daysBefore: dto.rehearsalFor.daysBefore, repeatEveryWeeks: null, repeatUntil: null }),
      },
    });
    const after = await this.find(teamId, eventId);
    // Coming dates the event no longer falls on: their sets leave it (deleted while empty), their changes go.
    const today = localDate(new Date(), after.timeZone);
    const timing = timingOf(after);
    for (const row of after.dates) {
      const rowDate = dateText(row.date);
      if (rowDate < today || eventFallsOn(timing, rowDate)) continue;
      await this.dropDate(row.id, row.setlist);
    }
    // No sets any more (issue #523): coming empty ones go, so they're made again if it changes back; sets with songs stay.
    if (before.withSet && !after.withSet) {
      for (const row of after.dates) {
        if (dateText(row.date) < today || !row.setlist || row.setlist._count.items > 0) continue;
        await this.prisma.client.$transaction([
          this.prisma.client.setlist.delete({ where: { id: row.setlist.id } }),
          this.prisma.client.teamEventDate.update({ where: { id: row.id }, data: { setCreatedAt: null } }),
        ]);
      }
    }
    // Answers for coming dates it no longer falls on go too.
    const answers = await this.prisma.client.teamEventAnswer.findMany({ where: { eventId, date: { gte: day(today) } }, select: { id: true, date: true } });
    const gone = answers.filter((answer) => !eventFallsOn(timing, dateText(answer.date))).map((answer) => answer.id);
    if (gone.length > 0) await this.prisma.client.teamEventAnswer.deleteMany({ where: { id: { in: gone } } });
    // Read again: the dates dropped above are gone.
    await this.syncSetNames(await this.find(teamId, eventId), today);
    await this.makeSets(eventId);
    const fresh = await this.find(teamId, eventId);
    await this.notifyDates(before, fresh, signedUp, by);
    return this.summary(fresh);
  }

  /**
   * Asked to become its organisation's event (issue #549), by one of the
   * team's admins, one-off or series: the organisation's admins are told,
   * and accept or decline it (OrganizationEventsService.acceptTransfer).
   * `ask` false takes the request back.
   */
  async requestTransfer(teamId: string, eventId: string, userId: string, ask = true) {
    const event = await this.find(teamId, eventId);
    if (event.organizationEventId) throw new BadRequestException(["This event is the organisation's already"]);
    if (event.rehearsalForId) throw new BadRequestException(["A rehearsal goes with its event: move that event"]);
    const team = await this.prisma.client.team.findUniqueOrThrow({ where: { id: teamId }, select: { name: true, organizationId: true } });
    if (!team.organizationId) throw new BadRequestException(["The team isn't part of an organisation"]);
    if (!ask) {
      await this.prisma.client.teamEvent.update({ where: { id: eventId }, data: { transferRequestedAt: null, transferRequestedByUserId: null } });
      return this.summary(await this.find(teamId, eventId));
    }
    if (event.transferRequestedAt) return this.summary(event);
    await this.prisma.client.teamEvent.update({ where: { id: eventId }, data: { transferRequestedAt: new Date(), transferRequestedByUserId: userId } });
    const [admins, by] = await Promise.all([
      this.prisma.client.organizationMembership.findMany({ where: { organizationId: team.organizationId, role: "ADMIN" }, select: { userId: true } }),
      this.prisma.client.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
    ]);
    await this.notifications.notify(
      admins.map((admin) => ({ userId: admin.userId, kind: "EVENT_TRANSFER_REQUESTED" as const, data: { event: event.title, team: team.name, by: by?.displayName ?? "" }, url: `/organizations/${team.organizationId}/events`, app: "planiverse" as const })),
      userId,
    );
    return this.summary(await this.find(teamId, eventId));
  }

  /** The event goes; its coming dates' empty sets with it, the rest stay as the team's sets. */
  async remove(teamId: string, eventId: string, by: string | null = null, planned = false): Promise<void> {
    const event = await this.find(teamId, eventId);
    this.notPlanned(event, planned);
    const today = localDate(new Date(), event.timeZone);
    const signedUp = await this.signedUp(eventId, today);
    const empty = event.dates.filter((row) => dateText(row.date) >= today && row.setlist && row.setlist._count.items === 0).map((row) => row.setlist!.id);
    await this.prisma.client.$transaction([this.prisma.client.setlist.deleteMany({ where: { id: { in: empty } } }), this.prisma.client.teamEvent.delete({ where: { id: eventId } })]);
    // Those signed up for a coming date of it are told, once each.
    const team = await this.teamName(teamId);
    const people = [...new Set(signedUp.map((one) => one.userId))];
    await this.notifications.notify(
      people.map((userId) => ({ userId, kind: "EVENT_CANCELLED", data: { event: event.title, team }, url: "/calendar", teamId })),
      by,
    );
  }

  /** A date's row and, while it has no songs, its set. */
  private async dropDate(rowId: string, setlist: { id: string; _count: { items: number } } | null) {
    await this.prisma.client.$transaction([
      ...(setlist && setlist._count.items === 0 ? [this.prisma.client.setlist.delete({ where: { id: setlist.id } })] : []),
      this.prisma.client.teamEventDate.delete({ where: { id: rowId } }),
    ]);
  }

  /** Coming dates' sets named after their date's title or the event's. */
  private async syncSetNames(event: EventRow, today: string) {
    for (const row of event.dates) {
      if (!row.setlist || dateText(row.date) < today) continue;
      await this.prisma.client.setlist.update({ where: { id: row.setlist.id }, data: { name: row.title || event.title } });
    }
  }

  /** The team's dates from `from` to `to`, every event's, in time order, with their sets. */
  async dates(teamId: string, from: string, to: string) {
    if (to < from) throw new BadRequestException(["to must not be before from"]);
    if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new BadRequestException([`to must be at most ${MAX_RANGE_DAYS} days after from`]);
    const events = await this.prisma.client.teamEvent.findMany({ where: { teamId }, include: withDates });
    return events
      .flatMap((event) => {
        const parent = event.rehearsalForId ? events.find((one) => one.id === event.rehearsalForId) : null;
        if (parent) {
          // A rehearsal: its event's dates, days before; the set it opens is that date's.
          const rows = new Map(parent.dates.map((row) => [dateText(row.date), row]));
          return rehearsalDatesOf(event, parent, from, to).map(({ forDate, ...date }) => ({
            ...this.dateSummary(event, date, rows.get(forDate)),
            rehearsalFor: { eventId: parent.id, date: forDate, title: rows.get(forDate)?.title || parent.title } as RehearsalOf | null,
          }));
        }
        const rows = new Map(event.dates.map((row) => [dateText(row.date), row]));
        return eventDates(timingOf(event), from, to, changesOf(event)).map((date) => ({ ...this.dateSummary(event, date, rows.get(date.date)), rehearsalFor: null as RehearsalOf | null }));
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  private dateSummary(event: EventRow, date: EventDate, row: EventRow["dates"][number] | undefined) {
    return {
      ...date,
      eventId: event.id,
      // Its own title, or the event's.
      title: date.title || event.title,
      ownTitle: date.title,
      eventTitle: event.title,
      place: event.place,
      locationId: event.locationId,
      timeZone: event.timeZone,
      callAt: callAt(date.startsAt, event.callMinutes),
      repeats: !!event.repeatEveryWeeks,
      withSet: event.withSet,
      setlistId: row?.setlist?.id ?? null,
      songCount: row?.setlist?._count.items ?? 0,
      // When an admin said its set is ready (issue #235).
      setReadyAt: row?.setReadyAt?.toISOString() ?? null,
      // The parts it needs (issue #235, phase 7), with what the date asks for besides (issue #549).
      parts: partsOf(event, date.date),
      asks: asksOn(event, date.date),
    };
  }

  /** One date changed by itself: cancelled (its empty set deleted), another time or title (its set renamed). */
  async updateDate(teamId: string, eventId: string, date: string, dto: UpdateTeamEventDateDto, by: string | null = null, planned = false) {
    const event = await this.find(teamId, eventId);
    this.notPlanned(event, planned);
    if (event.rehearsalForId) throw new BadRequestException(["A rehearsal follows its event's dates: change that event's date"]);
    if (!eventFallsOn(timingOf(event), date)) throw new NotFoundException("The event isn't on that date");
    const existing = event.dates.find((row) => dateText(row.date) === date);
    const data = {
      cancelled: dto.cancelled,
      startTime: dto.startTime === undefined ? undefined : dto.startTime === event.startTime ? null : dto.startTime,
      title: dto.title === undefined ? undefined : dto.title === event.title ? null : dto.title,
    };
    let row = existing
      ? await this.prisma.client.teamEventDate.update({ where: { id: existing.id }, data, include: withDates.dates.include })
      : await this.prisma.client.teamEventDate.create({ data: { eventId, date: day(date), ...data }, include: withDates.dates.include });
    if (row.cancelled && row.setlist && row.setlist._count.items === 0) {
      // Cleared, so the set comes back if the date does.
      await this.prisma.client.setlist.delete({ where: { id: row.setlist.id } });
      row = await this.prisma.client.teamEventDate.update({ where: { id: row.id }, data: { setCreatedAt: null }, include: withDates.dates.include });
    } else if (row.setlist) {
      await this.prisma.client.setlist.update({ where: { id: row.setlist.id }, data: { name: row.title || event.title } });
    }
    if (!row.cancelled) await this.makeSet(event, date);
    const fresh = await this.find(teamId, eventId);
    const signedUp = date >= localDate(new Date(), event.timeZone) ? (await this.signedUp(eventId, date)).filter((one) => one.date === date) : [];
    await this.notifyDates(event, fresh, signedUp, by);
    const [shown] = eventDates(timingOf(fresh), date, date, changesOf(fresh));
    return this.dateSummary(fresh, shown!, fresh.dates.find((one) => dateText(one.date) === date));
  }

  /**
   * What a date asks for besides its event's parts (issue #549): the
   * instruments its music lead wants that date, open to whoever the event's
   * Music part is (asksOpenTo). The team's admins and the date's music lead
   * ask; places on a part no longer asked for go with it.
   */
  async setAsks(teamId: string, eventId: string, date: string, dto: SetTeamEventDateAsksDto, userId: string, isAdmin: boolean) {
    const event = await this.find(teamId, eventId);
    if (event.rehearsalForId) throw new BadRequestException(["A rehearsal uses its event's line-up"]);
    if (!eventFallsOn(timingOf(event), date)) throw new NotFoundException("The event isn't on that date");
    if (date < localDate(new Date(), event.timeZone)) throw new BadRequestException(["That date is over"]);
    if (!isAdmin) {
      const lead = await this.prisma.client.teamEventAssignment.findFirst({ where: { eventId, date: day(date), partKey: MUSIC_LEADER, userId, status: { not: "DECLINED" } }, select: { id: true } });
      if (!lead) throw new ForbiddenException("Only the team's admins and the date's music lead ask for the date's instruments");
    }
    const openTo = asksOpenTo(partsOf(event), teamId);
    // Checked as the team's parts, without the teams they're open to: those are the Music part's.
    const checked = ((await this.checkParts(dto.parts.map((part) => ({ ...part, openTo: undefined })), teamId)) ?? []) as unknown as EventPart[];
    const asks = checked.map((part) => ({ ...part, openTo }));
    const before = asksOn(event, date).map((part) => partKey(part));
    await this.prisma.client.teamEventDate.upsert({
      where: { eventId_date: { eventId, date: day(date) } },
      create: { eventId, date: day(date), asks: asks as unknown as Prisma.InputJsonValue },
      update: { asks: asks.length > 0 ? (asks as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
    });
    const kept = new Set(withAsks(partsOf(event), asks).map((part) => partKey(part)));
    const gone = before.filter((key) => !kept.has(key));
    if (gone.length > 0) await this.prisma.client.teamEventAssignment.deleteMany({ where: { eventId, date: day(date), partKey: { in: gone } } });
    return { parts: asks };
  }

  /** A date's set now, however far ahead (someone opening it to plan). */
  async ensureDateSet(teamId: string, eventId: string, date: string) {
    const event = await this.find(teamId, eventId);
    if (event.rehearsalForId) throw new BadRequestException(["A rehearsal uses its event's set"]);
    if (!event.withSet) throw new BadRequestException(["This event's dates have no set"]);
    if (!eventFallsOn(timingOf(event), date)) throw new NotFoundException("The event isn't on that date");
    const setlistId = await this.makeSet(event, date, true);
    if (!setlistId) throw new BadRequestException(["That date is cancelled"]);
    return { setlistId };
  }

  /**
   * A date's set, made if it has none and never had one (a set someone
   * deleted isn't made again, unless `again`). Returns its ID, or null for
   * a cancelled date.
   */
  private async makeSet(event: EventRow, date: string, again = false): Promise<string | null> {
    const row = await this.prisma.client.teamEventDate.findUnique({ where: { eventId_date: { eventId: event.id, date: day(date) } } });
    if (row?.cancelled) return null;
    if (row?.setlistId) return row.setlistId;
    if (row?.setCreatedAt && !again) return null;
    // An event without sets (issue #523): its dates have none. A group that only plans has them too (issue #531): sets aren't only songs.
    if (!event.withSet) return null;
    return this.prisma.client.$transaction(async (tx) => {
      const set = await tx.setlist.create({ data: { ownerTeamId: event.teamId, name: row?.title || event.title, eventDate: day(date) } });
      await tx.teamEventDate.upsert({
        where: { eventId_date: { eventId: event.id, date: day(date) } },
        create: { eventId: event.id, date: day(date), setlistId: set.id, setCreatedAt: new Date() },
        update: { setlistId: set.id, setCreatedAt: new Date() },
      });
      return set.id;
    });
  }

  /** The sets of an event's dates from today to its team's `setsAheadWeeks` ahead. Returns how many were made. */
  async makeSets(eventId: string): Promise<number> {
    const event = await this.prisma.client.teamEvent.findUnique({ where: { id: eventId }, include: { ...withDates, team: { select: { setsAheadWeeks: true } } } });
    if (!event || event.rehearsalForId) return 0;
    const today = localDate(new Date(), event.timeZone);
    let made = 0;
    for (const date of eventDates(timingOf(event), today, addDays(today, event.team.setsAheadWeeks * 7), changesOf(event))) {
      if (date.cancelled) continue;
      const row = event.dates.find((one) => dateText(one.date) === date.date);
      if (row?.setlistId || row?.setCreatedAt) continue;
      if (await this.makeSet(event, date.date)) made++;
    }
    return made;
  }

  private async usesSongverse(teamId: string): Promise<boolean> {
    return (await this.prisma.client.team.findUnique({ where: { id: teamId }, select: { usesSongverse: true } }))?.usesSongverse ?? true;
  }

  /** Every team's coming sets (the daily job). */
  async makeAllSets(): Promise<number> {
    const events = await this.prisma.client.teamEvent.findMany({ where: { rehearsalForId: null, withSet: true }, select: { id: true } });
    let made = 0;
    for (const { id } of events) made += await this.makeSets(id);
    return made;
  }

  async calendarSettings(teamId: string) {
    const team = await this.prisma.client.team.findUnique({ where: { id: teamId }, select: { setsAheadWeeks: true } });
    if (!team) throw new NotFoundException("Team not found");
    return team;
  }

  async updateCalendarSettings(teamId: string, dto: UpdateTeamCalendarDto) {
    const team = await this.prisma.client.team.update({ where: { id: teamId }, data: { setsAheadWeeks: dto.setsAheadWeeks }, select: { setsAheadWeeks: true } });
    // Further ahead: made now. Nearer: the sets already made stay.
    const events = await this.prisma.client.teamEvent.findMany({ where: { teamId }, select: { id: true } });
    for (const { id } of events) await this.makeSets(id);
    return team;
  }
}
