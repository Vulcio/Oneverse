import { createDeviceStore } from "@oneverse/ui/lib/device-store";

/**
 * How the operator's console looks on this device (issue #358): the slides'
 * lettering, size and case, where a section's colour goes, slides grouped by
 * section or not, how many to a row, and the screens' pictures as a grid, one
 * screen at a time or not at all. Kept on the device: a laptop at the desk
 * and a tablet by the stage each have theirs.
 */
export interface OperatorDisplay {
  font: (typeof OPERATOR_FONTS)[number];
  size: (typeof OPERATOR_SIZES)[number];
  uppercase: boolean;
  /** The section's colour on the whole tile, on its header only, or nowhere. */
  sectionColor: (typeof OPERATOR_SECTION_COLORS)[number];
  /** Each section's slides together under its name. */
  grouped: boolean;
  /** Slides to a row; auto, as many as fit. */
  columns: (typeof OPERATOR_COLUMNS)[number];
  /** Each slide's number. */
  numbers: boolean;
  /** The tiles light as the app, or dark as a screen. */
  tiles: (typeof OPERATOR_TILES)[number];
  /** The screens' pictures: all of them in a grid, one at a time by its tab, or hidden. */
  screens: (typeof OPERATOR_SCREEN_VIEWS)[number];
}

export const OPERATOR_FONTS = ["sans", "serif", "mono", "condensed"] as const;
export const OPERATOR_SIZES = ["s", "m", "l", "xl"] as const;
export const OPERATOR_SECTION_COLORS = ["tile", "header", "none"] as const;
export const OPERATOR_COLUMNS = ["auto", "1", "2", "3", "4", "5", "6"] as const;
export const OPERATOR_TILES = ["app", "dark"] as const;
export const OPERATOR_SCREEN_VIEWS = ["grid", "tabs", "off"] as const;

export const DEFAULT_OPERATOR_DISPLAY: OperatorDisplay = { font: "sans", size: "m", uppercase: false, sectionColor: "tile", grouped: false, columns: "auto", numbers: true, tiles: "app", screens: "grid" };

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/** What's stored, as options: anything not one of ours takes the default. */
export function readOperatorDisplay(raw: string | null): OperatorDisplay {
  const value = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  const d = DEFAULT_OPERATOR_DISPLAY;
  if (!value || typeof value !== "object") return d;
  return {
    font: pick(value.font, OPERATOR_FONTS, d.font),
    size: pick(value.size, OPERATOR_SIZES, d.size),
    uppercase: flag(value.uppercase, d.uppercase),
    sectionColor: pick(value.sectionColor, OPERATOR_SECTION_COLORS, d.sectionColor),
    grouped: flag(value.grouped, d.grouped),
    columns: pick(value.columns, OPERATOR_COLUMNS, d.columns),
    numbers: flag(value.numbers, d.numbers),
    tiles: pick(value.tiles, OPERATOR_TILES, d.tiles),
    screens: pick(value.screens, OPERATOR_SCREEN_VIEWS, d.screens),
  };
}

const store = createDeviceStore<OperatorDisplay>("oneverse.operator.display", {
  fallback: DEFAULT_OPERATOR_DISPLAY,
  parse: readOperatorDisplay,
  format: (value) => JSON.stringify(value),
});

export const useOperatorDisplay = store.use;

/** One or more options changed, the rest kept. */
export function changeOperatorDisplay(change: Partial<OperatorDisplay>) {
  store.set({ ...store.get(), ...change });
}

/** Back to how the console looks by default. */
export function resetOperatorDisplay() {
  store.set(DEFAULT_OPERATOR_DISPLAY);
}
