import { useSyncExternalStore } from "react";

/**
 * A choice kept on the device (issue #427): one value under a key in
 * localStorage, the same in every component that reads it on the page, and
 * changed for the page even when storage is blocked (a private window). The
 * server can't know it, so a page rendered there shows the fallback.
 *
 * ```ts
 * const waves = deviceChoice("songverse.tracksWaves", "filled", ["filled", "lines"]);
 * export const setTrackWaves = waves.set;
 * export const useTrackWaves = waves.use;
 * ```
 */
export interface DeviceStore<T> {
  /** What the device has now. */
  get(): T;
  set(value: T): void;
  /** The same, in a component: it follows every `set`. */
  use(): T;
}

interface DeviceStoreOptions<T> {
  /** What a device that never chose has, and what the server renders. */
  fallback: T;
  /** The stored text (null when there is none) as a value; anything not ours gives the fallback. */
  parse(raw: string | null): T;
  /** The value as text to store; null removes the key. */
  format(value: T): string | null;
}

export function createDeviceStore<T>(key: string, { fallback, parse, format }: DeviceStoreOptions<T>): DeviceStore<T> {
  const listeners = new Set<() => void>();
  let known = false;
  let current = fallback;

  function get(): T {
    if (!known) {
      known = true;
      try {
        current = parse(localStorage.getItem(key));
      } catch {
        // Storage blocked, or not ours: the fallback.
        current = fallback;
      }
    }
    return current;
  }

  function set(value: T) {
    known = true;
    current = value;
    try {
      const text = format(value);
      if (text === null) localStorage.removeItem(key);
      else localStorage.setItem(key, text);
    } catch {
      // Not kept (a private window): still changed for this page.
    }
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return { get, set, use: () => useSyncExternalStore(subscribe, get, () => fallback) };
}

/** One of a few named choices: anything else stored gives the fallback. */
export function deviceChoice<T extends string>(key: string, fallback: T, allowed: readonly T[]): DeviceStore<T> {
  return createDeviceStore<T>(key, {
    fallback,
    parse: (raw) => (raw !== null && allowed.includes(raw as T) ? (raw as T) : fallback),
    format: (value) => value,
  });
}

/** On or off, kept as "1" or "0". */
export function deviceFlag(key: string, fallback: boolean): DeviceStore<boolean> {
  return createDeviceStore<boolean>(key, {
    fallback,
    parse: (raw) => (raw === "1" ? true : raw === "0" ? false : fallback),
    format: (value) => (value ? "1" : "0"),
  });
}
