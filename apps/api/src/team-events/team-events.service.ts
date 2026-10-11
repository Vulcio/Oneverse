import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { addDays, daysBetween, eventDates, eventFallsOn, INSTRUMENTS, localDate, TECH_ROLES, type EventDate, type EventPart, type EventTiming } from "@songverse/core";
import type { Prisma } from "@songverse/db";
import { NotificationsService, type NotificationInput } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateTeamEventDto, UpdateTeamCalendarDto, UpdateTeamEventDateDto, UpdateTeamEventDto } from "./dto/team-events.dto.js";

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

/** The parts an event needs (issue #235, phase 7), as stored. */
export function partsOf(event: { parts: Prisma.JsonValue }): EventPart[] {
  return Array.isArray(event.parts) ? (event.parts as unknown as EventPart[]) : [];
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

  /** Who signed up (answered Available) for an event's coming dates, from `today`: each date and its people. */
  private async signedUp(eventId: string, today: string): Promise<{ date: string; userId: string }[]> {
    const rows = await this.prisma.client.teamEventAnswer.findMany({ where: { eventId, answer: "AVAILABLE", date: { gte: day(today) } }, select: { date: true, userId: true } });
    return rows.map((row) => ({ date: dateText(row.date), userId: row.userId }));
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
      if (notice) sent.push({ userId, kind: notice.kind, data: { ...notice.data, team }, url: "/calendar" });
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
      timeZone: event.timeZone,
      place: event.place,
      note: event.note,
      repeat: timingOf(event).repeat ?? null,
      parts: partsOf(event),
    };
  }

  /** Parts that name an instrument or role must be one: built in, or an admin's custom instrument. */
  private async checkParts(parts: EventPart[] | undefined): Promise<Prisma.InputJsonValue | undefined> {
    if (!parts) return undefined;
    const keys = parts.map((part) => part.part).filter((key): key is string => !!key);
    const known = new Set<string>([...INSTRUMENTS, ...TECH_ROLES]);
    const custom = new Set((await this.prisma.client.customInstrument.findMany({ where: { id: { in: keys.filter((key) => !known.has(key)) } }, select: { id: true } })).map((row) => row.id));
    const unknown = keys.filter((key) => !known.has(key) && !custom.has(key));
    if (unknown.length > 0) throw new BadRequestException(unknown.map((key) => `parts: "${key}" isn't an instrument or a role`));
    return parts.map((part) => (part.part ? { part: part.part, count: part.count } : { name: part.name, count: part.count }));
  }

  async list(teamId: string) {
    const events = await this.prisma.client.teamEvent.findMany({ where: { teamId }, include: withDates, orderBy: { date: "asc" } });
    return events.map((event) => this.summary(event));
  }

  private async find(teamId: string, eventId: string): Promise<EventRow> {
    const event = await this.prisma.client.teamEvent.findFirst({ where: { id: eventId, teamId }, include: withDates });
    if (!event) throw new NotFoundException("Event not found");
    return event;
  }

  async get(teamId: string, eventId: string) {
    return this.summary(await this.find(teamId, eventId));
  }

  async create(teamId: string, userId: string, dto: CreateTeamEventDto) {
    if (dto.repeat?.until && dto.repeat.until < dto.date) throw new BadRequestException(["repeat.until must not be before date"]);
    const event = await this.prisma.client.teamEvent.create({
      data: {
        teamId,
        title: dto.title,
        date: day(dto.date),
        startTime: dto.startTime,
        durationMinutes: dto.durationMinutes ?? 90,
        timeZone: dto.timeZone,
        place: dto.place || null,
        note: dto.note || null,
        repeatEveryWeeks: dto.repeat?.everyWeeks ?? null,
        repeatUntil: dto.repeat?.until ? day(dto.repeat.until) : null,
        parts: await this.checkParts(dto.parts),
        createdByUserId: userId,
      },
      include: withDates,
    });
    await this.makeSets(event.id);
    return this.summary(await this.find(teamId, event.id));
  }

  async update(teamId: string, eventId: string, dto: UpdateTeamEventDto, by: string | null = null) {
    const before = await this.find(teamId, eventId);
    const signedUp = await this.signedUp(eventId, localDate(new Date(), before.timeZone));
    const repeat = dto.repeat === undefined ? timingOf(before).repeat : dto.repeat;
    const date = dto.date ?? dateText(before.date);
    if (repeat?.until && repeat.until < date) throw new BadRequestException(["repeat.until must not be before date"]);
    await this.prisma.client.teamEvent.update({
      where: { id: eventId },
      data: {
        title: dto.title,
        date: dto.date ? day(dto.date) : undefined,
        startTime: dto.startTime,
        durationMinutes: dto.durationMinutes,
        timeZone: dto.timeZone,
        place: dto.place,
        note: dto.note,
        repeatEveryWeeks: dto.repeat === undefined ? undefined : (dto.repeat?.everyWeeks ?? null),
        repeatUntil: dto.repeat === undefined ? undefined : dto.repeat?.until ? day(dto.repeat.until) : null,
        parts: await this.checkParts(dto.parts),
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

  /** The event goes; its coming dates' empty sets with it, the rest stay as the team's sets. */
  async remove(teamId: string, eventId: string, by: string | null = null): Promise<void> {
    const event = await this.find(teamId, eventId);
    const today = localDate(new Date(), event.timeZone);
    const signedUp = await this.signedUp(eventId, today);
    const empty = event.dates.filter((row) => dateText(row.date) >= today && row.setlist && row.setlist._count.items === 0).map((row) => row.setlist!.id);
    await this.prisma.client.$transaction([this.prisma.client.setlist.deleteMany({ where: { id: { in: empty } } }), this.prisma.client.teamEvent.delete({ where: { id: eventId } })]);
    // Those signed up for a coming date of it are told, once each.
    const team = await this.teamName(teamId);
    const people = [...new Set(signedUp.map((one) => one.userId))];
    await this.notifications.notify(
      people.map((userId) => ({ userId, kind: "EVENT_CANCELLED", data: { event: event.title, team }, url: "/calendar" })),
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
        const rows = new Map(event.dates.map((row) => [dateText(row.date), row]));
        return eventDates(timingOf(event), from, to, changesOf(event)).map((date) => this.dateSummary(event, date, rows.get(date.date)));
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
      timeZone: event.timeZone,
      repeats: !!event.repeatEveryWeeks,
      setlistId: row?.setlist?.id ?? null,
      songCount: row?.setlist?._count.items ?? 0,
      // When an admin said its set is ready (issue #235).
      setReadyAt: row?.setReadyAt?.toISOString() ?? null,
      // The parts it needs (issue #235, phase 7).
      parts: partsOf(event),
    };
  }

  /** One date changed by itself: cancelled (its empty set deleted), another time or title (its set renamed). */
  async updateDate(teamId: string, eventId: string, date: string, dto: UpdateTeamEventDateDto, by: string | null = null) {
    const event = await this.find(teamId, eventId);
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

  /** A date's set now, however far ahead (someone opening it to plan). */
  async ensureDateSet(teamId: string, eventId: string, date: string) {
    const event = await this.find(teamId, eventId);
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
    if (!event) return 0;
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

  /** Every team's coming sets (the daily job). */
  async makeAllSets(): Promise<number> {
    const events = await this.prisma.client.teamEvent.findMany({ select: { id: true } });
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
