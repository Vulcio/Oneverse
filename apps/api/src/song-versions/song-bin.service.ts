import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { BINNED_TOO } from "@oneverse/db";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

/** How long a deleted song waits in the bin before it's deleted for good (issue #340). */
export const BIN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Where a song is used beyond its owner (issue #340): what deleting it would take from others. */
export interface SongUsage {
  /** Sets that aren't the deleter's own, with their team (null: someone's personal set). */
  sets: { id: string; name: string | null; eventDate: string | null; team: { id: string; name: string } | null }[];
  /** Songbooks that aren't the deleter's own. */
  songbooks: { id: string; name: string }[];
  /** Files, versions (arrangements) and notes other people have on it. */
  othersFiles: number;
  othersVersions: number;
  othersNotes: number;
  /** Teams it could be given to instead: those it's used in or shared with, that the deleter is in. */
  teams: { id: string; name: string }[];
}

/** A song in the user's bin. */
export interface BinnedSong {
  id: string;
  title: string;
  artist: string | null;
  team: { id: string; name: string } | null;
  deletedAt: string;
  deletedBy: string | null;
  /** When it's deleted for good. */
  purgeAt: string;
}

/**
 * The bin (issue #340): deleting a song puts it here, out of everyone's
 * sight (the shared Prisma client leaves it out of every song read), with
 * its sets, songbooks, files and history kept. Who could delete it can put
 * it back, or delete it for good; the Worker deletes it for good after
 * BIN_DAYS.
 */
@Injectable()
export class SongBinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly storage: StorageService,
  ) {}

  /** Puts the song in the bin. The caller has checked the user may delete it. */
  async bin(user: AuthenticatedUser, songVersionId: string): Promise<void> {
    const { count } = await this.prisma.client.songVersion.updateMany({ where: { id: songVersionId, deletedAt: null }, data: { deletedAt: new Date(), deletedByUserId: user.id } });
    if (count === 0) throw new NotFoundException("Song version not found");
  }

  /** Where the song is used beyond the user's own sets and songbooks, before they delete it. */
  async usage(user: AuthenticatedUser, songVersionId: string): Promise<SongUsage> {
    const song = await this.prisma.client.songVersion.findUnique({ where: { id: songVersionId }, select: { id: true, ownerScope: true, ownerUserId: true, ownerTeamId: true } });
    if (!song) throw new NotFoundException("Song version not found");
    await this.access.assertCanEdit(user, song, "song version");
    const teamIds = await this.access.teamIds(user.id);
    // Someone else's: not a personal set or songbook of the user's, nor one of the song's own team (nulls said, as SQL's NOT skips them).
    const notOwnedBy = (field: "ownerUserId" | "ownerTeamId", id: string) => ({ OR: [{ [field]: null }, { [field]: { not: id } }] });
    const notMine = { AND: [notOwnedBy("ownerUserId", user.id), ...(song.ownerTeamId ? [notOwnedBy("ownerTeamId", song.ownerTeamId)] : [])] };
    const [items, entries, othersFiles, othersVersions, othersNotes, grants] = await Promise.all([
      this.prisma.client.setlistItem.findMany({
        where: { songVersionId, setlist: notMine },
        select: { setlist: { select: { id: true, name: true, eventDate: true, ownerTeam: { select: { id: true, name: true } } } } },
      }),
      this.prisma.client.songbookEntry.findMany({ where: { songVersionId, songbook: notMine }, select: { songbook: { select: { id: true, name: true } } } }),
      this.prisma.client.attachment.count({ where: { songVersionId, OR: [{ uploadedByUserId: null }, { uploadedByUserId: { not: user.id } }] } }),
      this.prisma.client.arrangement.count({ where: { songVersionId, setlistItemId: null, OR: [{ ownerUserId: null }, { ownerUserId: { not: user.id } }] } }),
      this.prisma.client.note.count({ where: { songVersionId, NOT: { authorUserId: user.id } } }),
      this.prisma.client.accessGrant.findMany({ where: { songVersionId, grantedToTeamId: { in: teamIds } }, select: { grantedToTeam: { select: { id: true, name: true } } } }),
    ]);
    const sets = new Map(items.map(({ setlist }) => [setlist.id, setlist]));
    const teams = new Map<string, { id: string; name: string }>();
    for (const set of sets.values()) if (set.ownerTeam && teamIds.includes(set.ownerTeam.id) && set.ownerTeam.id !== song.ownerTeamId) teams.set(set.ownerTeam.id, set.ownerTeam);
    for (const grant of grants) if (grant.grantedToTeam) teams.set(grant.grantedToTeam.id, grant.grantedToTeam);
    return {
      sets: [...sets.values()].map((set) => ({ id: set.id, name: set.name, eventDate: set.eventDate ? set.eventDate.toISOString().slice(0, 10) : null, team: set.ownerTeam })),
      songbooks: [...new Map(entries.map(({ songbook }) => [songbook.id, songbook])).values()],
      othersFiles,
      othersVersions,
      othersNotes,
      // Only a personal song can be given to a team.
      teams: song.ownerScope === "USER" ? [...teams.values()] : [],
    };
  }

  /** The songs the user could restore: those they deleted, and their own or their admin teams' others deleted. */
  async list(user: AuthenticatedUser): Promise<BinnedSong[]> {
    const adminTeams = await this.prisma.client.teamMembership.findMany({ where: { userId: user.id, role: "ADMIN" }, select: { teamId: true } });
    const rows = await this.prisma.client.songVersion.findMany({
      where: {
        deletedAt: { not: null },
        OR: [{ deletedByUserId: user.id }, { ownerScope: "USER", ownerUserId: user.id }, { ownerScope: "TEAM", ownerTeamId: { in: adminTeams.map((team) => team.teamId) } }, ...(user.isGlobalAdmin ? [{ ownerScope: "GLOBAL" as const }] : [])],
      },
      select: {
        id: true,
        title: true,
        deletedAt: true,
        deletedBy: { select: { displayName: true } },
        ownerTeam: { select: { id: true, name: true } },
        contributors: { where: { roles: { has: "PERFORMER" } }, select: { source: true }, orderBy: { displayOrder: "asc" }, take: 1 },
      },
      orderBy: { deletedAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      artist: row.contributors[0]?.source ?? null,
      team: row.ownerTeam,
      deletedAt: row.deletedAt!.toISOString(),
      deletedBy: row.deletedBy?.displayName ?? null,
      purgeAt: new Date(row.deletedAt!.getTime() + BIN_DAYS * DAY_MS).toISOString(),
    }));
  }

  /** A binned song the user may restore or delete for good: who could delete it. */
  private async findBinned(user: AuthenticatedUser, songVersionId: string) {
    const song = await this.prisma.client.songVersion.findUnique({
      where: { id: songVersionId, deletedAt: { not: null } },
      select: { id: true, ownerScope: true, ownerUserId: true, ownerTeamId: true, deletedByUserId: true },
    });
    if (!song) throw new NotFoundException("Song not in the bin");
    if (song.deletedByUserId !== user.id) await this.access.assertCanEdit(user, song, "song version");
    return song;
  }

  async restore(user: AuthenticatedUser, songVersionId: string): Promise<void> {
    await this.findBinned(user, songVersionId);
    await this.prisma.client.songVersion.update({ where: { id: songVersionId }, data: { deletedAt: null, deletedByUserId: null } });
  }

  /** Deletes a binned song for good, now. */
  async deleteForGood(user: AuthenticatedUser, songVersionId: string): Promise<void> {
    const song = await this.findBinned(user, songVersionId);
    // Who deleted it but can no longer change it (moved to a team since) only puts it back.
    if (song.deletedByUserId === user.id && !(await this.access.canEdit(user, song))) throw new BadRequestException("Only its owner can delete it for good");
    await destroySong(this.prisma, this.storage, songVersionId);
  }
}

