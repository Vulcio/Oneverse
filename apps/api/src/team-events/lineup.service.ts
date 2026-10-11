import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { eventDates, eventFallsOn, localDate, partKey, type AssignPartRequest, type NotificationData, type RespondAssignmentRequest } from "@songverse/core";
import { Prisma } from "@songverse/db";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { changesOf, dateText, day, partsOf, timingOf, withDates, type EventRow } from "./team-events.service.js";

type Client = PrismaService["client"];

/** Why someone scheduled on a date might not be able to: away, said Not available, or on another event then. */
export type LineupConflict = "AWAY" | "UNAVAILABLE" | "ELSEWHERE";

/**
 * Of these people's line-up places, the ones that clash with another place
 * of theirs (any team's), not declined: an event at the same time.
 * `places` are their places to check, with when the date starts and ends.
 */
export async function placesElsewhere(prisma: Client, places: { id: string; userId: string; eventId: string; startsAt: string; endsAt: string; date: string }[]): Promise<Set<string>> {
  const clashing = new Set<string>();
  if (places.length === 0) return clashing;
  const dates = places.map((place) => place.date).sort();
  const from = new Date(`${dates[0]}T00:00:00Z`);
  const to = new Date(`${dates.at(-1)}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  to.setUTCDate(to.getUTCDate() + 1);
  const others = await prisma.teamEventAssignment.findMany({
    where: { userId: { in: [...new Set(places.map((place) => place.userId))] }, status: { not: "DECLINED" }, date: { gte: from, lte: to } },
    include: { event: { include: withDates } },
  });
  for (const place of places) {
    for (const other of others) {
      if (other.id === place.id || other.userId !== place.userId) continue;
      const otherDate = dateText(other.date);
      const [when] = eventDates(timingOf(other.event), otherDate, otherDate, changesOf(other.event));
      if (!when || when.cancelled) continue;
      // The same date of the same event (another part of it) isn't elsewhere.
      if (other.eventId === place.eventId && otherDate === place.date) continue;
      if (when.startsAt < place.endsAt && place.startsAt < when.endsAt) clashing.add(place.id);
    }
  }
  return clashing;
}

/**
 * Scheduling by part (issue #235, phase 7): a team's admins put members on
 * the parts a date needs; each is told and accepts or declines (declining
 * tells the admins). Once a date has a line-up, the people on it are who
 * signed up for it (signedUpFor).
 */
@Injectable()
export class LineupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The event on a date that's coming and not cancelled: scheduling is for those. */
  private async comingDate(teamId: string, eventId: string, date: string): Promise<EventRow & { team: { name: string } }> {
    const event = await this.prisma.client.teamEvent.findFirst({ where: { id: eventId, teamId }, include: { ...withDates, team: { select: { name: true } } } });
    if (!event || !eventFallsOn(timingOf(event), date)) throw new NotFoundException("The event isn't on that date");
    if (date < localDate(new Date(), event.timeZone)) throw new BadRequestException(["That date is over"]);
    const [shown] = eventDates(timingOf(event), date, date, changesOf(event));
    if (shown?.cancelled) throw new BadRequestException(["That date is cancelled"]);
    return event;
  }

  /** A part as a notification names it: its instrument or role key, else its own name (a team's, or a custom instrument's). */
  private async partData(event: EventRow, key: string): Promise<Pick<NotificationData, "part" | "partName">> {
    const part = partsOf(event).find((one) => partKey(one) === key);
    if (!part?.part) return { partName: part?.name ?? key.replace(/^name:/, "") };
    const custom = await this.prisma.client.customInstrument.findUnique({ where: { id: part.part }, select: { label: true } });
    return custom ? { partName: custom.label } : { part: part.part };
  }

  private titleOn(event: EventRow, date: string): string {
    const [shown] = eventDates(timingOf(event), date, date, changesOf(event));
    return shown?.title || event.title;
  }

  /** A member put on a part for a date: asked (they're told), or accepted at once when admins schedule themselves. */
  async assign(teamId: string, eventId: string, date: string, dto: AssignPartRequest, by: string) {
    const event = await this.comingDate(teamId, eventId, date);
    if (!partsOf(event).some((part) => partKey(part) === dto.part)) throw new BadRequestException(["part isn't one this event needs"]);
    const member = await this.prisma.client.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: dto.userId } } });
    if (!member) throw new BadRequestException(["userId isn't a member of the team"]);
    const self = dto.userId === by;
    let row;
    try {
      row = await this.prisma.client.teamEventAssignment.create({
        data: { eventId, date: day(date), partKey: dto.part, userId: dto.userId, assignedByUserId: by, ...(self ? { status: "ACCEPTED", respondedAt: new Date() } : {}) },
        include: { user: { select: { displayName: true } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("They're already on that part");
      throw error;
    }
    if (!self) {
      await this.notifications.notify([{ userId: dto.userId, kind: "SCHEDULED", data: { event: this.titleOn(event, date), date, team: event.team.name, ...(await this.partData(event, dto.part)) }, url: "/calendar" }]);
    }
    return { id: row.id, userId: row.userId, displayName: row.user.displayName, partKey: row.partKey, status: row.status };
  }

  /** Someone taken off a part; told, unless they'd declined it. */
  async unassign(teamId: string, eventId: string, date: string, assignmentId: string, by: string): Promise<void> {
    const row = await this.prisma.client.teamEventAssignment.findFirst({ where: { id: assignmentId, eventId, date: day(date), event: { teamId } }, include: { event: { include: { ...withDates, team: { select: { name: true } } } } } });
    if (!row) throw new NotFoundException("Not on the line-up");
    await this.prisma.client.teamEventAssignment.delete({ where: { id: row.id } });
    if (row.userId !== by && row.status !== "DECLINED" && date >= localDate(new Date(), row.event.timeZone)) {
      await this.notifications.notify([{ userId: row.userId, kind: "UNSCHEDULED", data: { event: this.titleOn(row.event, date), date, team: row.event.team.name, ...(await this.partData(row.event, row.partKey)) }, url: "/calendar" }]);
    }
  }

  /**
   * The person scheduled answers. Accepting says they're available that
   * date; declining tells the team's admins (not one declining their own).
   */
  async respond(teamId: string, eventId: string, date: string, assignmentId: string, userId: string, dto: RespondAssignmentRequest) {
    const row = await this.prisma.client.teamEventAssignment.findFirst({ where: { id: assignmentId, eventId, date: day(date), userId, event: { teamId } } });
    if (!row) throw new NotFoundException("Not on the line-up");
    const event = await this.comingDate(teamId, eventId, date);
    const updated = await this.prisma.client.teamEventAssignment.update({
      where: { id: row.id },
      data: { status: dto.status, note: dto.note === undefined ? undefined : dto.note, respondedAt: new Date() },
    });
    if (dto.status === "ACCEPTED") {
      await this.prisma.client.teamEventAnswer.upsert({
        where: { eventId_date_userId: { eventId, date: day(date), userId } },
        create: { eventId, date: day(date), userId, answer: "AVAILABLE" },
        update: { answer: "AVAILABLE", answeredByUserId: null },
      });
    } else if (row.status !== "DECLINED") {
      const [me, admins] = await Promise.all([
        this.prisma.client.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
        this.prisma.client.teamMembership.findMany({ where: { teamId, role: "ADMIN" }, select: { userId: true } }),
      ]);
      const data = { event: this.titleOn(event, date), date, team: event.team.name, by: me?.displayName ?? "", ...(await this.partData(event, row.partKey)) };
      await this.notifications.notify(
        admins.map(({ userId: admin }) => ({ userId: admin, kind: "SCHEDULE_DECLINED" as const, data, url: `/teams/${teamId}` })),
        userId,
      );
    }
    return { id: updated.id, status: updated.status, note: updated.note };
  }
}
