import { stemSpeed } from "@oneverse/core";
import { useSyncExternalStore } from "react";

/**
 * What someone chose for a song's stems, remembered on the device (issue
 * #427, out of `stem-engine.ts`): how far they're transposed, how fast they
 * play, and which multitrack. The pages read these and hand them to the
 * player with the song.
 */

// --- how far each song's stems are transposed (issue #129), remembered on the device

const TRANSPOSE_KEY = "songverse.stems.transpose.";

/** A song's transposition (issues #129, #135): how far, and by file which parts, when not as their part says. */
export interface StemTranspose {
  steps: number;
  parts: Record<string, boolean>;
}
const transposes = new Map<string, StemTranspose | undefined>();
const transposeListeners = new Set<() => void>();

function transposeOf(key: string): StemTranspose | undefined {
  if (transposes.has(key)) return transposes.get(key);
  let saved: StemTranspose | undefined;
  try {
    const raw = localStorage.getItem(TRANSPOSE_KEY + key);
    const parsed = raw ? (JSON.parse(raw) as { steps?: unknown; parts?: unknown }) : null;
    if (parsed && typeof parsed.steps === "number") {
      const parts = parsed.parts && typeof parsed.parts === "object" ? Object.entries(parsed.parts).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean") : [];
      saved = { steps: parsed.steps, parts: Object.fromEntries(parts) };
    }
  } catch {
    // Storage blocked, or not ours.
  }
  transposes.set(key, saved);
  return saved;
}

/** Transposes the song's stems (`key`: the song, or the song in a set) from now on; undefined goes back to the default. */
export function chooseStemTranspose(key: string, value: StemTranspose | undefined) {
  transposes.set(key, value);
  try {
    if (value) localStorage.setItem(TRANSPOSE_KEY + key, JSON.stringify(value));
    else localStorage.removeItem(TRANSPOSE_KEY + key);
  } catch {
    // Remembered until the page reloads.
  }
  for (const listener of transposeListeners) listener();
}

/** The transposition chosen for the song; undefined when none was (the default then). */
export function useChosenTranspose(key: string): StemTranspose | undefined {
  return useSyncExternalStore(
    (listener) => {
      transposeListeners.add(listener);
      return () => transposeListeners.delete(listener);
    },
    () => transposeOf(key),
    () => undefined,
  );
}

// --- how fast each song's stems play (issue #139), remembered on the device like the transposition

const SPEED_KEY = "songverse.stems.speed.";
const speeds = new Map<string, number>();
const speedListeners = new Set<() => void>();

function speedOf(key: string): number {
  const known = speeds.get(key);
  if (known !== undefined) return known;
  let saved = 1;
  try {
    const raw = localStorage.getItem(SPEED_KEY + key);
    if (raw) saved = stemSpeed(Number(raw));
  } catch {
    // Storage blocked.
  }
  speeds.set(key, saved);
  return saved;
}

/** Plays the song's stems (`key`: the song, or the song in a set) this much slower or faster from now on; 1 as recorded. */
export function chooseStemSpeed(key: string, rate: number) {
  const speed = stemSpeed(rate);
  speeds.set(key, speed);
  try {
    if (speed === 1) localStorage.removeItem(SPEED_KEY + key);
    else localStorage.setItem(SPEED_KEY + key, String(speed));
  } catch {
    // Remembered until the page reloads.
  }
  for (const listener of speedListeners) listener();
}

/** The speed chosen for the song: 1 when none was. */
export function useChosenSpeed(key: string): number {
  return useSyncExternalStore(
    (listener) => {
      speedListeners.add(listener);
      return () => speedListeners.delete(listener);
    },
    () => speedOf(key),
    () => 1,
  );
}

// --- which multitrack each song plays (issue #123), remembered on the device

const CHOICE_KEY = "songverse.stems.multitrack.";
const choices = new Map<string, string | null>();
const choiceListeners = new Set<() => void>();

function choiceOf(songVersionId: string): string | null | undefined {
  if (choices.has(songVersionId)) return choices.get(songVersionId);
  try {
    const saved = localStorage.getItem(CHOICE_KEY + songVersionId);
    if (saved !== null) return saved === "" ? null : saved;
  } catch {
    // Storage blocked.
  }
  return undefined;
}

/** The multitrack chosen for the song, outside React (undefined: none was). */
export function chosenMultitrack(songVersionId: string): string | null | undefined {
  return choiceOf(songVersionId);
}

/** Plays that multitrack of the song from now on (null: its original stems). */
export function chooseMultitrack(songVersionId: string, multitrackId: string | null) {
  choices.set(songVersionId, multitrackId);
  try {
    localStorage.setItem(CHOICE_KEY + songVersionId, multitrackId ?? "");
  } catch {
    // Remembered until the page reloads.
  }
  for (const listener of choiceListeners) listener();
}

/** The multitrack chosen for the song; undefined when none was (its first then). */
export function useChosenMultitrack(songVersionId: string): string | null | undefined {
  return useSyncExternalStore(
    (listener) => {
      choiceListeners.add(listener);
      return () => choiceListeners.delete(listener);
    },
    () => choiceOf(songVersionId),
    () => undefined,
  );
}
