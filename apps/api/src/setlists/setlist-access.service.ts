import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@oneverse/db";
import { setEditors, setRight, type SetDateTeam } from "@oneverse/core";
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
  // Its image, for the lock screen while it plays (issue #173).
  imageStorageKey: true,
  ownerTeam: { select: { name: true } },
  // Its artists, for the Live view's title (issue #68).
  contributors: { where: { roles: { has: "PERFORMER" } }, select: { source: true }, orderBy: { displayOrder: "asc" } },
} satisfies Prisma.SongVersionSelect;

export type SongRow = Prisma.SongVersionGetPayload<{ select: typeof SONG_SELECT }>;
export type SetRow = { id: string; ownerUserId: string | null; ownerTeamId: string | null };

export interface SetAccess {
  canView: boolean;
  canEdit: boolean;
  /** Deletes it or hands it to another owner: its owner, the team's admins - not those who edit it through a date (issues #520, #578). */
  canManage: boolean;
  /** Joined through the set's share link, rather than owning it or being on its team. */
  isGuest: boolean;
}

const NO_ACCESS: SetAccess = { canView: false, canEdit: false, canManage: false, isGuest: false };

/** A date a set was made for, with its team's choices and line-up (issue #578). */
export type SetDate = SetDateTeam & { eventId: string; date: Date };


