import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { MUSIC_LEADER, setLeaders, withAsks, type EventPart, type SetAvailability } from "@oneverse/core";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AvailabilityService } from "../team-events/availability.service.js";
import { dateText, partsOf } from "../team-events/team-events.service.js";
import { SetlistAccessService } from "./setlist-access.service.js";

/**
 * Who can play on the date a set was made for (issue #520): the team's
 * answers, the parts each would like to play, and the date's line-up, for
 * those who can edit the set - the team's admins and the date's host and
 * music leader. Notes stay the admins'.
 */
@Injectable()
export class SetAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sets: SetlistAccessService,
    private readonly policy: AccessPolicyService,
    private readonly availability: AvailabilityService,
  ) {}

  async forSet(user: AuthenticatedUser, setlistId: string): Promise<SetAvailability> {
    const { set, access } = await this.sets.findViewable(user, setlistId);
    if (!access.canEdit) throw new ForbiddenException("Only those who can edit the set see who can play");
    const row = await this.prisma.client.teamEventDate.findUnique({
      where: { setlistId },
      select: { eventId: true, date: true, title: true, asks: true, event: { select: { teamId: true, title: true, parts: true } } },
    });
    if (!row || !set.ownerTeamId || row.event.teamId !== set.ownerTeamId) throw new NotFoundException("The set wasn't made for a date of the team's calendar");
    const date = dateText(row.date);
    const teamId = row.event.teamId;
    const [members, lineup] = await Promise.all([
      this.availability.answersFor(teamId, row.eventId, date),
      this.prisma.client.teamEventAssignment.findMany({
        where: { eventId: row.eventId, date: row.date },
        select: { userId: true, guestName: true, partKey: true, status: true, user: { select: { displayName: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const isAdmin = user.isGlobalAdmin || (await this.policy.teamRole(user.id, teamId)) === "ADMIN";
    const asks = Array.isArray(row.asks) ? (row.asks as unknown as EventPart[]) : [];
    const places = lineup.map((place) => ({ userId: place.userId, displayName: place.user?.displayName ?? place.guestName ?? "", partKey: place.partKey, status: place.status }));
    return {
      teamId,
      eventId: row.eventId,
      date,
      title: row.title || row.event.title,
      // With what the date asks for besides (issue #549).
      parts: withAsks(partsOf(row.event), asks),
      asks,
      // The team's admins and the date's music lead ask for its instruments.
      canAsk: isAdmin || places.some((place) => place.userId === user.id && place.partKey === MUSIC_LEADER && place.status !== "DECLINED"),
      // Their notes are for the team's admins.
      members: isAdmin ? members : members.map((member) => ({ ...member, note: null })),
      lineup: places,
      leaders: setLeaders(places),
    };
  }
}
