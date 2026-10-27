import type {
  Attachment,
  DisplaySettings,
  OfflinePin,
  OfflineSyncCheck,
  OfflineSyncResponse,
  SetlistDetail,
  SetlistOfflineCopy,
  SetlistSongView,
  SongbookDetail,
  SongbookEntryHit,
  SongbookOfflineCopy,
  SongNotes,
  SongOfflineCopy,
} from "../api-client/index.js";
import { lyricsLines, matchLyrics, parseLyricsQuery, type LyricsMatch } from "../search-text/lyrics.js";
import type { AppModeValue, CapoDisplayModeValue, ChordDiagramsValue, ChordNotationValue, LiveViewValue } from "../constants/index.js";
import type { SongDocumentV2 } from "../schemas/song-document-v2.js";
import { foldSearchWords } from "../search-text/index.js";
import { formatSongbookReference, limitSongbookHits, rankSongbookHits, SONGBOOK_HIT_LIMITS, songbookReferences, type SongbookHitMatch } from "../songbook-references/index.js";

/**
 * What a device keeps to work offline (docs/offline.md, issues #25 and
 * #50), as plain functions over a storage interface: the web app gives it
 * IndexedDB, a mobile app (#28) its own store.
 */
export type OfflineStoreKey = "sets" | "songs" | "songbooks" | "files" | "meta";
export interface OfflineStorage {
  get<T>(store: OfflineStoreKey, key: string): Promise<T | undefined>;
  put(store: OfflineStoreKey, key: string, value: unknown): Promise<void>;
  delete(store: OfflineStoreKey, key: string): Promise<void>;
  keys(store: OfflineStoreKey): Promise<string[]>;
}

/** A set as kept on the device: the offline copy (with its version), and when it was downloaded. */
export interface KeptSet extends SetlistOfflineCopy {
  savedAt: string;
}

/** Keeps (or refreshes) a set and its songs. */
export async function keepSet(storage: OfflineStorage, copy: SetlistOfflineCopy, now = new Date()): Promise<void> {
  const kept: KeptSet = { ...copy, savedAt: now.toISOString() };
  await storage.put("sets", copy.set.id, kept);
}

export async function keptSet(storage: OfflineStorage, setlistId: string): Promise<KeptSet | undefined> {
  return storage.get<KeptSet>("sets", setlistId);
}

/** The set as its page shows it. */
export async function keptSetDetail(storage: OfflineStorage, setlistId: string): Promise<SetlistDetail | undefined> {
  return (await keptSet(storage, setlistId))?.set;
}

/** One song of a kept set, as its song page and Live show it. */
export async function keptSetSong(storage: OfflineStorage, setlistId: string, itemId: string): Promise<SetlistSongView | undefined> {
  return (await keptSet(storage, setlistId))?.songs.find((view) => view.item.id === itemId);
}

/** The notes kept for a song (issue #256): as seen in a kept set, else outside sets (a kept song's). */
export async function keptSongNotes(storage: OfflineStorage, songVersionId: string, setlistId?: string | null): Promise<SongNotes | undefined> {
  if (setlistId) {
    const inSet = (await keptSet(storage, setlistId))?.notes?.[songVersionId];
    if (inSet) return inSet;
  }
  return (await keptSongCopy(storage, songVersionId))?.notes;
}

export async function allKeptSets(storage: OfflineStorage): Promise<KeptSet[]> {
  const sets = await Promise.all((await storage.keys("sets")).map((key) => keptSet(storage, key)));
  return sets.filter((set): set is KeptSet => !!set);
}

/** A song as kept on the device (issue #52): its copy, whether its audio comes too, and when it was downloaded. */
export interface KeptSongCopy extends SongOfflineCopy {
  audio: boolean;
  savedAt: string;
}

export interface KeptSongbook extends SongbookOfflineCopy {
  savedAt: string;
}

export async function keptSongCopy(storage: OfflineStorage, songVersionId: string): Promise<KeptSongCopy | undefined> {
  return storage.get<KeptSongCopy>("songs", songVersionId);
}

export async function keptSongbook(storage: OfflineStorage, songbookId: string): Promise<SongbookDetail | undefined> {
  return (await storage.get<KeptSongbook>("songbooks", songbookId))?.songbook;
}

async function all<T>(storage: OfflineStorage, store: OfflineStoreKey): Promise<T[]> {
  const values = await Promise.all((await storage.keys(store)).map((key) => storage.get<T>(store, key)));
  return values.filter((value): value is Awaited<T> & T => value !== undefined);
}

export const allKeptSongs = (storage: OfflineStorage) => all<KeptSongCopy>(storage, "songs");
export const allKeptSongbooks = (storage: OfflineStorage) => all<KeptSongbook>(storage, "songbooks");

