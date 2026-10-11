import { chordShapes, chordTones, shapeText } from "../chords/shapes.js";
import { pianoVoicings, songVoicings, voicingText } from "../chords/piano.js";
import { effectiveDisplaySettings, mergeDisplaySettings } from "../display/settings.js";
import { chordRowLabel, chordRowShowsShapes } from "../display/chord-rows.js";
import { prettyChord } from "../display/accidentals.js";
import { chartEdgeChords, degreeChord, transitionDegrees, transitionProgressions } from "../chords/transitions.js";
import { findProgression, parseProgressionQuery, progressionDegree, progressionGrams, progressionSimilarity, songProgressions } from "../chords/progressions.js";
import { chordFamily, diatonicChords, formatChord, keyUsesFlats, nashvilleChord, parseChord, romanChord, sameChord, simplifyChord, transposeChord } from "../chords/chord.js";
import { formatKey, parseKey, semitonesBetween, transposeKey } from "../music-keys/transpose.js";
import { parseArrangementDocumentV2, findArrangementProblems } from "../schemas/arrangement-document-v2.js";
import { chordPositionProblem } from "../schemas/song-document-v2.js";
import { arrangementFromChart, mapChartIds, remapArrangement } from "../song-document/fold.js";
import { chartChords, chartSeconds, renderChart, sectionChords } from "../song-document/render.js";
import { followChords, uniquePass, wordDiff } from "../song-document/pass.js";
import type { SectionInstance } from "../schemas/song-document-v2.js";
import { structureOf } from "../song-document/structure.js";
import { flowToChordPro, lineToInlineText, readSongDocument, sectionsFromText, songDocumentFromSections, songDocumentFromText, songFromText, songToChordPro } from "../song-document/text.js";
import { sectionHeading } from "../chordpro/section-labels.js";
import { beatAt, clicksBetween, normalizeMetronome, tapTempo } from "../metronome/index.js";
import { clockOffset, deviceTime, metronomePositionAt, stemsPositionAt } from "../sync/index.js";
import { cuesFromSections } from "../recording/cues.js";
import { lyricSlides, normalizeScreenCode, resolveScreenTheme, SCREEN_THEME_TEMPLATES, screenThemeContrast, sectionEnergy } from "../screens/index.js";
import { rankSongbookHits, songbookReferences } from "../songbook-references/index.js";
import { lyricsLines, lyricsSearchText, matchLyrics, parseLyricsQuery } from "../search-text/lyrics.js";
import { CreateSongVersionSchema, UpdateSongVersionSchema } from "../requests/songs.js";
import { AddSetlistItemSchema, CreateSetlistSchema } from "../requests/sets.js";
import { UpdateUserSchema } from "../requests/accounts.js";
import { checkRequest } from "../requests/messages.js";
import { AnswerEventDateSchema, CreateAwaySchema, CreateTeamEventSchema } from "../requests/events.js";
import { calendarFeed } from "../calendar/ical.js";
import { isPushEndpoint, notificationEmail, notificationPush, notificationPreferences, quietHoursEnd, notificationText, withNotificationChanges, type NotificationData, type NotificationKind } from "../notifications/index.js";
import enMessages from "../i18n/locales/en.js";
import frMessages from "../i18n/locales/fr.js";
import { coversPart, partCoverage, dayBeforeReminderDue, deadlineReminderDue, effectiveAnswer, eventDates, setListing, isPastDate, localDate, zonedInstant } from "../calendar/index.js";
import type { z } from "zod";

/**
 * The shared test cases (issue #170): what @songverse/core does, by area,
 * each function with the arguments it's tried with. The answers aren't
 * written here - they're this implementation's, written out by
 * `pnpm --filter @songverse/core conformance` to conformance/*.json, so a
 * change that alters one shows in the diff, for review. Add a case where
 * the behaviour matters to every client (the web app and the native apps,
 * #165): the song format, chords, the timeline, what the API accepts.
 */

export interface ConformanceFunction {
  about: string;
  params: string[];
  // The arguments come from JSON: each function reads its own.
  // oxlint-disable-next-line no-explicit-any
  run: (...args: any[]) => unknown;
  cases: { name: string; args: unknown[] }[];
}

export interface ConformanceArea {
  area: string;
  about: string;
  functions: Record<string, ConformanceFunction>;
}

// --- A song and an arrangement of it, the documents most cases use.

const SONG = {
  $schema: "song-document/v2",
  revision: 3,
  defaults: { key: "G", tempo: 72, timeSignature: { numerator: 4, denominator: 4 }, durationSeconds: 180 },
  sections: [
    {
      id: "sec_verse",
      type: "verse",
      label: null,
      showLabel: true,
      lines: [
        {
          id: "line_v1",
          kind: "lyric",
          text: "Amazing grace how sweet the sound",
          chords: [
            { id: "chd_v1", at: 0, raw: "G" },
            { id: "chd_v2", at: 18, raw: "G7" },
            { id: "chd_v3", at: 28, raw: "C" },
          ],
        },
        { id: "line_v2", kind: "note", text: "softly", chords: [] },
        {
          id: "line_v3",
          kind: "lyric",
          text: "That saved a wretch like me",
          chords: [
            { id: "chd_v4", at: 0, raw: "D/F#" },
            { id: "chd_v5", at: 20, raw: "Em7" },
          ],
        },
      ],
    },
    {
      id: "sec_chorus",
      type: "chorus",
      label: null,
      showLabel: true,
      lines: [
        {
          id: "line_c1",
          kind: "lyric",
          text: "I once was lost but now am found",
          chords: [
            { id: "chd_c1", at: 2, raw: "C" },
            { id: "chd_c2", at: 17, raw: "Dsus4" },
            { id: "chd_c3", at: 26, raw: "Bm7b5" },
          ],
        },
      ],
    },
  ],
  flow: [
    { id: "fi_verse", sectionId: "sec_verse" },
    { id: "fi_chorus", sectionId: "sec_chorus" },
    { id: "fi_chorus2", sectionId: "sec_chorus", label: "Chorus 2", keyChange: { steps: 2, key: "A" } },
  ],
};

const ARRANGEMENT = {
  $schema: "arrangement-document/v2",
  songVersionId: "song_1",
  songRevision: 3,
  defaults: { transposeSteps: -2, capo: 3 },
  items: [
    {
      id: "ai_1",
      sectionId: "sec_verse",
      overrides: [
        { type: "chord", chordId: "chd_v3", raw: "Cadd9" },
        { type: "hide_line", lineId: "line_v2" },
      ],
    },
    { id: "ai_2", sectionId: "sec_chorus", note: "all in", overrides: [{ type: "hide_chord", chordId: "chd_c3" }] },
    {
      id: "ai_3",
      sectionId: "sec_verse",
      label: "Verse 2",
      overrides: [
        { type: "lyric", lineId: "line_v1", text: "Twas grace that taught my heart to fear" },
        { type: "insert_line", afterLineId: "line_v3", line: { id: "ins_line_1", kind: "lyric", text: "Tag", chords: [{ id: "ins_chd_1", at: 0, raw: "G" }] } },
        { type: "chord", chordId: "chd_gone", raw: "A" },
      ],
    },
  ],
};

/** The song with passes of its own (issue #205): the verse's last line again, a chorus with its own words and chords, a pass a tone up, and references that are gone. */
const SONG_WITH_PASSES = {
  ...SONG,
  flow: [
    { id: "fi_verse", sectionId: "sec_verse" },
    {
      id: "fi_chorus",
      sectionId: "sec_chorus",
      chords: [
        { chordId: "chd_c1", raw: "Am" },
        { chordId: "chd_c3", raw: null },
      ],
      lyrics: [{ lineId: "line_c1", text: "I once was blind but now I see" }],
    },
    { id: "fi_verse_end", sectionId: "sec_verse", hiddenLines: ["line_v1", "line_v2"] },
    { id: "fi_chorus_up", sectionId: "sec_chorus", transpose: 2 },
    { id: "fi_missing", sectionId: "sec_verse", hiddenLines: ["line_gone"], lyrics: [{ lineId: "line_gone2", text: "x" }], chords: [{ chordId: "chd_gone", raw: "E" }] },
  ],
};

const read = (json: unknown) => readSongDocument(json);
const arrangement = (json: unknown) => parseArrangementDocumentV2(json);

/** A request body checked as the API checks it (checkRequest). */
const checked = (schema: z.ZodType) => (body: unknown) => checkRequest(schema, body);

