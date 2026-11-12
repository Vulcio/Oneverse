import { parseChord, semitoneOf, type ParsedChord } from "./chord.js";
import { noteName, octaveOf, parseNoteName } from "../tuner/notes.js";

/**
 * Chord shapes for fretted instruments (issue #207, phase 1 of #111): where
 * to put the fingers for a chord, worked out from its notes rather than
 * looked up, so every chord the reader understands has a shape, on any
 * tuning. The answer is plain data - frets, fingers, barres, the notes it
 * sounds - that each platform draws its own way (docs/chord-diagrams.md),
 * and the same chord always gives the same shapes, in the same order.
 */

export type ToneRole = "root" | "third" | "fifth" | "seventh" | "extension" | "alteration" | "bass";

export interface ChordTone {
  /** Semitones above the root (0-11). */
  interval: number;
  /** The note's pitch class (C = 0 … B = 11). */
  pitchClass: number;
  role: ToneRole;
  /** False for a tone a player may leave out (the 5th, an implied 9th): it's dropped first when a shape can't hold every note. */
  needed: boolean;
}

/** An extension's interval above the root: 2 and 9 → 2, 4 and 11 → 5, 6 and 13 → 9. */
function extensionInterval(degree: string): number | null {
  const number = Number(/\d+/.exec(degree)?.[0]);
  return ({ 2: 2, 9: 2, 4: 5, 11: 5, 6: 9, 13: 9 } as Record<number, number>)[number] ?? null;
}

const ALTERATIONS: Record<string, number> = { b9: 1, "#9": 3, "#11": 6, b13: 8 };

/** The notes of a chord, each with its role; null for something that isn't a chord (or "N.C."). */
export function chordTones(chord: string | ParsedChord): ChordTone[] | null {
  const parsed = typeof chord === "string" ? parseChord(chord) : chord;
  if (!parsed || parsed.kind !== "chord") return null;
  const root = semitoneOf(parsed.root);
  const tones: ChordTone[] = [];
  const add = (interval: number, role: ToneRole, needed: boolean) => {
    const same = tones.find((tone) => tone.interval === interval);
    if (same) same.needed ||= needed;
    else tones.push({ interval, pitchClass: (root + interval) % 12, role, needed });
  };
  const { quality, seventh, extensions, alterations } = parsed;
  // The highest of 9, 11 and 13 is the chord's colour; the ones under it may go.
  const stacked = extensions.filter((e) => /^(9|11|13)$/.test(e)).map(Number);
  const top = stacked.length > 0 ? Math.max(...stacked) : null;

  add(0, "root", true);
  const thirds: Record<ParsedChord["quality"], number | null> = {
    major: 4,
    augmented: 4,
    minor: 3,
    diminished: 3,
    "half-diminished": 3,
    sus2: 2,
    sus4: 5,
    power: null,
  };
  const third = thirds[quality];
  // An 11 chord usually leaves the major 3rd out (they clash).
  if (third !== null) add(third, "third", !(top === 11 && third === 4));
  let fifth = quality === "diminished" || quality === "half-diminished" ? 6 : quality === "augmented" ? 8 : 7;
  if (alterations.includes("b5")) fifth = 6;
  if (alterations.includes("#5")) fifth = 8;
  add(fifth, "fifth", fifth !== 7 || quality === "power");
  if (seventh) add(seventh === "major" ? 11 : seventh === "minor" ? 10 : 9, "seventh", true);
  for (const extension of extensions) {
    const interval = extensionInterval(extension);
    if (interval === null) continue;
    const implied = /^(9|11|13)$/.test(extension) && Number(extension) !== top;
    add(interval, "extension", !implied);
  }
  // A 13 chord's 9th is there in spirit; its 11th isn't (it clashes with the 3rd).
  if (top === 13) add(2, "extension", false);
  if (top === 11) add(2, "extension", false);
  for (const alteration of alterations) {
    const interval = ALTERATIONS[alteration];
    if (interval !== undefined) add(interval, "alteration", true);
  }
  if (parsed.bass) {
    const bass = (semitoneOf(parsed.bass) - root + 12) % 12;
    if (!tones.some((tone) => tone.interval === bass)) tones.push({ interval: bass, pitchClass: (root + bass) % 12, role: "bass", needed: true });
  }
  return tones;
}

