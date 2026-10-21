export const SECTION_TYPES = [
  "intro",
  "verse",
  "chorus",
  "pre-chorus",
  "post-chorus",
  "bridge",
  // A phrase repeated as long as it's needed; the band stripped back (issue #143).
  "vamp",
  "breakdown",
  "instrumental",
  // Music between two sections.
  "interlude",
  "outro",
  "tag",
  "other",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const CHORD_QUALITIES = [
  "major",
  "minor",
  "diminished",
  "augmented",
  "sus2",
  "sus4",
  "dominant",
] as const;
export type ChordQuality = (typeof CHORD_QUALITIES)[number];

export const NOTE_ROOTS = ["C", "D", "E", "F", "G", "A", "B"] as const;
export type NoteRoot = (typeof NOTE_ROOTS)[number];

export const ACCIDENTALS = ["sharp", "flat"] as const;
export type Accidental = (typeof ACCIDENTALS)[number];

export const KEY_MODES = ["major", "minor"] as const;
export type KeyMode = (typeof KEY_MODES)[number];

export const CONTRIBUTOR_ROLES = [
  "author",
  "composer",
  "lyricist",
  "translator",
  "adaptor",
  "arranger",
  "performer",
] as const;
export type ContributorRole = (typeof CONTRIBUTOR_ROLES)[number];

export const IMPORT_FORMATS = [
  "CHORDPRO",
  "CHORDS_OVER_LYRICS",
  "RAW_TEXT",
  "LRC",
  "MUSICXML",
  "ABC_NOTATION",
] as const;
export type ImportFormatValue = (typeof IMPORT_FORMATS)[number];

// The subset of IMPORT_FORMATS that actually has a parser today - the
// others (LRC, MUSICXML, ABC_NOTATION) are reserved for later. RAW_TEXT is
// plain lyrics with no chords ("Lyrics only" in the UI).
export const SUPPORTED_IMPORT_FORMATS = ["CHORDPRO", "CHORDS_OVER_LYRICS", "RAW_TEXT"] as const;
export type SupportedImportFormat = (typeof SUPPORTED_IMPORT_FORMATS)[number];

export const VOICING_PREFERENCES = ["OPEN", "BARRE", "DROP2", "CLOSE", "AUTO"] as const;
export type VoicingPreferenceValue = (typeof VOICING_PREFERENCES)[number];

export const CAPO_DISPLAY_MODES = ["SOUNDING", "FINGERED"] as const;
export type CapoDisplayModeValue = (typeof CAPO_DISPLAY_MODES)[number];

/** Chord names on every chart: letters (G), solfège (Sol) or Nashville numbers (1, issue #207). */
export const CHORD_NOTATIONS = ["LETTERS", "SOLFEGE", "NASHVILLE", "ROMAN"] as const;
export type ChordNotationValue = (typeof CHORD_NOTATIONS)[number];

/** Chord diagrams beside every chart (issue #207): off, or for a guitar, a ukulele or a piano. */
export const CHORD_DIAGRAMS = ["OFF", "GUITAR", "UKULELE", "PIANO"] as const;
/** Where the song's chord diagrams sit (issue #212): nowhere (a tapped chord still opens its card), at the top, docked at the bottom for the section being played, or beside each section. */
export const DIAGRAM_POSITIONS = ["hidden", "top", "bottom", "sections"] as const;
export type DiagramPositionValue = (typeof DIAGRAM_POSITIONS)[number];
/** What a row of chords over the lyrics shows (issue #230): a notation's names. */
export const CHORD_ROW_NAMES = CHORD_NOTATIONS;
export type ChordRowNamesValue = (typeof CHORD_ROW_NAMES)[number];
export const CHORD_ROW_FONTS = ["same", "sans", "mono"] as const;
export type ChordRowFontValue = (typeof CHORD_ROW_FONTS)[number];
export const CHORD_ROW_WEIGHTS = ["bold", "normal"] as const;
export type ChordRowWeightValue = (typeof CHORD_ROW_WEIGHTS)[number];
/** A row's colour: the theme's accent, muted, by chord type (issue #9), or a colour of its own (#rrggbb). */
export const CHORD_ROW_COLORS = ["theme", "muted", "family"] as const;
/** Where the second row is: under the main chords, over them, beside each as a superscript, or side by side with it (after or before). */
export const SECOND_ROW_POSITIONS = ["below", "above", "beside", "right", "left"] as const;
export type SecondRowPositionValue = (typeof SECOND_ROW_POSITIONS)[number];
/** The second row's size, against the main chords'. */
export const SECOND_ROW_SIZES = [0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;
/** The space between the two rows, in em (of the main chords). */
export const SECOND_ROW_GAPS = [0, 0.1, 0.2, 0.3, 0.5, 0.75, 1] as const;
/** Piano diagrams' hands (issue #207 phase 4): both, or the right only (a bassist covers the bass). */
export const PIANO_HANDS = ["both", "right"] as const;
/** Note names on a piano diagram's keys: in the bigger card only, everywhere, or never. */
export const PIANO_NOTE_NAMES = ["card", "all", "none"] as const;
export type ChordDiagramsValue = (typeof CHORD_DIAGRAMS)[number];

/**
 * How a player reads charts, kept for each mode (issue #209): Edit, Practice
 * and Live each have their own, changed from the Display panel.
 */
export const APP_MODES = ["EDIT", "PRACTICE", "LIVE"] as const;
export type AppModeValue = (typeof APP_MODES)[number];
/** The chart's lettering: a fixed-width font keeps chords over their syllables; sans reads lighter. */
export const DISPLAY_FONTS = ["mono", "sans"] as const;
export type DisplayFontValue = (typeof DISPLAY_FONTS)[number];
/** The space between a chart's lines. */
export const DISPLAY_SPACINGS = ["compact", "normal", "relaxed"] as const;
export type DisplaySpacingValue = (typeof DISPLAY_SPACINGS)[number];
/** Columns a chart flows into (issue #177): as many as fit, or 1, 2, 3. */
export const DISPLAY_COLUMNS = ["auto", "1", "2", "3"] as const;
export type DisplayColumnsValue = (typeof DISPLAY_COLUMNS)[number];
/** Text size, as a zoom of the chart: its own proportions kept. */
export const DISPLAY_TEXT_SIZES = [0.75, 0.875, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
/** Where Live's controls are (issue #224): a bar along the bottom, round buttons over the chart, or none. */
export const CONTROLS_LAYOUTS = ["footer", "floating", "hidden"] as const;
export type ControlsLayoutValue = (typeof CONTROLS_LAYOUTS)[number];
/** Where floating controls sit. */
export const CONTROLS_POSITIONS = ["bottom-right", "bottom-left", "bottom-center", "right"] as const;
export type ControlsPositionValue = (typeof CONTROLS_POSITIONS)[number];
/** Live's controls, each of which can be hidden, in the order they show. */
export const LIVE_CONTROLS = ["songs", "autoscroll", "textSize", "metronome", "structure", "transpose"] as const;
export type LiveControlValue = (typeof LIVE_CONTROLS)[number];
/** How opaque floating controls are, 20% to 100%. */
export const CONTROLS_OPACITIES = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

/** How a song reads in Live (issue #155): its chart (chords and lyrics), its chords in bars (the chord grid, issue #238), or its PDF. More to come: lyrics only (#106), drummer (#107). */
export const LIVE_VIEWS = ["CHART", "GRID", "PDF"] as const;
export type LiveViewValue = (typeof LIVE_VIEWS)[number];

/**
 * What happens after a song of a set (issue #199): the end, wait for the
 * leader (STOP); straight on to the next (NEXT); into the next with no pause,
 * its count-in on the last bar (SEGUE); or a bridge into it - a key or tempo
 * change, a pad under a prayer (TRANSITION, with a note).
 */
export const SET_TRANSITIONS = ["STOP", "NEXT", "SEGUE", "TRANSITION"] as const;
export type SetTransitionValue = (typeof SET_TRANSITIONS)[number];

/** What a set's songs can show on their right, in Live's sidebar (issue #199): each person picks. */
export const SET_LIST_DETAILS = ["KEY", "TEMPO", "TIME_SIGNATURE", "LENGTH", "TRANSITION"] as const;
export type SetListDetailValue = (typeof SET_LIST_DETAILS)[number];

export const MIDI_EVENT_TYPES = ["program_change", "control_change"] as const;
export type MidiEventTypeValue = (typeof MIDI_EVENT_TYPES)[number];

export const OWNERSHIP_SCOPES = ["GLOBAL", "TEAM", "USER"] as const;
export type OwnershipScopeValue = (typeof OWNERSHIP_SCOPES)[number];

export const SONGBOOK_KINDS = ["SIMPLE", "NUMBERED"] as const;
export type SongbookKindValue = (typeof SONGBOOK_KINDS)[number];

export const PUBLICATION_STATES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_CHANGES",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
  "ARCHIVED",
] as const;
export type PublicationStateValue = (typeof PUBLICATION_STATES)[number];

export const TEAM_ROLES = ["MEMBER", "ADMIN"] as const;
export type TeamRoleValue = (typeof TEAM_ROLES)[number];

export const DISPLAY_MODES = ["SINGER", "GUITAR", "PIANO", "UKULELE", "LEADER", "DRUMMER"] as const;
export type DisplayModeValue = (typeof DISPLAY_MODES)[number];

// What a user can say they do on a team (dashboard > Roles), shown next to
// their name in team member lists. Stored as these keys; labels come from
// the "roles" i18n section. Append new entries rather than renaming: stored
// values that drop off these lists are ignored on read. An admin adds others
// (Admin > Instruments, issue #166): those are stored by their id.
export const INSTRUMENTS = [
  "LEAD_VOCALS",
  "BACKING_VOCALS",
  "ACOUSTIC_GUITAR",
  "ELECTRIC_GUITAR",
  "BASS_GUITAR",
  "PIANO",
  "KEYBOARD",
  "ORGAN",
  "SYNTH",
  "DRUMS",
  "PERCUSSION",
  "VIOLIN",
  "VIOLA",
  "CELLO",
  "FLUTE",
  "CLARINET",
  "SAXOPHONE",
  "TRUMPET",
  "TROMBONE",
  "UKULELE",
  "MANDOLIN",
  "BANJO",
  "HARMONICA",
  // Issue #166.
  "HARP",
  "CELTIC_HARP",
  "TUBA",
  "DOUBLE_BASS",
  "ACCORDION",
  "CAJON",
] as const;
export type InstrumentValue = (typeof INSTRUMENTS)[number];

export const TECH_ROLES = ["TECHNICIAN", "MEDIA_OPERATOR", "SOUND_ENGINEER"] as const;
export type TechRoleValue = (typeof TECH_ROLES)[number];

// UI locales the app has translations for. French is first alongside the
// English default; add more here (and a matching packages/core/src/i18n
// dictionary) as new languages ship.
export const SUPPORTED_LOCALES = ["en", "fr"] as const;
export type LocaleValue = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: LocaleValue = "en";

// Seed tag category types (Section 10 of the spec). Admins can add more.
// `label` is the English fallback; `fr` seeds TagCategory.translations.
export const SEED_TAG_CATEGORIES = [
  { slug: "theme", label: "Theme", fr: "Thème" },
  { slug: "style", label: "Musical Style", fr: "Style musical" },
  { slug: "mood", label: "Mood / Energy", fr: "Ambiance" },
  { slug: "instrumentation", label: "Instrumentation", fr: "Instrumentation" },
] as const;

// Seed tuning presets (Section 22 of the spec).
export const SEED_TUNING_PRESETS = [
  { slug: "standard_guitar", name: "Standard", instrument: "GUITAR_STANDARD", notes: ["E", "A", "D", "G", "B", "E"], isDefault: true },
  { slug: "drop_d", name: "Drop D", instrument: "GUITAR_ALTERNATE", notes: ["D", "A", "D", "G", "B", "E"], isDefault: false },
  { slug: "dadgad", name: "DADGAD", instrument: "GUITAR_ALTERNATE", notes: ["D", "A", "D", "G", "A", "D"], isDefault: false },
  { slug: "open_g", name: "Open G", instrument: "GUITAR_ALTERNATE", notes: ["D", "G", "D", "G", "B", "D"], isDefault: false },
  { slug: "standard_ukulele", name: "Standard", instrument: "UKULELE_STANDARD", notes: ["G", "C", "E", "A"], isDefault: true },
] as const;

/**
 * Where Songverse's source is (AGPL-3.0, section 13: whoever uses it over
 * the network is offered it). A modified copy points this at its own.
 */
export const SOURCE_CODE_URL = "https://github.com/Vulcio/Oneverse";

/**
 * The colours a team or a songbook can be given (issue #161): a key each,
 * drawn by the apps in shades that read on light and dark themes.
 */
export const ENTITY_COLORS = ["red", "orange", "amber", "lime", "green", "teal", "sky", "blue", "violet", "pink"] as const;
export type EntityColor = (typeof ENTITY_COLORS)[number];

/** Its colour: the one chosen, else one derived from its name - the same everywhere, on every device. */
export function entityColor(color: string | null | undefined, name: string): EntityColor {
  if (color && (ENTITY_COLORS as readonly string[]).includes(color)) return color as EntityColor;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return ENTITY_COLORS[hash % ENTITY_COLORS.length]!;
}
