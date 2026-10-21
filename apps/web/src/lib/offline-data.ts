import { deviceOffline, keepSet, syncKeptFiles, syncKeptSets, type OfflineStorage } from "@oneverse/core";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect } from "react";
import { apiClient } from "#/lib/api-client";
import { deleteOffline, getOffline, keysOffline, putOffline } from "#/lib/offline-db";

/**
 * Between the route loaders and the API (docs/offline.md, "Loading pages";
 * issue #50): online, pages load from the API as always, and sets are kept
 * on the device as they're opened; offline, pages read what's kept -
 * through @oneverse/core's onlineOrKept().
 */

/** The device's store, as @oneverse/core's offline functions see it. Writes need the signed-in user. */
export function deviceStorage(userId?: string): OfflineStorage {
  return {
    get: (store, key) => getOffline(store, key),
    put: (store, key, value) => (userId ? putOffline(userId, store, key, value) : Promise.resolve()),
    delete: (store, key) => deleteOffline(store, key),
    keys: (store) => keysOffline(store),
  };
}

// When each set was last downloaded in this tab: at most once a minute.
const REFRESH_MS = 60_000;
const refreshed = new Map<string, number>();

/** Downloads a set and its songs to keep them on the device (online only; failures are quiet). */
export async function refreshKeptSet(userId: string, setlistId: string): Promise<void> {
  if (deviceOffline()) return;
  const last = refreshed.get(setlistId);
  if (last && Date.now() - last < REFRESH_MS) return;
  refreshed.set(setlistId, Date.now());
  try {
    await keepSet(deviceStorage(userId), await apiClient.getSetlistOffline(setlistId));
  } catch {
    // Not kept this time (offline, gone, no access): the next visit tries again.
    refreshed.delete(setlistId);
  }
}

/** Keeps the set a page shows on the device, once it's in the browser (a page drawn on the server can't). */
export function useKeepSet(setlistId: string | null | undefined) {
  const { session, offline } = useRouteContext({ from: "/_protected" });
  useEffect(() => {
    if (setlistId && !offline) void refreshKeptSet(session.userId, setlistId);
  }, [setlistId, session.userId, offline]);
}

// While the app is open, it catches up this often (and on launch, and when the connection is back).
const SYNC_EVERY_MS = 5 * 60_000;
let syncing: Promise<void> | null = null;

const DAYS_KEY = "songverse.offline.days";
export const DEFAULT_OFFLINE_DAYS = 14;

/** How many days ahead this device keeps upcoming sets (the storage page's setting). */
export function offlineDays(): number {
  try {
    const days = Number(localStorage.getItem(DAYS_KEY));
    return Number.isInteger(days) && days >= 1 && days <= 60 ? days : DEFAULT_OFFLINE_DAYS;
  } catch {
    return DEFAULT_OFFLINE_DAYS;
  }
}

export function setOfflineDays(days: number): void {
  try {
    localStorage.setItem(DAYS_KEY, String(days));
  } catch {
    // Storage blocked: the default.
  }
}

/**
 * Brings the device's copy up to date (issues #51, #52): upcoming and
 * pinned sets, own and pinned songs, kept songbooks - downloaded, caught
 * up, and removed when gone, unpinned or past - then the songs' files.
 * Online only; a failure waits for the next time.
 */
export function syncOffline(userId: string): Promise<void> {
  if (deviceOffline()) return Promise.resolve();
  const storage = deviceStorage(userId);
  syncing ??= syncKeptSets(
    storage,
    (known, knownSongs, knownSongbooks) => apiClient.syncOffline({ days: offlineDays(), known, knownSongs, knownSongbooks }),
    new Date(),
    {
      // Asked first whether anything changed, so an up-to-date device sends and gets back almost nothing (issue #121).
      check: (fingerprint, known) => apiClient.checkOffline({ days: offlineDays(), fingerprint, known }),
      // A big library's songs, a hundred at a time rather than all in one answer (issue #122).
      fetchSongs: (ids) => apiClient.getOfflineSongs(ids),
    },
  )
    .then(() => syncKeptFiles(storage, ({ songVersionId, attachment }) => apiClient.downloadAttachment(songVersionId, attachment.id)))
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      syncing = null;
      for (const listener of syncListeners) listener();
    });
  return syncing;
}

// Pages showing what's kept (the storage page, pin buttons) refresh when a sync ends.
const syncListeners = new Set<() => void>();
export function onOfflineSync(listener: () => void): () => void {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
}

/** Keeps the offline copy current while the signed-in app is open. */
export function useOfflineSync() {
  const { session, offline } = useRouteContext({ from: "/_protected" });
  useEffect(() => {
    if (offline) return;
    void syncOffline(session.userId);
    const timer = setInterval(() => void syncOffline(session.userId), SYNC_EVERY_MS);
    const online = () => void syncOffline(session.userId);
    window.addEventListener("online", online);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", online);
    };
  }, [session.userId, offline]);
}