/**
 * Deletes a song for good: its versions, files, notes, history and its
 * places in sets and songbooks go with it (cascading), and its Work when it
 * was the last of it. Its stored files are removed unless something else
 * holds the same bytes.
 */
export async function destroySong(prisma: PrismaService, storage: StorageService, id: string): Promise<void> {
  const version = await prisma.client.songVersion.findUnique({
    where: { id, ...BINNED_TOO },
    select: { workId: true, imageStorageKey: true, attachments: { select: { storageKey: true, originalStorageKey: true } } },
  });
  if (!version) throw new NotFoundException("Song version not found");
  const siblingCount = await prisma.client.songVersion.count({ where: { workId: version.workId, NOT: { id }, ...BINNED_TOO } });
  await prisma.client.$transaction(async (tx) => {
    // Clear the Work's preferredOriginalVersionId FK before deleting the
    // version it points to, whether or not the Work itself survives.
    await tx.work.updateMany({ where: { id: version.workId, preferredOriginalVersionId: id }, data: { preferredOriginalVersionId: null } });
    await tx.songVersion.delete({ where: { id } });
    if (siblingCount === 0) await tx.work.delete({ where: { id: version.workId } });
  });
  const keys = [...version.attachments.flatMap((attachment) => [attachment.storageKey, attachment.originalStorageKey]), version.imageStorageKey].filter((key): key is string => !!key);
  await storage.deleteUnreferenced(keys);
}

/** Deletes for good the songs binned more than BIN_DAYS ago (the Worker, hourly); how many. */
export async function purgeExpiredBin(prisma: PrismaService, storage: StorageService): Promise<number> {
  const expired = await prisma.client.songVersion.findMany({ where: { deletedAt: { lt: new Date(Date.now() - BIN_DAYS * DAY_MS) } }, select: { id: true }, take: 500 });
  for (const { id } of expired) await destroySong(prisma, storage, id);
  return expired.length;
}
