import { findKeptSong, keptSongCopy, offlineViewer, type Attachment, type CapoDisplayModeValue, type ChordDiagramsValue, type ChordNotationValue, type DiagramPlayer, type FoundSong, type SavedDisplaySettings } from "@oneverse/core";
import { deviceStorage } from "#/lib/offline-data";

// Kept apart from the offline song page (issue #343): the song route's loader reads it, and a
// loader is in the app's first chunk, so importing it from the page brought the page there too.

/** A song as kept on the device, with its files' list and the player's chord settings. */
export interface OfflineSong extends FoundSong {
  attachments: Attachment[];
  notation: ChordNotationValue;
  capoDisplay: CapoDisplayModeValue;
  /** Chord diagrams beside the chart (issue #207), as of the last sync. */
  diagrams: ChordDiagramsValue;
  colors: boolean;
  player: DiagramPlayer;
  /** Each mode's display settings (issue #209), as of the last sync. */
  displaySettings: SavedDisplaySettings | null;
}

/** The song as kept on the device (on its own, or in a kept set), if it is. */
export async function loadOfflineSong(songVersionId: string): Promise<OfflineSong | undefined> {
  const storage = deviceStorage();
  const [found, kept, viewer] = await Promise.all([findKeptSong(storage, songVersionId), keptSongCopy(storage, songVersionId), offlineViewer(storage)]);
  if (!found) return undefined;
  return {
    ...found,
    attachments: kept?.attachments ?? [],
    notation: viewer?.chordNotation ?? "LETTERS",
    capoDisplay: viewer?.capoDisplayMode ?? "SOUNDING",
    diagrams: viewer?.chordDiagrams ?? "OFF",
    colors: viewer?.chordColors ?? false,
    player: viewer ?? {},
    displaySettings: viewer?.displaySettings ?? null,
  };
}