export type InstrumentId = "guitar" | "ukulele";

export interface FrettedInstrument {
  id: InstrumentId;
  /** Open strings as MIDI notes, in the order a diagram draws them: the lowest-pitched (guitar) or the nearest the chin (ukulele) first. */
  strings: number[];
  /** Frets shapes may reach. */
  frets: number;
  /** The lowest note sounding must be the chord's bass (guitar); a ukulele's high G has no bass. */
  bassFirst: boolean;
  /** At least this many strings sound. */
  minStrings: number;
  /** Strings may be muted (guitar); a ukulele strums all four. */
  mutes: boolean;
  /** The usual shapes (KNOWN_OPEN, MOVABLE) apply: only in the tunings they were learnt in. */
  knownShapes?: boolean;
}

export interface Tuning {
  id: string;
  /** As players name it. */
  name: string;
  /** Open strings as MIDI notes, in drawing order. */
  strings: number[];
  /** The usual shapes still hold (a ukulele's low G changes no fingering). */
  knownShapes: boolean;
}

/**
 * The tunings a player can choose (issue #207, phase 3), each instrument's
 * standard one first. Shapes are worked out for whichever is chosen.
 */
export const TUNINGS: Record<InstrumentId, Tuning[]> = {
  guitar: [
    { id: "standard", name: "EADGBE", strings: [40, 45, 50, 55, 59, 64], knownShapes: true },
    { id: "drop-d", name: "Drop D (DADGBE)", strings: [38, 45, 50, 55, 59, 64], knownShapes: false },
    { id: "dadgad", name: "DADGAD", strings: [38, 45, 50, 55, 57, 62], knownShapes: false },
    { id: "open-g", name: "Open G (DGDGBD)", strings: [38, 43, 50, 55, 59, 62], knownShapes: false },
    { id: "half-step-down", name: "Half step down (Eb)", strings: [39, 44, 49, 54, 58, 63], knownShapes: false },
    { id: "whole-step-down", name: "Whole step down (D standard)", strings: [38, 43, 48, 53, 57, 62], knownShapes: false },
    { id: "drop-c", name: "Drop C (CGCFAD)", strings: [36, 43, 48, 53, 57, 62], knownShapes: false },
    { id: "double-drop-d", name: "Double drop D (DADGBD)", strings: [38, 45, 50, 55, 59, 62], knownShapes: false },
    { id: "open-d", name: "Open D (DADF#AD)", strings: [38, 45, 50, 54, 57, 62], knownShapes: false },
    { id: "open-e", name: "Open E (EBEG#BE)", strings: [40, 47, 52, 56, 59, 64], knownShapes: false },
    { id: "open-c", name: "Open C (CGCGCE)", strings: [36, 43, 48, 55, 60, 64], knownShapes: false },
  ],
  ukulele: [
    { id: "standard", name: "GCEA (high G)", strings: [67, 60, 64, 69], knownShapes: true },
    { id: "low-g", name: "GCEA (low G)", strings: [55, 60, 64, 69], knownShapes: true },
    { id: "baritone", name: "Baritone (DGBE)", strings: [50, 55, 59, 64], knownShapes: false },
  ],
};

const CUSTOM = "custom:";
// The names the database's tuning presets (TuningPreset.slug) and older arrangements used.
const LEGACY_IDS: Record<string, string> = { standard_guitar: "standard", drop_d: "drop-d", open_g: "open-g", open_d: "open-d", open_e: "open-e", half_step_down: "half-step-down" };

/**
 * A player's own tuning (issue #355) as a tuning ID: "custom:D2-A2-D3-F#3-A3-D4",
 * the open strings in drawing order with their octaves. Null when a note
 * can't be read or there are too many or too few for the instrument.
 */
