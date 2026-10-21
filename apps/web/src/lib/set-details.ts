import { formatDuration, SET_LIST_DETAILS, type SetListDetailValue, type SetlistItem } from "@oneverse/core";
import { useSyncExternalStore } from "react";

/**
 * What a set's songs show on their right in Live's sidebar (issue #199):
 * picked on each device, as Live's text size is - a stage tablet and a
 * phone may want different ones - and kept offline.
 */
const KEY = "songverse.sets.details";
export const DEFAULT_SET_DETAILS: SetListDetailValue[] = ["KEY", "TRANSITION"];

const listeners = new Set<() => void>();
let cached: SetListDetailValue[] | null = null;

function read(): SetListDetailValue[] {
  if (cached) return cached;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    if (Array.isArray(raw)) cached = SET_LIST_DETAILS.filter((detail) => raw.includes(detail));
  } catch {
    // Storage blocked, or not ours.
  }
  return (cached ??= DEFAULT_SET_DETAILS);
}

/** Shown or not, kept in the list's order. */
export function toggleSetDetail(detail: SetListDetailValue) {
  const now = read();
  cached = SET_LIST_DETAILS.filter((one) => (one === detail ? !now.includes(one) : now.includes(one)));
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Remembered until the page reloads.
  }
  for (const listener of listeners) listener();
}

export function useSetDetails(): SetListDetailValue[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => DEFAULT_SET_DETAILS,
  );
}

/** A set song's value for a detail (not the transition, which is a symbol): "A", "72", "6/8", "4:05"; null when it has none. */
export function setDetailValue(detail: Exclude<SetListDetailValue, "TRANSITION">, item: SetlistItem, playedKey: string | null): string | null {
  const song = item.song;
  if (!song) return null;
  if (detail === "KEY") return playedKey;
  if (detail === "TEMPO") return song.tempo ? String(Math.round(song.tempo)) : null;
  if (detail === "TIME_SIGNATURE") return song.timeSignature ? `${song.timeSignature.numerator}/${song.timeSignature.denominator}` : null;
  return song.durationSeconds ? formatDuration(song.durationSeconds) : null;
}
