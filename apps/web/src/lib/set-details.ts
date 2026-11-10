import { formatDuration, SET_LIST_DETAILS, type SetListDetailValue, type SetlistItem } from "@oneverse/core";
import { createDeviceStore } from "#/lib/device-store";

/**
 * What a set's songs show on their right in Live's sidebar (issue #199):
 * picked on each device, as Live's text size is - a stage tablet and a
 * phone may want different ones - and kept offline.
 */
const KEY = "songverse.sets.details";
export const DEFAULT_SET_DETAILS: SetListDetailValue[] = ["KEY", "TRANSITION"];

const details = createDeviceStore<SetListDetailValue[]>(KEY, {
  fallback: DEFAULT_SET_DETAILS,
  parse(raw) {
    const stored = JSON.parse(raw ?? "null") as unknown;
    return Array.isArray(stored) ? SET_LIST_DETAILS.filter((detail) => stored.includes(detail)) : DEFAULT_SET_DETAILS;
  },
  format: (value) => JSON.stringify(value),
});

/** Shown or not, kept in the list's order. */
export function toggleSetDetail(detail: SetListDetailValue) {
  const now = details.get();
  details.set(SET_LIST_DETAILS.filter((one) => (one === detail ? !now.includes(one) : now.includes(one))));
}

export const useSetDetails = details.use;

/** A set song's value for a detail (not the transition, which is a symbol): "A", "72", "6/8", "4:05"; null when it has none. */
export function setDetailValue(detail: Exclude<SetListDetailValue, "TRANSITION">, item: SetlistItem, playedKey: string | null): string | null {
  const song = item.song;
  if (!song) return null;
  if (detail === "KEY") return playedKey;
  // The set's own tempo (issue #382), else the song's.
  if (detail === "TEMPO") {
    const tempo = item.tempoOverride ?? song.tempo;
    return tempo ? String(Math.round(tempo)) : null;
  }
  if (detail === "TIME_SIGNATURE") return song.timeSignature ? `${song.timeSignature.numerator}/${song.timeSignature.denominator}` : null;
  return song.durationSeconds ? formatDuration(song.durationSeconds) : null;
}
