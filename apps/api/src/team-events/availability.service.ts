import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AVAILABILITY_ANSWERS, partCoverage, type EventPart, daysBetween, effectiveAnswer, eventDates, eventFallsOn, localDate, type AvailabilityAnswer, type AwayRange } from "@songverse/core";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AnswerEventDateDto, CreateAwayDto } from "./dto/team-events.dto.js";
import { changesOf, dateText, day, timingOf, withDates, type EventRow } from "./team-events.service.js";

/** The longest range of dates asked for at once. */
const MAX_RANGE_DAYS = 400;

const key = (eventId: string, date: string) => `${eventId}|${date}`;

/** Counts of a date's answers among the team's members: no answer is counted, never taken as Available. */
export type AnswerCounts = Record<AvailabilityAnswer | "NONE", number>;

/**
 * Who can play when (issue #235): each person's answer for an event's
 * date - Available, If needed, Not available, with a note seen only by
 * them and the team's admins - and the days they're away, across all
 * their teams, which answer Not available for every date in them that
 * they haven't answered themselves. Admins see everyone's answers and can
 * answer for someone (marked as theirs).
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async awayOf(userIds: string[], from: string, to: string): Promise<Map<string, (AwayRange & { note: string | null })[]>> {
    const rows = await this.prisma.client.userAway.findMany({ where: { userId: { in: userIds }, from: { lte: day(to) }, to: { gte: day(from) } } });
    const byUser = new Map<string, (AwayRange & { note: string | null })[]>();
    for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), { from: dateText(row.from), to: dateText(row.to), note: row.note }]);
    return byUser;
  }

  /**
   * The viewer's answer on each of `dates`, and for the team's admins the
   * counts among its members and how its parts are covered (issue #235,
   * phase 7). Dates come from TeamEventsService.dates().
   */
  async withAnswers<T extends { eventId: string; date: string; parts?: EventPart[] }>(teamId: string, viewerId: string, isAdmin: boolean, dates: T[]) {
    if (dates.length === 0) return [];
    const from = dates.reduce((min, d) => (d.date < min ? d.date : min), dates[0]!.date);
    const to = dates.reduce((max, d) => (d.date > max ? d.date : max), dates[0]!.date);
    const memberRows = isAdmin ? await this.prisma.client.teamMembership.findMany({ where: { teamId }, select: { userId: true, user: { select: { instruments: true, techRoles: true } } } }) : [];
    const members = isAdmin ? memberRows.map((m) => m.userId) : [viewerId];
    const userIds = members.includes(viewerId) ? members : [...members, viewerId];
    const [answers, away] = await Promise.all([
      this.prisma.client.teamEventAnswer.findMany({
        where: { eventId: { in: [...new Set(dates.map((d) => d.eventId))] }, date: { gte: day(from), lte: day(to) }, userId: { in: userIds } },
      }),
      this.awayOf(userIds, from, to),
    ]);
    const byDate = new Map<string, typeof answers>();
    for (const answer of answers) {
      const k = key(answer.eventId, dateText(answer.date));
      byDate.set(k, [...(byDate.get(k) ?? []), answer]);
    }
    return dates.map((date) => {
      const given = byDate.get(key(date.eventId, date.date)) ?? [];
      const mine = given.find((answer) => answer.userId === viewerId);
      const myAnswer = { ...effectiveAnswer(mine?.answer ?? null, away.get(viewerId) ?? [], date.date), note: mine?.note ?? null, byAdmin: !!mine?.answeredByUserId };
      let counts: AnswerCounts | null = null;
      let coverage: ReturnType<typeof partCoverage> | null = null;
      if (isAdmin) {
        counts = { AVAILABLE: 0, IF_NEEDED: 0, UNAVAILABLE: 0, NONE: 0 };
        const answered = memberRows.map(({ userId, user }) => {
          const own = given.find((answer) => answer.userId === userId)?.answer ?? null;
          return { ...user, answer: effectiveAnswer(own, away.get(userId) ?? [], date.date).answer };
        });
        for (const member of answered) counts[member.answer ?? "NONE"]++;
        if (date.parts?.length) coverage = partCoverage(date.parts, answered);
      }
      return { ...date, myAnswer, counts, coverage };
    });
  }

  private async eventOn(teamId: string, eventId: string, date: string): Promise<EventRow> {
    const event = await this.prisma.client.teamEvent.findFirst({ where: { id: eventId, teamId }, include: withDates });
    if (!event || !eventFallsOn(timingOf(event), date)) throw new NotFoundException("The event isn't on that date");
    if (date < localDate(new Date(), event.timeZone)) throw new BadRequestException(["That date is over"]);
    return event;
  }

  /** Someone's answer for a date: their own, or an admin's for them (`by`). */
  async answer(teamId: string, eventId: string, date: string, userId: string, dto: AnswerEventDateDto, by: string | null = null) {
    const event = await this.eventOn(teamId, eventId, date);
    if (by) {
      const member = await this.prisma.client.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId } } });
      if (!member) throw new NotFoundException("Not a member of the team");
    }
    const data = { answer: dto.answer, note: dto.note === undefined ? undefined : dto.note, answeredByUserId: by };
    const row = await this.prisma.client.teamEventAnswer.upsert({
      where: { eventId_date_userId: { eventId, date: day(date), userId } },
      create: { eventId, date: day(date), userId, ...data, note: dto.note ?? null },
      update: data,
    });
    if (by) {
      // They're told an admin answered for them (issue #236).
      const [admin, team] = await Promise.all([this.prisma.client.user.findUnique({ where: { id: by }, select: { displayName: true } }), this.prisma.client.team.findUnique({ where: { id: teamId }, select: { name: true } })]);
      const [shown] = eventDates(timingOf(event), date, date, changesOf(event));
      await this.notifications.notify([{ userId, kind: "ANSWERED_FOR_YOU", data: { event: shown?.title || event.title, date, team: team?.name ?? "", answer: row.answer, by: admin?.displayName ?? "" }, url: "/calendar" }], by);
    }
    return { answer: row.answer, note: row.note, away: false, byAdmin: !!row.answeredByUserId };
  }

  /** A date's answer taken back: no answer again (or away, if the date is in a range they're away). */
  async clear(teamId: string, eventId: string, date: string, userId: string): Promise<void> {
    await this.eventOn(teamId, eventId, date);
    await this.prisma.client.teamEventAnswer.deleteMany({ where: { eventId, date: day(date), userId } });
  }

  /** Every member's answer for a date, for the team's admins: with their notes, who answered, and whether they're away. */
  async answersFor(teamId: string, eventId: string, date: string) {
    const event = await this.prisma.client.teamEvent.findFirst({ where: { id: eventId, teamId }, include: withDates });
    if (!event || !eventFallsOn(timingOf(event), date)) throw new NotFoundException("The event isn't on that date");
    const members = await this.prisma.client.teamMembership.findMany({
      where: { teamId },
      select: { role: true, user: { select: { id: true, displayName: true, avatarUrl: true, instruments: true, techRoles: true } } },
    });
    const userIds = members.map((m) => m.user.id);
    const [answers, away] = await Promise.all([
      this.prisma.client.teamEventAnswer.findMany({ where: { eventId, date: day(date), userId: { in: userIds } }, include: { answeredBy: { select: { displayName: true } } } }),
      this.awayOf(userIds, date, date),
    ]);
    const order: (AvailabilityAnswer | null)[] = [...AVAILABILITY_ANSWERS, null];
    return members
      .map(({ user, role }) => {
        const own = answers.find((answer) => answer.userId === user.id);
        const ranges = away.get(user.id) ?? [];
        const shown = effectiveAnswer(own?.answer ?? null, ranges, date);
        return {
          userId: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          instruments: user.instruments,
          techRoles: user.techRoles,
          role,
          ...shown,
          note: own?.note ?? (shown.away ? (ranges[0]?.note ?? null) : null),
          answeredBy: own?.answeredBy?.displayName ?? null,
        };
      })
      .sort((a, b) => order.indexOf(a.answer) - order.indexOf(b.answer) || a.displayName.localeCompare(b.displayName));
  }

  // --- the days someone is away

  async awayList(userId: string) {
    const rows = await this.prisma.client.userAway.findMany({ where: { userId }, orderBy: { from: "asc" } });
    return rows.map((row) => ({ id: row.id, from: dateText(row.from), to: dateText(row.to), note: row.note }));
  }

  async addAway(userId: string, dto: CreateAwayDto) {
    if (daysBetween(dto.from, dto.to) > 366) throw new BadRequestException(["to must be at most a year after from"]);
    const row = await this.prisma.client.userAway.create({ data: { userId, from: day(dto.from), to: day(dto.to), note: dto.note || null } });
    return { id: row.id, from: dto.from, to: dto.to, note: row.note };
  }

  /** Days away changed: their first and last day, and note. */
  async updateAway(userId: string, id: string, dto: CreateAwayDto) {
    if (daysBetween(dto.from, dto.to) > 366) throw new BadRequestException(["to must be at most a year after from"]);
    const { count } = await this.prisma.client.userAway.updateMany({ where: { id, userId }, data: { from: day(dto.from), to: day(dto.to), note: dto.note || null } });
    if (count === 0) throw new NotFoundException("Not found");
    return { id, from: dto.from, to: dto.to, note: dto.note || null };
  }

  async removeAway(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.client.userAway.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException("Not found");
  }

  // --- someone's calendar, across their teams

  /** The dates of every team someone is in, from `from` to `to`, with their answer and each date's set. */
  async myDates(userId: string, from: string, to: string) {
    if (to < from) throw new BadRequestException(["to must not be before from"]);
    if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new BadRequestException([`to must be at most ${MAX_RANGE_DAYS} days after from`]);
    const memberships = await this.prisma.client.teamMembership.findMany({ where: { userId }, select: { teamId: true, role: true, team: { select: { name: true, color: true, avatarUrl: true } } } });
    const events = await this.prisma.client.teamEvent.findMany({ where: { teamId: { in: memberships.map((m) => m.teamId) } }, include: withDates });
    const [answers, away] = await Promise.all([
      this.prisma.client.teamEventAnswer.findMany({ where: { userId, eventId: { in: events.map((e) => e.id) }, date: { gte: day(from), lte: day(to) } } }),
      this.awayOf([userId], from, to),
    ]);
    const answerOf = new Map(answers.map((answer) => [key(answer.eventId, dateText(answer.date)), answer]));
    return events
      .flatMap((event) => {
        const team = memberships.find((m) => m.teamId === event.teamId)!;
        const rows = new Map(event.dates.map((row) => [dateText(row.date), row]));
        return eventDates(timingOf(event), from, to, changesOf(event)).map((date) => {
          const mine = answerOf.get(key(event.id, date.date));
          const row = rows.get(date.date);
          return {
            ...date,
            eventId: event.id,
            title: date.title || event.title,
            place: event.place,
            timeZone: event.timeZone,
            repeats: !!event.repeatEveryWeeks,
            teamId: event.teamId,
            teamName: team.team.name,
            teamColor: team.team.color,
            teamAvatarUrl: team.team.avatarUrl,
            isAdmin: team.role === "ADMIN",
            setlistId: row?.setlist?.id ?? null,
            songCount: row?.setlist?._count.items ?? 0,
            myAnswer: { ...effectiveAnswer(mine?.answer ?? null, away.get(userId) ?? [], date.date), note: mine?.note ?? null, byAdmin: !!mine?.answeredByUserId },
          };
        });
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
}
