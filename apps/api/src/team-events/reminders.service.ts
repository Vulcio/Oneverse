import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { addDays, dayBeforeReminderDue, deadlineReminderDue, eventDates, localDate, type CreateAnswerRequestRequest } from "@songverse/core";
import { Prisma } from "@songverse/db";
import { NotificationsService, type NotificationInput } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { signedUpFor, signupKey } from "./signups.js";
import { changesOf, dateText, day, rehearsalDatesOf, TeamEventsService, timingOf, withDates } from "./team-events.service.js";

type RequestRow = Prisma.TeamAnswerRequestGetPayload<{ include: { createdBy: { select: { displayName: true } } } }>;

/**
 * Reminders (issue #235), as notifications (#236): a team admin asking
 * for answers by a deadline, and the reminder the day before it; the
 * reminder the day before a date one signed up for; "the set is ready".
 * The timed ones are sent by the team-events job every hour.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: TeamEventsService,
    private readonly notifications: NotificationsService,
  ) {}

  private async teamName(teamId: string): Promise<string> {
    return (await this.prisma.client.team.findUnique({ where: { id: teamId }, select: { name: true } }))?.name ?? "";
  }

  /**
   * For each member, how many of the team's dates from `from` to `to` they
   * haven't answered - not cancelled, not over, not in days they're away.
   */
  private async unanswered(teamId: string, from: string, to: string): Promise<Map<string, number>> {
    const members = (await this.prisma.client.teamMembership.findMany({ where: { teamId }, select: { userId: true } })).map((member) => member.userId);
    const counts = new Map(members.map((userId) => [userId, 0]));
    if (to < from || members.length === 0) return counts;
    const now = new Date();
    const dates = (await this.events.dates(teamId, from, to)).filter((date) => !date.cancelled && !date.rehearsalFor && date.date >= localDate(now, date.timeZone));
    if (dates.length === 0) return counts;
    const [answers, away] = await Promise.all([
      this.prisma.client.teamEventAnswer.findMany({ where: { event: { teamId }, date: { gte: day(from), lte: day(to) } }, select: { eventId: true, date: true, userId: true } }),
      this.prisma.client.userAway.findMany({ where: { userId: { in: members }, from: { lte: day(to) }, to: { gte: day(from) } }, select: { userId: true, from: true, to: true } }),
    ]);
    const answered = new Set(answers.map((answer) => `${answer.userId}|${answer.eventId}|${dateText(answer.date)}`));
    for (const userId of members) {
      const ranges = away.filter((range) => range.userId === userId).map((range) => ({ from: dateText(range.from), to: dateText(range.to) }));
      const missing = dates.filter((date) => !answered.has(`${userId}|${date.eventId}|${date.date}`) && !ranges.some((range) => range.from <= date.date && date.date <= range.to));
      counts.set(userId, missing.length);
    }
    return counts;
  }

  private summary(row: RequestRow) {
    return {
      id: row.id,
      from: dateText(row.from),
      to: dateText(row.to),
      deadline: dateText(row.deadline),
      timeZone: row.timeZone,
      createdBy: row.createdBy?.displayName ?? null,
      createdAt: row.createdAt.toISOString(),
      remindedAt: row.remindedAt?.toISOString() ?? null,
    };
  }

  /** Answers asked for: the members missing some are told now (not the asker), and reminded the day before the deadline. */
  async createRequest(teamId: string, by: string, dto: CreateAnswerRequestRequest) {
    const today = localDate(new Date(), dto.timeZone);
    if (dto.deadline < today) throw new BadRequestException(["deadline must not be in the past"]);
    const row = await this.prisma.client.teamAnswerRequest.create({
      data: { teamId, from: day(dto.from), to: day(dto.to), deadline: day(dto.deadline), timeZone: dto.timeZone, createdByUserId: by },
      include: { createdBy: { select: { displayName: true } } },
    });
    const counts = await this.unanswered(teamId, dto.from > today ? dto.from : today, dto.to);
    const team = await this.teamName(teamId);
    const sent: NotificationInput[] = [...counts]
      .filter(([, count]) => count > 0)
      .map(([userId, count]) => ({ userId, kind: "ANSWERS_REQUESTED", data: { team, by: row.createdBy?.displayName ?? "", deadline: dto.deadline, count }, url: "/calendar", teamId }));
    const notified = await this.notifications.notify(sent, by);
    return { ...this.summary(row), notified };
  }

  /** The team's requests still open: their deadline not over. */
  async listRequests(teamId: string) {
    const rows = await this.prisma.client.teamAnswerRequest.findMany({ where: { teamId }, include: { createdBy: { select: { displayName: true } } }, orderBy: { deadline: "asc" } });
    const now = new Date();
    return rows.filter((row) => dateText(row.deadline) >= localDate(now, row.timeZone)).map((row) => this.summary(row));
  }

  async removeRequest(teamId: string, id: string): Promise<void> {
    const { count } = await this.prisma.client.teamAnswerRequest.deleteMany({ where: { id, teamId } });
    if (count === 0) throw new NotFoundException("Request not found");
  }

  /** A date's set is ready: the people signed up for it are told (not the admin saying so); again each time it's said. */
  async setReady(teamId: string, eventId: string, date: string, by: string) {
    const event = await this.prisma.client.teamEvent.findFirst({ where: { id: eventId, teamId }, include: withDates });
    if (!event) throw new NotFoundException("Event not found");
    const row = event.dates.find((one) => dateText(one.date) === date);
    if (!row?.setlist || row.cancelled) throw new BadRequestException(["That date has no set yet"]);
    const readyAt = new Date();
    await this.prisma.client.teamEventDate.update({ where: { id: row.id }, data: { setReadyAt: readyAt } });
    const [admin, team, people] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { id: by }, select: { displayName: true } }),
      this.teamName(teamId),
      signedUpFor(this.prisma.client, [{ eventId, date }]).then((found) => (found.get(signupKey(eventId, date)) ?? []).map((userId) => ({ userId }))),
    ]);
    const [shown] = eventDates(timingOf(event), date, date, changesOf(event));
    const notified = await this.notifications.notify(
      people.map(({ userId }) => ({ userId, kind: "SET_READY", data: { event: shown?.title || event.title, date, team, by: admin?.displayName ?? "", count: row.setlist!._count.items }, url: `/sets/${row.setlist!.id}`, teamId })),
      by,
    );
    return { setReadyAt: readyAt.toISOString(), notified };
  }

  /**
   * The timed reminders, due now: the day before each date (to the people
   * signed up, once per date), and the day before each request's deadline
   * (to the members still missing answers, once per request).
   */
  async runReminders(now = new Date()): Promise<{ dayBefore: number; deadlines: number }> {
    let dayBefore = 0;
    const utcToday = now.toISOString().slice(0, 10);
    const events = await this.prisma.client.teamEvent.findMany({ include: { ...withDates, team: { select: { name: true } } } });
    for (const event of events) {
      // A rehearsal (issue #235, phase 7): its event's dates, days before; those signed up for that date, its set.
      const parent = event.rehearsalForId ? events.find((one) => one.id === event.rehearsalForId) : null;
      if (event.rehearsalForId && !parent) continue;
      const rows = new Map((parent ?? event).dates.map((row) => [dateText(row.date), row]));
      // The day before covers today and tomorrow everywhere: from yesterday to two days ahead in UTC.
      const from = addDays(utcToday, -1);
      const to = addDays(utcToday, 2);
      const dates = parent ? rehearsalDatesOf(event, parent, from, to) : eventDates(timingOf(event), from, to, changesOf(event)).map((date) => ({ ...date, forDate: date.date }));
      for (const date of dates) {
        if (date.cancelled || !dayBeforeReminderDue(date.date, date.startsAt, event.timeZone, now)) continue;
        try {
          // Marked first: the API's instances and the Worker may run this at once; one sends.
          await this.prisma.client.teamEventReminder.create({ data: { eventId: event.id, date: day(date.date), kind: "DAY_BEFORE" } });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
          throw error;
        }
        const of = { eventId: parent?.id ?? event.id, date: date.forDate };
        const people = ((await signedUpFor(this.prisma.client, [of])).get(signupKey(of.eventId, of.date)) ?? []).map((userId) => ({ userId }));
        const setlist = rows.get(date.forDate)?.setlist;
        dayBefore += await this.notifications.notify(
          people.map(({ userId }) => ({
            userId,
            kind: "EVENT_TOMORROW",
            data: { event: date.title || event.title, date: date.date, team: event.team.name, startTime: date.startTime, ...(event.place ? { place: event.place } : {}) },
            url: setlist ? `/sets/${setlist.id}` : "/calendar",
            teamId: event.teamId,
          })),
        );
      }
    }

    let deadlines = 0;
    const requests = await this.prisma.client.teamAnswerRequest.findMany({ where: { remindedAt: null }, include: { team: { select: { name: true } } } });
    for (const request of requests) {
      const deadline = dateText(request.deadline);
      if (!deadlineReminderDue(deadline, request.timeZone, now)) continue;
      // Marked first, as above.
      const { count } = await this.prisma.client.teamAnswerRequest.updateMany({ where: { id: request.id, remindedAt: null }, data: { remindedAt: now } });
      if (count === 0) continue;
      const today = localDate(now, request.timeZone);
      const from = dateText(request.from);
      const counts = await this.unanswered(request.teamId, from > today ? from : today, dateText(request.to));
      deadlines += await this.notifications.notify(
        [...counts].filter(([, missing]) => missing > 0).map(([userId, missing]) => ({ userId, kind: "ANSWER_DEADLINE", data: { team: request.team.name, deadline, count: missing }, url: "/calendar", teamId: request.teamId })),
      );
    }
    if (dayBefore + deadlines > 0) this.logger.log(`Reminders: ${dayBefore} for tomorrow, ${deadlines} for answers due`);
    return { dayBefore, deadlines };
  }
}