/** A song readable offline: from the songs kept on their own, or else as it's written in a kept set. */
export interface FoundSong {
  songVersionId: string;
  title: string;
  versionName: string | null;
  /** One line; null when only known from a set. */
  artists: string | null;
  document: SongDocumentV2;
  /** The song's own capo: a suggestion. */
  capo: number | null;
}


function artistLine(song: SongOfflineCopy["song"]): string | null {
  const names = song.artists.map((artist) => artist.source ?? artist.userId ?? "").filter(Boolean);
  return names.length > 0 ? names.join(", ") : null;
}

/** Every song readable offline, each once: kept songs first (they have more), then the songs of kept sets. */
export async function allFoundSongs(storage: OfflineStorage): Promise<FoundSong[]> {
  const found = new Map<string, FoundSong>();
  for (const { song } of await allKeptSongs(storage)) {
    found.set(song.id, {
      songVersionId: song.id,
      title: song.title,
      versionName: song.versionName,
      artists: artistLine(song),
      document: song.documentJson,
      capo: song.capo,
    });
  }
  for (const set of await allKeptSets(storage)) {
    for (const view of set.songs) {
      const song = view.song;
      if (!song || found.has(song.id)) continue;
      found.set(song.id, { songVersionId: song.id, title: song.title, versionName: song.versionName, artists: null, document: song.document, capo: song.suggestedCapo });
    }
  }
  return [...found.values()];
}

