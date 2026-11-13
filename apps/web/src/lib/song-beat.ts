import { defaultBeats, drumsBeatAt, type BeatLevel, type ChartBar, type DrumsBeat, type MetronomeLightUpValue, type RenderedChart, type SongDocumentV2 } from "@oneverse/core";
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

/**
 * The beat behind the whole page (issues #107, #443): the Drums view, or the
 * metronome's Background display, asks for it; the page's shell draws it,
 * behind its header and everything on the page but the sidebar.
 */
export interface PageBeatSource {
  songId: string;
  chart: RenderedChart;
  document: Pick<SongDocumentV2, "sections"> | null | undefined;
  brightness: number;
  lightUp: MetronomeLightUpValue;
  /** How much of its colour a column keeps between beats. */
  idle: number;
  /** Shown while nothing plays too (the Drums view); else only as the music plays. */
  always: boolean;
}

let pageBeat: PageBeatSource | null = null;
const pageBeatListeners = new Set<() => void>();
const subscribePageBeat = (listener: () => void) => {
  pageBeatListeners.add(listener);
  return () => pageBeatListeners.delete(listener);
};
const setPageBeat = (next: PageBeatSource | null) => {
  pageBeat = next;
  for (const listener of pageBeatListeners) listener();
};

/** Asks for the beat behind the page while mounted (a memoised source; null for none). */
export function useRequestPageBeat(source: PageBeatSource | null): void {
  useEffect(() => {
    if (!source) return;
    setPageBeat(source);
    return () => {
      if (pageBeat === source) setPageBeat(null);
    };
  }, [source]);
}

/** What the beat behind the page follows, if anything asked for it. */
export function usePageBeat(): PageBeatSource | null {
  return useSyncExternalStore(
    subscribePageBeat,
    () => pageBeat,
    () => null,
  );
}
