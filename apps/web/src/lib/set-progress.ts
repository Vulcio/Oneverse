import { useSyncExternalStore } from "react";

/**
 * Where a set got to in Live (issue #153), on the device: the last song
 * opened there, so coming back picks up where it left off, and the songs
 * played - scrolled to their end. Forgotten after a while - the next service starts from the top.
 */
export interface SetProgress {
  /** The last song (set item) opened in Live. */
  current: string;
  /** The songs played through: their chart scrolled to the end (or, one that fits the screen, moved on from). */
  played: string[];
  /** When it last changed (ms). */
  at: number;
}

const KEY = "songverse.sets.progress.";
/** A set left alone this long starts from the top again. */
export const PROGRESS_FORGOTTEN_AFTER = 12 * 60 * 60 * 1000;

const cache = new Map<string, SetProgress | null>();
const listeners = new Set<() => void>();

function read(setId: string): SetProgress | null {
  if (!cache.has(setId)) {
    let saved: SetProgress | null = null;
    try {
      const raw = localStorage.getItem(KEY + setId);
      const parsed = raw ? (JSON.parse(raw) as Partial<SetProgress>) : null;
      if (parsed && typeof parsed.current === "string" && Array.isArray(parsed.played) && typeof parsed.at === "number") {
        saved = { current: parsed.current, played: parsed.played.filter((id): id is string => typeof id === "string"), at: parsed.at };
      }
    } catch {
      // Storage blocked, or not ours.
    }
    cache.set(setId, saved);
  }
  const progress = cache.get(setId) ?? null;
  return progress && Date.now() - progress.at < PROGRESS_FORGOTTEN_AFTER ? progress : null;
}

function write(setId: string, progress: SetProgress | null) {
  cache.set(setId, progress);
  try {
    if (progress) localStorage.setItem(KEY + setId, JSON.stringify(progress));
    else localStorage.removeItem(KEY + setId);
  } catch {
    // Remembered until the page reloads.
  }
  for (const listener of listeners) listener();
}

/** The set's progress, if it's recent. */
export function setProgressOf(setId: string): SetProgress | null {
  return read(setId);
}

/** A song of the set opened in Live: where the set is now. */
export function markCurrent(setId: string, itemId: string) {
  const before = read(setId);
  write(setId, { current: itemId, played: before?.played ?? [], at: Date.now() });
}

/** A song of the set played through in Live. */
export function markPlayed(setId: string, itemId: string) {
  const before = read(setId);
  if (before?.played.includes(itemId)) return;
  write(setId, { current: before?.current ?? itemId, played: [...(before?.played ?? []), itemId], at: Date.now() });
}

/** From the top: nothing played. */
export function clearSetProgress(setId: string) {
  write(setId, null);
}

/** Where to open the set in Live: the last song played (`progress`, from useSetProgress) if it's still in it, else its first. */
export function resumeItemOf(progress: SetProgress | null, itemIds: string[]): string | null {
  const current = progress?.current;
  return current && itemIds.includes(current) ? current : (itemIds[0] ?? null);
}

export function useSetProgress(setId: string | null | undefined): SetProgress | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (setId ? read(setId) : null),
    () => null,
  );
}

