import { useSyncExternalStore } from "react";
import { apiClient } from "#/lib/api-client";

/**
 * The user's favorites as changed on this page (issue #434): a song starred
 * on a card is starred on its other cards and in its preview at once, before
 * the server's answer. A song not changed here is as the server said
 * (`initial`).
 */
const changed = new Map<string, boolean>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function put(songVersionId: string, on: boolean | undefined) {
  if (on === undefined) changed.delete(songVersionId);
  else changed.set(songVersionId, on);
  for (const listener of listeners) listener();
}

/** Stars the song, or takes its star away: shown at once, put back if the server refuses. */
export async function setFavorite(songVersionId: string, on: boolean): Promise<void> {
  const before = changed.get(songVersionId);
  put(songVersionId, on);
  try {
    await apiClient.setFavorite(songVersionId, on);
  } catch (error) {
    put(songVersionId, before);
    throw error;
  }
}

/** Whether the song is in the user's favorites: as changed on this page, else as the server said. */
export function useIsFavorite(songVersionId: string, initial: boolean): boolean {
  return useSyncExternalStore(
    subscribe,
    () => changed.get(songVersionId) ?? initial,
    () => initial,
  );
}