/**
 * Who can open or change a set, and which of its songs they can read.
 *
 * - The owner of a personal set, and admins of a team set's team, edit it;
 *   other team members view it. Global admins can do anything.
 * - A date's set (issue #578): every team whose date it is views it, and in
 *   the teams that edit it (setRight() in core) their admins and their
 *   people on the date's line-up edit it - without deleting it or giving it
 *   away - as does a viewer whose ask to edit was granted.
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
    return (await this.accessAll(user, [set])).get(set.id) ?? NO_ACCESS;
  }

  /** access() for several sets at once (the list of sets). */
  async accessAll(user: AuthenticatedUser, sets: readonly SetRow[]): Promise<Map<string, SetAccess>> {
    const out = new Map<string, SetAccess>();
    const left = sets.filter((set) => {
      if (user.isGlobalAdmin || set.ownerUserId === user.id) out.set(set.id, { canView: true, canEdit: true, canManage: true, isGuest: false });
      return !out.has(set.id);
    });
    if (left.length === 0) return out;
    const dates = await this.datesOfAll(left.map((set) => set.id));
    const teamIds = [...new Set([...left.flatMap((set) => (set.ownerTeamId ? [set.ownerTeamId] : [])), ...[...dates.values()].flat().map((date) => date.teamId)])];
    const [memberships, granted, guestOf] = await Promise.all([
      this.prisma.client.teamMembership.findMany({ where: { userId: user.id, teamId: { in: teamIds } }, select: { teamId: true, role: true } }),
      this.prisma.client.setEditRequest.findMany({ where: { userId: user.id, status: "GRANTED", setlistId: { in: left.map((set) => set.id) } }, select: { setlistId: true } }),
      this.prisma.client.setlistGuest.findMany({ where: { userId: user.id, setlistId: { in: left.map((set) => set.id) } }, select: { setlistId: true } }),
    ]);
    const teamRoles = Object.fromEntries(memberships.map((m) => [m.teamId, m.role as "ADMIN" | "MEMBER"]));
    const grants = new Set(granted.map((row) => row.setlistId));
    const guests = new Set(guestOf.map((row) => row.setlistId));
    for (const set of left) {
      if (set.ownerTeamId && teamRoles[set.ownerTeamId] === "ADMIN") {
        out.set(set.id, { canView: true, canEdit: true, canManage: true, isGuest: false });
        continue;
      }
      const ofSet = dates.get(set.id) ?? [];
      // A set made by hand for a team: its members view it.
      const right = ofSet.length > 0 ? setRight({ userId: user.id, teamRoles, granted: grants.has(set.id) }, ofSet) : set.ownerTeamId && teamRoles[set.ownerTeamId] ? "view" : null;
      if (right) out.set(set.id, { canView: true, canEdit: right === "edit", canManage: false, isGuest: false });
      else if (guests.has(set.id)) out.set(set.id, { canView: true, canEdit: false, canManage: false, isGuest: true });
      else out.set(set.id, NO_ACCESS);
    }
    return out;
  }

  /** The dates a set was made for (issue #578): each team's, with its choice to edit and its line-up. */
  async datesOf(setlistId: string): Promise<SetDate[]> {
    return (await this.datesOfAll([setlistId])).get(setlistId) ?? [];
  }

  private async datesOfAll(setlistIds: readonly string[]): Promise<Map<string, SetDate[]>> {
    const key = `setDates:${[...setlistIds].sort().join(",")}`;
    return requestMemo(key, async () => {
      const rows = await this.prisma.client.teamEventDate.findMany({
        where: { setlistId: { in: [...setlistIds] } },
        select: { setlistId: true, eventId: true, date: true, editsSet: true, event: { select: { teamId: true, editsSet: true } } },
      });
      const lineup = rows.length
        ? await this.prisma.client.teamEventAssignment.findMany({ where: { OR: rows.map((row) => ({ eventId: row.eventId, date: row.date })) }, select: { eventId: true, date: true, userId: true, status: true } })
        : [];
      const out = new Map<string, SetDate[]>();
      for (const row of rows) {
        const dates = out.get(row.setlistId!) ?? [];
        dates.push({
          eventId: row.eventId,
          date: row.date,
          teamId: row.event.teamId,
          editsSet: row.event.editsSet,
          dateEditsSet: row.editsSet,
          lineup: lineup.filter((place) => place.eventId === row.eventId && place.date.getTime() === row.date.getTime()),
        });
        out.set(row.setlistId!, dates);
      }
      return out;
    });
  }

  /** Who edits a date's set through its teams (issue #578): told when someone asks to edit it. */
  async editorsOf(setlistId: string): Promise<string[]> {
    const dates = await this.datesOf(setlistId);
    const admins = await this.prisma.client.teamMembership.findMany({ where: { teamId: { in: dates.map((date) => date.teamId) }, role: "ADMIN" }, select: { teamId: true, userId: true } });
    const byTeam: Record<string, string[]> = {};
    for (const admin of admins) (byTeam[admin.teamId] ??= []).push(admin.userId);
    return setEditors(dates, byTeam);
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
    if (!access.canEdit) throw new ForbiddenException("Only the set's owner, a team admin, or the people of the date's teams that edit it can change it");
    return set;
  }

  /** Deleting a set or handing it to another owner (issue #520): not for the date's host or music leader. */
  async findManageable(user: AuthenticatedUser, setlistId: string): Promise<SetRow> {
    const { set, access } = await this.findViewable(user, setlistId);
    if (!access.canManage) throw new ForbiddenException("Only the set's owner or a team admin can delete it or give it to someone else");
    return set;
  }

  async assertTeamAdmin(user: AuthenticatedUser, teamId: string): Promise<void> {
    if (user.isGlobalAdmin) {
      const team = await this.prisma.client.team.findUnique({ where: { id: teamId }, select: { id: true } });
      if (!team) throw new NotFoundException("Team not found");
      return;
    }
    if ((await this.policy.teamRole(user.id, teamId)) !== "ADMIN") throw new ForbiddenException("Team admin role required");
  }

  /** The organisation a team is part of, if any (issue #241). */
  private async organizationOf(teamId: string): Promise<string | null> {
    return requestMemo(`teamOrganization:${teamId}`, async () => (await this.prisma.client.team.findUnique({ where: { id: teamId }, select: { organizationId: true } }))?.organizationId ?? null);
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
      const organizationId = await this.organizationOf(set.ownerTeamId);
      return {
        deletedAt: null,
        OR: [
          approvedGlobal,
          { ownerScope: "TEAM", ownerTeamId: set.ownerTeamId },
          { ownerScope: { not: "GLOBAL" }, accessGrants: { some: { grantedToTeamId: set.ownerTeamId } } },
          // Shared with the team's organisation (issue #350): its members are all in it.
          ...(organizationId ? [{ ownerScope: { not: "GLOBAL" as const }, accessGrants: { some: { grantedToOrganizationId: organizationId } } }] : []),
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
   * they're added (issue #331, AddSetlistItem's teamAccess) - not in the set
   * of a group that only plans (issue #531), which has no songs to share with.
   */
  async pickableWhere(user: AuthenticatedUser, set: SetRow): Promise<Prisma.SongVersionWhereInput> {
    const addable = await this.addableWhere(set);
    return set.ownerTeamId && (await this.policy.usesSongverse(set.ownerTeamId)) ? { OR: [addable, { ownerScope: "USER", ownerUserId: user.id }] } : addable;
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
              ...(
                await this.prisma.client.accessGrant.findMany({
                  where: { OR: [{ grantedToTeamId: teamId }, { grantedToOrganization: { teams: { some: { id: teamId } } } }] },
                  select: { songVersionId: true },
                })
              ).map((grant) => grant.songVersionId),
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
