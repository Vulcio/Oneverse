import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { snapshotChanges, songSnapshot, readSongDocument, type SongChange, type SongSnapshot } from "@songverse/core";
import type { Prisma, SongRevisionKind } from "@songverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import { announceSongSaved } from "./song-announce.js";

/** Saves by the same person this close together are one history entry. */
export const MERGE_WINDOW_MS = 10 * 60 * 1000;

/** What a snapshot is taken from. */
export const SNAPSHOT_SELECT = {
  title: true,
  alternateTitle: true,
  versionName: true,
  sortTitle: true,
  language: true,
  album: true,
  year: true,
  copyright: true,
  copyrightYear: true,
  publisher: true,
  ccli: true,
  isrc: true,
  reference: true,
  notes: true,
  capo: true,
  documentJson: true,
  updatedAt: true,
  contributors: { select: { source: true, roles: true }, orderBy: { displayOrder: "asc" } },
} satisfies Prisma.SongVersionSelect;

type SnapshotRow = Prisma.SongVersionGetPayload<{ select: typeof SNAPSHOT_SELECT }>;

/** The song as the history keeps it, from its row. */
export function snapshotOfRow({ documentJson, updatedAt: _updatedAt, contributors, ...details }: SnapshotRow): SongSnapshot {
  return songSnapshot({ ...details, document: readSongDocument(documentJson), contributors });
}

/** The song as it was before a save: what a first history entry starts from. */
export interface SongBefore {
  snapshot: SongSnapshot;
  at: Date;
}

const ENTRY_SELECT = {
  id: true,
  kind: true,
  createdAt: true,
  updatedAt: true,
  changes: true,
  author: { select: { id: true, displayName: true } },
  restoredFrom: { select: { id: true, updatedAt: true } },
} satisfies Prisma.SongVersionRevisionSelect;

type EntryRow = Prisma.SongVersionRevisionGetPayload<{ select: typeof ENTRY_SELECT }>;

function toEntry(row: EntryRow) {
  return { ...row, changes: row.changes as SongChange[] };
}

function readSnapshot(json: Prisma.JsonValue): SongSnapshot {
  const snapshot = json as unknown as SongSnapshot | null;
  if (snapshot?.$schema !== "song-snapshot/v1") throw new Error("Not a song-snapshot/v1");
  return snapshot;
}

const newestFirst = [{ createdAt: "desc" }, { id: "desc" }] satisfies Prisma.SongVersionRevisionOrderByWithRelationInput[];

/**
 * A song's history (issue #71): an entry for each save, holding the song
 * as it left it. Recorded in the save's own transaction, so the history
 * and the song never disagree.
 */
