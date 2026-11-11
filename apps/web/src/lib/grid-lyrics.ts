import { deviceChoice } from "#/lib/device-store";

/**
 * Where the chord grid shows the words (issue #376): in each bar (as it
 * always did), as a line between its rows, two lines pinned at the bottom
 * (the one being sung and the next, issue #408), or not at all. Chosen on the device, for every song.
 */
export type GridLyrics = "bars" | "between" | "pinned" | "off";

export const GRID_LYRICS: readonly GridLyrics[] = ["bars", "between", "pinned", "off"];

const choice = deviceChoice<GridLyrics>("songverse.gridLyrics", "bars", GRID_LYRICS);

export const setGridLyrics = choice.set;
/** The device's choice, the same in every grid on the page. */
export const useGridLyrics = choice.use;
