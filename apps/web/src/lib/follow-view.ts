/**
 * Keeping what the music has reached in view (issues #238, #365): the bar
 * lit in the chord grid, the line sung in the chart. Only when it nears an
 * edge of the page left above the docked player, so the page doesn't move
 * under the reader for every bar - and not for a few seconds after they
 * scroll themselves.
 */
const PAUSE_MS = 4000;
let pausedUntil = 0;
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const pause = () => {
    pausedUntil = performance.now() + PAUSE_MS;
  };
  window.addEventListener("wheel", pause, { passive: true, capture: true });
  window.addEventListener("touchmove", pause, { passive: true, capture: true });
}

/** The docked player's height (`--stem-dock-height`, set by the app shell). */
function dockHeight(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--stem-dock-height")) || 0;
}

export function keepInView(element: HTMLElement): void {
  listen();
  if (performance.now() < pausedUntil) return;
  const dock = dockHeight();
  const visible = window.innerHeight - dock;
  const box = element.getBoundingClientRect();
  if (box.top >= visible * 0.15 && box.bottom <= visible * 0.75) return;
  // Centred in what the player leaves visible, not behind it.
  element.style.scrollMarginBottom = `${dock}px`;
  element.scrollIntoView({ block: "center", behavior: "smooth" });
}