/** The songs readable offline whose title, version or artists match `query` (case and accents ignored). */
export async function searchKeptSongs(storage: OfflineStorage, query: string, limit = 8): Promise<FoundSong[]> {
  const q = foldSearchWords(query);
  return (await allFoundSongs(storage))
    .filter((song) => !q || [song.title, song.versionName, song.artists].some((text) => text && foldSearchWords(text).includes(q)))
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** The songs readable offline found by their words (issue #221), as the API finds them: each with the line found, by title. */
export async function searchKeptLyrics(storage: OfflineStorage, query: string, limit = 8): Promise<(FoundSong & { lyricsMatch: LyricsMatch })[]> {
  const terms = parseLyricsQuery(query);
  if (!terms) return [];
  return (await allFoundSongs(storage))
    .flatMap((song) => {
      const lyricsMatch = matchLyrics(terms, lyricsLines(song.document));
      return lyricsMatch ? [{ ...song, lyricsMatch }] : [];
    })
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, limit);
}

export async function findKeptSong(storage: OfflineStorage, songVersionId: string): Promise<FoundSong | undefined> {
  return (await allFoundSongs(storage)).find((song) => song.songVersionId === songVersionId);
}

/**
 * Entries of the songbooks kept on the device for a search by number ("HY 42",
 * "58"), ranked as the API ranks them (issue #213): exactly that number, then
 * numbers starting with it, then containing it, `limits` of each.
 */
export async function searchKeptEntries(storage: OfflineStorage, query: string, limits: Record<SongbookHitMatch, number> = SONGBOOK_HIT_LIMITS): Promise<SongbookEntryHit[]> {
  if (songbookReferences(query).length === 0) return [];
  const entries = (await allKeptSongbooks(storage)).flatMap(({ songbook }) =>
    songbook.entries.map((entry) => ({ entryCode: entry.entryCode ?? null, songbook, entry })),
  );
  return limitSongbookHits(rankSongbookHits(query, entries), limits).map(({ songbook, entry, match }) => ({
    songbookId: songbook.id,
    songbookName: songbook.name,
    abbreviation: songbook.abbreviation,
    entryCode: entry.entryCode!,
    sectionLabel: entry.sectionLabel ?? null,
    songVersionId: entry.songVersionId,
    title: entry.songVersionTitle ?? "",
    match,
  }));
}

/** Where a song is in the numbered songbooks and sets kept on the device: "JEM 855 · JEM3" (issue #59). */
export async function keptSongReferences(storage: OfflineStorage, songVersionId: string): Promise<string[]> {
  const references = new Set<string>();
  for (const { songbook } of await allKeptSongbooks(storage)) {
    for (const entry of songbook.entries) {
      if (entry.songVersionId !== songVersionId || !entry.entryCode) continue;
      references.add(formatSongbookReference({ songbookName: songbook.name, abbreviation: songbook.abbreviation, entryCode: entry.entryCode, sectionLabel: entry.sectionLabel }));
    }
  }
  for (const set of await allKeptSets(storage)) {
    for (const view of set.songs) if (view.song?.id === songVersionId) for (const reference of view.songbookReferences ?? []) references.add(reference);
  }
  return [...references].sort();
}

/** The user's chord settings, as of the last sync, for songs shown on their own. */
export interface OfflineViewer {
  chordNotation: ChordNotationValue;
  capoDisplayMode: CapoDisplayModeValue;
  liveView?: LiveViewValue;
  chordDiagrams?: ChordDiagramsValue;
  chordColors?: boolean;
  leftHanded?: boolean;
  guitarTuning?: string;
  ukuleleTuning?: string;
  pianoSmooth?: boolean;
  pianoHands?: string;
  pianoNoteNames?: string;
  /** Each mode's display settings (issue #209); left out by an older copy. */
  displaySettings?: Partial<Record<AppModeValue, DisplaySettings>>;
}

export async function offlineViewer(storage: OfflineStorage): Promise<OfflineViewer | undefined> {
  return storage.get<OfflineViewer>("meta", "viewer");
}

export async function offlinePins(storage: OfflineStorage): Promise<OfflinePin[]> {
  return (await storage.get<OfflinePin[]>("meta", "pins")) ?? [];
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** POST /offline/songs takes a hundred at most. */
const SONGS_PER_FETCH = 100;

/** What a sync did, and when it last ran. */
export interface OfflineSyncResult {
  at: string;
  updated: number;
  removed: number;
  kept: number;
}

type Known = { id: string; version: string }[];

/** What a device keeps, as the fingerprint sees it. */
export interface OfflineHoldings {
  sets: Known;
  songs: (Known[number] & { audio: boolean })[];
  songbooks: Known;
}

/**
 * One fingerprint of what a device keeps (issue #121), worked out the same
 * way by the device (from what it has) and the API (from what it should
 * have): when they match, a sync has nothing to send either way. SHA-256,
 * through Web Crypto (browsers and Node alike).
 */
export async function offlineFingerprint(holdings: OfflineHoldings): Promise<string> {
  const lines = [
    ...holdings.sets.map((set) => `set ${set.id} ${set.version}`),
    ...holdings.songs.map((song) => `song ${song.id} ${song.version} ${song.audio ? "audio" : ""}`),
    ...holdings.songbooks.map((book) => `songbook ${book.id} ${book.version}`),
  ].sort();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(lines.join("\n")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Brings the device's copy up to date (issues #51, #52): sends the versions
 * of what it keeps (sets, songs, songbooks), stores the copies that changed
 * or are new, removes what's gone (deleted, access lost, unpinned), and
 * drops sets a day after their date. `send` is POST /offline/sync.
 *
 * With `check` (issue #121), it first sends only a fingerprint of what it
 * keeps (and its sets, which are few): when the API's matches, nothing is
 * out of date and the lists aren't sent either way.
 *
 * An answer carries so many song copies at most (issue #122): the others
 * come `pending`, and `fetchSongs` (POST /offline/songs) gets them a
 * hundred at a time. Without it they come with the next syncs.
 */
export async function syncKeptSets(
  storage: OfflineStorage,
  send: (known: Known, knownSongs: Known, knownSongbooks: Known) => Promise<OfflineSyncResponse>,
  now = new Date(),
  options: {
    check?: (fingerprint: string, known: Known) => Promise<OfflineSyncCheck>;
    fetchSongs?: (ids: string[]) => Promise<SongOfflineCopy[]>;
  } = {},
): Promise<OfflineSyncResult> {
  const { check, fetchSongs } = options;
  const keptSongs = await all<{ version?: string; audio?: boolean; song: { id: string } }>(storage, "songs");
  const knownSongs = keptSongs.map((kept) => ({ id: kept.song.id, version: kept.version ?? "" }));
  const knownSongbooks = (await all<{ version?: string; songbook: { id: string } }>(storage, "songbooks")).map((kept) => ({ id: kept.songbook.id, version: kept.version ?? "" }));
  const before = await allKeptSets(storage);
  const known = before.map((kept) => ({ id: kept.set.id, version: kept.version ?? "" }));
  let updated = 0;
  let removed = 0;
  const savedAt = now.toISOString();

  if (check) {
    const fingerprint = await offlineFingerprint({
      sets: known,
      songs: keptSongs.map((kept) => ({ id: kept.song.id, version: kept.version ?? "", audio: kept.audio ?? false })),
      songbooks: knownSongbooks,
    });
    const answer = await check(fingerprint, known);
    if (answer.unchanged) {
      await storage.put("meta", "viewer", answer.viewer);
      await storage.put("meta", "pins", answer.pins);
      removed += await dropPastSets(storage, now);
      const result: OfflineSyncResult = { at: savedAt, updated, removed, kept: (await storage.keys("sets")).length };
      await storage.put("meta", "lastSync", result);
      return result;
    }
  }
  const response = await send(known, knownSongs, knownSongbooks);

  for (const id of response.gone) {
    await storage.delete("sets", id);
    removed++;
  }
  for (const entry of response.sets) {
    if (!entry.copy) continue;
    await keepSet(storage, entry.copy, now);
    updated++;
  }
  for (const id of response.goneSongbooks ?? []) {
    await storage.delete("songbooks", id);
    removed++;
  }
  for (const entry of response.songbooks ?? []) {
    if (!entry.copy) continue;
    await storage.put("songbooks", entry.id, { ...entry.copy, savedAt } satisfies KeptSongbook);
    updated++;
  }
  for (const id of response.goneSongs ?? []) {
    await storage.delete("songs", id);
    removed++;
  }
  for (const entry of response.songs ?? []) {
    if (entry.copy) {
      await storage.put("songs", entry.id, { ...entry.copy, audio: entry.audio, savedAt } satisfies KeptSongCopy);
      updated++;
    } else if (entry.pending) {
      continue;
    } else {
      // Same song, but its audio may have been asked for (or no longer).
      const kept = await keptSongCopy(storage, entry.id);
      if (kept && kept.audio !== entry.audio) await storage.put("songs", entry.id, { ...kept, audio: entry.audio });
    }
  }
  // The copies the answer had no room for, a hundred at a time.
  const pending = (response.songs ?? []).filter((entry) => entry.pending);
  if (fetchSongs) {
    const audio = new Map(pending.map((entry) => [entry.id, entry.audio]));
    for (let start = 0; start < pending.length; start += SONGS_PER_FETCH) {
      for (const copy of await fetchSongs(pending.slice(start, start + SONGS_PER_FETCH).map((entry) => entry.id))) {
        await storage.put("songs", copy.song.id, { ...copy, audio: audio.get(copy.song.id) ?? false, savedAt } satisfies KeptSongCopy);
        updated++;
      }
    }
  }
  if (response.viewer) await storage.put("meta", "viewer", response.viewer);
  if (response.pins) await storage.put("meta", "pins", response.pins);

  removed += await dropPastSets(storage, now);
  const result: OfflineSyncResult = { at: savedAt, updated, removed, kept: (await storage.keys("sets")).length };
  await storage.put("meta", "lastSync", result);
  return result;
}

/** A set drops off the device a day after its date; how many did. */
async function dropPastSets(storage: OfflineStorage, now: Date): Promise<number> {
  const yesterday = new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
  let dropped = 0;
  for (const kept of await allKeptSets(storage)) {
    if (kept.set.eventDate && kept.set.eventDate < yesterday) {
      await storage.delete("sets", kept.set.id);
      dropped++;
    }
  }
  return dropped;
}

export async function lastOfflineSync(storage: OfflineStorage): Promise<OfflineSyncResult | undefined> {
  return storage.get<OfflineSyncResult>("meta", "lastSync");
}

/** A file the device should have: a kept song's PDF, image, ChordPro... and its audio only when asked for. */
export interface WantedFile {
  songVersionId: string;
  attachment: Attachment;
}

export async function wantedFiles(storage: OfflineStorage): Promise<WantedFile[]> {
  return (await allKeptSongs(storage)).flatMap((kept) =>
    kept.attachments.filter((file) => file.type !== "AUDIO" || kept.audio).map((attachment) => ({ songVersionId: kept.song.id, attachment })),
  );
}

/**
 * Brings the device's files in line with its kept songs (issue #52): downloads
 * the ones it's missing (by attachment, which never changes once uploaded) and
 * removes the ones no longer wanted. A failed download is retried next time.
 */
export async function syncKeptFiles(
  storage: OfflineStorage,
  download: (file: WantedFile) => Promise<unknown>,
): Promise<{ downloaded: number; removed: number }> {
  const wanted = await wantedFiles(storage);
  const have = new Set(await storage.keys("files"));
  let downloaded = 0;
  for (const file of wanted) {
    if (have.has(file.attachment.id)) continue;
    try {
      await storage.put("files", file.attachment.id, await download(file));
      downloaded++;
    } catch {
      // Next sync.
    }
  }
  const keep = new Set(wanted.map((file) => file.attachment.id));
  let removed = 0;
  for (const id of have) {
    if (keep.has(id)) continue;
    await storage.delete("files", id);
    removed++;
  }
  return { downloaded, removed };
}

/** A kept file (a Blob on the web), if the device has it. */
export async function keptFile<T = unknown>(storage: OfflineStorage, attachmentId: string): Promise<T | undefined> {
  return storage.get<T>("files", attachmentId);
}
export * from "./network.js";
