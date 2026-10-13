import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { coversPart, effectiveAnswer, eventDates, eventFallsOn, localDate, partKey, swapCandidates, type AssignPartRequest, type NotificationData, type RequestSwapRequest, type RespondAssignmentRequest } from "@songverse/core";
import { Prisma } from "@songverse/db";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { changesOf, dateText, day, partsOf, TeamEventsService, timingOf, withDates, type EventRow } from "./team-events.service.js";

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
    private readonly events: TeamEventsService,
  ) {}

  /** Whether two people are connected in People (#79): an admin can schedule their People as guests. */
  private async connected(a: string, b: string): Promise<boolean> {
    const found = await this.prisma.client.connection.findFirst({
      where: { status: "ACCEPTED", OR: [{ requesterId: a, addresseeId: b }, { requesterId: b, addresseeId: a }] },
      select: { id: true },
    });
    return !!found;
  }

  /** A guest with an account (not in the team) sees the date's set, read-only, as a guest of it. */
  private async letSeeSet(teamId: string, eventId: string, date: string, userId: string) {
    const { setlistId } = await this.events.ensureDateSet(teamId, eventId, date);
    if (setlistId) await this.prisma.client.setlistGuest.upsert({ where: { setlistId_userId: { setlistId, userId } }, create: { setlistId, userId }, update: {} });
  }

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
    // One of the group's positions (issue #241): by its name.
    if (part?.position) return { partName: (await this.prisma.client.teamPosition.findUnique({ where: { id: part.position }, select: { name: true } }))?.name ?? "" };
    if (!part?.part) return { partName: part?.name ?? key.replace(/^name:/, "") };
    const custom = await this.prisma.client.customInstrument.findUnique({ where: { id: part.part }, select: { label: true } });
    return custom ? { partName: custom.label } : { part: part.part };
  }

  private titleOn(event: EventRow, date: string): string {
    const [shown] = eventDates(timingOf(event), date, date, changesOf(event));
    return shown?.title || event.title;
  }

  /**
   * Someone put on a part for a date: a member, or a guest - one of the
   * admin's People (they're told and answer like a member, and see the
   * date's set), or someone without an account, by name, for reference
   * only (accepted, never told). Admins scheduling themselves: accepted.
   */
  async assign(teamId: string, eventId: string, date: string, dto: AssignPartRequest, by: string) {
    const event = await this.comingDate(teamId, eventId, date);
    if (!partsOf(event).some((part) => partKey(part) === dto.part)) throw new BadRequestException(["part isn't one this event needs"]);
    let guest = false;
    if (dto.userId) {
      const member = await this.prisma.client.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: dto.userId } } });
      guest = !member;
      if (guest && !(await this.connected(by, dto.userId))) throw new BadRequestException(["userId isn't a member of the team or one of your People"]);
    }
    const accepted = !dto.userId || dto.userId === by;
    let row;
    try {
      row = await this.prisma.client.teamEventAssignment.create({
        data: {
          eventId,
          date: day(date),
          partKey: dto.part,
          userId: dto.userId ?? null,
          guestName: dto.userId ? null : dto.guestName,
          assignedByUserId: by,
          ...(accepted ? { status: "ACCEPTED", respondedAt: new Date() } : {}),
        },
        include: { user: { select: { displayName: true } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("They're already on that part");
      throw error;
    }
    if (dto.userId && guest) await this.letSeeSet(teamId, eventId, date, dto.userId);
    if (dto.userId && !accepted) {
      await this.notifications.notify([{ userId: dto.userId, kind: "SCHEDULED", data: { event: this.titleOn(event, date), date, team: event.team.name, ...(await this.partData(event, dto.part)) }, url: "/calendar" }]);
    }
    return { id: row.id, userId: row.userId, displayName: row.user?.displayName ?? row.guestName ?? "", partKey: row.partKey, status: row.status, guest: row.userId ? (guest ? "account" : null) : "external" };
  }

  /** Someone taken off a part; told, unless they'd declined it. */
  async unassign(teamId: string, eventId: string, date: string, assignmentId: string, by: string): Promise<void> {
    const row = await this.prisma.client.teamEventAssignment.findFirst({ where: { id: assignmentId, eventId, date: day(date), event: { teamId } }, include: { event: { include: { ...withDates, team: { select: { name: true } } } } } });
    if (!row) throw new NotFoundException("Not on the line-up");
    await this.prisma.client.teamEventAssignment.delete({ where: { id: row.id } });
    if (!row.userId) return;
    // A guest with no other place that date no longer sees its set.
    const member = await this.prisma.client.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: row.userId } } });
    const stillOn = await this.prisma.client.teamEventAssignment.count({ where: { eventId, date: day(date), userId: row.userId } });
    const setlistId = row.event.dates.find((one) => dateText(one.date) === date)?.setlist?.id;
    if (!member && !stillOn && setlistId) await this.prisma.client.setlistGuest.deleteMany({ where: { setlistId, userId: row.userId } });
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

  /** One's own place on a coming date, not declined: the one to swap. */
  private async ownPlace(teamId: string, eventId: string, date: string, assignmentId: string, userId: string) {
    const row = await this.prisma.client.teamEventAssignment.findFirst({ where: { id: assignmentId, eventId, date: day(date), userId, event: { teamId } } });
    if (!row || row.status === "DECLINED") throw new NotFoundException("Not on the line-up");
    return row;
  }

  /**
   * Someone asks for a replacement (a swap): the members who play the part,
   * not on it already and not unavailable or away that date, are offered it
   * (swapCandidates). Their place stays theirs until someone takes it.
   */
  async requestSwap(teamId: string, eventId: string, date: string, assignmentId: string, userId: string, dto: RequestSwapRequest) {
    const row = await this.ownPlace(teamId, eventId, date, assignmentId, userId);
    const event = await this.comingDate(teamId, eventId, date);
    const part = partsOf(event).find((one) => partKey(one) === row.partKey);
    if (!part) throw new BadRequestException(["That part isn't one this event needs any more"]);
    await this.prisma.client.teamEventAssignment.update({ where: { id: row.id }, data: { swapRequestedAt: new Date(), swapNote: dto.note || null } });
    const [members, answers, away, lineup, me] = await Promise.all([
      this.prisma.client.teamMembership.findMany({ where: { teamId }, select: { userId: true, positionIds: true, user: { select: { instruments: true, techRoles: true } } } }),
      this.prisma.client.teamEventAnswer.findMany({ where: { eventId, date: day(date) }, select: { userId: true, answer: true } }),
      this.prisma.client.userAway.findMany({ where: { user: { teamMemberships: { some: { teamId } } }, from: { lte: day(date) }, to: { gte: day(date) } }, select: { userId: true, from: true, to: true } }),
      this.prisma.client.teamEventAssignment.findMany({ where: { eventId, date: day(date), userId: { not: null } }, select: { userId: true, partKey: true, status: true } }),
      this.prisma.client.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
    ]);
    const answered = members.map(({ userId: member, user, positionIds }) => {
      const own = answers.find((answer) => answer.userId === member)?.answer ?? null;
      const ranges = away.filter((range) => range.userId === member).map((range) => ({ from: dateText(range.from), to: dateText(range.to) }));
      return { userId: member, ...user, positionIds, answer: effectiveAnswer(own, ranges, date).answer };
    });
    const offered = swapCandidates(part, answered, lineup.map((one) => ({ ...one, userId: one.userId! })), userId);
    const data = { event: this.titleOn(event, date), date, team: event.team.name, by: me?.displayName ?? "", ...(await this.partData(event, row.partKey)) };
    const notified = await this.notifications.notify(offered.map((candidate) => ({ userId: candidate, kind: "SWAP_OFFERED" as const, data, url: "/calendar" })));
    return { id: row.id, swapRequestedAt: new Date().toISOString(), notified };
  }

  /** The replacement no longer looked for: the place stays theirs. */
  async cancelSwap(teamId: string, eventId: string, date: string, assignmentId: string, userId: string): Promise<void> {
    const row = await this.ownPlace(teamId, eventId, date, assignmentId, userId);
    await this.prisma.client.teamEventAssignment.update({ where: { id: row.id }, data: { swapRequestedAt: null, swapNote: null } });
  }

  /**
   * A member takes the place of someone who asked for a replacement: the
   * first to do so gets it (accepted, and available that date); the one
   * replaced and the team's admins are told. Taken already: a conflict.
   */
  async takeSwap(teamId: string, eventId: string, date: string, assignmentId: string, userId: string) {
    const event = await this.comingDate(teamId, eventId, date);
    const row = await this.prisma.client.teamEventAssignment.findFirst({ where: { id: assignmentId, eventId, date: day(date), event: { teamId } } });
    if (!row || !row.swapRequestedAt || row.status === "DECLINED") throw new ConflictException("Someone already took it, or it's no longer offered");
    if (row.userId === userId) throw new BadRequestException(["It's your own place"]);
    const part = partsOf(event).find((one) => partKey(one) === row.partKey);
    const member = await this.prisma.client.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId } }, select: { positionIds: true, user: { select: { instruments: true, techRoles: true, displayName: true } } } });
    if (!member || !part || !coversPart({ ...member.user, positionIds: member.positionIds }, part)) throw new BadRequestException(["You don't play that part"]);
    let created;
    try {
      created = await this.prisma.client.$transaction(async (tx) => {
        // Only while it's still offered: the first one wins.
        const { count } = await tx.teamEventAssignment.deleteMany({ where: { id: row.id, swapRequestedAt: { not: null } } });
        if (count === 0) throw new ConflictException("Someone already took it");
        return tx.teamEventAssignment.create({ data: { eventId, date: day(date), partKey: row.partKey, userId, status: "ACCEPTED", respondedAt: new Date(), assignedByUserId: row.assignedByUserId } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("You're already on that part");
      throw error;
    }
    await this.prisma.client.teamEventAnswer.upsert({
      where: { eventId_date_userId: { eventId, date: day(date), userId } },
      create: { eventId, date: day(date), userId, answer: "AVAILABLE" },
      update: { answer: "AVAILABLE", answeredByUserId: null },
    });
    const admins = await this.prisma.client.teamMembership.findMany({ where: { teamId, role: "ADMIN" }, select: { userId: true } });
    const data = { event: this.titleOn(event, date), date, team: event.team.name, by: member.user.displayName, ...(await this.partData(event, row.partKey)) };
    const told = [...new Set([row.userId!, ...admins.map((admin) => admin.userId)])];
    await this.notifications.notify(
      told.map((person) => ({ userId: person, kind: "SWAP_TAKEN" as const, data, url: person === row.userId ? "/calendar" : `/teams/${teamId}` })),
      userId,
    );
    return { id: created.id, userId, partKey: created.partKey, status: created.status };
  }
}
