import type {
  AppModeValue,
  CapoDisplayModeValue,
  ChordDiagramsValue,
  ChordNotationValue,
  ControlsLayoutValue,
  ControlsPositionValue,
  DiagramPositionValue,
  LiveControlValue,
  DisplayColumnsValue,
  DisplayFontValue,
  DisplaySpacingValue,
} from "../constants/index.js";
import { APP_MODES } from "../constants/index.js";
import type { DisplaySettings } from "../api-client/index.js";
import { NOTE_PRESETS, type NewNotes, type NoteShow, type NoteStyle } from "../notes/index.js";
import { chordRowNotation, type ChordRow, type SecondChordRow } from "./chord-rows.js";

/**
 * How a player reads charts (issue #209): each mode - Edit, Practice, Live -
 * keeps what the Display panel changed there; anything it didn't comes from
 * the account's settings (the dashboard's Chart display), then a default.
 */
export interface EffectiveDisplaySettings {
  /** The lyrics' size (and the whole chart's, but the chords'). */
  textSize: number;
  /** The chords' size (issue #225): the lyrics' unless set apart. */
  chordSize: number;
  /** Whether the chords' size follows the lyrics'. */
  sizesLinked: boolean;
  font: DisplayFontValue;
  spacing: DisplaySpacingValue;
  columns: DisplayColumnsValue;
  chordNotation: ChordNotationValue;
  chordColors: boolean;
  capoDisplayMode: CapoDisplayModeValue;
  chordDiagrams: ChordDiagramsValue;
  /** Where the diagrams sit (issue #212): hidden, at the top, docked at the bottom, beside each section. */
  diagramsPosition: DiagramPositionValue;
  hideChords: boolean;
  /** Live's controls (issue #224): a footer, floating buttons or none; which are hidden; floating ones' opacity. */
  controls: ControlsLayoutValue;
  controlsPosition: ControlsPositionValue;
  hiddenControls: LiveControlValue[];
  controlsOpacity: number;
  /** The rows of chords over the lyrics (issue #230): the main one, and a second one or none. chordNotation and chordColors are the main row's, as a notation and on or off. */
  chordRows: { main: ChordRow; second: SecondChordRow | null };
  /** The second row's settings as kept, on or off: what it comes back with when turned on again. */
  secondRowKept: Partial<SecondChordRow>;
  /** Notes on the chart (issue #256): every note unless the mode says otherwise. */
  notes: NoteShow;
  /** What each note is on, marked on the chart (issue #263): on unless turned off. */
  noteMarks: boolean;
  /** Someone else's new notes (issue #263): held until a tap in Live, else shown at once. */
  newNotes: NewNotes;
  /** Where notes go and how they look (issue #264): the Standard preset unless changed. */
  noteStyle: NoteStyle;
}

export type SavedDisplaySettings = Partial<Record<AppModeValue, DisplaySettings>>;

/** The account's own settings, the modes' defaults. */
export interface AccountDisplaySettings {
  chordNotation?: ChordNotationValue | null;
  chordColors?: boolean | null;
  capoDisplayMode?: CapoDisplayModeValue | null;
  chordDiagrams?: ChordDiagramsValue | null;
}

/** Live reads from further away: bigger text unless changed there. */
const DEFAULT_TEXT_SIZE: Record<AppModeValue, number> = { EDIT: 1, PRACTICE: 1, LIVE: 1.5 };

/** A mode's settings in full: what it changed, else the account's, else the default. */
export function effectiveDisplaySettings(account: AccountDisplaySettings | null | undefined, saved: SavedDisplaySettings | null | undefined, mode: AppModeValue): EffectiveDisplaySettings {
  const own = saved?.[mode] ?? {};
  // The main row of chords (issue #230): the mode's own, else the account's, else the default.
  const main: ChordRow = {
    names: chordRowNotation(own.chordNotation ?? account?.chordNotation ?? "LETTERS"),
    source: own.capoDisplayMode ?? account?.capoDisplayMode ?? "SOUNDING",
    size: 1,
    font: own.chordFont ?? "same",
    weight: own.chordWeight ?? "bold",
    color: own.chordColor ?? ((own.chordColors ?? account?.chordColors) ? "family" : "theme"),
  };
  return {
    textSize: own.textSize ?? DEFAULT_TEXT_SIZE[mode],
    chordSize: own.chordSize ?? own.textSize ?? DEFAULT_TEXT_SIZE[mode],
    sizesLinked: own.chordSize == null,
    font: own.font ?? "mono",
    spacing: own.spacing ?? "normal",
    // One column unless asked (issue #264): the room on the right is for other things, notes first. The editor's preview flows.
    columns: own.columns ?? (mode === "EDIT" ? "auto" : "1"),
    chordNotation: chordRowNotation(main.names),
    chordColors: main.color === "family",
    capoDisplayMode: main.source,
    chordDiagrams: own.chordDiagrams ?? account?.chordDiagrams ?? "OFF",
    diagramsPosition: own.diagramsPosition ?? "top",
    hideChords: own.hideChords ?? false,
    controls: own.controls ?? "footer",
    controlsPosition: own.controlsPosition ?? "bottom-right",
    hiddenControls: own.hiddenControls ?? [],
    controlsOpacity: own.controlsOpacity ?? 0.7,
    notes: own.notes ?? "ALL",
    noteMarks: own.noteMarks ?? true,
    newNotes: own.newNotes ?? (mode === "LIVE" ? "HOLD" : "SHOW"),
    noteStyle: {
      placement: own.notesPlacement ?? NOTE_PRESETS.standard.placement,
      look: own.notesLook ?? NOTE_PRESETS.standard.look,
      size: own.notesSize ?? NOTE_PRESETS.standard.size,
      color: own.notesColor ?? NOTE_PRESETS.standard.color,
    },
    secondRowKept: Object.fromEntries(Object.entries(own.secondRow ?? {}).filter(([field]) => field !== "on")) as Partial<SecondChordRow>,
    chordRows: {
      main,
      // Off keeps its settings (on: false), for when it's turned on again.
      second: own.secondRow && own.secondRow.on !== false
        ? {
            names: chordRowNotation(own.secondRow.names ?? "LETTERS"),
            source: own.secondRow.source ?? "SOUNDING",
            position: own.secondRow.position ?? "below",
            gap: own.secondRow.gap ?? 0.1,
            size: own.secondRow.size ?? 0.8,
            font: own.secondRow.font ?? "same",
            weight: own.secondRow.weight ?? "normal",
            color: own.secondRow.color ?? "muted",
          }
        : null,
    },
  };
}

/**
 * Changes merged into what's kept, mode by mode: a field given replaces its
 * value, null removes it (back to the account's), one left out stays.
 */
export function mergeDisplaySettings(
  saved: SavedDisplaySettings | null | undefined,
  changes: Partial<Record<AppModeValue, { [K in keyof DisplaySettings]?: DisplaySettings[K] | null }>>,
): SavedDisplaySettings {
  const next: SavedDisplaySettings = {};
  for (const mode of APP_MODES) {
    const merged: Record<string, unknown> = { ...(saved?.[mode] ?? {}) };
    for (const [field, value] of Object.entries(changes[mode] ?? {})) {
      if (value === null) delete merged[field];
      else if (value !== undefined) merged[field] = value;
    }
    if (Object.keys(merged).length > 0) next[mode] = merged as DisplaySettings;
  }
  return next;
}