export function customTuningId(instrumentId: InstrumentId, notes: readonly (string | number)[]): string | null {
  const midi = notes.map((note) => (typeof note === "number" ? note : parseNoteName(note)));
  if (midi.length !== FRETTED_INSTRUMENTS[instrumentId].strings.length || midi.some((note) => note === null || note < 21 || note > 88)) return null;
  return CUSTOM + (midi as number[]).map((note) => `${noteName(note)}${octaveOf(note)}`).join("-");
}

/**
 * A player's own tuning from the names of its open strings as they'd write
 * them, without octaves ("D A D F# A D", "DADF#AD", "C G C G C E"): each string
 * taken in the octave nearest the instrument's standard one. Null when it
 * can't be read or has the wrong number of strings.
 */
export function customTuningFromNames(instrumentId: InstrumentId, text: string): string | null {
  const names = text.replace(/♯/g, "#").replace(/♭/g, "b").match(/[A-Ga-g][#b]?/g);
  const standard = FRETTED_INSTRUMENTS[instrumentId].strings;
  if (!names || names.length !== standard.length) return null;
  // Only note names, nothing else (spaces, commas and dashes between them).
  if (text.replace(/♯|♭/g, "").replace(/[A-Ga-g][#b]?/g, "").replace(/[\s,\-/]/g, "") !== "") return null;
  const midi = names.map((name, index) => {
    const pitch = parseNoteName(`${name[0]!.toUpperCase()}${name.slice(1)}4`)! % 12;
    const near = standard[index]!;
    // The nearest to the standard string; a tie goes down (strings are tuned down more often than up).
    const below = near - (((near - pitch) % 12) + 12) % 12;
    return near - below <= 6 ? below : below + 12;
  });
  return customTuningId(instrumentId, midi);
}

/**
 * The tuning an ID names: one of TUNINGS, a player's own ("custom:..."), or an
 * older preset's name ("drop_d"); null for anything else.
 */
export function findTuning(instrumentId: InstrumentId, tuningId: string | null | undefined): Tuning | null {
  if (!tuningId) return null;
  const id = LEGACY_IDS[tuningId] ?? tuningId;
  const builtIn = TUNINGS[instrumentId].find((one) => one.id === id);
  if (builtIn) return builtIn;
  if (!id.startsWith(CUSTOM)) return null;
  const notes = id.slice(CUSTOM.length).split("-");
  const canonical = customTuningId(instrumentId, notes);
  if (canonical !== id) return null;
  const strings = notes.map((note) => parseNoteName(note)!);
  // The same strings as a built-in tuning: that one, under its name.
  const same = TUNINGS[instrumentId].find((one) => one.strings.join() === strings.join());
  if (same) return same;
  const standard = TUNINGS[instrumentId][0]!.strings;
  return { id, name: notes.map((note) => note.replace(/-?\d+$/, "")).join(""), strings, knownShapes: strings.every((note, index) => note % 12 === standard[index]! % 12) };
}

/** Whether an ID names a tuning (a built-in one or a player's own): what a request may set. */
export function isTuningId(instrumentId: InstrumentId, tuningId: string): boolean {
  return findTuning(instrumentId, tuningId) !== null;
}

/** An instrument in a tuning (its standard one when the tuning isn't known). */
export function tunedInstrument(instrumentId: InstrumentId, tuningId = "standard"): FrettedInstrument & { tuning: Tuning } {
  const tuning = findTuning(instrumentId, tuningId) ?? TUNINGS[instrumentId][0]!;
  return { ...FRETTED_INSTRUMENTS[instrumentId], strings: tuning.strings, knownShapes: tuning.knownShapes, tuning };
}

export const FRETTED_INSTRUMENTS: Record<InstrumentId, FrettedInstrument> = {
  // E2 A2 D3 G3 B3 E4.
  guitar: { id: "guitar", strings: [40, 45, 50, 55, 59, 64], frets: 15, bassFirst: true, minStrings: 3, mutes: true },
  // G4 C4 E4 A4 (high G).
  ukulele: { id: "ukulele", strings: [67, 60, 64, 69], frets: 12, bassFirst: false, minStrings: 4, mutes: false },
};

export interface ChordShape {
  /** Per string, in the instrument's order: the fret pressed, 0 for open, null for muted. */
  frets: (number | null)[];
  /** Per string: the finger (1 index … 4 little finger) on a pressed string, null on an open or muted one. */
  fingers: (number | null)[];
  /** One finger across several strings: `from` and `to` are string indexes, both pressed at `fret`. */
  barres: { fret: number; from: number; to: number }[];
  /** The fret a diagram starts at: 1 when the shape is near the nut, else its lowest pressed fret. */
  baseFret: number;
  /** The MIDI notes it sounds, string by string (muted ones left out): what's played when it's tapped. */
  notes: number[];
}

/** Window of frets a hand covers. */
const SPAN = 4;

// The shapes players learn first: when the search finds one, it comes before
// anything merely easy. Open chords exactly as written; the movable ones
// (E and A shapes, barred anywhere up the neck) relative to their barre.
const KNOWN_OPEN: Record<InstrumentId, Set<string>> = {
  guitar: new Set(
    // C D E G A, Am Dm Em, 7ths, maj7s, m7s, sus, add9 and the usual slash chords.
    "x32010 xx0232 022100 320003 x02220 x02210 xx0231 022000 x32310 xx0212 020100 320001 x02020 x21202 x32000 xx0222 xx3210 320002 x02120 021100 x02010 xx0211 020000 x02200 x02230 xx0230 xx0233 022200 x32030 2x0232 x20003 332010 032010 x02100".split(" "),
  ),
  ukulele: new Set(
    "0003 2220 2010 0232 2100 4322 2000 4222 0333 2210 0432 1013 0231 0001 2223 1202 0212 0100 2322 0000 2213 0202 0002 0222 3211 2120 2200 0233 2222".split(" "),
  ),
};
const MOVABLE: Record<InstrumentId, (number | null)[][]> = {
  guitar: ["022100", "x02220", "022000", "x02210", "020100", "x02020", "020000", "x02010", "021100", "x02120", "022200", "x02230", "x02200", "022xxx", "x022xx"].map((text) =>
    [...text].map((c) => (c === "x" ? null : Number(c))),
  ),
  ukulele: [],
};

function knownShape(frets: (number | null)[], instrument: FrettedInstrument): "open" | "movable" | null {
  if (instrument.knownShapes === false) return null;
  const text = frets.map((fret) => (fret === null ? "x" : fret > 9 ? "?" : String(fret))).join("");
  if (KNOWN_OPEN[instrument.id].has(text)) return "open";
  const pressed = frets.filter((fret): fret is number => !!fret);
  if (pressed.length === 0) return null;
  const barre = Math.min(...pressed);
  for (const template of MOVABLE[instrument.id]) {
    if (template.every((fret, i) => (fret === null ? frets[i] === null : frets[i] === fret + barre))) return "movable";
  }
  return null;
}

/**
 * Fingers for a shape: the pressed strings in order of fret, then string,
 * get fingers 1, 2, 3, 4. With four or more pressed and the lowest fret on
 * two strings or more, the index finger lies across that fret (a barre) and
 * the rest share the other three - with five or more, it has to. Null when
 * a hand can't play it.
 */
function fingering(frets: (number | null)[]): Pick<ChordShape, "fingers" | "barres"> | null {
  const pressed = frets.flatMap((fret, string) => (fret ? [{ fret, string }] : []));
  const fingers: (number | null)[] = frets.map(() => null);
  if (pressed.length === 0) return { fingers, barres: [] };
  const ordered = [...pressed].sort((a, b) => a.fret - b.fret || a.string - b.string);
  const separately = () => {
    ordered.forEach(({ string }, i) => (fingers[string] = i + 1));
    return { fingers, barres: [] };
  };
  if (pressed.length < 4 || ordered[1]!.fret !== ordered[0]!.fret) return pressed.length <= 4 ? separately() : null;
  return barred(frets, ordered, fingers) ?? (pressed.length <= 4 ? separately() : null);
}

function barred(
  frets: (number | null)[],
  ordered: { fret: number; string: number }[],
  fingers: (number | null)[],
): Pick<ChordShape, "fingers" | "barres"> | null {
  const lowest = ordered[0]!.fret;
  const onLowest = ordered.filter((p) => p.fret === lowest).map((p) => p.string);
  const from = Math.min(...onLowest);
  const to = Math.max(...onLowest);
  // Under a barre every string sounds, at its fret or above.
  for (let string = from; string <= to; string++) {
    const fret = frets[string];
    if (fret === null || fret === undefined || fret < lowest) return null;
  }
  const rest = ordered.filter((p) => p.fret !== lowest);
  if (rest.length > 3) return null;
  for (let string = from; string <= to; string++) if (frets[string] === lowest) fingers[string] = 1;
  rest.forEach(({ string }, i) => (fingers[string] = i + 2));
  return { fingers, barres: [{ fret: lowest, from, to }] };
}

/** Lower is easier and more usual. */
function difficulty(frets: (number | null)[], shape: Pick<ChordShape, "barres" | "fingers">, missingOptional: number, instrument: FrettedInstrument): number {
  const pressed = frets.filter((fret): fret is number => !!fret);
  const low = pressed.length > 0 ? Math.min(...pressed) : 0;
  const high = pressed.length > 0 ? Math.max(...pressed) : 0;
  const open = frets.filter((fret) => fret === 0).length;
  const sounding = frets.filter((fret) => fret !== null).length;
  const firstSounding = frets.findIndex((fret) => fret !== null);
  const lastSounding = frets.length - 1 - [...frets].reverse().findIndex((fret) => fret !== null);
  let score = low * 2 + (high - low >= 3 ? 4 : 0);
  // Open strings: the open chords everyone knows, near the nut; further up they ring against the shape.
  score += high <= 3 ? -1.5 * open : open;
  score -= sounding * 1.2;
  for (let string = 0; string < frets.length; string++) {
    if (frets[string] !== null) continue;
    if (string < firstSounding) score += string >= 2 ? 2 : 0.5;
    else if (string > lastSounding) score += 2;
    else score += 4;
  }
  score += shape.barres.length * 1.5;
  // A pressed bass with the next string open: rare, and hard to keep from ringing wrong.
  if (instrument.bassFirst && frets[firstSounding]! > 0 && frets[firstSounding + 1] === 0) score += 4;
  const known = knownShape(frets, instrument);
  if (known === "open") score -= 12;
  if (known === "movable") score -= 11;
  score += shape.fingers.filter((finger) => finger !== null).length * 0.5;
  score += missingOptional;
  return score;
}

const cache = new Map<string, ChordShape[]>();

/**
 * Shapes for a chord on a fretted instrument, easiest and most usual first:
 * every needed note of the chord and nothing else, the bass lowest on a
 * guitar, at most four fingers (a barre counting as one) across four frets.
 * When no shape holds every needed note, the ones a player leaves out first
 * (an extension's colour, then an alteration) are dropped. Empty for
 * something that isn't a chord. `tuningId` is one of TUNINGS (standard by
 * default); in another tuning the shapes are worked out for its strings.
 */
export function chordShapes(chord: string, instrumentId: InstrumentId = "guitar", limit = 8, tuningId = "standard"): ChordShape[] {
  const key = `${instrumentId}|${tuningId}|${chord.trim()}|${limit}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const parsed = parseChord(chord);
  const tones = parsed && parsed.kind === "chord" ? chordTones(parsed) : null;
  let shapes: ChordShape[] = [];
  if (parsed && parsed.kind === "chord" && tones) {
    const instrument = tunedInstrument(instrumentId, tuningId);
    const bass = parsed.bass ? semitoneOf(parsed.bass) : semitoneOf(parsed.root);
    // Fewer notes needed each time nothing fits: first the extensions' colours, then the alterations.
    const attempts = [tones, tones.map((tone) => (tone.role === "extension" ? { ...tone, needed: false } : tone)), tones.map((tone) => (tone.role === "extension" || tone.role === "alteration" ? { ...tone, needed: false } : tone))];
    for (const attempt of attempts) {
      shapes = searchShapes(attempt, bass, instrument, limit);
      if (shapes.length > 0) break;
    }
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, shapes);
  return shapes;
}

function searchShapes(tones: ChordTone[], bass: number, instrument: FrettedInstrument, limit: number): ChordShape[] {
  const allowed = new Set(tones.map((tone) => tone.pitchClass));
  const needed = tones.filter((tone) => tone.needed).map((tone) => tone.pitchClass);
  const optional = tones.filter((tone) => !tone.needed).map((tone) => tone.pitchClass);
  const found: { frets: (number | null)[]; score: number; shape: ChordShape }[] = [];
  const strings = instrument.strings;

  for (let start = 1; start + SPAN - 1 <= instrument.frets; start++) {
    // Each string: muted, open, or pressed within the window - only on the chord's notes.
    const options = strings.map((open) => {
      const choices: (number | null)[] = [];
      if (instrument.mutes) choices.push(null);
      if (allowed.has(open % 12)) choices.push(0);
      for (let fret = start; fret < start + SPAN; fret++) if (allowed.has((open + fret) % 12)) choices.push(fret);
      return choices;
    });
    const frets: (number | null)[] = new Array(strings.length).fill(null);
    const visit = (string: number) => {
      if (string === strings.length) return consider([...frets], start);
      for (const choice of options[string]!) {
        frets[string] = choice;
        visit(string + 1);
      }
    };
    visit(0);
  }

  function consider(frets: (number | null)[], start: number) {
    const pressed = frets.filter((fret): fret is number => !!fret);
    // Each shape once: in the window that starts at its lowest pressed fret (an all-open one in the first).
    if (pressed.length > 0 ? Math.min(...pressed) !== start : start !== 1) return;
    const sounding = frets.flatMap((fret, string) => (fret === null ? [] : [strings[string]! + fret]));
    if (sounding.length < instrument.minStrings) return;
    const classes = new Set(sounding.map((note) => note % 12));
    if (!needed.every((pc) => classes.has(pc))) return;
    if (instrument.bassFirst && Math.min(...sounding) % 12 !== bass) return;
    // A guitar's muted strings: below or above the shape, and at most one among its strings.
    if (instrument.mutes) {
      const first = frets.findIndex((fret) => fret !== null);
      const last = frets.length - 1 - [...frets].reverse().findIndex((fret) => fret !== null);
      if (frets.slice(first, last + 1).filter((fret) => fret === null).length > 1) return;
    }
    const hand = fingering(frets);
    if (!hand) return;
    const missing = optional.filter((pc) => !classes.has(pc)).length;
    const shape: ChordShape = {
      frets,
      ...hand,
      baseFret: pressed.length > 0 && Math.max(...pressed) > SPAN ? Math.min(...pressed) : 1,
      notes: sounding,
    };
    found.push({ frets, score: difficulty(frets, hand, missing, instrument), shape });
  }

  const text = (frets: (number | null)[]) => frets.map((fret) => (fret === null ? "x" : fret.toString(36))).join("");
  found.sort((a, b) => a.score - b.score || (text(a.frets) < text(b.frets) ? -1 : text(a.frets) > text(b.frets) ? 1 : 0));
  return found.slice(0, limit).map((entry) => entry.shape);
}

/** A shape written as players write it: "x32010", with "(10)" for frets past 9. */
export function shapeText(shape: Pick<ChordShape, "frets">): string {
  return shape.frets.map((fret) => (fret === null ? "x" : fret > 9 ? `(${fret})` : String(fret))).join("");
}