export const CONFORMANCE: ConformanceArea[] = [
  {
    area: "keys",
    about: "Keys as written (\"G\", \"Bb\", \"F#m\"): read, written, moved by semitones.",
    functions: {
      parseKey: {
        about: "A key as written: its semitone from C and whether it's minor; null when it isn't one.",
        params: ["text"],
        run: parseKey,
        cases: ["C", "G", "Bb", "F#m", "Ebm", "Cb", "B#", "  a  ", "H", "", "Gmaj"].map((text) => ({ name: JSON.stringify(text), args: [text] })),
      },
      formatKey: {
        about: "A key from its semitone and mode, spelt as a key signature would.",
        params: ["key"],
        run: formatKey,
        cases: [
          ...[0, 1, 3, 6, 8, 10, 11].map((semitone) => ({ name: `major ${semitone}`, args: [{ semitone, minor: false }] })),
          ...[1, 3, 6, 10].map((semitone) => ({ name: `minor ${semitone}`, args: [{ semitone, minor: true }] })),
        ],
      },
      transposeKey: {
        about: "A key moved by semitones (negative goes down); null when it isn't a key.",
        params: ["key", "steps"],
        run: transposeKey,
        cases: [
          ["G", 2],
          ["G", -2],
          ["F", 1],
          ["Bb", 5],
          ["Em", 3],
          ["C#m", -1],
          ["E", 12],
          ["E", -13],
          ["nope", 1],
        ].map((args) => ({ name: args.join(" by "), args })),
      },
      semitonesBetween: {
        about: "The shortest way from one key to another, -5 to +6; null when either isn't a key.",
        params: ["from", "to"],
        run: semitonesBetween,
        cases: [
          ["G", "A"],
          ["A", "G"],
          ["C", "F#"],
          ["C", "G"],
          ["Em", "Gm"],
          ["G", "?"],
        ].map((args) => ({ name: args.join(" to "), args })),
      },
    },
  },
  {
    area: "chords",
    about: "Chord symbols as written: read, transposed (sharps or flats from the key), simplified, named in letters or solfège.",
    functions: {
      parseChord: {
        about: "A chord symbol read: its root, quality, seventh, extensions, alterations and bass; \"N.C.\" is no chord; null when it isn't a chord.",
        params: ["raw"],
        run: parseChord,
        cases: ["G", "Em7", "D/F#", "Cmaj7", "Bbm7b5", "F#dim7", "Gsus4", "Asus2", "C5", "Eaug", "C7#9", "Cadd9", "G6/B", "(Am)", "N.C.", "Hm", "verse", "",
          // As French books write them (issue #203).
          "G7maj", "C7M", "F#d", "C#7d", "A4", "Am4", "Asus", "Esus7", "F9/6", "C/9", "Ab+", "Bb9maj", "Bm7/5"].map((raw) => ({
          name: JSON.stringify(raw),
          args: [raw],
        })),
      },
      nashvilleChord: {
        about: "A chord as a Nashville number in a key (issue #207): root and bass as degrees of the key, the rest as written; a minor key counts from its own tonic; the chord as written without a key.",
        params: ["raw", "key"],
        run: nashvilleChord,
        cases: [
          ["G", "G"],
          ["Em7", "D"],
          ["D/F#", "D"],
          ["Bb", "C"],
          ["F#m7b5", "G"],
          ["Asus4", "A"],
          ["Em", "Em"],
          ["G", "Em"],
          ["B7", "Em"],
          ["(C)", "G"],
          ["Db", "Ab"],
          ["N.C.", "G"],
          ["G", null],
        ].map((args) => ({ name: `${args[0]} in ${args[1]}`, args })),
      },
      romanChord: {
        about: "A chord as a Roman numeral in a key (issue #220): the root counted from the key's tonic, in capitals when major and lowercase when minor or diminished; ° diminished, ø half-diminished, + augmented; extensions as written; a slash chord's bass as a degree; a minor key counts from its own tonic; the chord as written without a key.",
        params: ["raw", "key"],
        run: romanChord,
        cases: [
          ["D", "D"],
          ["Em7", "D"],
          ["A7", "D"],
          ["D/F#", "D"],
          ["Bb", "C"],
          ["F#m7b5", "G"],
          ["C#dim", "D"],
          ["Bdim7", "C"],
          ["A7sus4", "D"],
          ["Cmaj7", "C"],
          ["G9", "C"],
          ["Caug", "C"],
          ["C6/9", "C"],
          ["G7b9", "C"],
          ["G7maj", "G"],
          ["F#d", "G"],
          ["Em", "Em"],
          ["G", "Em"],
          ["(C)", "G"],
          ["N.C.", "G"],
          ["G", null],
        ].map((args) => ({ name: `${args[0]} in ${args[1]}`, args })),
      },
      chordFamily: {
        about: "A chord's family, for colouring it (issue #9): major, minor, suspended, diminished, augmented or dominant (a major triad with a minor seventh); null for a power chord or something that isn't a chord.",
        params: ["raw"],
        run: chordFamily,
        cases: ["G", "Gmaj7", "G6", "G7", "G13", "Em", "Em7", "Asus4", "A7sus4", "Bdim", "Bm7b5", "Caug", "C5", "N.C.", "verse"].map((raw) => ({ name: JSON.stringify(raw), args: [raw] })),
      },
      chordTones: {
        about: "A chord's notes, each with its interval above the root, its pitch class (C = 0), its role and whether a shape may leave it out; null when it isn't a chord.",
        params: ["chord"],
        run: chordTones,
        cases: ["C", "Am7", "G7", "Bm7b5", "Cmaj9", "A13", "Dsus4", "E7#9", "C/E", "D/C", "F#dim7", "C5", "N.C."].map((chord) => ({ name: JSON.stringify(chord), args: [chord] })),
      },
      chordShapes: {
        about:
          "Shapes for a chord on a guitar (EADGBE unless a tuning is given) or a ukulele (GCEA, high G unless given), easiest and most usual first (issue #207): per string the fret (0 open, null muted), the fingers, barres, the fret the diagram starts at and the MIDI notes it sounds. Every needed note and nothing else; on a guitar the bass is lowest; at most four fingers, a barre counting as one. Each client draws them its own way (docs/chord-diagrams.md).",
        params: ["chord", "instrument", "limit", "tuning"],
        run: chordShapes,
        cases: [
          ...["C", "G", "D", "Em", "F", "Bm", "B7", "Cmaj7", "Asus4", "D/F#", "Ab", "C#m", "A13", "E7#9", "C5"].map((chord) => ({ name: `guitar ${chord}`, args: [chord, "guitar", 3] })),
          ...["C", "F", "G", "Am", "E", "Bb", "Bm7", "D7"].map((chord) => ({ name: `ukulele ${chord}`, args: [chord, "ukulele", 3] })),
          { name: "not a chord", args: ["N.C.", "guitar", 3] },
          // Other tunings (issue #207 phase 3): shapes worked out for their strings.
          { name: "guitar in drop D: D", args: ["D", "guitar", 2, "drop-d"] },
          { name: "guitar in DADGAD: G", args: ["G", "guitar", 2, "dadgad"] },
          { name: "ukulele with a low G: C", args: ["C", "ukulele", 2, "low-g"] },
          { name: "baritone ukulele: G", args: ["G", "ukulele", 2, "baritone"] },
        ],
      },
      pianoVoicings: {
        about:
          "A chord's piano voicings (issue #207 phase 4): the right hand's notes in close position near middle C (MIDI 60), root position first then each inversion; the left hand's bass (the root, or a slash chord's bass) in the octave below - or the right hand only. Optional notes go when there'd be more than four.",
        params: ["chord", "options"],
        run: pianoVoicings,
        cases: [
          ...["C", "Am", "G7", "D/F#", "Cmaj9", "Bm7b5", "Csus4", "N.C."].map((chord) => ({ name: chord, args: [chord, {}] })),
          { name: "G7, right hand only", args: ["G7", { hands: "right" }] },
        ],
      },
      songVoicings: {
        about: "Which voicing of each chord a song plays: smooth, the inversion nearest the chord before (the hand hardly moves), from the first chord's root position; or root position throughout.",
        params: ["chords", "options"],
        run: songVoicings,
        cases: [
          { name: "C G Am F, smooth", args: [["C", "G", "Am", "F"], {}] },
          { name: "C G Am F, root position", args: [["C", "G", "Am", "F"], { smooth: false }] },
          { name: "a ii-V-I in C", args: [["Dm7", "G7", "Cmaj7"], {}] },
        ],
      },
      progressionDegree: {
        about: "A chord as a degree for finding songs by progression (issue #204): its triad only - no 7ths, extensions or slash bass - as a Nashville number in the key.",
        params: ["raw", "key"],
        run: progressionDegree,
        cases: [["G7/B", "G"], ["Em7", "G"], ["Cadd9", "G"], ["Dsus4", "G"], ["F", "G"], ["Bm7b5", "C"], ["(Am)", "C"], ["N.C.", "G"]].map((args) => ({ name: `${args[0]} in ${args[1]}`, args })),
      },
      songProgressions: {
        about: "Each section's progression in the song's key: chord changes in order, repeats collapsed; empty without a key.",
        params: ["song"],
        run: (song: unknown) => songProgressions(read(song)),
        cases: [{ name: "verse and chorus", args: [SONG] }],
      },
      progressionGrams: {
        about: "The runs of 3 and 4 chords in a song's sections, each section read as a loop, each run once: what songs are compared by.",
        params: ["sections"],
        run: progressionGrams,
        cases: [
          { name: "1 5 6m 4", args: [[{ degrees: ["1", "5", "6m", "4"] }]] },
          { name: "starting and ending on 1", args: [[{ degrees: ["1", "4", "5", "1"] }]] },
          { name: "back and forth only", args: [[{ degrees: ["1", "4"] }]] },
        ],
      },
      parseProgressionQuery: {
        about: "A progression typed to search with, as degrees: numbers, Roman numerals (lowercase minor), flats and sharps; a plain 2, 3 or 6 is minor. Null when it isn't one.",
        params: ["text"],
        run: parseProgressionQuery,
        cases: ["1 5 6m 4", "I V vi IV", "1-5-6-4", "6 4 1 5", "1 b7 4 1", "2m7 5 1", "ii V I", "1 5sus 5", "Amazing grace", "4"].map((text) => ({ name: JSON.stringify(text), args: [text] })),
      },
      findProgression: {
        about: "The sections whose chords, read as a loop, contain a progression in order.",
        params: ["sections", "query"],
        run: findProgression,
        cases: [
          { name: "in a loop", args: [[{ sectionId: "s1", type: "chorus", label: null, degrees: ["6m", "4", "1", "5"] }], ["1", "5", "6m", "4"]] },
          { name: "not there", args: [[{ sectionId: "s1", type: "verse", label: null, degrees: ["1", "4", "5"] }], ["1", "5", "6m", "4"]] },
        ],
      },
      progressionSimilarity: {
        about: "How alike two songs' runs are, 0 to 1: the shared ones over all, each weighted (here equally).",
        params: ["a", "b"],
        run: (a: string[], b: string[]) => progressionSimilarity(a, b),
        cases: [
          { name: "half shared", args: [["1-5-6m", "5-6m-4"], ["1-5-6m", "4-1-5"]] },
          { name: "nothing shared", args: [["1-4-5"], ["2m-5-1"]] },
        ],
      },
      transitionProgressions: {
        about: "The ways from one song into the next (issues #10, #217, #218), from the song's last chord into the next one's first (its 1 when not given): V7 → I, ii7 V7 → I, V7sus V7 → I (those three recommended), an altered V7, a diminished vii°7, a chord both keys share, a chromatic bass, the backdoor iv7 ♭VII7, and the stacked bass + sus + altered - each with its usual form and variations, as degrees of the next song's key and spelled in it. `fast` keeps the one-chord forms.",
        params: ["fromKey", "toKey", "options"],
        run: transitionProgressions,
        cases: [
          { name: "G into D", args: ["G", "D", {}] },
          { name: "G into A, a step up", args: ["G", "A", {}] },
          { name: "D into Em", args: ["D", "Em", {}] },
          { name: "Bb into F#, sharps", args: ["Bb", "F#", {}] },
          { name: "the same key", args: ["G", "G", {}] },
          { name: "C into Db, fast", args: ["C", "Db", { fast: true }] },
          { name: "from C into D, the eight ways", args: ["C", "D", { lastChord: "C", firstChord: "D" }] },
          { name: "no key", args: [null, "D", {}] },
          { name: "G into D, starting on Bm", args: ["G", "D", { firstChord: "Bm" }] },
          { name: "G into G, starting on its 4", args: ["G", "G", { firstChord: "C" }] },
          { name: "G into D, starting on D/F#", args: ["G", "D", { firstChord: "D/F#" }] },
          { name: "from E♭ into Bm, in D", args: ["Eb", "D", { lastChord: "Eb", firstChord: "Bm" }] },
          { name: "from A into Em, in G", args: ["A", "G", { lastChord: "A", firstChord: "Em" }] },
          { name: "from C into D, a step up", args: ["C", "D", { lastChord: "C", firstChord: "D" }] },
        ],
      },
      chartEdgeChords: {
        about: "A chart's first and last chords as played (sounding), where a set's transition starts and leads; nulls without chords.",
        params: ["chart"],
        run: chartEdgeChords,
        cases: [
          { name: "two passes", args: [{ passes: [{ lines: [{ chords: [{ sounding: "N.C." }, { sounding: "G" }, { sounding: "C" }] }] }, { lines: [{ chords: [{ sounding: "D" }] }, { chords: [] }] }] }] },
          { name: "no chords", args: [{ passes: [{ lines: [{ chords: [] }] }] }] },
        ],
      },
      degreeChord: {
        about: "A degree of a key as a chord: a flat degree spelled with flats, a sharp one with sharps, the others as the key is. Null when it isn't a degree.",
        params: ["degree", "key"],
        run: degreeChord,
        cases: [["2m7", "D"], ["57", "Eb"], ["b6", "D"], ["#4m7b5", "C"], ["1/3", "G"], ["b3", "Em"], ["57sus4", "F#"], ["8", "C"], ["2m", "H"]].map((args) => ({ name: `${args[0]} in ${args[1]}`, args })),
      },
      transitionDegrees: {
        about: "Chords typed for a transition, kept as degrees of the key it goes into; degrees typed are kept. Null when something isn't a chord or a degree.",
        params: ["text", "key"],
        run: transitionDegrees,
        cases: [["Em7 A7", "D"], ["2m7 57", "D"], ["Bb, C", "D"], ["Em7 hello", "D"], ["A7", "not a key"]].map((args) => ({ name: `${JSON.stringify(args[0])} into ${args[1]}`, args })),
      },
      voicingText: {
        about: "A voicing written down to keep a player's choice: left hand | right hand, as MIDI notes.",
        params: ["voicing"],
        run: voicingText,
        cases: [{ name: "C, both hands", args: [{ left: [48], right: [60, 64, 67] }] }, { name: "right hand only", args: [{ left: [], right: [64, 67, 72] }] }],
      },
      shapeText: {
        about: "A shape written as players write it: \"x32010\", a fret past 9 in parentheses.",
        params: ["shape"],
        run: shapeText,
        cases: [
          { name: "open C", args: [{ frets: [null, 3, 2, 0, 1, 0] }] },
          { name: "high up", args: [{ frets: [null, 10, 12, 12, 12, 10] }] },
        ],
      },
      transposeChord: {
        about: "A chord moved by semitones, spelt with sharps or flats as the target key uses; anything that isn't a chord is left as written.",
        params: ["raw", "steps", "targetKey"],
        run: transposeChord,
        cases: [
          ["G", 2, "A"],
          ["D/F#", 2, "A"],
          ["Em7", 1, "F"],
          ["Bb", 1, null],
          ["C", -1, "B"],
          ["C", 1, "Db"],
          ["F#m7b5", -2, "E"],
          ["N.C.", 3, "C"],
          // A key written with a sharp keeps sharps (a guitarist's capo 3 shapes in A).
          ["A", -3, "F#"],
          ["E", -3, "C#"],
          ["(Am)", 5, "D"],
          ["verse", 2, "A"],
          ["G", 0, "G"],
          ["G", 12, "G"],
        ].map((args) => ({ name: `${args[0]} by ${args[1]} to ${args[2]}`, args })),
      },
      keyUsesFlats: {
        about: "Whether chords in this key are spelt with flats.",
        params: ["key"],
        run: keyUsesFlats,
        cases: ["F", "Bb", "Eb", "Dm", "Gm", "G", "D", "Em", "C", "Am", "F#", "C#", "C#m", "Gb", "Db", "Ebm", null].map((key) => ({ name: String(key), args: [key] })),
      },
      formatChord: {
        about: "A chord named in letters (\"english\", as written) or solfège (\"solfege\": Do, Ré, Mi…).",
        params: ["raw", "notation"],
        run: formatChord,
        cases: ["G", "Em7", "D/F#", "Bbmaj7", "C#m", "N.C."].flatMap((raw) => [
          { name: `${raw} in solfège`, args: [raw, "solfege"] },
          { name: `${raw} in letters`, args: [raw, "english"] },
        ]),
      },
      simplifyChord: {
        about: "A chord made easier: only its triad (dropExtensions), without its bass note (dropBass).",
        params: ["raw", "options"],
        run: simplifyChord,
        cases: [
          ["Gmaj7", { dropExtensions: true }],
          ["Em7", { dropExtensions: true }],
          ["Bm7b5", { dropExtensions: true }],
          ["Csus4", { dropExtensions: true }],
          ["Cadd9", { dropExtensions: true }],
          ["D/F#", { dropBass: true }],
          ["Am7/G", { dropExtensions: true, dropBass: true }],
          ["G", {}],
        ].map((args) => ({ name: `${args[0]} ${JSON.stringify(args[1])}`, args })),
      },
      sameChord: {
        about: "Whether two symbols are the same chord, however written.",
        params: ["a", "b"],
        run: sameChord,
        cases: [
          ["G", "G"],
          ["Gmaj", "G"],
          ["F#", "Gb"],
          ["Em7", "Emin7"],
          ["G", "G/B"],
          ["C", "Cm"],
        ].map((args) => ({ name: args.join(" and "), args })),
      },
      diatonicChords: {
        about: "The chords of a key, I to vii, for the chord palette.",
        params: ["key"],
        run: diatonicChords,
        cases: ["G", "F", "Em", "Bb", null].map((key) => ({ name: String(key), args: [key] })),
      },
    },
  },
  {
    area: "song-document",
    about: "SongDocument v2 (docs/song-document-v2.md): reading a stored one, and a song after its text or sections were edited - IDs kept for what's still there, the revision moved on.",
    functions: {
      readSongDocument: {
        about: "A stored song document, checked and with its defaults filled in; anything else fails.",
        params: ["json"],
        run: read,
        cases: [
          { name: "a song", args: [SONG] },
          {
            name: "lines and sections with what's left out filled in",
            args: [{ $schema: "song-document/v2", revision: 1, defaults: {}, sections: [{ id: "sec_a", type: "verse", lines: [{ id: "line_a", text: "Hello" }] }], flow: [] }],
          },
          { name: "not v2", args: [{ $schema: "song-document/v1", sections: [] }] },
          { name: "nothing", args: [null] },
          {
            name: "a chord past the end of its line",
            args: [{ ...SONG, sections: [{ id: "sec_a", type: "verse", lines: [{ id: "line_a", kind: "lyric", text: "Hi", chords: [{ id: "chd_a", at: 5, raw: "G" }] }] }], flow: [] }],
          },
          {
            name: "a note with a chord",
            args: [{ ...SONG, sections: [{ id: "sec_a", type: "verse", lines: [{ id: "line_a", kind: "note", text: "x2", chords: [{ id: "chd_a", at: 0, raw: "G" }] }] }], flow: [] }],
          },
          { name: "a section type that doesn't exist", args: [{ ...SONG, sections: [{ id: "sec_a", type: "solo-ish", lines: [] }], flow: [] }] },
        ],
      },
      chordPositionProblem: {
        about: "Why a line's chords can't be where they are (past its end, inside a character, out of order), or null.",
        params: ["text", "chords"],
        run: chordPositionProblem,
        cases: [
          { name: "fine", args: ["Amazing grace", [{ at: 0 }, { at: 8 }, { at: 13 }]] },
          { name: "past the end", args: ["Hi", [{ at: 3 }]] },
          { name: "out of order", args: ["Amazing", [{ at: 4 }, { at: 2 }]] },
          { name: "inside an emoji (UTF-16)", args: ["a🎵b", [{ at: 2 }]] },
          { name: "after an emoji", args: ["a🎵b", [{ at: 3 }]] },
        ],
      },
      songDocumentFromText: {
        about:
          "The song after its content was edited as text (CHORDPRO, CHORDS_OVER_LYRICS or RAW_TEXT): IDs kept from the previous song where the content is still there, new ones made for the rest (\"sec_@1\"), the revision moved on.",
        params: ["previous", "change"],
        run: (previous: unknown, change: Parameters<typeof songDocumentFromText>[1]) => songDocumentFromText(previous ? read(previous) : null, change),
        cases: [
          { name: "a new song from ChordPro", args: [null, { content: "{start_of_verse}\n[G]Amazing [C]grace\n{end_of_verse}\n{start_of_chorus}\n[D]I once was lost\n{end_of_chorus}\n{chorus}\n", format: "CHORDPRO", defaults: { key: "G" } }] },
          { name: "chords over lyrics", args: [null, { content: "[Verse]\nG       C\nAmazing grace\n\n[Chorus]\nD\nI once was lost\n", format: "CHORDS_OVER_LYRICS" }] },
          { name: "plain lyrics", args: [null, { content: "Amazing grace\nhow sweet the sound\n\nI once was lost\n", format: "RAW_TEXT" }] },
          {
            name: "one chord changed: every ID kept",
            args: [SONG, { content: "{start_of_verse}\n[G]Amazing grace how [G7]sweet the [Cadd9]sound\n{comment: softly}\n[D/F#]That saved a wretch [Em7]like me\n{end_of_verse}\n{start_of_chorus}\nI [C]once was lost but [Dsus4]now am [Bm7b5]found\n{end_of_chorus}\n", format: "CHORDPRO" }],
          },
          {
            name: "a line added to the chorus",
            args: [SONG, { content: "{start_of_verse}\n[G]Amazing grace how [G7]sweet the [C]sound\n{comment: softly}\n[D/F#]That saved a wretch [Em7]like me\n{end_of_verse}\n{start_of_chorus}\nI [C]once was lost but [Dsus4]now am [Bm7b5]found\nWas [G]blind but now I see\n{end_of_chorus}\n", format: "CHORDPRO" }],
          },
          { name: "only the key changed", args: [SONG, { format: "CHORDPRO", defaults: { key: "A" } }] },
        ],
      },
      songDocumentFromSections: {
        about: "The song after the structured editor changed its sections or flow: taken as they are, the flow following the sections when not given, the revision moved on.",
        params: ["previous", "change"],
        run: (previous: unknown, change: Parameters<typeof songDocumentFromSections>[1]) => songDocumentFromSections(previous ? read(previous) : null, change),
        cases: [
          { name: "the chorus dropped: the flow follows", args: [SONG, { sections: [SONG.sections[0]] }] },
          { name: "a new flow", args: [SONG, { flow: [{ id: "fi_chorus", sectionId: "sec_chorus" }, { id: "fi_verse", sectionId: "sec_verse" }] }] },
        ],
      },
      lineToInlineText: {
        about: "A line with its chords inline, as ChordPro writes it.",
        params: ["line"],
        run: lineToInlineText,
        cases: [
          { name: "a lyric", args: [SONG.sections[0]!.lines[0]] },
          { name: "a note", args: [SONG.sections[0]!.lines[1]] },
          { name: "chords only", args: [{ id: "line_x", kind: "lyric", text: "", chords: [{ id: "chd_x", at: 0, raw: "G" }, { id: "chd_y", at: 0, raw: "C" }] }] },
        ],
      },
    },
  },
  {
    area: "chordpro",
    about: "ChordPro and the other text formats, only for import and export: songs aren't stored that way.",
    functions: {
      sectionsFromText: {
        about: "Pasted or typed text as sections, with new IDs.",
        params: ["text", "format"],
        run: sectionsFromText,
        cases: [
          { name: "ChordPro with a comment and a label", args: ["{start_of_verse: Verse 2}\n[Am]Hello [F]world\n{comment: x2}\n{end_of_verse}\n{soc}\n[C]La la\n{eoc}\n", "CHORDPRO"] },
          { name: "ChordPro's short directives", args: ["{sov}\n[G]One\n{eov}\n{sob}\n[D]Two\n{eob}\n", "CHORDPRO"] },
          { name: "chords over lyrics, chords above the right letters", args: ["Verse 1:\n  G        D/F#   Em\nAmazing grace how sweet\n\nChorus:\nC      G\nI once was lost\n", "CHORDS_OVER_LYRICS"] },
          { name: "a line of chords only", args: ["[Intro]\nG  D  Em  C\n", "CHORDS_OVER_LYRICS"] },
          { name: "plain lyrics: a section per paragraph", args: ["One\nTwo\n\nThree\n", "RAW_TEXT"] },
          { name: "labels in other languages", args: ["Strophe 1\n[G]Un\n\nRefrain\n[C]Deux\n\nPuente:\n[D]Tres\n", "CHORDS_OVER_LYRICS"] },
        ],
      },
      songFromText: {
        about:
          "A file imported (mergeRepeats: a section written out again is sung again, not kept twice): its sections, the order they're sung in, the key it starts in, and a copyright line before the first section. A comment naming a section (\"Strophe 2\", \"Refrain\", \"Pont\") sets the type and label of the one after it, and a \"2. \" numbering its first line is dropped; the site's address and a comment saying the key changes are left out.",
        params: ["text", "format", "options"],
        run: songFromText,
        cases: [
          {
            name: "a songbook's file",
            args: [
              "{t: Christ a triomphé}\n{c: © 2020 Rolf Schneider}\n{c: https://www.example.org – 1143}\n{key: C}\n\n{c: Strophe 1}\n{start_of_verse}\n1. Des [C]ténèbres il s'est levé,\n{end_of_verse}\n\n{c: Refrain}\n{start_of_chorus}\nOh ! [F]mort\n{end_of_chorus}\n\n{c: Pont}\n{start_of_verse}\n[Am]Sur son corps\n{end_of_verse}\n\n{c: Strophe 2}\n{start_of_verse}\n2. Après [C]la peur\n{end_of_verse}\n\n{c: Refrain}\n{start_of_chorus}\nOh ! [F]mort\n{end_of_chorus}\n\n{key: D}\n{c: Changement de tonalité : D}\n\n{c: Fin}\n{start_of_chorus}\nOh ! [G]mort\n{end_of_chorus}\n",
              "CHORDPRO",
              { mergeRepeats: true },
            ],
          },
          { name: "a note before a section stays its note", args: ["{c: Softly}\n{start_of_verse}\n[G]One\n{end_of_verse}\n", "CHORDPRO", {}] },
          { name: "without mergeRepeats, a section written twice stays twice", args: ["{soc}\n[C]La\n{eoc}\n{soc}\n[C]La\n{eoc}\n", "CHORDPRO", {}] },
        ],
      },
      sectionHeading: {
        about: "Whether a line only names a section, in the languages songs come in: its type and its number or letter.",
        params: ["text"],
        run: sectionHeading,
        cases: ["Verse 2", "[Chorus]", "Bridge:", "Strophe 2a", "Refrain", "Pont b", "Pré-refrain", "Coro", "Estribillo 2", "Fin", "Introduction", "Amazing grace", "Allemand.1"].map((text) => ({
          name: JSON.stringify(text),
          args: [text],
        })),
      },
      songToChordPro: {
        about: "A song as a ChordPro file, with its details.",
        params: ["song", "details"],
        run: (song: unknown, details: Parameters<typeof songToChordPro>[1]) => songToChordPro(read(song), details),
        cases: [
          { name: "with its details", args: [SONG, { title: "Amazing Grace", artists: ["John Newton"], composers: ["Traditional"], capo: 2, ccli: "4755360", year: 1779, copyright: "Public domain" }] },
          { name: "a title only", args: [SONG, { title: "Amazing Grace" }] },
        ],
      },
      flowToChordPro: {
        about: "The order a song is sung in, as ChordPro: a section again is a reference to it.",
        params: ["song"],
        run: (song: unknown) => flowToChordPro(read(song)),
        cases: [
          { name: "verse, chorus, chorus", args: [SONG] },
          { name: "passes of their own, written out in full", args: [SONG_WITH_PASSES] },
        ],
      },
    },
  },
  {
    area: "chart",
    about:
      "A song played as its arrangement says, seen through a reader's choices: what every client shows. Transposition, capo shapes, solfège, simpler chords, the arrangement's changes; references the song no longer has are kept as problems, never dropped.",
    functions: {
      renderChart: {
        about:
          "The chart: each pass of the flow (or of the arrangement) with its lines and chords - each shown (label), as it sounds and as a guitarist frets it with the capo (for chord diagrams) - its key and whether the arrangement changes it.",
        params: ["song", "arrangement", "view"],
        run: (song: unknown, arr: unknown, view: Parameters<typeof renderChart>[2]) => renderChart(read(song), arr ? arrangement(arr) : null, view),
        cases: [
          { name: "as written", args: [SONG, null, {}] },
          { name: "a set's own transposition, in solfège", args: [SONG, null, { transposeSteps: 3, notation: "solfege" }] },
          { name: "Nashville numbers, the same with a capo", args: [SONG, null, { notation: "nashville", suggestedCapo: 2, capoDisplay: "shapes" }] },
          { name: "Roman numerals, the same with a capo", args: [SONG, null, { notation: "roman", suggestedCapo: 2, capoDisplay: "shapes" }] },
          { name: "the song's capo suggestion, as shapes", args: [SONG, null, { suggestedCapo: 2, capoDisplay: "shapes" }] },
          { name: "simpler chords, no bass notes, a hidden chord", args: [SONG, null, { preferences: { simplifyChords: true, hideBassNotes: true, hiddenChordIds: ["chd_v2"] } }] },
          { name: "an arrangement", args: [SONG, ARRANGEMENT, {}] },
          { name: "passes of their own: lines left out, their own words and chords, a tone up, and references that are gone", args: [SONG_WITH_PASSES, null, {}] },
          { name: "an arrangement with its capo, as shapes", args: [SONG, ARRANGEMENT, { capoDisplay: "shapes" }] },
        ],
      },
      effectiveDisplaySettings: {
        about: "A mode's display settings (issue #209): what the Display panel changed for that mode, else the account's chord settings, else a default (Live's text bigger).",
        params: ["account", "saved", "mode"],
        run: effectiveDisplaySettings,
        cases: [
          { name: "nothing changed: the account's, Live bigger", args: [{ chordNotation: "SOLFEGE", chordDiagrams: "GUITAR" }, {}, "LIVE"] },
          { name: "Practice changed its names and size", args: [{ chordNotation: "SOLFEGE" }, { PRACTICE: { chordNotation: "NASHVILLE", textSize: 1.25 }, LIVE: { font: "sans" } }, "PRACTICE"] },
          { name: "chords set apart from the lyrics", args: [null, { LIVE: { textSize: 1.25, chordSize: 2 } }, "LIVE"] },
          { name: "a second row of chords, the capo's shapes, the rest by default", args: [null, { LIVE: { secondRow: { source: "FINGERED", position: "beside" } } }, "LIVE"] },
          { name: "the main row in Nashville numbers, in its own colour and font", args: [{ chordColors: true }, { PRACTICE: { chordNotation: "NASHVILLE", chordColor: "#ff8800", chordFont: "sans", chordWeight: "normal" } }, "PRACTICE"] },
          { name: "a second row side by side, with a wider gap", args: [null, { LIVE: { secondRow: { names: "ROMAN", position: "right", gap: 0.5 } } }, "LIVE"] },
          { name: "a second row turned off keeps its settings", args: [null, { LIVE: { secondRow: { on: false, names: "ROMAN", position: "above" } } }, "LIVE"] },
          { name: "colours by chord type from the account", args: [{ chordColors: true }, null, "LIVE"] },
          { name: "diagrams docked at the bottom", args: [{ chordDiagrams: "GUITAR" }, { LIVE: { diagramsPosition: "bottom" } }, "LIVE"] },
          { name: "Live's controls floating, some hidden", args: [null, { LIVE: { controls: "floating", controlsPosition: "right", hiddenControls: ["metronome", "transpose"], controlsOpacity: 0.4 } }, "LIVE"] },
          { name: "no account settings", args: [null, null, "EDIT"] },
        ],
      },
      mergeDisplaySettings: {
        about: "Changes merged into a user's display settings, mode by mode: a value replaces, null goes back to the account's, a field left out stays.",
        params: ["saved", "changes"],
        run: mergeDisplaySettings,
        cases: [
          { name: "one field changed, one cleared", args: [{ LIVE: { textSize: 2, font: "sans" } }, { LIVE: { textSize: 2.5, font: null } }] },
          { name: "the last one cleared: the mode gone", args: [{ EDIT: { hideChords: true } }, { EDIT: { hideChords: null }, PRACTICE: { columns: "2" } }] },
        ],
      },
      chartChords: {
        about: "The chords a chart plays, each once, in the order they first come (a strip of chord diagrams): as a guitarist frets them with the capo, or as they sound.",
        params: ["song", "view", "as"],
        run: (song: unknown, view: Parameters<typeof renderChart>[2], as: "fretted" | "sounding") => chartChords(renderChart(read(song), null, view), as),
        cases: [
          { name: "as they sound", args: [SONG, {}, "sounding"] },
          { name: "fretted with the capo on 2", args: [SONG, { suggestedCapo: 2 }, "fretted"] },
        ],
      },
      wordDiff: {
        about: "How a linked copy's words differ from its section's (issue #205), word by word: kept, removed (shown greyed out) or added.",
        params: ["before", "after"],
        run: wordDiff,
        cases: [
          { name: "a word replaced", args: ["I once was lost but now am found", "I once was blind but now am found"] },
          { name: "words removed", args: ["My chains are gone, I've been set free", "My chains are gone"] },
          { name: "a word added", args: ["Amazing grace", "Amazing, amazing grace"] },
          { name: "the same", args: ["Grace", "Grace"] },
        ],
      },
      followChords: {
        about: "A line's chords over a copy's new words: on their character where the word is kept, at the start of what replaced their word, or at the next kept word when theirs is removed.",
        params: ["before", "after", "chords"],
        run: followChords,
        cases: [
          { name: "a word replaced before a chord", args: ["I once was lost but now am found", "I once was blind but now am found", [{ id: "a", at: 2 }, { id: "b", at: 17 }, { id: "c", at: 26 }]] },
          { name: "a chord on a replaced word", args: ["I once was lost but now am found", "I once was blind but now am found", [{ id: "a", at: 11 }]] },
          { name: "a chord on a removed word", args: ["My chains are gone now", "My chains now", [{ id: "a", at: 14 }]] },
        ],
      },
      uniquePass: {
        about: "A linked copy made unique: a section of its own with new IDs, its lines left out, its words and chords written in, its chords moved by its transposition (spelt in the key it reaches).",
        params: ["section", "pass", "key"],
        run: (section: unknown, pass: SectionInstance, key: string | null) => {
          let n = 0;
          return uniquePass(read({ ...SONG, sections: [section], flow: [] }).sections[0]!, pass, key, (kind) => `${kind}_new${++n}`);
        },
        cases: [
          {
            name: "words, a chord and a line, a tone up",
            args: [
              SONG.sections[0],
              { id: "fi_x", sectionId: "sec_verse", transpose: 2, hiddenLines: ["line_v2"], lyrics: [{ lineId: "line_v1", text: "Amazing love how sweet the sound" }], chords: [{ chordId: "chd_v2", raw: "Em" }, { chordId: "chd_v5", raw: null }] },
              "G",
            ],
          },
        ],
      },
      sectionChords: {
        about: "Each pass's chords, once each, in the order they come (issue #212): diagrams beside a section, or docked for the section being played.",
        params: ["song", "view", "as"],
        run: (song: unknown, view: Parameters<typeof renderChart>[2], as: "fretted" | "sounding") => renderChart(read(song), null, view).passes.map((pass) => sectionChords(pass, as)),
        cases: [
          { name: "as they sound", args: [SONG, {}, "sounding"] },
          { name: "fretted with the capo on 2", args: [SONG, { suggestedCapo: 2 }, "fretted"] },
        ],
      },
      structureOf: {
        about: "The structure bar: each pass's type, its number among those of its type, and its group.",
        params: ["song", "arrangement"],
        run: (song: unknown, arr: unknown) => structureOf(renderChart(read(song), arr ? arrangement(arr) : null)),
        cases: [
          { name: "the song's flow", args: [SONG, null] },
          { name: "an arrangement", args: [SONG, ARRANGEMENT] },
        ],
      },
      chartSeconds: {
        about: "How long the chart lasts, for autoscroll: the song's duration, or worked out from its tempo.",
        params: ["song", "durationSeconds"],
        run: (song: unknown, duration: number | null) => chartSeconds(renderChart(read(song)), duration),
        cases: [
          { name: "a duration given", args: [SONG, 200] },
          { name: "none given", args: [SONG, null] },
        ],
      },
    },
  },
  {
    area: "arrangements",
    about: "Arrangements following a song: checked against it, and pointed at another song's IDs when one song is folded into another (issue #75).",
    functions: {
      findArrangementProblems: {
        about: "What an arrangement refers to that the song doesn't have.",
        params: ["arrangement", "song"],
        run: (arr: unknown, song: unknown) => findArrangementProblems(arrangement(arr), read(song)),
        cases: [{ name: "a chord that's gone", args: [ARRANGEMENT, SONG] }],
      },
      mapChartIds: {
        about: "One song's section, line and chord IDs mapped to another's: the same ID where both have it, otherwise by content.",
        params: ["from", "to"],
        run: (from: unknown, to: unknown) => mapChartIds(read(from), read(to)),
        cases: [
          { name: "the same song", args: [SONG, SONG] },
          {
            name: "a copy with other IDs",
            args: [
              SONG,
              {
                ...SONG,
                sections: SONG.sections.map((section, s) => ({
                  ...section,
                  id: `sec_copy${s}`,
                  lines: section.lines.map((line, l) => ({ ...line, id: `line_copy${s}${l}`, chords: line.chords.map((chord, c) => ({ ...chord, id: `chd_copy${s}${l}${c}` })) })),
                })),
                flow: [],
              },
            ],
          },
        ],
      },
      remapArrangement: {
        about: "An arrangement pointed at another song through a map (as mapChartIds gives, its Maps as objects); what doesn't map is left, and songRevision 0 asks for a review.",
        params: ["arrangement", "map", "songVersionId"],
        run: (arr: unknown, map: Record<"sections" | "lines" | "chords", Record<string, string>>, songVersionId: string) =>
          remapArrangement(arrangement(arr), { sections: new Map(Object.entries(map.sections)), lines: new Map(Object.entries(map.lines)), chords: new Map(Object.entries(map.chords)) }, songVersionId),
        cases: [
          {
            name: "to a copy",
            args: [ARRANGEMENT, { sections: { sec_verse: "sec_copy0", sec_chorus: "sec_copy1" }, lines: { line_v1: "line_copy00", line_v2: "line_copy01", line_v3: "line_copy02" }, chords: { chd_v3: "chd_copy002", chd_c3: "chd_copy102" } }, "song_2"],
          },
        ],
      },
      arrangementFromChart: {
        about: "How one song is sung, as an arrangement of another (its owner's version, kept when folded): the key difference as transposeSteps, chords and lines changed as overrides, IDs mapped with mapChartIds; null when sung the same.",
        params: ["from", "to", "songVersionId"],
        run: (from: unknown, to: unknown, songVersionId: string) => {
          const a = read(from);
          const b = read(to);
          return arrangementFromChart(a, b, mapChartIds(a, b), songVersionId);
        },
        cases: [
          { name: "the same song", args: [SONG, SONG, "song_2"] },
          {
            name: "in A, with a chord changed",
            args: [
              {
                ...SONG,
                defaults: { ...SONG.defaults, key: "A" },
                sections: [
                  {
                    ...SONG.sections[0],
                    lines: [{ ...SONG.sections[0]!.lines[0], chords: [{ id: "chd_v1", at: 0, raw: "A" }, { id: "chd_v2", at: 18, raw: "A7" }, { id: "chd_v3", at: 28, raw: "Dmaj7" }] }, ...SONG.sections[0]!.lines.slice(1)],
                  },
                  SONG.sections[1],
                ],
              },
              SONG,
              "song_2",
            ],
          },
        ],
      },
    },
  },
  {
    area: "timeline",
    about:
      "The metronome and sync play's timeline (issue #13): only \"beat N at server time T\" crosses the network, and each device plays it on its own clock. Positions are in beats from the start, count-in included; times in ms.",
    functions: {
      clockOffset: {
        about: "The server's clock less the device's, from the ping with the shortest round trip; null with none usable.",
        params: ["samples"],
        run: clockOffset,
        cases: [
          { name: "the quickest of three", args: [[{ sent: 1000, at: 5060, received: 1100 }, { sent: 2000, at: 6015, received: 2020 }, { sent: 3000, at: 7090, received: 3200 }]] },
          { name: "a sample from the future is left out", args: [[{ sent: 1000, at: 5000, received: 900 }, { sent: 2000, at: 6010, received: 2020 }]] },
          { name: "none", args: [[]] },
        ],
      },
      deviceTime: {
        about: "A server time on this device's clock.",
        params: ["serverTime", "offset"],
        run: deviceTime,
        cases: [
          { name: "server ahead", args: [10_000, 4_000] },
          { name: "server behind", args: [10_000, -250.5] },
        ],
      },
      metronomePositionAt: {
        about: "Where the leader's metronome is at a server time: on from its anchor at the tempo while playing.",
        params: ["metronome", "serverTime"],
        run: metronomePositionAt,
        cases: [
          { name: "120 bpm, 1.5 s on", args: [{ settings: { tempo: 120 }, playing: true, anchorAt: 10_000, anchorPosition: 4 }, 11_500] },
          { name: "72 bpm, before its anchor", args: [{ settings: { tempo: 72 }, playing: true, anchorAt: 10_000, anchorPosition: 8 }, 9_000] },
          { name: "stopped", args: [{ settings: { tempo: 120 }, playing: false, anchorAt: 0, anchorPosition: 6 }, 99_999] },
        ],
      },
      stemsPositionAt: {
        about: "Seconds into the leader's recording at a server time: on from its anchor at its speed while playing, in the recording's own time.",
        params: ["stems", "serverTime"],
        run: stemsPositionAt,
        cases: [
          { name: "at full speed", args: [{ playing: true, position: 30, anchorAt: 10_000 }, 12_500] },
          { name: "at 80%", args: [{ playing: true, position: 30, anchorAt: 10_000, speed: 0.8 }, 12_500] },
          { name: "paused", args: [{ playing: false, position: 42.5, anchorAt: 0 }, 12_500] },
        ],
      },
      normalizeMetronome: {
        about: "Metronome settings made whole and within bounds: the tempo 20-300, a beat level per beat of the bar.",
        params: ["input"],
        run: normalizeMetronome,
        cases: [
          { name: "nothing", args: [null] },
          { name: "6/8", args: [{ tempo: 90, numerator: 6, denominator: 8 }] },
          { name: "too fast, beats missing", args: [{ tempo: 999, numerator: 3, beats: ["accent"] }] },
        ],
      },
      beatAt: {
        about: "The bar (negative in the count-in), beat and fraction at a position.",
        params: ["settings", "position"],
        run: beatAt,
        cases: [
          { name: "the start", args: [{ numerator: 4, countIn: 0 }, 0] },
          { name: "bar 2, beat 3 and a half", args: [{ numerator: 4, countIn: 0 }, 6.5] },
          { name: "in a bar of count-in", args: [{ numerator: 4, countIn: 1 }, 2] },
          { name: "after the count-in", args: [{ numerator: 3, countIn: 2 }, 7] },
        ],
      },
      clicksBetween: {
        about: "The clicks from one position (included) to another (not): accents, muted beats, subdivisions, count-in.",
        params: ["settings", "from", "to"],
        run: (settings: unknown, from: number, to: number) => clicksBetween(normalizeMetronome(settings as never), from, to),
        cases: [
          { name: "a bar of 4/4", args: [{ tempo: 100, numerator: 4 }, 0, 4] },
          { name: "eighths, a muted beat", args: [{ tempo: 100, numerator: 4, subdivision: 2, beats: ["accent", "mute", "normal", "normal"] }, 0, 2] },
          { name: "a bar of count-in, count-in only", args: [{ tempo: 100, numerator: 2, countIn: 1, countInOnly: true }, 0, 4] },
        ],
      },
      cuesFromSections: {
        about:
          "A recording's sections as an analyser labels them (issue #175), placed on the song's: each label on the next pass of that kind in the flow; one sung more often than written on the last of its kind placed; two choruses in a row two cues; labels it can't place left out.",
        params: ["found", "song"],
        run: (found: Parameters<typeof cuesFromSections>[0], song: unknown) => cuesFromSections(found, read(song)),
        cases: [
          {
            name: "verse, chorus, the chorus again",
            args: [[{ start: 0, label: "start" }, { start: 1.234, label: "verse" }, { start: 20, label: "chorus" }, { start: 35, label: "chorus" }, { start: 50, label: "chorus" }, { start: 60, label: "end" }], SONG],
          },
          { name: "labels in capitals, out of order, an instrumental the song hasn't", args: [[{ start: 30, label: "Chorus" }, { start: 2, label: "VERSE" }, { start: 15, label: "inst" }], SONG] },
          { name: "nothing it can place", args: [[{ start: 0, label: "start" }, { start: 5, label: "bridge" }], SONG] },
        ],
      },
      tapTempo: {
        about: "The tempo from taps (ms); null with too few.",
        params: ["taps"],
        run: tapTempo,
        cases: [
          { name: "steady at 120", args: [[0, 500, 1000, 1500, 2000]] },
          { name: "uneven", args: [[0, 480, 1010, 1490]] },
          { name: "one tap", args: [[0]] },
        ],
      },
    },
  },
  {
    area: "screens",
    about:
      "A set on a big screen (issue #186): the leader and each screen cut a song into the same slides, so only \"this song, slide N\" crosses the network; and the code a screen is paired by.",
    functions: {
      lyricSlides: {
        about: "A chart's sung lines, `size` at a time, pass by pass: no notes, no line without words; a pass without words is one empty slide.",
        params: ["song", "arrangement", "size"],
        run: (song: unknown, arr: unknown, size: number) => lyricSlides(renderChart(read(song), arr ? arrangement(arr) : null), size),
        cases: [
          { name: "two lines at a time, as written", args: [SONG, null, 2] },
          { name: "one at a time", args: [SONG, null, 1] },
          { name: "an arrangement: changed words, an inserted line", args: [SONG, ARRANGEMENT, 2] },
        ],
      },
      resolveScreenTheme: {
        about:
          "A screen theme as every client reads it (issue #194, docs/screen-theme-v1.md): what it says over the defaults; a part it can't read falls back to that part's defaults, a field it doesn't know is ignored, and anything that isn't a theme is the default look.",
        params: ["input"],
        run: resolveScreenTheme,
        cases: [
          { name: "nothing: the default look", args: [{}] },
          { name: "a few fields: the rest default", args: [{ text: { font: "elegant", upperCase: true }, motion: { transition: "blur", reveal: "words" } }] },
          { name: "a bad colour: that part's defaults, the rest kept", args: [{ text: { color: "red", font: "serif" }, background: { kind: "aurora", colors: ["#000000", "#6d28d9"] } }] },
          { name: "a field from a later version: ignored", args: [{ background: { kind: "waves", shimmer: true }, future: { x: 1 } }] },
          { name: "not a theme", args: ["concert"] },
        ],
      },
      screenThemeTemplates: {
        about: "The built-in themes, by id, in full: a client that offers them shows these.",
        params: ["id"],
        run: (id: string) => SCREEN_THEME_TEMPLATES.find((one) => one.id === id)?.theme ?? null,
        cases: SCREEN_THEME_TEMPLATES.map((one) => ({ name: one.id, args: [one.id] })),
      },
      screenThemeContrast: {
        about: "The lowest contrast between a theme's words and what's under them (WCAG 2, 1 to 21); an outline, shadow or glow counts as half again. An editor warns under 4.5.",
        params: ["theme"],
        run: (input: unknown) => screenThemeContrast(resolveScreenTheme(input)),
        cases: [
          { name: "white on black", args: [{}] },
          { name: "dark grey on black, no effect", args: [{ text: { color: "#333333", effect: "none" } }] },
          { name: "a moving background's lights, darkened", args: [{ text: { effect: "none" }, background: { kind: "aurora", colors: ["#05010f", "#facc15", "#ffffff"], dim: 0.3 } }] },
          { name: "a picture: mid-grey under the words unless darkened", args: [{ text: { effect: "none" }, background: { kind: "image", media: "asset1", dim: 0.5 } }] },
        ],
      },
      sectionEnergy: {
        about: "How lively a part is, from its label, for a background that warms up in a chorus: high, mid or low.",
        params: ["label"],
        run: sectionEnergy,
        cases: ["Chorus", "Refrain 2", "Bridge", "Pre-chorus", "Verse 1", null].map((label) => ({ name: String(label), args: [label] })),
      },
      normalizeScreenCode: {
        about: "A pairing code as typed, as it's kept: upper case, no spaces or dashes; null when it can't be one.",
        params: ["input"],
        run: (input: string) => normalizeScreenCode(input),
        cases: [
          { name: "as shown", args: ["K7Q-M3X"] },
          { name: "typed in lower case with a space", args: ["k7q m3x"] },
          { name: "a letter it never uses (O)", args: ["K7Q-O3X"] },
          { name: "too short", args: ["K7QM"] },
        ],
      },
    },
  },
  {
    area: "chord-rows",
    about: "Rows of chords over the lyrics (issue #230): what each row shows for a chord, from the chord as it sounds or the shape played with the capo.",
    functions: {
      chordRowLabel: {
        about:
          "A chord's name in a row: letters or solfège of the sounding chord, or of the capo's shape when the row says so and there's a capo; Nashville numbers and Roman numerals from the sounding chord in the key sung at that point, capo or not; a diagram row gives the chord to draw.",
        params: ["chord", "row", "capo"],
        run: chordRowLabel,
        cases: (() => {
          const chord = { sounding: "A", fretted: "G", key: "A" };
          return [
            { name: "letters, sounding", args: [chord, { names: "LETTERS", source: "SOUNDING" }, 2] },
            { name: "letters, the capo's shape", args: [chord, { names: "LETTERS", source: "FINGERED" }, 2] },
            { name: "the capo's shape without a capo: the sounding chord", args: [{ sounding: "A", fretted: "A", key: "A" }, { names: "LETTERS", source: "FINGERED" }, null] },
            { name: "solfège of the shape", args: [chord, { names: "SOLFEGE", source: "FINGERED" }, 2] },
            { name: "Nashville: the same with the capo", args: [{ sounding: "E", fretted: "D", key: "A" }, { names: "NASHVILLE", source: "FINGERED" }, 2] },
            { name: "Roman numerals", args: [{ sounding: "F#m", fretted: "Em", key: "A" }, { names: "ROMAN", source: "SOUNDING" }, 2] },
          ];
        })(),
      },
      prettyChord: {
        about: "A chord or key as it's shown: # and b as ♯ and ♭ - a b after a note (letter or solfège) or before a number; any other b is a letter.",
        params: ["text"],
        run: prettyChord,
        cases: ["F#m7b5", "Bb/D", "Ebsus4", "C#7#9", "Sib", "Fa#m", "b7m7b5", "♭VII7", "Bbm(maj7)", "Absus2", "C/Bb", "Dbadd9"].map((text) => ({ name: JSON.stringify(text), args: [text] })),
      },
      chordRowShowsShapes: {
        about: "Whether a row names the capo's shapes (shown in italics): only with a capo, and not for numbers or numerals.",
        params: ["row", "capo"],
        run: chordRowShowsShapes,
        cases: [
          { name: "letters, shapes, a capo", args: [{ names: "LETTERS", source: "FINGERED" }, 3] },
          { name: "no capo", args: [{ names: "LETTERS", source: "FINGERED" }, null] },
          { name: "Nashville", args: [{ names: "NASHVILLE", source: "FINGERED" }, 3] },
        ],
      },
    },
  },
  {
    area: "lyrics-search",
    about: "Finding a song by its words (issue #221): its sung lines, how a search is read, and the line it finds.",
    functions: {
      lyricsLines: {
        about: "A song's sung lines in order, with their ids: no chords, notes or empty lines; a line sung again only the first time.",
        params: ["document"],
        run: (json: unknown) => lyricsLines(read(json)),
        cases: [
          {
            name: "a chorus written out twice, a note, an empty line",
            args: [
              {
                $schema: "song-document/v2",
                revision: 1,
                defaults: {},
                sections: [
                  { id: "c1", type: "chorus", lines: [{ id: "l1", text: "My chains are gone,  I've been set free", chords: [{ id: "k1", at: 3, raw: "C" }] }, { id: "l2", kind: "note", text: "Softly" }] },
                  { id: "v1", type: "verse", lines: [{ id: "l3", text: "" }, { id: "l4", text: "Amazing grace" }] },
                  { id: "c2", type: "chorus", lines: [{ id: "l5", text: "My chains are gone, I've been set free" }] },
                ],
                flow: [],
              },
            ],
          },
        ],
      },
      lyricsSearchText: {
        about: "What's kept to search a song's words: its sung lines folded (case, accents, apostrophes, punctuation), one per line.",
        params: ["document"],
        run: (json: unknown) => lyricsSearchText(read(json)),
        cases: [{ name: "accents, apostrophes and punctuation", args: [{ $schema: "song-document/v2", revision: 1, defaults: {}, sections: [{ id: "s", type: "verse", lines: [{ id: "a", text: "Ô Seigneur, c'est Toi!" }, { id: "b", text: "Cœur — à cœur" }] }], flow: [] }] }],
      },
      parseLyricsQuery: {
        about: "A lyrics search as typed: its words and quoted phrases, folded; null under three letters.",
        params: ["query"],
        run: parseLyricsQuery,
        cases: ["chains free", '"chains are gone" free', "Élévation", "I've", "ab", "a b c", "«set free»"].map((query) => ({ name: JSON.stringify(query), args: [query] })),
      },
      matchLyrics: {
        about: "The line that matches: every word and phrase in order, not necessarily next to each other; the closest together, then the first. Where the words are, in the line's own text.",
        params: ["query", "lines"],
        run: matchLyrics,
        cases: (() => {
          const lines = [
            { id: "l1", text: "Amazing grace, how sweet the sound" },
            { id: "l2", text: "My chains are gone, I've been set free" },
            { id: "l3", text: "Free, my chains are gone, they're free" },
            { id: "l4", text: "Élévation, cœur à cœur" },
          ];
          return [
            { name: "words in order, apart", args: ["chains free", lines] },
            { name: "an exact phrase", args: ['"set free"', lines] },
            { name: "words out of order: none", args: ["free sweet", lines] },
            { name: "accents and ligatures ignored", args: ["elevation coeur", lines] },
            { name: "an apostrophe left out", args: ["ive been", lines] },
            { name: "too short", args: ["my", lines] },
          ];
        })(),
      },
    },
  },
  {
    area: "songbooks",
    about: "Finding a song by the number people call out (issues #48, #213): how a search reads as a songbook reference, and the order songbook entries come in for it.",
    functions: {
      songbookReferences: {
        about: "The ways a search reads as a songbook entry, most likely first: a book (abbreviation or part of its name) and a code; none without a digit.",
        params: ["query"],
        run: songbookReferences,
        cases: ["HY 42", "HY42", "Hymns 42", "42", "A-17", "Hymns FR-092", "grace"].map((query) => ({ name: JSON.stringify(query), args: [query] })),
      },
      rankSongbookHits: {
        about:
          "Entries for a search by number, in the order shown, each with how it matched: exactly that number, then numbers starting with it, then containing it (from two digits), each group in number order then by songbook; a number with letters matches on its digits; a book keeps all three to it.",
        params: ["query", "entries"],
        run: rankSongbookHits,
        cases: (() => {
          const jem = { name: "J'aime l'Éternel", abbreviation: "JEM" };
          const hy = { name: "Hymns", abbreviation: "HY" };
          const entries = [
            ...["58", "580", "5800", "581", "158", "258", "12a", "12", "058b"].map((entryCode) => ({ entryCode, songbook: jem })),
            ...["58", "1058"].map((entryCode) => ({ entryCode, songbook: hy })),
          ];
          return [
            { name: "a number", args: ["58", entries] },
            { name: "a book and a number", args: ["JEM 58", entries] },
            { name: "run together", args: ["hy58", entries] },
            { name: "a number with letters", args: ["12", entries] },
            { name: "one digit: only itself", args: ["5", entries] },
          ];
        })(),
      },
    },
  },
  {
    area: "calendar",
    about: "A team's calendar (issue #235): the dates an event falls on, at its wall-clock time in the team's time zone - the same across daylight saving.",
    functions: {
      eventDates: {
        about: "The dates from `from` to `to` (included), with each date's own changes.",
        params: ["event", "from", "to", "changes"],
        run: eventDates,
        cases: [
          { name: "a one-off", args: [{ date: "2026-12-24", startTime: "18:00", durationMinutes: 90, timeZone: "Europe/Paris" }, "2026-12-01", "2026-12-31", []] },
          { name: "a one-off outside the range", args: [{ date: "2026-12-24", startTime: "18:00", durationMinutes: 90, timeZone: "Europe/Paris" }, "2027-01-01", "2027-01-31", []] },
          {
            name: "every Sunday at 10:00 across the clocks going back",
            args: [{ date: "2026-10-11", startTime: "10:00", durationMinutes: 120, timeZone: "Europe/Paris", repeat: { everyWeeks: 1 } }, "2026-10-12", "2026-11-08", []],
          },
          {
            name: "every other week, until a date, one cancelled and one moved",
            args: [
              { date: "2026-01-04", startTime: "09:30", durationMinutes: 90, timeZone: "America/New_York", repeat: { everyWeeks: 2, until: "2026-03-29" } },
              "2026-02-01",
              "2026-12-31",
              [
                { date: "2026-02-15", cancelled: true },
                { date: "2026-03-15", startTime: "11:00", title: "Easter rehearsal" },
              ],
            ],
          },
          { name: "a range before the first date", args: [{ date: "2026-10-11", startTime: "10:00", durationMinutes: 60, timeZone: "UTC", repeat: { everyWeeks: 1 } }, "2026-09-01", "2026-10-20", []] },
        ],
      },
      zonedInstant: {
        about: "The instant a wall-clock time happens in a time zone; a time skipped by the clocks going forward is taken an hour later, one that happens twice as the first.",
        params: ["date", "time", "timeZone"],
        run: zonedInstant,
        cases: [
          { name: "summer in Paris", args: ["2026-07-05", "10:00", "Europe/Paris"] },
          { name: "winter in Paris", args: ["2026-12-06", "10:00", "Europe/Paris"] },
          { name: "skipped: 02:30 the day the clocks go forward", args: ["2026-03-29", "02:30", "Europe/Paris"] },
          { name: "twice: 02:30 the day the clocks go back", args: ["2026-10-25", "02:30", "Europe/Paris"] },
          { name: "Sydney", args: ["2026-04-05", "10:00", "Australia/Sydney"] },
        ],
      },
      localDate: {
        about: "The date an instant falls on in a time zone.",
        params: ["instant", "timeZone"],
        run: localDate,
        cases: [
          { name: "late evening in New York is the next day in UTC", args: ["2026-10-12T02:00:00.000Z", "America/New_York"] },
          { name: "Tokyo", args: ["2026-10-11T20:00:00.000Z", "Asia/Tokyo"] },
        ],
      },
      effectiveAnswer: {
        about: "Someone's answer for a date: their own if they gave one, else Not available on a day they're away, else none (never taken as Available).",
        params: ["own", "away", "date"],
        run: effectiveAnswer,
        cases: [
          { name: "answered", args: ["IF_NEEDED", [], "2026-08-09"] },
          { name: "away that day", args: [null, [{ from: "2026-08-01", to: "2026-08-15" }], "2026-08-09"] },
          { name: "away, but answered for that day", args: ["AVAILABLE", [{ from: "2026-08-01", to: "2026-08-15" }], "2026-08-09"] },
          { name: "away on the last day of the range", args: [null, [{ from: "2026-08-01", to: "2026-08-15" }], "2026-08-15"] },
          { name: "no answer", args: [null, [{ from: "2026-08-01", to: "2026-08-15" }], "2026-08-16"] },
        ],
      },
      notificationText: {
        about: "A notification in words (issue #236): its kind and details, in the reader's language (en, fr), the date written in it.",
        params: ["kind", "data", "locale"],
        run: (kind: NotificationKind, data: NotificationData, locale: string) => notificationText(kind, data, locale === "fr" ? frMessages : enMessages, locale),
        cases: [
          { name: "a date cancelled", args: ["EVENT_DATE_CANCELLED", { event: "Morning service", date: "2026-10-18", team: "Worship team" }, "en"] },
          { name: "a date moved, in French", args: ["EVENT_DATE_CHANGED", { event: "Culte du matin", date: "2026-10-18", team: "Louange", startTime: "09:30" }, "fr"] },
          { name: "answered for you", args: ["ANSWERED_FOR_YOU", { event: "Rehearsal", date: "2026-10-15", team: "Worship team", answer: "IF_NEEDED", by: "Sam" }, "en"] },
          { name: "answers asked for", args: ["ANSWERS_REQUESTED", { team: "Worship team", by: "Sam", deadline: "2026-10-20" }, "en"] },
          { name: "answers due, in French", args: ["ANSWER_DEADLINE", { team: "Louange", deadline: "2026-10-20", count: 3 }, "fr"] },
          { name: "tomorrow, with a place", args: ["EVENT_TOMORROW", { event: "Morning service", date: "2026-10-18", team: "Worship team", startTime: "10:00", place: "Main hall" }, "en"] },
          { name: "tomorrow, without one", args: ["EVENT_TOMORROW", { event: "Morning service", date: "2026-10-18", team: "Worship team", startTime: "10:00" }, "en"] },
          { name: "the set is ready", args: ["SET_READY", { event: "Morning service", date: "2026-10-18", team: "Worship team", count: 6 }, "en"] },
        ],
      },
      notificationPreferences: {
        about: "How each kind of notification reaches someone (issue #236), from what's stored: a choice left out is on, anything else is ignored.",
        params: ["stored"],
        run: notificationPreferences,
        cases: [
          { name: "nothing chosen: everything on", args: [null] },
          { name: "email off for one kind; junk ignored", args: [{ kinds: { EVENT_DATE_CHANGED: { email: false, sms: true }, NOPE: { email: false }, EVENT_CANCELLED: { push: "no" } } }] },
        ],
      },
      withNotificationChanges: {
        about: "Choices changed: what's left out stays as it was.",
        params: ["stored", "changes"],
        run: withNotificationChanges,
        cases: [{ name: "one channel changed, the rest kept", args: [{ kinds: { EVENT_DATE_CHANGED: { email: false } } }, { ANSWERED_FOR_YOU: { push: false } }] }],
      },
      notificationEmail: {
        about: "Notifications in an email: one under its own title, several under one subject, in the reader's language.",
        params: ["items", "locale"],
        run: (items: { kind: NotificationKind; data: NotificationData }[], locale: string) => notificationEmail(items, locale === "fr" ? frMessages : enMessages, locale),
        cases: [
          { name: "one", args: [[{ kind: "EVENT_DATE_CANCELLED", data: { event: "Morning service", date: "2026-10-18", team: "Worship team" } }], "en"] },
          {
            name: "several, in French",
            args: [
              [
                { kind: "EVENT_DATE_CHANGED", data: { event: "Culte", date: "2026-10-18", team: "Louange", startTime: "09:30" } },
                { kind: "EVENT_DATE_CHANGED", data: { event: "Culte", date: "2026-10-25", team: "Louange", startTime: "09:30" } },
              ],
              "fr",
            ],
          },
        ],
      },
      coversPart: {
        about: "Whether a member covers a part an event needs (issue #235): they listed its instrument or role (dashboard > Roles); a part with a name of the team's, anyone.",
        params: ["member", "part"],
        run: coversPart,
        cases: [
          { name: "an instrument they play", args: [{ instruments: ["DRUMS", "PIANO"], techRoles: [] }, { part: "PIANO", count: 1 }] },
          { name: "a role they have", args: [{ instruments: [], techRoles: ["SOUND_ENGINEER"] }, { part: "SOUND_ENGINEER", count: 1 }] },
          { name: "one they don't", args: [{ instruments: ["DRUMS"], techRoles: [] }, { part: "BASS_GUITAR", count: 1 }] },
          { name: "a named part: anyone", args: [{ instruments: [], techRoles: [] }, { name: "Worship leader", count: 1 }] },
        ],
      },
      partCoverage: {
        about: "How a date's parts are covered by the members' answers: per part, those covering it available or if needed, and how many it's short.",
        params: ["parts", "members"],
        run: partCoverage,
        cases: [
          {
            name: "two vocals, drums, sound",
            args: [
              [
                { part: "LEAD_VOCALS", count: 1 },
                { part: "BACKING_VOCALS", count: 2 },
                { part: "DRUMS", count: 1 },
                { part: "SOUND_ENGINEER", count: 1 },
                { name: "Slides", count: 1 },
              ],
              [
                { instruments: ["LEAD_VOCALS", "BACKING_VOCALS"], techRoles: [], answer: "AVAILABLE" },
                { instruments: ["BACKING_VOCALS"], techRoles: [], answer: "IF_NEEDED" },
                { instruments: ["DRUMS"], techRoles: [], answer: "UNAVAILABLE" },
                { instruments: [], techRoles: ["SOUND_ENGINEER"], answer: null },
              ],
            ],
          },
        ],
      },
      dayBeforeReminderDue: {
        about: "Whether a date's day-before reminder is due: the day before, from 18:00 to midnight in the event's zone; not on the day itself.",
        params: ["date", "startsAt", "timeZone", "now"],
        run: dayBeforeReminderDue,
        cases: [
          { name: "the day before, 17:59 in Paris: not yet", args: ["2026-10-18", "2026-10-18T08:00:00Z", "Europe/Paris", "2026-10-17T15:59:00Z"] },
          { name: "the day before, 18:00 in Paris", args: ["2026-10-18", "2026-10-18T08:00:00Z", "Europe/Paris", "2026-10-17T16:00:00Z"] },
          { name: "the day itself, before it starts: no (it says tomorrow)", args: ["2026-10-18", "2026-10-18T08:00:00Z", "Europe/Paris", "2026-10-18T06:00:00Z"] },
          { name: "once it started: no", args: ["2026-10-18", "2026-10-18T08:00:00Z", "Europe/Paris", "2026-10-18T08:00:00Z"] },
          { name: "two days before: no", args: ["2026-10-18", "2026-10-18T08:00:00Z", "Europe/Paris", "2026-10-16T20:00:00Z"] },
        ],
      },
      deadlineReminderDue: {
        about: "Whether the reminder that answers are due is due: the day before the deadline from 10:00 in the asker's zone, or on the deadline itself.",
        params: ["deadline", "timeZone", "now"],
        run: deadlineReminderDue,
        cases: [
          { name: "the day before, 09:00 in New York: not yet", args: ["2026-10-20", "America/New_York", "2026-10-19T13:00:00Z"] },
          { name: "the day before, 10:00 in New York", args: ["2026-10-20", "America/New_York", "2026-10-19T14:00:00Z"] },
          { name: "the deadline itself", args: ["2026-10-20", "America/New_York", "2026-10-20T23:00:00Z"] },
          { name: "after it: no", args: ["2026-10-20", "America/New_York", "2026-10-21T05:00:00Z"] },
        ],
      },
      notificationPush: {
        about: "A notification on a device's screen: one by its own words, several under one title with the first three listed.",
        params: ["items", "locale"],
        run: (items: { kind: NotificationKind; data: NotificationData }[], locale: string) => notificationPush(items, locale === "fr" ? frMessages : enMessages, locale),
        cases: [
          { name: "one", args: [[{ kind: "EVENT_CANCELLED", data: { event: "Morning service", team: "Worship team" } }], "en"] },
          {
            name: "four",
            args: [
              ["2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08"].map((date) => ({ kind: "EVENT_DATE_CHANGED", data: { event: "Morning service", date, team: "Worship team", startTime: "09:30" } })),
              "en",
            ],
          },
        ],
      },
      quietHoursEnd: {
        about: "When someone's quiet hours end, if they're on: over midnight when they end earlier than they start, in their time zone; null when not on.",
        params: ["quiet", "now"],
        run: quietHoursEnd,
        cases: [
          { name: "none", args: [null, "2026-10-10T23:00:00Z"] },
          { name: "night, before midnight (Paris)", args: [{ from: "22:00", to: "07:00", timeZone: "Europe/Paris" }, "2026-10-10T21:30:00Z"] },
          { name: "night, after midnight (Paris)", args: [{ from: "22:00", to: "07:00", timeZone: "Europe/Paris" }, "2026-10-11T03:00:00Z"] },
          { name: "night, in the day: not on", args: [{ from: "22:00", to: "07:00", timeZone: "Europe/Paris" }, "2026-10-11T12:00:00Z"] },
          { name: "the night the clocks go back", args: [{ from: "22:00", to: "07:00", timeZone: "Europe/Paris" }, "2026-10-24T21:30:00Z"] },
          { name: "in the day", args: [{ from: "13:00", to: "15:00", timeZone: "America/New_York" }, "2026-10-10T17:30:00Z"] },
          { name: "at the end: not on", args: [{ from: "13:00", to: "15:00", timeZone: "UTC" }, "2026-10-10T15:00:00Z"] },
        ],
      },
      isPushEndpoint: {
        about: "Whether a device's push address is a push service's (Google, Mozilla, Apple, Microsoft), https only, or one of the given stand-ins: the server posts to it, so nowhere else.",
        params: ["endpoint", "extraOrigins"],
        run: isPushEndpoint,
        cases: [
          { name: "Google", args: ["https://fcm.googleapis.com/fcm/send/abc:def", []] },
          { name: "Mozilla", args: ["https://updates.push.services.mozilla.com/wpush/v2/gAAAA", []] },
          { name: "Apple", args: ["https://web.push.apple.com/QGuQ", []] },
          { name: "Microsoft", args: ["https://wns2-par02p.notify.windows.com/w/?token=x", []] },
          { name: "not https", args: ["http://fcm.googleapis.com/fcm/send/abc", []] },
          { name: "another host", args: ["https://fcm.googleapis.com.evil.example/fcm", []] },
          { name: "an inside address", args: ["https://169.254.169.254/latest", []] },
          { name: "another port", args: ["https://fcm.googleapis.com:8443/fcm/send/abc", []] },
          { name: "a stand-in for tests", args: ["http://localhost:3997/push/1", ["http://localhost:3997"]] },
          { name: "not an address", args: ["nope", []] },
        ],
      },
      calendarFeed: {
        about: "A personal calendar feed (iCalendar): each date one signed up for, its times in UTC, text escaped, lines folded at 75 octets with CRLF.",
        params: ["entries", "options"],
        run: calendarFeed,
        cases: [
          {
            name: "one date, with a place, a long description and characters to escape",
            args: [
              [
                {
                  uid: "evt_1-2026-10-11@songverse",
                  start: "2026-10-11T08:00:00.000Z",
                  end: "2026-10-11T10:00:00.000Z",
                  title: "Morning service, Worship team",
                  location: "Main hall; side door",
                  description: "The set: https://app.example.com/sets/abc - planned by Sam\nArrive at 9:15 for the soundcheck. Les chants à répéter sont dans la liste.",
                  url: "https://app.example.com/sets/abc",
                },
              ],
              { name: "Songverse - Alex", now: "2026-10-01T12:00:00.000Z" },
            ],
          },
          { name: "nothing signed up for", args: [[], { name: "Songverse - Alex", now: "2026-10-01T12:00:00.000Z", refreshMinutes: 30 }] },
        ],
      },
      setListing: {
        about: "Where a set is listed for someone: a set made by hand as always; an event's set in the sidebar while coming if they signed up, on the Sets page only if not; once past, in the archive if they took part, else hidden.",
        params: ["set"],
        run: setListing,
        cases: [
          { name: "made by hand", args: [{ fromEvent: false }] },
          { name: "coming, signed up", args: [{ fromEvent: true, signedUp: true, past: false }] },
          { name: "coming, not signed up", args: [{ fromEvent: true, signedUp: false, past: false }] },
          { name: "past, took part", args: [{ fromEvent: true, signedUp: true, past: true }] },
          { name: "past, didn't take part", args: [{ fromEvent: true, signedUp: false, past: true }] },
        ],
      },
      isPastDate: {
        about: "Whether a date is over: before today in the team's time zone. An event's date is still coming on the day.",
        params: ["date", "now", "timeZone"],
        run: isPastDate,
        cases: [
          { name: "the same day, in the evening", args: ["2026-10-11", "2026-10-11T21:00:00.000Z", "Europe/Paris"] },
          { name: "the day after", args: ["2026-10-11", "2026-10-11T23:30:00.000Z", "Europe/Paris"] },
        ],
      },
    },
  },
  {
    area: "requests",
    about:
      "What the API takes (issue #118), checked as it checks them (checkRequest): the body it goes on with (defaults filled in, text trimmed), or the messages it answers 400 with. A client can check a form the same way before sending it.",
    functions: {
      CreateSongVersionSchema: {
        about: "POST /song-versions",
        params: ["body"],
        run: checked(CreateSongVersionSchema),
        cases: [
          { name: "a title and language", args: [{ title: "  Amazing Grace ", language: "en", artists: ["John Newton"] }] },
          { name: "no title", args: [{ language: "en", artists: ["X"] }] },
          { name: "fields it doesn't know", args: [{ title: "X", language: "en", artists: ["X"], colour: "red", mood: "happy" }] },
          { name: "a year too early", args: [{ title: "X", language: "en", artists: ["X"], year: 999 }] },
          { name: "no artist", args: [{ title: "X", language: "en", artists: [] }] },
        ],
      },
      UpdateSongVersionSchema: {
        about: "PATCH /song-versions/:id: null or \"\" clears a field.",
        params: ["body"],
        run: checked(UpdateSongVersionSchema),
        cases: [
          { name: "clearing the album", args: [{ album: "" }] },
          { name: "a capo out of range", args: [{ capo: 14 }] },
        ],
      },
      CreateTeamEventSchema: {
        about: "POST /teams/:teamId/events (issue #235)",
        params: ["body"],
        run: checked(CreateTeamEventSchema),
        cases: [
          { name: "every Sunday morning", args: [{ title: "Morning service", date: "2026-10-11", startTime: "10:00", timeZone: "Europe/Paris", repeat: { everyWeeks: 1 } }] },
          { name: "a time and a zone that aren't", args: [{ title: "Rehearsal", date: "2026-02-30", startTime: "25:00", timeZone: "Mars/Olympus" }] },
        ],
      },
      AnswerEventDateSchema: {
        about: "PUT /teams/:teamId/events/:eventId/dates/:date/answer (issue #235)",
        params: ["body"],
        run: checked(AnswerEventDateSchema),
        cases: [
          { name: "available, with a note", args: [{ answer: "AVAILABLE", note: "Keys only" }] },
          { name: "an answer that isn't one", args: [{ answer: "MAYBE" }] },
        ],
      },
      CreateAwaySchema: {
        about: "POST /users/me/away (issue #235)",
        params: ["body"],
        run: checked(CreateAwaySchema),
        cases: [
          { name: "two weeks in August", args: [{ from: "2026-08-01", to: "2026-08-15", note: "Holidays" }] },
          { name: "ending before it starts", args: [{ from: "2026-08-15", to: "2026-08-01" }] },
        ],
      },
      CreateSetlistSchema: {
        about: "POST /setlists",
        params: ["body"],
        run: checked(CreateSetlistSchema),
        cases: [
          { name: "a name", args: [{ name: "Sunday" }] },
          { name: "no name: shown by its date", args: [{ eventDate: "2026-10-04" }] },
          { name: "a date that isn't one", args: [{ name: "Sunday", eventDate: "4/10/2026" }] },
        ],
      },
      AddSetlistItemSchema: {
        about: "POST /setlists/:id/items",
        params: ["body"],
        run: checked(AddSetlistItemSchema),
        cases: [
          { name: "a song", args: [{ songVersionId: "song_1" }] },
          { name: "nothing", args: [{}] },
        ],
      },
      UpdateUserSchema: {
        about: "PATCH /users/me",
        params: ["body"],
        run: checked(UpdateUserSchema),
        cases: [
          { name: "a language and instruments", args: [{ locale: "fr", instruments: ["DRUMS", "HARP"] }] },
          { name: "a language that isn't offered", args: [{ locale: "de" }] },
        ],
      },
    },
  },
];
