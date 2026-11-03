import { alignTake, encodeWav, type Attachment, type RecordingDetails, type StemPart } from "@oneverse/core";

/**
 * Takes kept on this device until they're safely on the server (issue #365):
 * a take is written to IndexedDB as it's recorded, a few seconds at a time,
 * so a reload, a crash or a locked phone loses at most the last moment; once
 * kept, its file waits here until the upload has answered, and is sent
 * again when the connection comes back. Nothing here is read by another
 * user: each take says whose it is.
 *
 * Its own database, apart from the offline copy (offline-db.ts), which is
 * deleted on signing out and rebuilt from the server: a take exists nowhere
 * else until it's uploaded.
 */

const DB_NAME = "songverse-takes";
const VERSION = 1;
const TAKES = "takes";
const CHUNKS = "chunks";
/** Captured audio is written at least this often while recording (s). */
const FLUSH_EVERY = 2;

/** What the take was recorded for: enough to finish it after a reload. */
export interface TakeTarget {
  userId: string;
  songVersionId: string;
  songTitle: string;
  /** The file's name when uploaded, without its extension. */
  name: string;
  part: StemPart;
  details: RecordingDetails;
  /** The take this one plays instead of, once uploaded. */
  instead: string | null;
}

/**
 * A take on this device. "recording": being captured, or cut short (a
 * reload, a crash) - its audio is in chunks. "waiting": kept, its file
 * waiting to be uploaded (or to be sent again).
 */
export interface StoredTake extends TakeTarget {
  id: string;
  state: "recording" | "waiting";
  createdAt: number;
  /** Recording: how to line its chunks up once it's finished (Recorder's Take, the round trip). */
  sampleRate: number;
  zeroAt: number;
  delay: number;
  /** Where it starts in the multitrack (s): before, it's silent. */
  from: number;
  /** Waiting: the file to upload. */
  wav: Blob | null;
  /** The last upload's error, if it failed. */
  error: string | null;
  attempts: number;
}

interface StoredChunk {
  takeId: string;
  frame: number;
  data: Float32Array;
}

function available(): boolean {
  return typeof indexedDB !== "undefined";
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let opening: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TAKES)) db.createObjectStore(TAKES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { autoIncrement: true }).createIndex("take", "takeId");
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading: let it, and open again next time.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

async function run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await open();
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  const result = await work(tx);
  await done;
  return result;
}