@Injectable()
export class SongHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** The song as it is now, and when it was last saved: taken before a save, for `record`. */
  async before(tx: Prisma.TransactionClient, songVersionId: string): Promise<SongBefore | null> {
    const row = await tx.songVersion.findUnique({ where: { id: songVersionId }, select: SNAPSHOT_SELECT });
    return row ? { snapshot: snapshotOfRow(row), at: row.updatedAt } : null;
  }

  /**
   * Records the song as it is now (after a save in `tx`). An edit that
   * changed nothing the history keeps (tags only, say) adds nothing; one
   * by the same person as the last entry, within a few minutes, updates
   * that entry. A song with no history yet first gets `before` as its
   * BASELINE, so this save can be undone too.
   */
  async record(
    tx: Prisma.TransactionClient,
    songVersionId: string,
    change: { kind: SongRevisionKind; authorUserId: string | null; before?: SongBefore | null; restoredFromId?: string },
  ): Promise<void> {
    if (!(await this.recordEntry(tx, songVersionId, change))) return;
    // Who's in the song hears it was saved (issue #27): its revision now, and by whom.
    const [song, author] = await Promise.all([
      tx.songVersion.findUniqueOrThrow({ where: { id: songVersionId }, select: { documentJson: true } }),
      change.authorUserId ? tx.user.findUnique({ where: { id: change.authorUserId }, select: { displayName: true } }) : null,
    ]);
    announceSongSaved({ songVersionId, revision: readSongDocument(song.documentJson).revision, byId: change.authorUserId, by: author?.displayName ?? null });
  }

  /** The history entry for a change; false when it changed nothing. */
  private async recordEntry(
    tx: Prisma.TransactionClient,
    songVersionId: string,
    change: { kind: SongRevisionKind; authorUserId: string | null; before?: SongBefore | null; restoredFromId?: string },
  ): Promise<boolean> {
    const row = await tx.songVersion.findUniqueOrThrow({ where: { id: songVersionId }, select: SNAPSHOT_SELECT });
    const after = snapshotOfRow(row);
    const [latest, second] = await tx.songVersionRevision.findMany({
      where: { songVersionId },
      orderBy: newestFirst,
      take: 2,
      select: { id: true, kind: true, authorUserId: true, updatedAt: true, changes: true, snapshot: true },
    });

    if (!latest && change.before && change.kind !== "CREATED") {
      await tx.songVersionRevision.create({
        data: {
          songVersionId,
          kind: "BASELINE",
          authorUserId: null,
          changes: [],
          snapshot: change.before.snapshot as object,
          createdAt: change.before.at,
          updatedAt: change.before.at,
        },
      });
    }
    const previous = latest ? readSnapshot(latest.snapshot) : (change.before?.snapshot ?? null);
    const changes = previous ? snapshotChanges(previous, after) : [];
    if (change.kind === "EDITED" && previous && changes.length === 0) return false;

    const merges =
      change.kind === "EDITED" &&
      latest?.kind === "EDITED" &&
      change.authorUserId !== null &&
      latest.authorUserId === change.authorUserId &&
      Date.now() - latest.updatedAt.getTime() < MERGE_WINDOW_MS;
    if (merges) {
      // What the whole session changed, from the entry before it.
      const sessionChanges = second
        ? snapshotChanges(readSnapshot(second.snapshot), after)
        : [...new Set([...(latest.changes as SongChange[]), ...changes])];
      await tx.songVersionRevision.update({
        where: { id: latest.id },
        data: { snapshot: after as object, changes: sessionChanges },
      });
      return true;
    }
    await tx.songVersionRevision.create({
      data: {
        songVersionId,
        kind: change.kind,
        authorUserId: change.authorUserId,
        changes,
        snapshot: after as object,
        restoredFromId: change.restoredFromId ?? null,
      },
    });
    return true;
  }

  /** Newest first. */
  async list(songVersionId: string) {
    const rows = await this.prisma.client.songVersionRevision.findMany({ where: { songVersionId }, orderBy: newestFirst, select: ENTRY_SELECT });
    return rows.map(toEntry);
  }

  /** An entry, with the song as it left it and as the entry before left it. */
  async detail(songVersionId: string, revisionId: string) {
    const row = await this.prisma.client.songVersionRevision.findFirst({
      where: { id: revisionId, songVersionId },
      select: { ...ENTRY_SELECT, snapshot: true },
    });
    if (!row) throw new NotFoundException("No such entry in this song's history");
    const previous = await this.prisma.client.songVersionRevision.findFirst({
      where: { songVersionId, OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: row.id } }] },
      orderBy: newestFirst,
      select: { snapshot: true },
    });
    const { snapshot, ...entry } = row;
    return { ...toEntry(entry), snapshot: readSnapshot(snapshot), previous: previous ? readSnapshot(previous.snapshot) : null };
  }

  /** The snapshot a restore brings back; refused for the latest entry, which is the song as it is. */
  async snapshotToRestore(songVersionId: string, revisionId: string): Promise<SongSnapshot> {
    const [latest] = await this.prisma.client.songVersionRevision.findMany({ where: { songVersionId }, orderBy: newestFirst, take: 1, select: { id: true } });
    const row = await this.prisma.client.songVersionRevision.findFirst({ where: { id: revisionId, songVersionId }, select: { id: true, snapshot: true } });
    if (!row) throw new NotFoundException("No such entry in this song's history");
    if (latest?.id === row.id) throw new BadRequestException("That's the song as it is now");
    return readSnapshot(row.snapshot);
  }
}
