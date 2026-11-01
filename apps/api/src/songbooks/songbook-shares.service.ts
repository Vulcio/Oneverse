import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Sharing a songbook (issue #211) with one of the owner's people (a
 * connection, as a song is shared, #77) or with a team they're in: to view
 * it - its entries and the songs in it - or to edit its entries and details
 * too. Only who may change the songbook itself (its owner, its team's
 * admins) shares it; someone it's shared with can leave it.
 */
@Injectable()
export class SongbookSharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Throws unless `user` may share the songbook: who can change it as its owner. */
  async assertManages(user: AuthenticatedUser, songbookId: string) {
    const songbook = await this.prisma.client.songbook.findUnique({ where: { id: songbookId }, select: { ownerScope: true, ownerUserId: true, ownerTeamId: true } });
    if (!songbook) throw new NotFoundException("Songbook not found");
    await this.access.assertCanEdit(user, songbook, "songbook");
    if (songbook.ownerScope === "GLOBAL") throw new BadRequestException("Everyone sees a catalogue songbook already");
    return songbook;
  }

  /** Who it's shared with, people then teams. */
  async list(songbookId: string) {
    const shares = await this.prisma.client.songbookShare.findMany({
      where: { songbookId },
      select: { canEdit: true, user: { select: { id: true, displayName: true, avatarUrl: true } }, team: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return shares.map((share) => ({ canEdit: share.canEdit, user: share.user, team: share.team }));
  }

  async shareWithUser(user: AuthenticatedUser, songbookId: string, otherId: string, canEdit: boolean) {
    const songbook = await this.assertManages(user, songbookId);
    if (otherId === user.id || otherId === songbook.ownerUserId) throw new BadRequestException("It's already theirs");
    const connected = await this.prisma.client.connection.count({
      where: { status: "ACCEPTED", OR: [{ requesterId: user.id, addresseeId: otherId }, { requesterId: otherId, addresseeId: user.id }] },
    });
    if (connected === 0) throw new ForbiddenException("Share with one of your people");
    const before = await this.prisma.client.songbookShare.findUnique({ where: { songbookId_userId: { songbookId, userId: otherId } }, select: { canEdit: true } });
    await this.prisma.client.songbookShare.upsert({
      where: { songbookId_userId: { songbookId, userId: otherId } },
      create: { songbookId, userId: otherId, canEdit, sharedById: user.id },
      update: { canEdit },
    });
    // Told when it's shared, and when it can be edited now (issue #149).
    if (!before || (canEdit && !before.canEdit)) {
      const [book, by] = await Promise.all([
        this.prisma.client.songbook.findUnique({ where: { id: songbookId }, select: { name: true } }),
        this.prisma.client.user.findUnique({ where: { id: user.id }, select: { displayName: true } }),
      ]);
      await this.notifications.notify([{ userId: otherId, kind: "SONGBOOK_SHARED", data: { by: by?.displayName ?? "", songbook: book?.name ?? "", canEdit }, url: `/songbooks/${songbookId}` }]);
    }
    return this.list(songbookId);
  }

  async shareWithTeam(user: AuthenticatedUser, songbookId: string, teamId: string, canEdit: boolean) {
    const songbook = await this.assertManages(user, songbookId);
    if (songbook.ownerTeamId === teamId) throw new BadRequestException("It's already the team's");
    if (!user.isGlobalAdmin && !(await this.access.teamRole(user.id, teamId))) throw new ForbiddenException("Share with a team you're in");
    if (!(await this.prisma.client.team.count({ where: { id: teamId } }))) throw new NotFoundException("Team not found");
    await this.prisma.client.songbookShare.upsert({
      where: { songbookId_teamId: { songbookId, teamId } },
      create: { songbookId, teamId, canEdit, sharedById: user.id },
      update: { canEdit },
    });
    return this.list(songbookId);
  }

  async unshareUser(user: AuthenticatedUser, songbookId: string, otherId: string) {
    await this.assertManages(user, songbookId);
    await this.prisma.client.songbookShare.deleteMany({ where: { songbookId, userId: otherId } });
    return this.list(songbookId);
  }

  async unshareTeam(user: AuthenticatedUser, songbookId: string, teamId: string) {
    await this.assertManages(user, songbookId);
    await this.prisma.client.songbookShare.deleteMany({ where: { songbookId, teamId } });
    return this.list(songbookId);
  }

  /**
   * Makes a personal songbook a team's (issue #211), for one of the team's
   * admins: in one transaction, the songbook becomes the team's, and the
   * giver's own songs in it are moved to the team too ("move", as a song is,
   * #331) or shared with it to view ("share"), so its members read every
   * song they could before. Other people's songs in it stay theirs.
   */
  async giveToTeam(user: AuthenticatedUser, songbookId: string, teamId: string, songs: "move" | "share"): Promise<{ moved: number; shared: number }> {
    const songbook = await this.assertManages(user, songbookId);
    if (songbook.ownerScope !== "USER" || !songbook.ownerUserId) throw new BadRequestException("Only a personal songbook can be given to a team");
    if (!(await this.prisma.client.team.count({ where: { id: teamId } }))) throw new NotFoundException("Team not found");
    await this.access.assertSongverseTeam(teamId);
    if (!user.isGlobalAdmin && (await this.access.teamRole(user.id, teamId)) !== "ADMIN") throw new ForbiddenException("Only the team's admins take a songbook in: share it with the team instead");
    const ownerId = songbook.ownerUserId;
    const entries = await this.prisma.client.songbookEntry.findMany({
      where: { songbookId, songVersion: { ownerScope: "USER", ownerUserId: ownerId, deletedAt: null } },
      select: { songVersionId: true },
    });
    const ids = [...new Set(entries.map((entry) => entry.songVersionId))];
    await this.prisma.client.$transaction(
      async (tx) => {
        await tx.songbook.update({ where: { id: songbookId }, data: { ownerScope: "TEAM", ownerTeamId: teamId, ownerUserId: null } });
        // The team's own now: no share with it needed.
        await tx.songbookShare.deleteMany({ where: { songbookId, teamId } });
        if (ids.length === 0) return;
        if (songs === "move") {
          // As SongOwnershipService.handOver does for one song, for all of them.
          await tx.songVersion.updateMany({ where: { id: { in: ids } }, data: { ownerScope: "TEAM", ownerTeamId: teamId, ownerUserId: null } });
          await tx.songOwnershipRequest.updateMany({ where: { songVersionId: { in: ids }, status: "PENDING" }, data: { status: "DECLINED", decidedAt: new Date() } });
          await tx.accessGrant.deleteMany({ where: { songVersionId: { in: ids }, grantedToTeamId: teamId } });
          await tx.setlistItem.updateMany({ where: { songVersionId: { in: ids }, setlist: { ownerTeamId: teamId } }, data: { sharedByUserId: null } });
        } else {
          await tx.accessGrant.createMany({ data: ids.map((songVersionId) => ({ songVersionId, grantedToTeamId: teamId, grantedByUserId: ownerId })), skipDuplicates: true });
        }
      },
      { timeout: 60_000 },
    );
    return songs === "move" ? { moved: ids.length, shared: 0 } : { moved: 0, shared: ids.length };
  }

  /** Whether it's shared with `user` themselves (not only through a team): theirs to leave. */
  async sharedWithUser(user: AuthenticatedUser, songbookId: string): Promise<boolean> {
    return (await this.prisma.client.songbookShare.count({ where: { songbookId, userId: user.id } })) > 0;
  }

  /** Someone it's shared with takes it out of their songbooks (a team's share stays the team's). */
  async leave(user: AuthenticatedUser, songbookId: string) {
    const { count } = await this.prisma.client.songbookShare.deleteMany({ where: { songbookId, userId: user.id } });
    if (count === 0) throw new NotFoundException("This songbook isn't shared with you");
  }
}
