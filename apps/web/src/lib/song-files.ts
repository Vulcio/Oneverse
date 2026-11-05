import { keptFile, keptSongCopy, readWaveform, type Attachment } from "@oneverse/core";
import { apiClient } from "#/lib/api-client";
import { deviceStorage } from "#/lib/offline-data";

/**
 * A song's files as this device sees them: the API's list, or - when it
 * can't be reached - the copy kept on the device (issue #50), and how to
 * load one of them either way. For the stem player on a set's song page
 * and Sync play's followers alike (issue #112 made them one).
 */
export async function songFiles(songVersionId: string): Promise<{ attachments: Attachment[]; offline: boolean }> {
  try {
    return { attachments: await apiClient.listAttachments(songVersionId), offline: false };
  } catch {
    return { attachments: (await keptSongCopy(deviceStorage(), songVersionId))?.attachments ?? [], offline: true };
  }
}

// --- waveforms (issue #388): worked out once by the server, drawn while the audio arrives

/** A file's waveform: `levels` a level every 1/rate s, 0-1 against its own loudest, which was `loudest` (0-1). */
export interface StoredWave {
  rate: number;
  seconds: number;
  loudest: number;
  levels: Float32Array;
}

/** By file: a file's bytes never change (a processed one is a new file), so neither does its waveform. */
const waves = new Map<string, StoredWave>();
/** The song's request going on, so two asking at once make one. */
const asking = new Map<string, Promise<void>>();

/**
 * The waveforms of these files of the song (issue #388), those the server
 * has: asked for once, kept for the page's life. Nothing when it can't be
 * reached (offline) - the player draws them once they're decoded instead.
 */
export async function songWaveforms(songVersionId: string, fileIds: string[]): Promise<Map<string, StoredWave>> {
  if (fileIds.some((id) => !waves.has(id))) {
    let request = asking.get(songVersionId);
    if (!request) {
      request = apiClient
        .listWaveforms(songVersionId)
        .then((list) => {
          for (const wire of list) {
            const read = readWaveform(wire);
            if (read) waves.set(wire.attachmentId, read);
          }
        })
        .catch(() => undefined)
        .finally(() => asking.delete(songVersionId));
      asking.set(songVersionId, request);
    }
    await request;
  }
  return new Map(fileIds.flatMap((id) => (waves.has(id) ? [[id, waves.get(id)!] as const] : [])));
}

// --- files fetched ahead (issue #366): the next song of a set, kept here for its Play

/** How much fetched audio is kept in memory, at most (bytes): the oldest go first. */
const KEPT_BYTES = 200 * 1024 * 1024;

interface Fetched {
  done: Promise<Blob>;
  received: number;
  total: number | null;
  size: number;
  listeners: Set<(received: number, total: number | null) => void>;
}
const fetched = new Map<string, Fetched>();

function keepWithin() {
  let size = [...fetched.values()].reduce((sum, entry) => sum + entry.size, 0);
  for (const [id, entry] of fetched) {
    if (size <= KEPT_BYTES) break;
    // Still arriving: kept, its Play may be waiting on it.
    if (!entry.size) continue;
    fetched.delete(id);
    size -= entry.size;
  }
}

/** A song's file from the API, once: fetched ahead, or as it's played - whoever asks second waits for the same download, hearing its progress. */
export function downloadOnce(songVersionId: string, file: Attachment, onProgress?: (received: number, total: number | null) => void): Promise<Blob> {
  let entry = fetched.get(file.id);
  if (entry) {
    // Used again: the newest.
    fetched.delete(file.id);
    fetched.set(file.id, entry);
  } else {
    const made: Fetched = { done: Promise.resolve(new Blob()), received: 0, total: file.sizeBytes ?? null, size: 0, listeners: new Set() };
    made.done = apiClient
      .downloadAttachment(songVersionId, file.id, (received, total) => {
        made.received = received;
        made.total = total;
        for (const listener of made.listeners) listener(received, total);
      })
      .then((blob) => {
        made.size = blob.size;
        made.listeners.clear();
        keepWithin();
        return blob;
      })
      .catch((error: unknown) => {
        fetched.delete(file.id);
        throw error;
      });
    fetched.set(file.id, made);
    entry = made;
  }
  if (onProgress) {
    if (entry.received) onProgress(entry.received, entry.total);
    entry.listeners.add(onProgress);
  }
  return entry.done;
}

/** Fetches a song's files ahead, one after another, so its Play is quick (issue #366). Not when the device asks to save data. */
export async function prefetchFiles(songVersionId: string, files: Attachment[]) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  // Their waveforms first (issue #388): a few kilobytes, and its player shows them at once.
  void songWaveforms(songVersionId, files.map((file) => file.id));
  for (const file of files) await downloadOnce(songVersionId, file).catch(() => {});
}

/** One of the song's files: downloaded (once, see downloadOnce), or from the device when the list came from there. */
export function fileLoader(songVersionId: string, offline: boolean) {
  return async (file: Attachment, onProgress?: (received: number, total: number | null) => void): Promise<Blob> => {
    if (!offline) return downloadOnce(songVersionId, file, onProgress);
    const blob = await keptFile<Blob>(deviceStorage(), file.id);
    if (!blob) throw new Error("not kept");
    return blob;
  };
}
