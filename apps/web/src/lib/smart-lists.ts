import type { SmartList, SmartListFilters } from "@oneverse/core";
import { useEffect, useSyncExternalStore } from "react";
import { apiClient } from "#/lib/api-client";

/**
 * The user's smart lists (issue #58), for the sidebar and the library:
 * fetched once, and again after each change made here.
 */
let lists: SmartList[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: SmartList[]) {
  lists = next;
  for (const listener of listeners) listener();
}

export function refreshSmartLists(): Promise<void> {
  loaded = apiClient
    .listSmartLists()
    .then(set)
    .catch(() => {
      // Offline, or signed out: none shown.
      loaded = null;
    });
  return loaded;
}

export function useSmartLists(): SmartList[] {
  useEffect(() => {
    if (!loaded) void refreshSmartLists();
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => lists,
    () => lists,
  );
}

/** Forgotten on sign-out, so the next user starts afresh. */
export function forgetSmartLists() {
  loaded = null;
  set([]);
}

/** The library's search for a list's filters (and the list itself, to name the page). */
export function smartListSearch(list: SmartList): SmartListFilters & { list: string } {
  return { ...list.filters, list: list.id };
}
