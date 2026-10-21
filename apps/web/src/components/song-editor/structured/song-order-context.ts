import type { SectionInstance } from "@oneverse/core";
import { createContext, useContext } from "react";

/**
 * The song's order, for the editor's blocks (issue #205): a linked copy
 * reads its pass here and changes it (transposed, lines left out, its own
 * words and chords), or is made unique.
 */
export interface SongOrderActions {
  /** The pass of a block, as the song's order has it. */
  pass: (passId: string) => SectionInstance | undefined;
  /** Changes a pass: undefined or null fields go back to the section as written. */
  updatePass: (passId: string, change: Partial<SectionInstance>) => void;
  /** The linked copy at `pos` made a section of its own, its changes written in. */
  makeUnique: (passId: string, pos: number) => void;
  /** The linked copy at `pos` duplicated just after it, its changes and all, linked to the same section. */
  duplicatePass: (passId: string, pos: number) => void;
  /** The key the song's sections are written in. */
  songKey: string;
  /** Whether a linked copy is unfolded (issue #252): kept by the editor, so a reload of the chart keeps it. */
  copyOpen: (passId: string) => boolean;
  setCopyOpen: (passId: string, open: boolean) => void;
}

export const SongOrderActionsContext = createContext<SongOrderActions | null>(null);

export function useSongOrderActions() {
  return useContext(SongOrderActionsContext);
}
