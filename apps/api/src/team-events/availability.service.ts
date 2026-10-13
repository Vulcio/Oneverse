import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AVAILABILITY_ANSWERS, coversPart, partCoverage, partKey, type EventPart, daysBetween, effectiveAnswer, eventDates, eventFallsOn, localDate, type AvailabilityAnswer, type AwayRange } from "@songverse/core";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AnswerEventDateDto, CreateAwayDto } from "./dto/team-events.dto.js";
import { placesElsewhere, type LineupConflict } from "./lineup.service.js";
import { signedUpFor, signupKey } from "./signups.js";
import { changesOf, dateText, day, partsOf, rehearsalDatesOf, timingOf, withDates, type EventRow, type RehearsalOf } from "./team-events.service.js";

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
  async withAnswers<T extends { eventId: string; date: string; startsAt: string; endsAt: string; parts?: EventPart[]; rehearsalFor?: object | null }>(teamId: string, viewerId: string, isAdmin: boolean, dates: T[]) {
    if (dates.length === 0) return [];
    const from = dates.reduce((min, d) => (d.date < min ? d.date : min), dates[0]!.date);
    const to = dates.reduce((max, d) => (d.date > max ? d.date : max), dates[0]!.date);
    const memberRows = isAdmin ? await this.prisma.client.teamMembership.findMany({ where: { teamId }, select: { userId: true, positionIds: true, user: { select: { instruments: true, techRoles: true } } } }) : [];
    // The team's members: anyone else on a line-up is a guest.
    const memberIds = new Set((await this.prisma.client.teamMembership.findMany({ where: { teamId }, select: { userId: true } })).map((m) => m.userId));
    // What the viewer plays: places offered for a swap they could take.
    const viewerUser = await this.prisma.client.user.findUnique({ where: { id: viewerId }, select: { instruments: true, techRoles: true } });
    // …and the group's positions they cover (issue #241).
    const viewerMembership = await this.prisma.client.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: viewerId } }, select: { positionIds: true } });
    const viewer = viewerUser ? { ...viewerUser, positionIds: viewerMembership?.positionIds ?? [] } : null;
    const members = isAdmin ? memberRows.map((m) => m.userId) : [viewerId];
    const userIds = members.includes(viewerId) ? members : [...members, viewerId];
    const [answers, away, lineupRows] = await Promise.all([
      this.prisma.client.teamEventAnswer.findMany({
        where: { eventId: { in: [...new Set(dates.map((d) => d.eventId))] }, date: { gte: day(from), lte: day(to) }, userId: { in: userIds } },
      }),
      this.awayOf(userIds, from, to),
      this.prisma.client.teamEventAssignment.findMany({
        where: { eventId: { in: [...new Set(dates.map((d) => d.eventId))] }, date: { gte: day(from), lte: day(to) } },
        include: { user: { select: { displayName: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    // For the admins: the places that clash with another of the person's, at the same time.
    const dateOf = new Map(dates.map((d) => [key(d.eventId, d.date), d]));
    const elsewhere = isAdmin
      ? await placesElsewhere(
          this.prisma.client,
          lineupRows.flatMap((row) => {
            const when = dateOf.get(key(row.eventId, dateText(row.date)));
            return when && row.userId && row.status !== "DECLINED" ? [{ id: row.id, userId: row.userId, eventId: row.eventId, date: when.date, startsAt: when.startsAt, endsAt: when.endsAt }] : [];
          }),
        )
      : new Set<string>();
    const byDate = new Map<string, typeof answers>();
    for (const answer of answers) {
      const k = key(answer.eventId, dateText(answer.date));
      byDate.set(k, [...(byDate.get(k) ?? []), answer]);
    }
    return dates.map((date) => {
      const given = byDate.get(key(date.eventId, date.date)) ?? [];
      const mine = given.find((answer) => answer.userId === viewerId);
      const myAnswer = { ...effectiveAnswer(mine?.answer ?? null, away.get(viewerId) ?? [], date.date), note: mine?.note ?? null, byAdmin: !!mine?.answeredByUserId };
      const placed = lineupRows.filter((row) => row.eventId === date.eventId && dateText(row.date) === date.date);
      let counts: AnswerCounts | null = null;
      let coverage: ReturnType<typeof partCoverage> | null = null;
      const shownOf = new Map<string, { answer: AvailabilityAnswer | null; away: boolean }>();
      // A rehearsal takes no answers: nothing to count.
      if (isAdmin && !date.rehearsalFor) {
        counts = { AVAILABLE: 0, IF_NEEDED: 0, UNAVAILABLE: 0, NONE: 0 };
        const answered = memberRows.map(({ userId, user, positionIds }) => {
          const own = given.find((answer) => answer.userId === userId)?.answer ?? null;
          const shown = effectiveAnswer(own, away.get(userId) ?? [], date.date);
          shownOf.set(userId, shown);
          return { ...user, positionIds, answer: shown.answer };
        });
        for (const member of answered) counts[member.answer ?? "NONE"]++;
        if (date.parts?.length) coverage = partCoverage(date.parts, answered, placed);
      }
      // Who's on which part (issue #235, phase 7): for everyone; their notes and the clashes, for the admins and themselves.
      const lineup = placed.map((row) => {
        const mine = row.userId === viewerId;
        const conflicts: LineupConflict[] = [];
        if (isAdmin && row.status !== "DECLINED") {
          const shown = row.userId ? shownOf.get(row.userId) : undefined;
          if (shown?.away) conflicts.push("AWAY");
          else if (shown?.answer === "UNAVAILABLE") conflicts.push("UNAVAILABLE");
          if (elsewhere.has(row.id)) conflicts.push("ELSEWHERE");
        }
        const part = date.parts?.find((one) => partKey(one) === row.partKey);
        const onIt = placed.some((other) => other.userId === viewerId && other.partKey === row.partKey && other.status !== "DECLINED");
        return {
          id: row.id,
          userId: row.userId,
          displayName: row.user?.displayName ?? row.guestName ?? "",
          partKey: row.partKey,
          status: row.status,
          // A guest (issue #235, phase 7): one of an admin's People, or someone without an account.
          guest: !row.userId ? ("external" as const) : memberIds.has(row.userId) ? null : ("account" as const),
          mine,
          note: isAdmin || mine ? row.note : null,
          conflicts,
          // A replacement looked for (issue #235, phase 7), and whether the viewer could take it.
          swap: row.swapRequestedAt && row.status !== "DECLINED" ? { requestedAt: row.swapRequestedAt.toISOString(), note: row.swapNote } : null,
          canTake: !!row.swapRequestedAt && row.status !== "DECLINED" && !mine && !onIt && !!part && !!viewer && coversPart(viewer, part),
        };
      });
      return { ...date, myAnswer, counts, coverage, lineup };
    });
  }

  private async eventOn(teamId: string, eventId: string, date: string): Promise<EventRow> {
    const event = await this.prisma.client.teamEvent.findFirst({ where: { id: eventId, teamId }, include: withDates });
    if (event?.rehearsalForId) throw new BadRequestException(["A rehearsal follows its event's line-up: answer for that event"]);
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
      await this.notifications.notify([{ userId, kind: "ANSWERED_FOR_YOU", data: { event: shown?.title || event.title, date, team: team?.name ?? "", answer: row.answer, by: admin?.displayName ?? "" }, url: "/calendar", teamId }], by);
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
      select: { role: true, positionIds: true, user: { select: { id: true, displayName: true, avatarUrl: true, instruments: true, techRoles: true } } },
    });
    const userIds = members.map((m) => m.user.id);
    const [answers, away] = await Promise.all([
      this.prisma.client.teamEventAnswer.findMany({ where: { eventId, date: day(date), userId: { in: userIds } }, include: { answeredBy: { select: { displayName: true } } } }),
      this.awayOf(userIds, date, date),
    ]);
    const order: (AvailabilityAnswer | null)[] = [...AVAILABILITY_ANSWERS, null];
    return members
      .map(({ user, role, positionIds }) => {
        const own = answers.find((answer) => answer.userId === user.id);
        const ranges = away.get(user.id) ?? [];
        const shown = effectiveAnswer(own?.answer ?? null, ranges, date);
        return {
          userId: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          instruments: user.instruments,
          techRoles: user.techRoles,
          positionIds,
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
    const memberships = await this.prisma.client.teamMembership.findMany({ where: { userId }, select: { teamId: true, role: true, positionIds: true, team: { select: { name: true, color: true, avatarUrl: true } } } });
    // The positions they cover, team by team (issue #241).
    const positionsIn = new Map(memberships.map((m) => [m.teamId, m.positionIds]));
    const me = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { instruments: true, techRoles: true } });
    const memberTeams = new Set(memberships.map((m) => m.teamId));
    // A guest's dates too (issue #235, phase 7): the events of other teams they're on a line-up for.
    const guestOn = await this.prisma.client.teamEventAssignment.findMany({ where: { userId, date: { gte: day(from), lte: day(to) }, event: { teamId: { notIn: [...memberTeams] } } }, select: { eventId: true, date: true } });
    const guestDates = new Set(guestOn.map((row) => key(row.eventId, dateText(row.date))));
    const events = await this.prisma.client.teamEvent.findMany({
      where: { OR: [{ teamId: { in: [...memberTeams] } }, { id: { in: guestOn.map((row) => row.eventId) } }, { rehearsalForId: { in: guestOn.map((row) => row.eventId) } }] },
      include: { ...withDates, team: { select: { name: true, color: true, avatarUrl: true } } },
    });
    const [answers, away, lineupRows] = await Promise.all([
      this.prisma.client.teamEventAnswer.findMany({ where: { userId, eventId: { in: events.map((e) => e.id) }, date: { gte: day(from), lte: day(to) } } }),
      this.awayOf([userId], from, to),
      this.prisma.client.teamEventAssignment.findMany({
        where: { eventId: { in: events.map((e) => e.id) }, date: { gte: day(from), lte: day(to) } },
        include: { user: { select: { displayName: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const answerOf = new Map(answers.map((answer) => [key(answer.eventId, dateText(answer.date)), answer]));
    // Rehearsals (issue #235, phase 7): shown for the dates one signed up for.
    const rehearsalsOf = events.flatMap((event) => {
      const parent = event.rehearsalForId ? events.find((one) => one.id === event.rehearsalForId) : null;
      return parent ? rehearsalDatesOf(event, parent, from, to).map((date) => ({ event, parent, date })) : [];
    });
    const signedUp = await signedUpFor(this.prisma.client, rehearsalsOf.map(({ parent, date }) => ({ eventId: parent.id, date: date.forDate })));
    const rehearsalItems = rehearsalsOf
      .filter(({ parent, date }) => signedUp.get(signupKey(parent.id, date.forDate))?.includes(userId))
      .map(({ event, parent, date: { forDate, ...date } }) => {
        const membership = memberships.find((m) => m.teamId === event.teamId);
        const row = parent.dates.find((one) => dateText(one.date) === forDate);
        return {
          ...date,
          eventId: event.id,
          title: event.title,
          place: event.place,
          timeZone: event.timeZone,
          repeats: !!parent.repeatEveryWeeks,
          teamId: event.teamId,
          teamName: event.team.name,
          teamColor: event.team.color,
          teamAvatarUrl: event.team.avatarUrl,
          isAdmin: membership?.role === "ADMIN",
          guest: !membership,
          setlistId: row?.setlist?.id ?? null,
          songCount: row?.setlist?._count.items ?? 0,
          myAnswer: { answer: null, away: false, note: null, byAdmin: false },
          parts: [],
          lineup: [],
          rehearsalFor: { eventId: parent.id, date: forDate, title: row?.title || parent.title } as RehearsalOf | null,
        };
      });
    return [
      ...rehearsalItems,
      ...events.filter((event) => !event.rehearsalForId).flatMap((event) => {
        const membership = memberships.find((m) => m.teamId === event.teamId);
        const rows = new Map(event.dates.map((row) => [dateText(row.date), row]));
        // In another team's event as a guest: only the dates one's on the line-up.
        return eventDates(timingOf(event), from, to, changesOf(event)).filter((date) => membership || guestDates.has(key(event.id, date.date))).map((date) => {
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
            teamName: event.team.name,
            teamColor: event.team.color,
            teamAvatarUrl: event.team.avatarUrl,
            isAdmin: membership?.role === "ADMIN",
            guest: !membership,
            setlistId: row?.setlist?.id ?? null,
            songCount: row?.setlist?._count.items ?? 0,
            myAnswer: { ...effectiveAnswer(mine?.answer ?? null, away.get(userId) ?? [], date.date), note: mine?.note ?? null, byAdmin: !!mine?.answeredByUserId },
            parts: partsOf(event),
            rehearsalFor: null as RehearsalOf | null,
            // Who's on which part; one's own place to accept or decline.
            lineup: lineupRows
              .filter((row) => row.eventId === event.id && dateText(row.date) === date.date)
              .map((row) => {
                const part = partsOf(event).find((one) => partKey(one) === row.partKey);
                const offered = !!row.swapRequestedAt && row.status !== "DECLINED";
                const onIt = lineupRows.some((other) => other.eventId === row.eventId && dateText(other.date) === date.date && other.userId === userId && other.partKey === row.partKey && other.status !== "DECLINED");
                return {
                  id: row.id,
                  userId: row.userId,
                  displayName: row.user?.displayName ?? row.guestName ?? "",
                  partKey: row.partKey,
                  status: row.status,
                  guest: !row.userId ? ("external" as const) : row.userId === userId && !memberTeams.has(event.teamId) ? ("account" as const) : null,
                  mine: row.userId === userId,
                  note: row.userId === userId ? row.note : null,
                  conflicts: [] as LineupConflict[],
                  swap: offered ? { requestedAt: row.swapRequestedAt!.toISOString(), note: row.swapNote } : null,
                  canTake: offered && row.userId !== userId && !onIt && !!part && !!me && coversPart({ ...me, positionIds: positionsIn.get(event.teamId) ?? [] }, part),
                };
              }),
          };
        });
      }),
    ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
}
