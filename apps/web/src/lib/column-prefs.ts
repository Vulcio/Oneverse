import { createDeviceStore } from "#/lib/device-store";

/** A list's columns as chosen on this device (issue #150): in order, each shown or not. */
export interface ColumnPrefs<Id extends string = string> {
  columns: { id: Id; shown: boolean }[];
}

/**
 * A list whose columns can be picked and ordered, kept on the device under
 * `key`: the Library's Songs (issue #150), a songbook's songs (issue #440).
 * `all` in their default order, `hiddenAtFirst` a pick away.
 */
export function columnPrefsStore<Id extends string>(key: string, all: readonly Id[], hiddenAtFirst: readonly Id[]) {
  const defaults: ColumnPrefs<Id> = { columns: all.map((id) => ({ id, shown: !hiddenAtFirst.includes(id) })) };

  /** What's kept, made whole: a column it doesn't know is dropped, one it lacks (added since) comes at the end as it starts. */
  function read(raw: string | null): ColumnPrefs<Id> {
    try {
      const saved = JSON.parse(raw ?? "null") as ColumnPrefs<Id> | null;
      if (!saved || !Array.isArray(saved.columns)) return defaults;
      const known = saved.columns.filter((column): column is ColumnPrefs<Id>["columns"][number] => (all as readonly string[]).includes(column?.id) && typeof column.shown === "boolean");
      const missing = defaults.columns.filter((column) => !known.some((kept) => kept.id === column.id));
      return { columns: [...known, ...missing] };
    } catch {
      return defaults;
    }
  }

  const store = createDeviceStore<ColumnPrefs<Id>>(key, { fallback: defaults, parse: read, format: (prefs) => JSON.stringify(prefs) });

  /**
   * The choice, read while rendering on the client (the defaults on the
   * server), not in an effect after it - so it's there from the first render.
   */
  function useColumnPrefs(): [ColumnPrefs<Id>, (next: ColumnPrefs<Id>) => void] {
    return [store.use(), store.set];
  }
  return { read, useColumnPrefs };
}

/** The table's state for a choice: which columns show, and their order after the ones always first. */
export function tableColumns<Id extends string>(prefs: ColumnPrefs<Id>, first: string[], last: string[] = []) {
  return {
    columnVisibility: Object.fromEntries(prefs.columns.map((column) => [column.id, column.shown])),
    columnOrder: [...first, ...prefs.columns.map((column) => column.id), ...last],
  };
}
