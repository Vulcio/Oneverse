import type { StemPart } from "@oneverse/core";
import { useSyncExternalStore } from "react";

/**
 * A colour per part for the Tracks view's waveforms (issue #379): voices in
 * greens and teals, the rhythm section warm, the rest cool. Mid lightness, so
 * they read on a light page and a dark one alike.
 */
const HUES: Record<StemPart, number> = {
  VOCALS: 175,
  HARMONY_SOPRANO: 155,
  HARMONY_ALTO: 140,
  HARMONY_TENOR: 125,
  HARMONY_BASS: 110,
  BACKING_VOCALS: 195,
  DRUMS: 40,
  BASS: 300,
  GUITAR: 75,
  KEYS: 255,
  OTHER: 220,
  CLICK: 0,
};
/** For parts that don't say what they are: in turn. */
const SPARE = [20, 330, 90, 235, 160, 280];

export function partColour(part: StemPart | null, index: number): string {
  if (part === "CLICK") return "oklch(0.62 0 0)";
  const hue = part ? HUES[part] : SPARE[index % SPARE.length]!;
  return `oklch(0.66 0.15 ${hue})`;
}

const KEY = "songverse.tracksColours";
const listeners = new Set<() => void>();
let shown: boolean | null = null;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

/** Colours on or off, chosen on the device. */
export function setTrackColours(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Not kept (a private window): still changed for this page.
  }
  shown = on;
  for (const listener of listeners) listener();
}

export function useTrackColours(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (shown ??= read()),
    () => true,
  );
}
