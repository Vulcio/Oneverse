import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SetlistAccessService } from "./setlist-access.service.js";

/**
 * Handing a personal song over to a team. When a personal set moves to a
 * team, its owner's songs stay in it, shared read-only; a team admin can
 * then ask for any of them, and the song's owner accepts (the song becomes
 * the team's) or declines. An admin who owns the song hands it over
 * directly.
 */
@Injectable()
export class SongOwnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sets: SetlistAccessService,
  ) {}

  async request(user: AuthenticatedUser, setlistId: string, itemId: string): Promise<void> {
    const set = await this.sets.findEditable(user, setlistId);
    if (!set.ownerTeamId) throw new BadRequestException("Only a team set's songs can be handed to its team");
    const item = await this.prisma.client.setlistItem.findUnique({
      where: { id: itemId },
      select: { setlistId: true, songVersion: { select: { id: true, ownerScope: true, ownerUserId: true } } },
    });
    if (!item || item.setlistId !== setlistId) throw new NotFoundException("Item not found");
    const song = item.songVersion;
    if (!song) throw new BadRequestException("Only a song can be handed to a team");
    if (song.ownerScope !== "USER" || !song.ownerUserId) throw new BadRequestException("Only someone's personal song can be handed to a team");

    const pending = await this.prisma.client.songOwnershipRequest.findFirst({
      where: { songVersionId: song.id, teamId: set.ownerTeamId, status: "PENDING" },
      select: { id: true },
    });
    if (pending) throw new ConflictException("The team has already asked for this song");

    const request = await this.prisma.client.songOwnershipRequest.create({
      data: { songVersionId: song.id, teamId: set.ownerTeamId, setlistId, requestedByUserId: user.id },
    });
    if (song.ownerUserId === user.id) await this.accept(user, request.id);
  }

  /** Requests waiting on the user, as the owner of the songs asked for. */
  async incoming(user: AuthenticatedUser) {
    const requests = await this.prisma.client.songOwnershipRequest.findMany({
      where: { status: "PENDING", songVersion: { ownerScope: "USER", ownerUserId: user.id } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        songVersion: { select: { id: true, title: true } },
        team: { select: { id: true, name: true } },
        requestedBy: { select: { displayName: true } },
        setlistId: true,
      },
    });
    const memberOf = await this.sets.teamIdsOf(user.id);
    return requests.map((request) => ({
      id: request.id,
      createdAt: request.createdAt,
      song: request.songVersion,
      team: request.team,
      requestedByName: request.requestedBy?.displayName ?? null,
      setlistId: request.setlistId,
      // If not, handing it over means losing access to it.
      ownerIsTeamMember: memberOf.has(request.team.id),
    }));
  }

  async accept(user: AuthenticatedUser, requestId: string): Promise<void> {
    const request = await this.findDecidable(user, requestId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.songVersion.update({
        where: { id: request.songVersionId },
        data: { ownerScope: "TEAM", ownerTeamId: request.teamId, ownerUserId: null },
      });
      await tx.songOwnershipRequest.update({ where: { id: request.id }, data: { status: "ACCEPTED", decidedAt: new Date() } });
      // It's the team's now, so nobody else can have it.
      await tx.songOwnershipRequest.updateMany({
        where: { songVersionId: request.songVersionId, status: "PENDING" },
        data: { status: "DECLINED", decidedAt: new Date() },
      });
      // The team's own song needs no sharing in its sets.
      await tx.setlistItem.updateMany({
        where: { songVersionId: request.songVersionId, setlist: { ownerTeamId: request.teamId } },
        data: { sharedByUserId: null },
      });
    });
  }

  async decline(user: AuthenticatedUser, requestId: string): Promise<void> {
    const request = await this.findDecidable(user, requestId);
    await this.prisma.client.songOwnershipRequest.update({ where: { id: request.id }, data: { status: "DECLINED", decidedAt: new Date() } });
  }

  private async findDecidable(user: AuthenticatedUser, requestId: string) {
    const request = await this.prisma.client.songOwnershipRequest.findUnique({
      where: { id: requestId },
      select: { id: true, status: true, songVersionId: true, teamId: true, songVersion: { select: { ownerScope: true, ownerUserId: true } } },
    });
    if (!request) throw new NotFoundException("Request not found");
    const ownsSong = request.songVersion.ownerScope === "USER" && request.songVersion.ownerUserId === user.id;
    if (!ownsSong) throw new ForbiddenException("Only the song's owner can decide");
    if (request.status !== "PENDING") throw new ConflictException("This request has already been decided");
    return request;
  }
}
