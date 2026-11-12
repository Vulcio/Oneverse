import { defaultBeats, drumsBeatAt, type BeatLevel, type ChartBar, type DrumsBeat } from "@oneverse/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useBarsClock } from "#/lib/bars-clock";
import { useMetronome } from "#/lib/metronome-engine";

/**
 * The beat a song is on (issues #107, #443), for the metronome's displays and
 * the Drums view: from what its bars follow (the stems, the metronome started
 * for it, or the Sync leader's), never a clock of its own. A new value only
 * when the beat changes; null while nothing plays.
 */
export function useSongBeat(songId: string, bars: readonly ChartBar[]): DrumsBeat | null {
  const { position } = useBarsClock(songId, bars);
  const [beat, setBeat] = useState<DrumsBeat | null>(null);
  useEffect(() => {
    if (!position) {
      setBeat(null);
      return;
    }
    let last = "";
    let frame = requestAnimationFrame(function tick() {
      const now = drumsBeatAt(bars, position());
      const key = now ? `${now.bar}:${now.beat}:${now.countIn}` : "";
      if (key !== last) {
        last = key;
        setBeat(now);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [position, bars]);
  return beat;
}

/** Each beat's level in a bar of `beats` (accent, medium, small, off): the metronome's pattern when it has that many, else the usual one. */
export function useBeatLevels(beats: number, denominator = 4): BeatLevel[] {
  const { settings } = useMetronome();
  if (settings.beats.length === beats) return settings.beats;
  return defaultBeats({ numerator: beats, denominator });
}

/**
 * A view on the page that has the beat of its own (the Drums view, issue
 * #107): the page's own beat display steps aside, and the Display panel shows
 * its section.
 */
let drumsShown = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Counts the Drums view as on screen while it's mounted. */
export function useRegisterDrumsView(): void {
  useEffect(() => {
    drumsShown += 1;
    for (const listener of listeners) listener();
    return () => {
      drumsShown -= 1;
      for (const listener of listeners) listener();
    };
  }, []);
}

/** Whether a Drums view is on screen. */
export function useDrumsOnScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => drumsShown > 0,
    () => false,
  );
}
