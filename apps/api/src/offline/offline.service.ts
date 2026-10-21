import { createHash } from "node:crypto";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { type SavedDisplaySettings, type SongNotes, offlineFingerprint, setListing } from "@oneverse/core";
import { NotesService } from "../notes/notes.service.js";
import { AccessPolicyService } from "../access/access-policy.service.js";
import { AttachmentsService } from "../attachments/attachments.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SetlistsService } from "../setlists/setlists.service.js";
import { SongbooksService } from "../songbooks/songbooks.service.js";
import { SongVersionsService } from "../song-versions/song-versions.service.js";
import type { OfflinePinDto, OfflineSyncDto, PinKind } from "./dto/offline.dto.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Song copies in one sync answer at most (issue #122); a device fetches the rest. */
export const MAX_COPIES_PER_SYNC = 100;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

/** A song to keep offline: its details, its files' list, and a version that changes when either does. */
type SongCopy = {
  song: Awaited<ReturnType<SongVersionsService["findDetails"]>> extends Map<string, infer Song> ? Song : never;
  attachments: Awaited<ReturnType<AttachmentsService["listForSongVersions"]>> extends Map<string, infer Files> ? Files : never;
  notes: SongNotes;
  version: string;
};

/** Not found and not visible look the same to a device: either way, it goes. */
function isGone(error: unknown): boolean {
  return error instanceof NotFoundException || error instanceof ForbiddenException;
}

/**
 * What each user's devices keep offline (docs/offline.md, issues #51 and
 * #52): their pins, and the sync that tells a device what to download,
 * update and remove - the same protocol for the web and mobile apps.
 */
