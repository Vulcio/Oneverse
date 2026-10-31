import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@oneverse/db";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { AccessPolicyService, type Viewer } from "../access/access-policy.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { requestMemo } from "../common/request-memo.js";

export const SONG_SELECT = {
  id: true,
  title: true,
  versionName: true,
  workId: true,
  ownerScope: true,
  ownerUserId: true,
  ownerTeamId: true,
  publicationState: true,
  // In the bin (issue #340): its set items show as placeholders until it's put back.
  deletedAt: true,
  documentJson: true,
  capo: true,
  ownerTeam: { select: { name: true } },
  // Its artists, for the Live view's title (issue #68).
  contributors: { where: { roles: { has: "PERFORMER" } }, select: { source: true }, orderBy: { displayOrder: "asc" } },
} satisfies Prisma.SongVersionSelect;

export type SongRow = Prisma.SongVersionGetPayload<{ select: typeof SONG_SELECT }>;
export type SetRow = { id: string; ownerUserId: string | null; ownerTeamId: string | null };

export interface SetAccess {
  canView: boolean;
  canEdit: boolean;
  /** Joined through the set's share link, rather than owning it or being on its team. */
  isGuest: boolean;
}

const NO_ACCESS: SetAccess = { canView: false, canEdit: false, isGuest: false };


/**
 * Who can open or change a set, and which of its songs they can read.
 *
 * - The owner of a personal set, and admins of a team set's team, edit it;
 *   other team members view it. Global admins can do anything.
 * - Guests (joined through the share link) view it.
 * - Everyone who can open a set can read every song in it that its owner
 *   could put there today (see addableWhere) - so a guest sees songs that
 *   aren't in their own library - plus songs shared into it by their owner
 *   (SetlistItem.sharedByUserId) for as long as that person can still see
 *   them. Anything else shows as a placeholder.
 */
