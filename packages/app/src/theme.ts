import { useSyncExternalStore } from "react";

/**
 * Light, dark, or as the device is (issue #422): Oneverse's pages and
 * Planiverse follow the device until someone picks one on the sign-in page
 * or the account's header. Remembered on this device, as Songverse's own
 * choice is (its modes, `apps/web/src/lib/mode.ts`): a browser's storage
 * isn't shared between the apps' domains.
 */
export type ThemeChoice = "light" | "dark" | "device";

const THEME_KEY = "oneverse.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Sets <html>'s theme from what's stored and the device's setting. */
function applyTheme() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch {
    // Storage blocked: the device's.
  }
  const dark = stored === "dark" || (stored !== "light" && window.matchMedia(DARK_QUERY).matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

/**
 * The same, in an app's root document before anything paints, so a reload
 * never flashes the wrong theme; it also follows the device as it changes.
 * Written out (not `applyTheme.toString()`): the server's and the browser's
 * builds must render the very same text, or the page fails to hydrate.
 */
export const THEME_SCRIPT = `(function(){var m=window.matchMedia('${DARK_QUERY}');function a(){var s=null;try{s=localStorage.getItem('${THEME_KEY}')}catch(e){}var d=s==='dark'||(s!=='light'&&m.matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light'}a();m.addEventListener('change',a)})()`;

const listeners = new Set<() => void>();

function choice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "device";
  } catch {
    return "device";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab choosing.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_KEY) return;
    applyTheme();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setThemeChoice(next: ThemeChoice) {
  try {
    if (next === "device") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage blocked: nothing to remember it by.
  }
  applyTheme();
  for (const listener of listeners) listener();
}

/** What was picked on this device; "device" while rendering on the server. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, choice, () => "device");
}
