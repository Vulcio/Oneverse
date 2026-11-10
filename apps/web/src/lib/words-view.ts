import { useEffect, useSyncExternalStore } from "react";

/**
 * The Words view on the page (issue #416), for the Display panel: its Words
 * section shows while one is on screen, as the Grid section does for a grid.
 */
let shown = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Counts this view as on screen while it's mounted. */
export function useRegisterWordsView(): void {
  useEffect(() => {
    shown += 1;
    for (const listener of listeners) listener();
    return () => {
      shown -= 1;
      for (const listener of listeners) listener();
    };
  }, []);
}

/** Whether a Words view is on screen. */
export function useWordsOnScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => shown > 0,
    () => false,
  );
}
