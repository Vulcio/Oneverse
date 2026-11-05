import type { StemPart } from "@oneverse/core";
import { useSyncExternalStore } from "react";
import type { WaveStyle } from "#/lib/wave-shape";

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

/** A choice kept on the device, for every Tracks view on the page. */
function deviceChoice<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const listeners = new Set<() => void>();
  let shown: T | null = null;
  const read = (): T => {
    try {
      const value = localStorage.getItem(key) as T | null;
      return value && allowed.includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    set(value: T) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Not kept (a private window): still changed for this page.
      }
      shown = value;
      for (const listener of listeners) listener();
    },
    use(): T {
      return useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => (shown ??= read()),
        () => fallback,
      );
    },
  };
}

const colours = deviceChoice("songverse.tracksColours", "on", ["on", "off"] as const);

/** Colours on or off, chosen on the device. */
export function setTrackColours(on: boolean) {
  colours.set(on ? "on" : "off");
}

export function useTrackColours(): boolean {
  return colours.use() === "on";
}

const waves = deviceChoice<WaveStyle>("songverse.tracksWaves", "filled", ["filled", "lines"]);

/** The waveforms as a filled shape or thin lines (issue #386), chosen on the device. */
export const setTrackWaves = waves.set;
export const useTrackWaves = waves.use;