@Injectable()
export class OfflineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly setlists: SetlistsService,
    private readonly songs: SongVersionsService,
    private readonly songbooks: SongbooksService,
    private readonly attachments: AttachmentsService,
    private readonly notes: NotesService,
  ) {}

  listPins(user: AuthenticatedUser) {
    return this.prisma.client.offlinePin.findMany({
      where: { userId: user.id },
      select: { kind: true, targetId: true, includeAudio: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Pins something the user can open (and sets whether its audio comes too). */
  async pin(user: AuthenticatedUser, dto: OfflinePinDto) {
    if (dto.kind === "SET") await this.setlists.findOne(user, dto.targetId);
    else if (dto.kind === "SONG") await this.songs.findOne(user, dto.targetId);
    else await this.songbooks.findOne(user, dto.targetId);
    return this.prisma.client.offlinePin.upsert({
      where: { userId_kind_targetId: { userId: user.id, kind: dto.kind, targetId: dto.targetId } },
      create: { userId: user.id, kind: dto.kind, targetId: dto.targetId, includeAudio: dto.includeAudio ?? false },
      update: { includeAudio: dto.includeAudio ?? false },
      select: { kind: true, targetId: true, includeAudio: true, createdAt: true },
    });
  }

  async unpin(user: AuthenticatedUser, kind: PinKind, targetId: string) {
    await this.prisma.client.offlinePin.deleteMany({ where: { userId: user.id, kind, targetId } });
  }

  async songbookCopy(user: AuthenticatedUser, songbookId: string) {
    const songbook = await this.songbooks.findOne(user, songbookId);
    return { songbook, version: hash(songbook) };
  }

  /** Several songs at once (up to 100), in their order; ones that can't be opened are left out. */
  async songCopies(user: AuthenticatedUser, ids: string[]) {
    const copies = await this.buildCopies(user, [...new Set(ids)]);
    return [...new Set(ids)].flatMap((id) => copies.get(id) ?? []);
  }

  /**
   * Songs to keep offline, each with its details, its files' list, and a
   * version that changes when either does - for many songs at once, with a
   * few queries in all (issue #122). Ones the user can't see are left out.
   */
  private async buildCopies(user: AuthenticatedUser, ids: string[]): Promise<Map<string, SongCopy>> {
    const details = await this.songs.findDetails(user, ids);
    const files = await this.attachments.listForSongVersions(
      user,
      [...details.values()].map((song) => ({ id: song.id, canEditSong: song.canManage })),
    );
    // The notes one sees on each (issue #256), outside any set.
    const notesBySong = new Map<string, SongNotes>();
    for (const id of details.keys()) notesBySong.set(id, await this.notes.list(user, id, {}));
    const stamps = await this.notesStamps([...details.keys()]);
    return new Map(
      [...details.values()].map((song) => {
        const attachments = files.get(song.id) ?? [];
        return [song.id, { song, attachments, notes: notesBySong.get(song.id)!, version: withNotes(songVersion(song.updatedAt, attachments), stamps.get(song.id)) }] as const;
      }),
    );
  }

  /**
   * When each song's notes last changed (issue #256), for its version: how
   * many notes and replies it has, and the latest change. Anyone's - a
   * change one doesn't see only costs a copy fetched again.
   */
  private async notesStamps(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.client.$queryRaw<{ songVersionId: string; notes: number; replies: number; last: Date }[]>`
      SELECT n."songVersionId", count(DISTINCT n.id)::int AS notes, count(r.id)::int AS replies, greatest(max(n."updatedAt"), max(r."updatedAt")) AS last
      FROM "Note" n LEFT JOIN "NoteReply" r ON r."noteId" = n.id
      WHERE n."songVersionId" = ANY(${ids}) GROUP BY n."songVersionId"`;
    return new Map(rows.map((row) => [row.songVersionId, `${row.notes}.${row.replies}@${new Date(row.last).toISOString()}`]));
  }

  /**
   * What a device should keep now. It sends what it keeps with the versions
   * it has; each list comes back with current versions, a copy only where
   * the device's is out of date, and what's `gone` (deleted, no longer
   * visible, unpinned) for the device to remove.
   *
   * - Sets: dated from yesterday to `days` ahead, pinned, or already kept
   *   (opened) and still visible.
   * - Songbooks: pinned ("Keep a local copy").
   * - Songs: the user's own, pinned, in a kept songbook, or in a kept set -
   *   with `audio` when a pin asks for their audio files.
   *
   * With a `fingerprint` (issue #121) the answer is only whether that's
   * still what the device keeps: `unchanged` with the small settings, or
   * not, and the device syncs with its lists.
   */
  async sync(user: AuthenticatedUser, dto: OfflineSyncDto) {
    const days = dto.days ?? 14;
    const pins = await this.listPins(user);
    const pinned = (kind: PinKind) => pins.filter((pin) => pin.kind === kind);

    // --- sets
    const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    const from = new Date(today - DAY_MS).toISOString().slice(0, 10);
    const to = new Date(today + days * DAY_MS).toISOString().slice(0, 10);
    // As the sidebar lists them (issue #235): a team's event set only for a date one signed up for.
    const upcoming = (await this.setlists.list(user)).filter((set) => set.eventDate && set.eventDate >= from && set.eventDate <= to && setListing(set) === "sidebar").map((set) => set.id);
    const knownSets = new Map((dto.known ?? []).map((set) => [set.id, set.version]));
    const sets: { id: string; version: string; copy?: Awaited<ReturnType<SetlistsService["offlineCopy"]>> }[] = [];
    const gone: string[] = [];
    const setSongIds = new Map<string, string[]>();
    for (const id of new Set([...upcoming, ...pinned("SET").map((pin) => pin.targetId), ...knownSets.keys()])) {
      try {
        const copy = await this.setlists.offlineCopy(user, id);
        setSongIds.set(id, copy.songs.flatMap((view) => (view.song ? [view.song.id] : [])));
        sets.push(copy.version === knownSets.get(id) ? { id, version: copy.version } : { id, version: copy.version, copy });
      } catch (error) {
        if (isGone(error)) gone.push(id);
        else throw error;
      }
    }

    // --- songbooks
    const knownSongbooks = new Map((dto.knownSongbooks ?? []).map((book) => [book.id, book.version]));
    const songbooks: { id: string; version: string; copy?: Awaited<ReturnType<OfflineService["songbookCopy"]>> }[] = [];
    const bookSongIds = new Map<string, string[]>();
    for (const pin of pinned("SONGBOOK")) {
      try {
        const copy = await this.songbookCopy(user, pin.targetId);
        bookSongIds.set(pin.targetId, copy.songbook.entries.map((entry) => entry.songVersionId));
        songbooks.push(copy.version === knownSongbooks.get(pin.targetId) ? { id: pin.targetId, version: copy.version } : { id: pin.targetId, version: copy.version, copy });
      } catch (error) {
        if (!isGone(error)) throw error;
      }
    }
    const goneSongbooks = [...knownSongbooks.keys()].filter((id) => !songbooks.some((book) => book.id === id));

    // --- songs: which, and whether with their audio
    const audio = new Set<string>();
    const wanted = new Set<string>();
    const own = await this.prisma.client.songVersion.findMany({
      where: { AND: [await this.access.songsVisibleTo(user), { ownerScope: "USER", ownerUserId: user.id }] },
      select: { id: true },
    });
    for (const { id } of own) wanted.add(id);
    for (const pin of pinned("SONG")) {
      wanted.add(pin.targetId);
      if (pin.includeAudio) audio.add(pin.targetId);
    }
    for (const [kind, lists] of [
      ["SONGBOOK", bookSongIds],
      ["SET", setSongIds],
    ] as const) {
      for (const [id, songIds] of lists) {
        const withAudio = pins.some((pin) => pin.kind === kind && pin.targetId === id && pin.includeAudio);
        for (const songId of songIds) {
          wanted.add(songId);
          if (withAudio) audio.add(songId);
        }
      }
    }
    // Versions in one query; full copies only for what the device doesn't have.
    // Only the files this user sees (issue #72).
    const visibleFiles = AttachmentsService.visibleWhere(user, await this.access.teamIds(user.id));
    const current = await this.prisma.client.songVersion.findMany({
      where: { AND: [await this.access.songsVisibleTo(user), { id: { in: [...wanted] } }] },
      select: {
        id: true,
        updatedAt: true,
        attachments: { where: visibleFiles, select: { id: true, createdAt: true, stemPart: true, partName: true, recordingKey: true, recordingTempo: true, recordingFirstBeat: true, recordingFreeIntro: true, recordingBeats: true, recordingDownbeats: true, pitchOffset: true, recordingTimeSignature: true, multitrackId: true, multitrackName: true, multitrackSetlistId: true, cuePoints: true, locked: true, otherTake: true, processing: true, visibility: true, visibleToTeamId: true } },
      },
    });
    const stamps = await this.notesStamps(current.map((row) => row.id));
    const entries = current.map((row) => ({ id: row.id, version: withNotes(songVersion(row.updatedAt, row.attachments), stamps.get(row.id)), audio: audio.has(row.id) }));
    const viewerRow = await this.prisma.client.user.findUnique({ where: { id: user.id }, select: { chordNotation: true, capoDisplayMode: true, liveView: true, chordDiagrams: true, chordColors: true, leftHanded: true, guitarTuning: true, ukuleleTuning: true, pianoSmooth: true, pianoHands: true, pianoNoteNames: true, displaySettings: true } });
    const viewer = {
      chordNotation: viewerRow?.chordNotation ?? "LETTERS",
      capoDisplayMode: viewerRow?.capoDisplayMode ?? "SOUNDING",
      liveView: viewerRow?.liveView ?? "CHART",
      chordDiagrams: viewerRow?.chordDiagrams ?? "OFF",
      chordColors: viewerRow?.chordColors ?? false,
      leftHanded: viewerRow?.leftHanded ?? false,
      guitarTuning: viewerRow?.guitarTuning ?? "standard",
      ukuleleTuning: viewerRow?.ukuleleTuning ?? "standard",
      pianoSmooth: viewerRow?.pianoSmooth ?? true,
      pianoHands: viewerRow?.pianoHands ?? "both",
      pianoNoteNames: viewerRow?.pianoNoteNames ?? "card",
      // Each mode's, from the Display panel (issue #209).
      displaySettings: (viewerRow?.displaySettings ?? {}) as SavedDisplaySettings,
    };

    // Asked only whether anything changed (issue #121): the device's
    // fingerprint of what it keeps against this one of what it should keep.
    if (dto.fingerprint !== undefined) {
      const expected = await offlineFingerprint({
        sets: sets.map(({ id, version }) => ({ id, version })),
        songs: entries,
        songbooks: songbooks.map(({ id, version }) => ({ id, version })),
      });
      return expected === dto.fingerprint ? { unchanged: true as const, days, upcoming, pins, viewer } : { unchanged: false as const };
    }

    // Full copies only for the songs the device doesn't have as they are,
    // and only so many in one answer (issue #122): the rest are `pending`,
    // for the device to fetch a hundred at a time (POST /offline/songs).
    const knownSongs = new Map((dto.knownSongs ?? []).map((song) => [song.id, song.version]));
    const outOfDate = entries.filter((entry) => entry.version !== knownSongs.get(entry.id));
    const sent = new Set(outOfDate.slice(0, MAX_COPIES_PER_SYNC).map((entry) => entry.id));
    const copies = await this.buildCopies(user, [...sent]);
    const songs: { id: string; version: string; audio: boolean; copy?: SongCopy; pending?: true }[] = entries.map(
      (entry) => (copies.has(entry.id) ? { ...entry, copy: copies.get(entry.id) } : entry.version === knownSongs.get(entry.id) ? entry : { ...entry, pending: true as const }),
    );
    const wantedNow = new Set(entries.map((entry) => entry.id));
    const goneSongs = [...knownSongs.keys()].filter((id) => !wantedNow.has(id));

    return {
      days,
      upcoming,
      sets,
      gone,
      songbooks,
      goneSongbooks,
      songs,
      goneSongs,
      pins,
      viewer,
    };
  }
}

/** A song's version with its notes' stamp, when it has notes. */
function withNotes(version: string, stamp: string | undefined): string {
  return stamp ? hash([version, stamp]) : version;
}

/** A song's version: its last change and its files (a file added or removed, or its part, key or tempo changed, changes it too). */
function songVersion(
  updatedAt: Date | string,
  attachments: {
    id: string;
    createdAt: Date | string;
    stemPart: string | null;
    partName: string | null;
    recordingKey: string | null;
    recordingTempo: number | null;
    recordingFirstBeat: number | null;
    recordingFreeIntro?: boolean;
    recordingBeats?: number[];
    pitchOffset: number | null;
    recordingTimeSignature: string | null;
    multitrackId: string | null;
    multitrackName: string | null;
    multitrackSetlistId: string | null;
    cuePoints?: unknown;
    locked?: boolean;
    otherTake: boolean;
    processing: string | null;
    visibility: string;
    visibleToTeamId: string | null;
  }[],
): string {
  const files = attachments
    .map(
      (file) =>
        `${file.id}@${new Date(file.createdAt).toISOString()}:${file.stemPart ?? ""}:${file.partName ?? ""}:${file.recordingKey ?? ""}:${file.recordingTempo ?? ""}:${file.recordingFirstBeat ?? ""}:${file.recordingFreeIntro ?? false}:${file.recordingBeats?.length ?? 0}:${file.pitchOffset ?? ""}:${file.recordingTimeSignature ?? ""}:${file.multitrackId ?? ""}:${file.multitrackName ?? ""}:${file.multitrackSetlistId ?? ""}:${JSON.stringify(file.cuePoints ?? null)}:${file.locked ?? false}:${file.otherTake}:${file.processing ?? ""}:${file.visibility}:${file.visibleToTeamId ?? ""}`,
    )
    .sort();
  return hash({ updatedAt: new Date(updatedAt).toISOString(), files });
}