@Injectable()
export class SetlistAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccessPolicyService,
  ) {}

  async access(user: AuthenticatedUser, set: SetRow): Promise<SetAccess> {
    if (user.isGlobalAdmin || set.ownerUserId === user.id) return { canView: true, canEdit: true, isGuest: false };
    if (set.ownerTeamId) {
      const role = await this.policy.teamRole(user.id, set.ownerTeamId);
      if (role) return { canView: true, canEdit: role === "ADMIN", isGuest: false };
    }
    const guest = await this.prisma.client.setlistGuest.findUnique({
      where: { setlistId_userId: { setlistId: set.id, userId: user.id } },
      select: { id: true },
    });
    return guest ? { canView: true, canEdit: false, isGuest: true } : NO_ACCESS;
  }

  /** 404 unless the user can open the set (not telling apart "doesn't exist" and "not yours"). */
  async findViewable(user: AuthenticatedUser, setlistId: string): Promise<{ set: SetRow; access: SetAccess }> {
    // Once per reading request (issue #341): a set kept offline asks for each of its songs.
    const set = await requestMemo(`set:${setlistId}`, () =>
      this.prisma.client.setlist.findUnique({
        where: { id: setlistId },
        select: { id: true, ownerUserId: true, ownerTeamId: true },
      }),
    );
    if (!set) throw new NotFoundException("Set not found");
    const access = await this.access(user, set);
    if (!access.canView) throw new NotFoundException("Set not found");
    return { set, access };
  }

  async findEditable(user: AuthenticatedUser, setlistId: string): Promise<SetRow> {
    const { set, access } = await this.findViewable(user, setlistId);
    if (!access.canEdit) throw new ForbiddenException("Only the set's owner or a team admin can change it");
    return set;
  }

  async assertTeamAdmin(user: AuthenticatedUser, teamId: string): Promise<void> {
    await this.policy.assertSongverseTeam(teamId);
    if (user.isGlobalAdmin) {
      const team = await this.prisma.client.team.findUnique({ where: { id: teamId }, select: { id: true } });
      if (!team) throw new NotFoundException("Team not found");
      return;
    }
    if ((await this.policy.teamRole(user.id, teamId)) !== "ADMIN") throw new ForbiddenException("Team admin role required");
  }

  async teamIdsOf(userId: string): Promise<Set<string>> {
    return new Set(await this.policy.teamIds(userId));
  }

  /**
   * Songs everyone who can open this set can also open: approved global
   * songs, plus the owning team's songs and those shared with it (issue
   * #331) for a team set, or for a personal set anything its owner can see.
   * Mirrored in memory by `addableIn()`.
   */
  async addableWhere(set: SetRow): Promise<Prisma.SongVersionWhereInput> {
    const approvedGlobal: Prisma.SongVersionWhereInput = { ownerScope: "GLOBAL", publicationState: "APPROVED" };
    if (set.ownerTeamId) {
      return {
        deletedAt: null,
        OR: [
          approvedGlobal,
          { ownerScope: "TEAM", ownerTeamId: set.ownerTeamId },
          { ownerScope: { not: "GLOBAL" }, accessGrants: { some: { grantedToTeamId: set.ownerTeamId } } },
          // In a songbook shared with the team (issue #211).
          { ownerScope: { not: "GLOBAL" }, songbookEntries: { some: { songbook: { shares: { some: { teamId: set.ownerTeamId } } } } } },
        ],
      };
    }
    // What the owner sees in their own library (as a regular user, even if they're a global admin).
    return this.policy.songsVisibleWhere({ id: set.ownerUserId!, isGlobalAdmin: false }, await this.policy.teamIds(set.ownerUserId!));
  }

  /**
   * Songs `user` may pick for the set: what's addable, and in a team's set
   * their own personal songs too, shared with the team or moved to it as
   * they're added (issue #331, AddSetlistItem's teamAccess).
   */
  async pickableWhere(user: AuthenticatedUser, set: SetRow): Promise<Prisma.SongVersionWhereInput> {
    const addable = await this.addableWhere(set);
    return set.ownerTeamId ? { OR: [addable, { ownerScope: "USER", ownerUserId: user.id }] } : addable;
  }

  /** In-memory twin of `addableWhere()`, for songs already loaded. */
  async addableIn(set: SetRow): Promise<(song: SongRow) => boolean> {
    const ownerTeams = set.ownerTeamId ? new Set([set.ownerTeamId]) : await this.teamIdsOf(set.ownerUserId!);
    // Songs shared with a personal set's owner (issue #77) are theirs to put in it.
    const shared = set.ownerTeamId ? new Map() : await this.policy.sharedWith(set.ownerUserId!);
    // A team set: the songs shared with the team (issue #331), and those of the songbooks shared with it (#211).
    const teamId = set.ownerTeamId;
    const teamShared = teamId
      ? await requestMemo(
          `teamShared:${teamId}`,
          async () =>
            new Set([
              ...(await this.prisma.client.accessGrant.findMany({ where: { grantedToTeamId: teamId }, select: { songVersionId: true } })).map((grant) => grant.songVersionId),
              ...(await this.prisma.client.songbookEntry.findMany({ where: { songbook: { shares: { some: { teamId } } } }, select: { songVersionId: true } })).map((entry) => entry.songVersionId),
            ]),
        )
      : new Set<string>();
    return (song) => {
      if (song.deletedAt) return false;
      if (song.ownerScope === "GLOBAL") return song.publicationState === "APPROVED";
      if (!set.ownerTeamId && shared.has(song.id)) return true;
      if (set.ownerTeamId && teamShared.has(song.id)) return true;
      if (song.ownerScope === "TEAM") return !!song.ownerTeamId && ownerTeams.has(song.ownerTeamId);
      return !set.ownerTeamId && song.ownerUserId === set.ownerUserId;
    };
  }

  /** Ids of the items whose song anyone who can open the set may read (see the class comment). */
  async readableItems(set: SetRow, items: { id: string; sharedByUserId: string | null; songVersion: SongRow }[]): Promise<Set<string>> {
    const addable = await this.addableIn(set);
    const sharerIds = [...new Set(items.map((item) => item.sharedByUserId).filter((id): id is string => !!id))];
    const sharers = new Map<string, (song: SongRow) => boolean>();
    if (sharerIds.length > 0) {
      const users = await this.prisma.client.user.findMany({ where: { id: { in: sharerIds } }, select: { id: true, isGlobalAdmin: true } });
      for (const sharer of users) sharers.set(sharer.id, await this.visibilityFor(sharer));
    }
    return new Set(
      items
        .filter((item) => addable(item.songVersion) || (!!item.sharedByUserId && !!sharers.get(item.sharedByUserId)?.(item.songVersion)))
        .map((item) => item.id),
    );
  }

  /** Whether a user can see a song in their own library. */
  async visibilityFor(user: Viewer): Promise<(song: SongRow) => boolean> {
    const [teams, shared] = await Promise.all([this.teamIdsOf(user.id), this.policy.sharedWith(user.id)]);
    return (song) => this.policy.songVisibleGivenTeams(user, teams, song, shared);
  }
}
