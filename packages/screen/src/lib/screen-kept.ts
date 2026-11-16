import type { ScreenCurrent, ScreenThemeAsset, SyncPresenting } from "@oneverse/core";

/**
 * What a screen keeps on the device (issue #195), so a dropped network - or a
 * reload with none - doesn't leave the audience on a dead screen: for each of
 * its profiles (issue #284), its whole set as last loaded and what was last
 * presented, in IndexedDB; its template's pictures, videos and fonts in the
 * Cache API, where the screen app's service worker (apps/screen/public/sw.js)
 * serves them from. Nothing here is ever required: storage blocked or full,
 * the screen works as it did, online.
 */

const DB = "oneverse-screen";
const STORE = "kept";
/** The service worker reads this cache too: keep the names the same. */
const FILES = "oneverse-screen-files";

export interface KeptScreen {
  current: ScreenCurrent;
  presenting: SyncPresenting | null;
  at: number;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let opened: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no IndexedDB"));
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((error: unknown) => {
    opened = null;
    throw error;
  });
  return opened;
}

async function store<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return request(run(db.transaction(STORE, mode).objectStore(STORE)));
}

/** What the profile with `token` kept, if anything. */
export async function keptScreen(token: string): Promise<KeptScreen | null> {
  try {
    return ((await store("readonly", (s) => s.get(token))) as KeptScreen | undefined) ?? null;
  } catch {
    return null;
  }
}

// Writes for one profile, one after another: a slide kept never overtakes the set it's on.
let writes: Promise<unknown> = Promise.resolve();
function update(token: string, change: (kept: KeptScreen | null) => KeptScreen | null): Promise<void> {
  const next = writes.then(async () => {
    try {
      const kept = change(await keptScreen(token));
      if (kept) await store("readwrite", (s) => s.put(kept, token));
    } catch {
      // Storage blocked or full: the screen still works online.
    }
  });
  writes = next;
  return next;
}

/** The set and look as just loaded, and its files kept for offline. */
export async function keepScreen(token: string, current: ScreenCurrent): Promise<void> {
  await update(token, (kept) => ({ current, presenting: kept?.presenting ?? null, at: Date.now() }));
  await keepFiles();
}

/** What's presented now, so a reload with no network starts on it. */
export function keepPresenting(token: string, presenting: SyncPresenting | null): Promise<void> {
  return update(token, (kept) => (kept ? { ...kept, presenting } : null));
}

/** A profile forgotten (disconnected): its copy goes, and the files nothing kept uses any more. */
export async function forgetKept(token: string): Promise<void> {
  await writes;
  try {
    await store("readwrite", (s) => s.delete(token));
  } catch {
    // Nothing kept.
  }
  await keepFiles();
}

/** A file's key in the cache: its address without the query, whose signature changes with every load. */
export function screenFileKey(url: string): string {
  const address = new URL(url);
  return address.origin + address.pathname;
}

/**
 * Every kept profile's template files in the cache, fetched once (a file's id
 * never changes what it is), and those no profile uses any more removed.
 */
async function keepFiles(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const all = (await store("readonly", (s) => s.getAll())) as KeptScreen[];
    const wanted = new Map<string, ScreenThemeAsset>();
    for (const kept of all) for (const asset of kept.current.assets ?? []) wanted.set(screenFileKey(asset.url), asset);
    const cache = await caches.open(FILES);
    const have = new Set((await cache.keys()).map((req) => req.url));
    for (const key of have) if (!wanted.has(key)) await cache.delete(key);
    for (const [key, asset] of wanted) {
      if (have.has(key)) continue;
      const response = await fetch(asset.url).catch(() => null);
      if (response?.ok) await cache.put(key, response).catch(() => undefined);
    }
  } catch {
    // Storage full or blocked: the files load from the network, as they always did.
  }
}
