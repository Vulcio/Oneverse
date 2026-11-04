import { useEffect, useSyncExternalStore } from "react";

/**
 * Whether a page shows the Tracks view (issue #374), for the stem player
 * to leave its own list of parts out while recording - the lanes have them,
 * with their mutes and solos - so the take, the parts and the recorder all
 * fit on the screen.
 */
let shown = 0;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

/** Marks the Tracks view as on the page while the calling component is mounted. */
export function useMarkTracksShown(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    shown++;
    changed();
    return () => {
      shown--;
      changed();
    };
  }, [on]);
}

export function useTracksShown(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shown > 0,
    () => false,
  );
}
