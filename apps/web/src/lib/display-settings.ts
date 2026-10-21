import {
  DISPLAY_TEXT_SIZES,
  effectiveDisplaySettings,
  mergeDisplaySettings,
  type AccountDisplaySettings,
  type AppModeValue,
  type DiagramPlayer,
  type DisplaySettings,
  type EffectiveDisplaySettings,
  type SavedDisplaySettings,
} from "@oneverse/core";
import { useEffect, useSyncExternalStore } from "react";
import { apiClient } from "#/lib/api-client";

/**
 * How the player reads charts in each mode (issue #209), as the Display
 * panel changes it: shown at once everywhere on the page, kept on the
 * device (offline, and before the page's data arrives), and saved to the
 * account a moment after the last change.
 *
 * The page seeds it with what its data says (the account's chord settings
 * and the modes' saved ones); a change made here wins over a seed until the
 * account has it.
 */

const KEY = "songverse.display";
const SAVE_DELAY_MS = 600;
// How long changes the account has had still win over a page's data: one fetched while they were on their way is older.
const SETTLE_MS = 15_000;

type Changes = Partial<Record<AppModeValue, { [K in keyof DisplaySettings]?: DisplaySettings[K] | null }>>;

interface State {
  account: AccountDisplaySettings;
  saved: SavedDisplaySettings;
}

/** As kept on the device: the settings, changes the account hasn't had yet (a page left before they were sent), and the ones it has just had. */
interface Kept extends State {
  unsent?: Changes;
  confirmed?: { changes: Changes; at: number };
}

let state: State | null = null;
let loaded = false;
const listeners = new Set<() => void>();
// Changes not yet sent, the ones on their way, and the timer sending them.
let pending: Changes = {};
let inFlight: Changes = {};
// Changes the account has just had (when, the last of them): a page's data fetched before they landed doesn't undo them.
let confirmed: Changes = {};
let confirmedAt = 0;

function settled(): Changes {
  return Date.now() - confirmedAt < SETTLE_MS ? confirmed : {};
}
let timer: ReturnType<typeof setTimeout> | null = null;
// One save at a time, so they reach the account in the order they were made.
let sending = false;

function emit() {
  for (const listener of listeners) listener();
}

/** Later changes over earlier ones, field by field. */
function combine(earlier: Changes, later: Changes): Changes {
  const all: Changes = { ...earlier };
  for (const [mode, changes] of Object.entries(later)) all[mode as AppModeValue] = { ...earlier[mode as AppModeValue], ...changes };
  return all;
}

function unsent(): Changes {
  return combine(inFlight, pending);
}

/** The device's copy, once: a page left before its changes were sent sends them now. */
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    const kept = raw ? (JSON.parse(raw) as Kept) : null;
    if (!kept) return;
    state ??= { account: kept.account ?? {}, saved: kept.saved ?? {} };
    if (kept.confirmed) {
      confirmed = combine(kept.confirmed.changes, confirmed);
      confirmedAt = Math.max(confirmedAt, kept.confirmed.at);
    }
    if (kept.unsent && Object.keys(kept.unsent).length > 0) {
      pending = combine(kept.unsent, pending);
      schedule(0);
    }
  } catch {
    // Storage blocked or unreadable: the page's data.
  }
}

function keep() {
  if (!state) return;
  try {
    const recent = settled();
    localStorage.setItem(KEY, JSON.stringify({ ...state, unsent: unsent(), ...(Object.keys(recent).length > 0 && { confirmed: { changes: recent, at: confirmedAt } }) } satisfies Kept));
  } catch {
    // Storage blocked: for this page only.
  }
}

/** What the page's data says (the account's settings and each mode's), with this page's changes on top - sent or still on their way. */
export function seedDisplaySettings(account: AccountDisplaySettings, saved: SavedDisplaySettings | null | undefined) {
  load();
  const next = { account, saved: mergeDisplaySettings(saved ?? {}, combine(settled(), unsent())) };
  if (state && JSON.stringify(state) === JSON.stringify(next)) return;
  state = next;
  keep();
  emit();
}

/**
 * A mode's settings in full, for the page (issue #209). `seed` is the page's
 * data, used until the device's copy is read - so the server and the first
 * render agree - and given to the store once mounted.
 */
