import { useSyncExternalStore } from "react";

/**
 * Where the chord grid shows the words (issue #376): in each bar (as it
 * always did), as a line between its rows, two lines pinned at the bottom
 * (the one being sung and the next, issue #408), or not at all. Chosen on the device, for every song.
 */
export type GridLyrics = "bars" | "between" | "pinned" | "off";

export const GRID_LYRICS: readonly GridLyrics[] = ["bars", "between", "pinned", "off"];

const KEY = "songverse.gridLyrics";
const listeners = new Set<() => void>();
let shown: GridLyrics | null = null;

function read(): GridLyrics {
  try {
    const stored = localStorage.getItem(KEY);
    return GRID_LYRICS.includes(stored as GridLyrics) ? (stored as GridLyrics) : "bars";
  } catch {
    return "bars";
  }
}

export function setGridLyrics(choice: GridLyrics) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Not kept (a private window): still changed for this page.
  }
  shown = choice;
  for (const listener of listeners) listener();
}

/** The device's choice, the same in every grid on the page. */
export function useGridLyrics(): GridLyrics {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (shown ??= read()),
    () => "bars",
  );
}
