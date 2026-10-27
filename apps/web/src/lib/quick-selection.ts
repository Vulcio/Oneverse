import type { QuickSelection } from "@oneverse/core";
import { useEffect, useSyncExternalStore } from "react";
import { apiClient } from "#/lib/api-client";

/**
 * The Quick selection (issue #334): songs gathered from anywhere, then
 * added to a set at once. Kept on the account by the API; here, the copy
 * every part of the page shares - loaded once, replaced by what each change
 * answers.
 */
let current: QuickSelection | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: QuickSelection) {
  current = next;
  for (const listener of listeners) listener();
}

/** Loaded again from the API (another device may have changed it). */
export function reloadQuickSelection(): Promise<void> {
  loading = apiClient
    .getQuickSelection()
    .then(set)
    .catch(() => {
      // Offline or signed out: nothing to show.
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The Quick selection, null until it's loaded. */
export function useQuickSelection(): QuickSelection | null {
  const selection = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  useEffect(() => {
    if (!current && !loading) void reloadQuickSelection();
  }, []);
  return selection;
}

export const inQuickSelection = (selection: QuickSelection | null, songVersionId: string) => !!selection?.songs.some((song) => song.id === songVersionId);

export async function addToQuickSelection(songVersionId: string) {
  set(await apiClient.addToQuickSelection(songVersionId));
}

export async function removeFromQuickSelection(songVersionId: string) {
  set(await apiClient.removeFromQuickSelection(songVersionId));
}

export async function clearQuickSelection() {
  set(await apiClient.clearQuickSelection());
}

/** Its songs into a set: what came of it, and the selection as it's left. */
export async function addQuickSelectionTo(setlistId: string) {
  const result = await apiClient.addQuickSelectionTo(setlistId);
  set(result.selection);
  return result;
}

/** Forgotten when someone signs out. */
export function forgetQuickSelection() {
  current = null;
}