export function useDisplaySettings(mode: AppModeValue, seed?: { account: AccountDisplaySettings; saved?: SavedDisplaySettings | null }): EffectiveDisplaySettings {
  const seedKey = seed ? JSON.stringify(seed) : "";
  useEffect(() => {
    if (seed) seedDisplaySettings(seed.account, seed.saved);
    else if (!state) {
      load();
      if (state) emit();
    }
    // The seed by value: a new object with the same settings changes nothing.
  }, [seedKey]);
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => null,
  );
  const source = snapshot ?? (seed ? { account: seed.account, saved: seed.saved ?? {} } : null);
  return effectiveDisplaySettings(source?.account, source?.saved, mode);
}

/** Changes a mode's settings: shown at once, saved to the account a moment after the last change. Null: back to the account's. */
export function changeDisplaySettings(mode: AppModeValue, change: { [K in keyof DisplaySettings]?: DisplaySettings[K] | null }) {
  load();
  const current = state ?? { account: {}, saved: {} };
  state = { ...current, saved: mergeDisplaySettings(current.saved, { [mode]: change }) };
  pending = combine(pending, { [mode]: change });
  keep();
  emit();
  schedule(SAVE_DELAY_MS);
}

function schedule(delay: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    send();
  }, delay);
}

function send() {
  if (sending || Object.keys(pending).length === 0) return;
  inFlight = pending;
  pending = {};
  sending = true;
  apiClient
    .updateMe({ displaySettings: inFlight })
    .then(
      () => {
        confirmed = combine(settled(), inFlight);
        confirmedAt = Date.now();
        inFlight = {};
        sending = false;
        keep();
        // Changed again while this one was on its way.
        if (!timer) send();
      },
      () => {
        // Offline: kept on the device, sent with the next change or the next page.
        pending = combine(inFlight, pending);
        inFlight = {};
        sending = false;
      },
    );
}

/** The mode a page is in, as the settings are kept. */
export function displayModeOf(mode: "edit" | "practice" | "live"): AppModeValue {
  return mode === "live" ? "LIVE" : mode === "practice" ? "PRACTICE" : "EDIT";
}

/**
 * How the player's diagrams are drawn - tunings, left-handed, the piano's
 * options: the account's, for every mode. A change from the panel shows at
 * once over what the page loaded, and is saved straight away.
 */
let instrument: DiagramPlayer = {};

/** The page's player with the panel's changes on top. */
export function useDiagramPlayer<T extends DiagramPlayer>(base: T): T;
export function useDiagramPlayer<T extends DiagramPlayer>(base: T | undefined): T | undefined;
export function useDiagramPlayer<T extends DiagramPlayer>(base: T | undefined): T | undefined {
  const overrides = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => instrument,
    () => instrument,
  );
  if (!base || Object.keys(overrides).length === 0) return base;
  return { ...base, ...overrides };
}

export function changeDiagramPlayer(change: DiagramPlayer) {
  instrument = { ...instrument, ...change };
  emit();
  void apiClient.updateMe(change).catch(() => {
    // Not saved (offline): for this page only.
  });
}

/** The next text size up or down the scale, from wherever it is now. */
export function stepTextSize(current: number, direction: 1 | -1): number {
  if (direction > 0) return DISPLAY_TEXT_SIZES.find((size) => size > current + 0.001) ?? current;
  return [...DISPLAY_TEXT_SIZES].reverse().find((size) => size < current - 0.001) ?? current;
}

/** What a chart takes from a mode's settings. */
export function chartDisplayProps(settings: EffectiveDisplaySettings) {
  return {
    columns: settings.columns,
    font: settings.font,
    spacing: settings.spacing,
    hideChords: settings.hideChords,
    chordScale: settings.chordSize / settings.textSize,
    rows: settings.chordRows,
    notation: settings.chordNotation,
    colors: settings.chordColors,
    diagrams: settings.chordDiagrams,
    diagramsPosition: settings.diagramsPosition,
  };
}

/** The store's seed from what a page loaded: the account's chord settings and each mode's saved ones. */
export function displaySeed(
  source: (AccountDisplaySettings & { displaySettings?: SavedDisplaySettings | null }) | null | undefined,
): { account: AccountDisplaySettings; saved?: SavedDisplaySettings | null } | undefined {
  if (!source) return undefined;
  const { chordNotation, chordColors, capoDisplayMode, chordDiagrams } = source;
  return { account: { chordNotation, chordColors, capoDisplayMode, chordDiagrams }, saved: source.displaySettings };
}
