import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@oneverse/db";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SetlistAccessService } from "./setlist-access.service.js";

type Tx = Prisma.TransactionClient;

/**
 * Songs and teams: sharing a song with a team or a whole organisation, and
 * handing a personal song over to a team.
 *
 * - Shared with a team (issue #331, an AccessGrant to it): everyone in it
 *   sees the song, joining later too, and the team's sets can hold it; to
 *   edit, the team's admins edit it. Who manages the song (its owner, its
 *   team's admins) shares it, with a Songverse team they're in.
 * - Moved to a team (#331): the song's owner makes it the team's at once
 *   when they're one of its admins, or offers it, and the team's admins
 *   accept or decline.
 * - Asked for: when a personal set moves to a team, its owner's songs stay
 *   in it, shared read-only; a team admin can then ask for any of them, and
 *   the song's owner accepts (the song becomes the team's) or declines. An
 *   admin who owns the song hands it over directly.
 */
@Injectable()
export class SongOwnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sets: SetlistAccessService,
    private readonly policy: AccessPolicyService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Throws unless `user` may share the song (who can change it as its owner); it, when they may. */
  async assertManages(user: AuthenticatedUser, songVersionId: string) {
    const song = await this.prisma.client.songVersion.findUnique({
      where: { id: songVersionId },
      select: { id: true, title: true, ownerScope: true, ownerUserId: true, ownerTeamId: true },
    });
    if (!song) throw new NotFoundException("Song version not found");
    await this.policy.assertCanEdit(user, song, "song version");
    if (song.ownerScope === "GLOBAL") throw new BadRequestException("Everyone sees a catalogue song already");
    return song;
  }

  /** The teams a song is shared with. */
  async teamShares(songVersionId: string) {
    const grants = await this.prisma.client.accessGrant.findMany({
      where: { songVersionId, grantedToTeamId: { not: null } },
      select: { canEdit: true, grantedToTeam: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return grants.map((grant) => ({ team: grant.grantedToTeam!, canEdit: grant.canEdit }));
  }

  async shareWithTeam(user: AuthenticatedUser, songVersionId: string, teamId: string, canEdit: boolean): Promise<void> {
    const song = await this.assertManages(user, songVersionId);
    if (song.ownerTeamId === teamId) throw new BadRequestException("It's already the team's");
    await this.assertJoinable(user, teamId);
    await this.prisma.client.accessGrant.upsert({
      where: { songVersionId_grantedToTeamId: { songVersionId, grantedToTeamId: teamId } },
      create: { songVersionId, grantedToTeamId: teamId, grantedByUserId: user.id, canEdit },
      update: { canEdit },
    });
  }

  async unshareTeam(user: AuthenticatedUser, songVersionId: string, teamId: string): Promise<void> {
    await this.assertManages(user, songVersionId);
    await this.prisma.client.accessGrant.deleteMany({ where: { songVersionId, grantedToTeamId: teamId } });
  }

  /** The organisations a song is shared with (issue #350), to view. */
  async organizationShares(songVersionId: string) {
    const grants = await this.prisma.client.accessGrant.findMany({
      where: { songVersionId, grantedToOrganizationId: { not: null } },
      select: { grantedToOrganization: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return grants.map((grant) => ({ organization: grant.grantedToOrganization! }));
  }

  /**
   * Shares the song with everyone in an organisation the user is in (issue
   * #350), to view: they see it in their library and its teams' sets can
   * hold it. The organisation never owns it.
   */
  async shareWithOrganization(user: AuthenticatedUser, songVersionId: string, organizationId: string): Promise<void> {
    await this.assertManages(user, songVersionId);
    if (!(await this.prisma.client.organization.count({ where: { id: organizationId } }))) throw new NotFoundException("Organisation not found");
    const member = await this.prisma.client.organizationMembership.count({ where: { organizationId, userId: user.id } });
    if (!member) throw new ForbiddenException("Share with an organisation you're in");
    await this.prisma.client.accessGrant.upsert({
      where: { songVersionId_grantedToOrganizationId: { songVersionId, grantedToOrganizationId: organizationId } },
      create: { songVersionId, grantedToOrganizationId: organizationId, grantedByUserId: user.id },
      update: {},
    });
  }

  async unshareOrganization(user: AuthenticatedUser, songVersionId: string, organizationId: string): Promise<void> {
    await this.assertManages(user, songVersionId);
    await this.prisma.client.accessGrant.deleteMany({ where: { songVersionId, grantedToOrganizationId: organizationId } });
  }

  /**
   * Makes the user's personal song the team's: at once when they're one of
   * its admins (or a global admin), else offered to its admins.
   */
  async move(user: AuthenticatedUser, songVersionId: string, teamId: string): Promise<{ moved: boolean }> {
    const song = await this.assertManages(user, songVersionId);
    if (song.ownerScope !== "USER" || !song.ownerUserId) throw new BadRequestException("Only a personal song can be moved to a team");
    const role = await this.assertJoinable(user, teamId);
    const pending = await this.prisma.client.songOwnershipRequest.findFirst({
      where: { songVersionId: song.id, teamId, status: "PENDING" },
      select: { offeredByOwner: true },
    });
    // One of its admins, or the team asked for it already (offering it is saying yes).
    if (user.isGlobalAdmin || role === "ADMIN" || (pending && !pending.offeredByOwner)) {
      await this.prisma.client.$transaction((tx) => this.handOver(tx, song.id, teamId));
      return { moved: true };
    }
    if (pending) throw new ConflictException("You've already offered this song to the team");
    await this.prisma.client.songOwnershipRequest.create({
      data: { songVersionId: song.id, teamId, requestedByUserId: user.id, offeredByOwner: true },
    });
    const [admins, by, team] = await Promise.all([
      this.prisma.client.teamMembership.findMany({ where: { teamId, role: "ADMIN" }, select: { userId: true } }),
      this.prisma.client.user.findUnique({ where: { id: user.id }, select: { displayName: true } }),
      this.prisma.client.team.findUnique({ where: { id: teamId }, select: { name: true } }),
    ]);
    await this.notifications.notify(
      admins.map((admin) => ({ userId: admin.userId, kind: "SONG_OFFERED" as const, data: { by: by?.displayName ?? "", song: song.title, team: team?.name ?? "" }, url: "/dashboard" })),
    );
    return { moved: false };
  }

  /** The user's role in a Songverse team they may share a song with or move one to; throws when they may not. */
  private async assertJoinable(user: AuthenticatedUser, teamId: string): Promise<"ADMIN" | "MEMBER" | null> {
    if (!(await this.prisma.client.team.count({ where: { id: teamId } }))) throw new NotFoundException("Team not found");
    await this.policy.assertSongverseTeam(teamId);
    const role = await this.policy.teamRole(user.id, teamId);
    if (!role && !user.isGlobalAdmin) throw new ForbiddenException("Share with a team you're in");
    return role;
  }

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
      select: { id: true, offeredByOwner: true },
    });
    // Its owner offered it already: asking for it is saying yes.
    if (pending?.offeredByOwner) return this.accept(user, pending.id);
    if (pending) throw new ConflictException("The team has already asked for this song");

    const request = await this.prisma.client.songOwnershipRequest.create({
      data: { songVersionId: song.id, teamId: set.ownerTeamId, setlistId, requestedByUserId: user.id },
    });
    if (song.ownerUserId === user.id) await this.accept(user, request.id);
  }

  /** Requests waiting on the user: teams asking for their songs, and songs offered to teams they're an admin of. */
  async incoming(user: AuthenticatedUser) {
    const adminOf = (await this.prisma.client.teamMembership.findMany({ where: { userId: user.id, role: "ADMIN" }, select: { teamId: true } })).map((membership) => membership.teamId);
    const requests = await this.prisma.client.songOwnershipRequest.findMany({
      where: {
        status: "PENDING",
        songVersion: { ownerScope: "USER" },
        OR: [
          { offeredByOwner: false, songVersion: { ownerUserId: user.id } },
          { offeredByOwner: true, teamId: { in: adminOf } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        offeredByOwner: true,
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
      // If not, handing it over means losing access to it (an offer comes from someone in the team).
      ownerIsTeamMember: request.offeredByOwner || memberOf.has(request.team.id),
      kind: request.offeredByOwner ? ("offer" as const) : ("ask" as const),
    }));
  }

  async accept(user: AuthenticatedUser, requestId: string): Promise<void> {
    const request = await this.findDecidable(user, requestId);
    await this.prisma.client.$transaction((tx) => this.handOver(tx, request.songVersionId, request.teamId));
  }

  async decline(user: AuthenticatedUser, requestId: string): Promise<void> {
    const request = await this.findDecidable(user, requestId);
    await this.prisma.client.songOwnershipRequest.update({ where: { id: request.id }, data: { status: "DECLINED", decidedAt: new Date() } });
  }

  /** Makes the song the team's. */
  private async handOver(tx: Tx, songVersionId: string, teamId: string): Promise<void> {
    await tx.songVersion.update({
      where: { id: songVersionId },
      data: { ownerScope: "TEAM", ownerTeamId: teamId, ownerUserId: null },
    });
    // What this team asked for or was offered is done; it's the team's now, so nobody else can have it.
    await tx.songOwnershipRequest.updateMany({ where: { songVersionId, teamId, status: "PENDING" }, data: { status: "ACCEPTED", decidedAt: new Date() } });
    await tx.songOwnershipRequest.updateMany({ where: { songVersionId, status: "PENDING" }, data: { status: "DECLINED", decidedAt: new Date() } });
    // The team's own song needs no sharing with it, nor in its sets.
    await tx.accessGrant.deleteMany({ where: { songVersionId, grantedToTeamId: teamId } });
    await tx.setlistItem.updateMany({
      where: { songVersionId, setlist: { ownerTeamId: teamId } },
      data: { sharedByUserId: null },
    });
  }

  private async findDecidable(user: AuthenticatedUser, requestId: string) {
    const request = await this.prisma.client.songOwnershipRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        offeredByOwner: true,
        requestedByUserId: true,
        songVersionId: true,
        teamId: true,
        songVersion: { select: { ownerScope: true, ownerUserId: true } },
      },
    });
    if (!request) throw new NotFoundException("Request not found");
    if (request.offeredByOwner) {
      // An offer: the team's admins decide, while the song is still the offerer's.
      const isAdmin = user.isGlobalAdmin || (await this.policy.teamRole(user.id, request.teamId)) === "ADMIN";
      if (!isAdmin) throw new ForbiddenException("Only the team's admins can decide");
      if (request.songVersion.ownerScope !== "USER" || request.songVersion.ownerUserId !== request.requestedByUserId) {
        throw new ConflictException("This song isn't theirs to offer any more");
      }
    } else {
      const ownsSong = request.songVersion.ownerScope === "USER" && request.songVersion.ownerUserId === user.id;
      if (!ownsSong) throw new ForbiddenException("Only the song's owner can decide");
    }
    if (request.status !== "PENDING") throw new ConflictException("This request has already been decided");
    return request;
  }
}