const listeners = new Set<() => void>();
/** Hears every change to the takes kept (to show them). */
export function onStoredTakes(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function changed() {
  for (const listener of listeners) listener();
}

/** The takes kept on this device for `userId` (and a song, if given), oldest first. */
export async function storedTakes(userId: string, songVersionId?: string): Promise<StoredTake[]> {
  if (!available()) return [];
  try {
    const all = await run([TAKES], "readonly", (tx) => request(tx.objectStore(TAKES).getAll() as IDBRequest<StoredTake[]>));
    return all.filter((take) => take.userId === userId && (!songVersionId || take.songVersionId === songVersionId)).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

async function putTake(take: StoredTake) {
  await run([TAKES], "readwrite", (tx) => request(tx.objectStore(TAKES).put(take)));
  changed();
}

/** Forgets a take and its audio. */
export async function deleteStoredTake(id: string) {
  if (!available()) return;
  await run([TAKES, CHUNKS], "readwrite", async (tx) => {
    tx.objectStore(TAKES).delete(id);
    const keys = await request(tx.objectStore(CHUNKS).index("take").getAllKeys(id));
    for (const key of keys) tx.objectStore(CHUNKS).delete(key);
  }).catch(() => {});
  changed();
}

/**
 * A take being recorded, written to the device as it comes in. `add` hears
 * each block captured; they're written every couple of seconds. `finish`
 * writes the rest; `drop` forgets it (a retake, a take not kept).
 */
export class TakeLog {
  readonly id: string;
  private pending: StoredChunk[] = [];
  private pendingSeconds = 0;
  private writing: Promise<void> = Promise.resolve();
  private dropped = false;

  private constructor(
    id: string,
    private readonly sampleRate: number,
  ) {
    this.id = id;
  }

  /** Starts keeping a take (written as it comes); null where the device can't (no IndexedDB): it's recorded all the same. */
  static begin(target: TakeTarget, timing: { sampleRate: number; zeroAt: number; delay: number; from: number }): TakeLog | null {
    if (!available()) return null;
    const id = `take-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const log = new TakeLog(id, timing.sampleRate);
    log.writing = putTake({ ...target, ...timing, id, state: "recording", createdAt: Date.now(), wav: null, error: null, attempts: 0 }).catch(() => {
      // Storage blocked or full: recorded in memory only.
      log.dropped = true;
    });
    return log;
  }

  add(frame: number, data: Float32Array) {
    if (this.dropped) return;
    this.pending.push({ takeId: this.id, frame, data: data.slice() });
    this.pendingSeconds += data.length / this.sampleRate;
    if (this.pendingSeconds >= FLUSH_EVERY) void this.flush();
  }

  /** Writes what's waiting (in order: one write after the other). */
  flush(): Promise<void> {
    const chunks = this.pending;
    this.pending = [];
    this.pendingSeconds = 0;
    if (chunks.length === 0 || this.dropped) return this.writing;
    this.writing = this.writing
      .then(() =>
        run([CHUNKS], "readwrite", (tx) => {
          for (const chunk of chunks) tx.objectStore(CHUNKS).add(chunk);
        }),
      )
      .catch(() => {
        // Storage full or gone: the take goes on in memory.
      });
    return this.writing;
  }

  /** Everything captured is written. */
  async finish() {
    await this.flush();
  }

  /** Forgets it. */
  async drop() {
    this.dropped = true;
    this.pending = [];
    await this.writing;
    await deleteStoredTake(this.id);
  }

  /**
   * Kept: its file, as it will be uploaded, takes the audio's place (what
   * was kept may differ from the raw take: aligned, nudged, spliced).
   */
  async keep(wav: Blob, change: Partial<TakeTarget>): Promise<StoredTake | null> {
    this.dropped = true;
    this.pending = [];
    await this.writing;
    return keepStoredTake(this.id, wav, change);
  }
}

/** A take's file waiting for upload: the one from a TakeLog, or a new one (no log: private browsing). */
async function keepStoredTake(id: string, wav: Blob, change: Partial<TakeTarget>): Promise<StoredTake | null> {
  try {
    const existing = await run([TAKES], "readonly", (tx) => request(tx.objectStore(TAKES).get(id) as IDBRequest<StoredTake | undefined>));
    if (!existing) return null;
    const take: StoredTake = { ...existing, ...change, state: "waiting", wav, error: null };
    await run([TAKES, CHUNKS], "readwrite", async (tx) => {
      tx.objectStore(TAKES).put(take);
      const keys = await request(tx.objectStore(CHUNKS).index("take").getAllKeys(id));
      for (const key of keys) tx.objectStore(CHUNKS).delete(key);
    });
    changed();
    return take;
  } catch {
    return null;
  }
}

/**
 * A take cut short (a reload, a crash, the phone locked) made into a file:
 * its blocks put back in order and lined up as they would have been, kept
 * from where it started. Waiting for upload, it's then like any other.
 */
export async function recoverStoredTake(id: string): Promise<StoredTake | null> {
  const take = await run([TAKES], "readonly", (tx) => request(tx.objectStore(TAKES).get(id) as IDBRequest<StoredTake | undefined>)).catch(() => undefined);
  if (!take || take.state !== "recording") return take ?? null;
  const chunks = await run([CHUNKS], "readonly", (tx) => request(tx.objectStore(CHUNKS).index("take").getAll(id) as IDBRequest<StoredChunk[]>)).catch(() => [] as StoredChunk[]);
  if (chunks.length === 0) {
    await deleteStoredTake(id);
    return null;
  }
  chunks.sort((a, b) => a.frame - b.frame);
  const first = chunks[0]!.frame;
  const last = chunks[chunks.length - 1]!;
  const captured = new Float32Array(last.frame - first + last.data.length);
  for (const chunk of chunks) captured.set(chunk.data, chunk.frame - first);
  const aligned = alignTake(captured, { sampleRate: take.sampleRate, capturedAt: first / take.sampleRate, zeroAt: take.zeroAt, delay: take.delay });
  if (take.from > 0) aligned.fill(0, 0, Math.min(aligned.length, Math.round(take.from * take.sampleRate)));
  const wav = new Blob([encodeWav(aligned, take.sampleRate) as Uint8Array<ArrayBuffer>], { type: "audio/wav" });
  // Recovered: kept beside the part, never instead of it - its owner listens before choosing it.
  return keepStoredTake(id, wav, { instead: null, details: { ...take.details, otherTake: true } });
}

/** How long a take kept is (s), from its file. */
export function storedTakeSeconds(take: StoredTake): number | null {
  if (!take.wav) return null;
  return Math.max(0, (take.wav.size - 44) / 2 / take.sampleRate);
}

type Uploader = {
  uploadAttachment: (songVersionId: string, type: "AUDIO", file: File, stemPart: StemPart, audience: { visibility: "PRIVATE" }, details: RecordingDetails) => Promise<Attachment>;
  useTake: (songVersionId: string, attachmentId: string, instead: string | null) => Promise<unknown>;
};

const uploading = new Map<string, Promise<Attachment>>();

/**
 * Uploads a take kept, then forgets it; on failure it stays, with the
 * error, for the next try. One upload at a time per take.
 */
export function uploadStoredTake(take: StoredTake, api: Uploader): Promise<Attachment> {
  const existing = uploading.get(take.id);
  if (existing) return existing;
  const attempt = (async () => {
    if (!take.wav) throw new Error("Nothing to upload");
    const file = new File([take.wav], `${take.name}.wav`, { type: "audio/wav" });
    try {
      const saved = await api.uploadAttachment(take.songVersionId, "AUDIO", file, take.part, { visibility: "PRIVATE" }, take.details);
      if (take.instead) await api.useTake(take.songVersionId, saved.id, take.instead).catch(() => {});
      await deleteStoredTake(take.id);
      return saved;
    } catch (error) {
      await putTake({ ...take, error: error instanceof Error ? error.message : String(error), attempts: take.attempts + 1 }).catch(() => {});
      throw error;
    } finally {
      uploading.delete(take.id);
    }
  })();
  uploading.set(take.id, attempt);
  return attempt;
}

/** Whether a take is being uploaded now. */
export function isUploadingTake(id: string): boolean {
  return uploading.has(id);
}

/** Every take of `userId` waiting, sent again (online, at launch or when the connection is back). Recordings cut short are left for their owner to keep or drop. */
export async function uploadWaitingTakes(userId: string, api: Uploader): Promise<number> {
  let sent = 0;
  for (const take of await storedTakes(userId)) {
    if (take.state !== "waiting") continue;
    try {
      await uploadStoredTake(take, api);
      sent++;
    } catch {
      // Stays for the next time.
    }
  }
  return sent;
}

/** The WAV of a take kept, ready to play (a recording cut short: once recovered). */
export async function storedTakeAudio(id: string): Promise<Blob | null> {
  const take = await run([TAKES], "readonly", (tx) => request(tx.objectStore(TAKES).get(id) as IDBRequest<StoredTake | undefined>)).catch(() => undefined);
  return take?.wav ?? null;
}

/** For the suites: how much of a take is on the device (blocks written). */
export async function storedTakeChunks(id: string): Promise<number> {
  return run([CHUNKS], "readonly", (tx) => request(tx.objectStore(CHUNKS).index("take").count(id))).catch(() => 0);
}

/** A file waiting without a TakeLog (none could be kept while recording): stored now, before it's uploaded. */
export async function storeTakeFile(target: TakeTarget, wav: Blob, sampleRate: number): Promise<StoredTake | null> {
  if (!available()) return null;
  const take: StoredTake = {
    ...target,
    id: `take-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    state: "waiting",
    createdAt: Date.now(),
    sampleRate,
    zeroAt: 0,
    delay: 0,
    from: 0,
    wav,
    error: null,
    attempts: 0,
  };
  try {
    await putTake(take);
    return take;
  } catch {
    return null;
  }
}

/** Whether an upload failed for want of a connection or a server (worth trying again), rather than being refused. */
export function uploadCanWait(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status !== "number" || status >= 500 || status === 408 || status === 429;
}

/**
 * Keeps a take (issue #365): its file on the device first, then uploaded.
 * Resolves with what was saved, or `waiting` when the upload couldn't be
 * made now (no connection, the server away): it's sent again on its own.
 * A refusal (too big, not allowed) throws, the take kept to try or drop.
 */
export async function keepTake(
  options: { log: TakeLog | null; target: TakeTarget; wav: Blob; sampleRate: number },
  api: Uploader,
): Promise<{ saved: Attachment | null; waiting: boolean }> {
  const change = { name: options.target.name, part: options.target.part, details: options.target.details, instead: options.target.instead };
  const stored = (options.log ? await options.log.keep(options.wav, change) : null) ?? (await storeTakeFile(options.target, options.wav, options.sampleRate));
  if (!stored) {
    // Nowhere to keep it on this device: uploaded straight away, as before.
    const file = new File([options.wav], `${options.target.name}.wav`, { type: "audio/wav" });
    const saved = await api.uploadAttachment(options.target.songVersionId, "AUDIO", file, options.target.part, { visibility: "PRIVATE" }, options.target.details);
    if (options.target.instead) await api.useTake(options.target.songVersionId, saved.id, options.target.instead);
    return { saved, waiting: false };
  }
  try {
    return { saved: await uploadStoredTake(stored, api), waiting: false };
  } catch (error) {
    if (uploadCanWait(error)) return { saved: null, waiting: true };
    throw error;
  }
}
