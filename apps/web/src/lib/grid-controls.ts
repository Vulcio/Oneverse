import { useSyncExternalStore } from "react";

/**
 * The chord grid on the page (issue #408), for what's outside it: the
 * Display panel's Grid section starts Loop bars and Edit bars from here,
 * and the bars row stays out of the way while a grid shows the same bars.
 * The grid on screen registers itself; the last one to do so is the one
 * reached (a page shows one at a time).
 */
export interface GridControls {
  /** Bars can be looped: the page plays the stems. */
  canLoop: boolean;
  /** The bars looped, 0-based, or null. */
  looped: { first: number; last: number } | null;
  /** Bars being picked to loop. */
  choosingLoop: boolean;
  /** Whoever reads it can edit the song's bars. */
  canEdit: boolean;
  editing: boolean;
  /** Starts picking bars to loop, or stops the loop (or the picking). */
  loop: () => void;
  /** Starts editing the bars. */
  edit: () => void;
}

const listeners = new Set<() => void>();
const grids: { current: GridControls }[] = [];

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A grid comes on screen: what it can do now, updated with `update`, gone with `remove`. */
export function registerGrid(controls: GridControls) {
  const entry = { current: controls };
  grids.push(entry);
  emit();
  return {
    update(next: GridControls) {
      entry.current = next;
      emit();
    },
    remove() {
      const at = grids.indexOf(entry);
      if (at >= 0) grids.splice(at, 1);
      emit();
    },
  };
}

/** The grid on screen, or null. */
export function useGridControls(): GridControls | null {
  return useSyncExternalStore(
    subscribe,
    () => grids.at(-1)?.current ?? null,
    () => null,
  );
}
