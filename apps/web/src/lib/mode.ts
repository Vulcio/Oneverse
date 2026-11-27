import { useSyncExternalStore } from "react";

/**
 * The app's mode (issues #11, #47): Edit to write songs and prepare sets,
 * Practice to learn and rehearse them, Live to play them on stage. Each
 * mode has its own look; a set's songs open full screen in Live.
 *
 * Edit and Practice follow the device's light or dark setting until the
 * player picks one; Live is always dark. Remembered on this device, not
 * the account: the tablet on the music stand stays Live while the laptop
 * edits.
 */
export type AppMode = "edit" | "practice" | "live";
export type Theme = "light" | "dark";

const MODE_KEY = "songverse.mode";
// Edit and Practice's theme, when the player picked one; unset follows the device.
const THEME_KEY = "songverse.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Sets <html>'s mode and theme from what's stored and the device's setting.
 * Self-contained (no imports, literal keys) because it also runs as an
 * inline script before the page paints (MODE_SCRIPT), so a reload never
 * flashes the wrong theme.
 */
function applyMode() {
  let mode = "edit";
  let theme = null;
  try {
    const stored = localStorage.getItem("songverse.mode");
    mode = stored === "live" ? "live" : stored === "practice" ? "practice" : "edit";
    theme = localStorage.getItem("songverse.theme");
  } catch {
    // Storage blocked: the defaults.
  }
  const dark = mode === "live" || (theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.mode = mode;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export const MODE_SCRIPT = `(${applyMode.toString()})()`;

type Snapshot = { mode: AppMode; theme: Theme };
const SERVER: Snapshot = { mode: "edit", theme: "light" };
let current: Snapshot | null = null;
const listeners = new Set<() => void>();

// Read back from <html>, which applyMode() has just set.
function snapshot(): Snapshot {
  if (!current) {
    const root = document.documentElement;
    const mode = root.dataset.mode === "live" ? "live" : root.dataset.mode === "practice" ? "practice" : "edit";
    current = { mode, theme: root.classList.contains("dark") ? "dark" : "light" };
  }
  return current;
}

function changed() {
  applyMode();
  current = null;
  for (const listener of listeners) listener();
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: nothing to remember it by.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab switching, or the device going dark at sunset.
  const onStorage = (event: StorageEvent) => {
    if (event.key === MODE_KEY || event.key === THEME_KEY) changed();
  };
  const media = window.matchMedia(DARK_QUERY);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", changed);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", changed);
  };
}

export function setMode(mode: AppMode) {
  store(MODE_KEY, mode);
  changed();
}

/** Edit and Practice's theme. The device's own setting goes back to following the device. */
export function setTheme(theme: Theme) {
  const device: Theme = window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  store(THEME_KEY, theme === device ? null : theme);
  changed();
}

/** The account's light or dark (issue #540), shown on this device: "device" follows it. */
export function setThemeChoice(choice: Theme | "device") {
  store(THEME_KEY, choice === "device" ? null : choice);
  changed();
}

/** The current mode and theme (Live's is always dark); Edit, light, while rendering on the server. */
export function useMode(): Snapshot {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER);
}
