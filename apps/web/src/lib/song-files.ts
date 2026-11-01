import { keptFile, keptSongCopy, type Attachment } from "@oneverse/core";
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
