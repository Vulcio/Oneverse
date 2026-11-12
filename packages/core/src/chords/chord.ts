/**
 * Chord symbols: reading them ("F#m7b5/C#", "Cadd9", "N.C."), transposing
 * them, naming them in solfège and simplifying them.
 *
 * A song stores each chord exactly as written (`raw`); everything here is
 * derived from that on demand, so an improvement to the parser applies to
 * every song at once, with nothing stored to go stale. Transposing and
 * renaming only touch the root and bass notes - the rest of the symbol
 * ("m7b5", "sus4", "(add9)") is kept as the author wrote it.
 */

export type NoteLetter = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type NoteAccidental = "sharp" | "flat";

export interface NoteName {
  letter: NoteLetter;
  accidental: NoteAccidental | null;
}

export type ParsedChordQuality = "major" | "minor" | "diminished" | "augmented" | "half-diminished" | "sus2" | "sus4" | "power";

export interface ParsedChord {
  kind: "chord";
  root: NoteName;
  quality: ParsedChordQuality;
  /** The seventh, if any: minor (C7, Cm7), major (Cmaj7) or diminished (Cdim7). */
  seventh: "minor" | "major" | "diminished" | null;
  /** Added and extended tones, in order: "6", "9", "11", "13", "add9", "add2"... */
  extensions: string[];
  /** Altered tones: "b5", "#5", "b9", "#9", "#11", "b13", or "alt". */
  alterations: string[];
  bass: NoteName | null;
  /** Written in parentheses, e.g. "(G)": play it if you like. */
  optional: boolean;
}

/** "N.C." - no chord: the band stops. */
export interface NoChord {
  kind: "no-chord";
  optional: boolean;
}

const LETTER_SEMITONES: Record<NoteLetter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_SPELLING: NoteName[] = [
  { letter: "C", accidental: null },
  { letter: "C", accidental: "sharp" },
  { letter: "D", accidental: null },
  { letter: "D", accidental: "sharp" },
  { letter: "E", accidental: null },
  { letter: "F", accidental: null },
  { letter: "F", accidental: "sharp" },
  { letter: "G", accidental: null },
  { letter: "G", accidental: "sharp" },
  { letter: "A", accidental: null },
  { letter: "A", accidental: "sharp" },
  { letter: "B", accidental: null },
];
const FLAT_SPELLING: NoteName[] = [
  { letter: "C", accidental: null },
  { letter: "D", accidental: "flat" },
  { letter: "D", accidental: null },
  { letter: "E", accidental: "flat" },
  { letter: "E", accidental: null },
  { letter: "F", accidental: null },
  { letter: "G", accidental: "flat" },
  { letter: "G", accidental: null },
  { letter: "A", accidental: "flat" },
  { letter: "A", accidental: null },
  { letter: "B", accidental: "flat" },
  { letter: "B", accidental: null },
];
// Major keys written with flats (F, Bb, Eb, Ab, Db, Gb); a minor key follows its relative major.
const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1, 6]);

const NOTE = "([A-G])([#♯b♭]?)";
const NO_CHORD = /^(n\.?\s?c\.?|n\/c)$/i;

/** The pieces of a chord symbol: root, the rest as written, and the bass note. */
interface ChordParts {
  optional: boolean;
  root: NoteName;
  suffix: string;
  bass: NoteName | null;
}

function toNote(letter: string, accidental: string): NoteName {
  return {
    letter: letter as NoteLetter,
    accidental: accidental === "#" || accidental === "♯" ? "sharp" : accidental === "b" || accidental === "♭" ? "flat" : null,
  };
}

function splitChord(raw: string): ChordParts | null {
  let text = raw.trim();
  let optional = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    optional = true;
    text = text.slice(1, -1).trim();
  }
  const match = new RegExp(`^${NOTE}(.*?)(?:/${NOTE})?$`).exec(text);
  if (!match) return null;
  const [, rootLetter, rootAccidental, suffix, bassLetter, bassAccidental] = match;
  return {
    optional,
    root: toNote(rootLetter!, rootAccidental!),
    suffix: suffix ?? "",
    bass: bassLetter ? toNote(bassLetter, bassAccidental ?? "") : null,
  };
}

/**
 * Reads a chord symbol. Returns null for anything it can't fully make sense
 * of (the raw text is still shown as written); `noChord` covers "N.C.".
 */
export function parseChord(raw: string): ParsedChord | NoChord | null {
  const trimmed = raw.trim();
  const optional = trimmed.startsWith("(") && trimmed.endsWith(")");
  if (NO_CHORD.test(optional ? trimmed.slice(1, -1).trim() : trimmed)) return { kind: "no-chord", optional };

  const parts = splitChord(raw);
  if (!parts) return null;
  const suffix = parseSuffix(parts.suffix);
  if (!suffix) return null;
  return { kind: "chord", root: parts.root, ...suffix, bass: parts.bass, optional: parts.optional };
}

function parseSuffix(input: string): Pick<ParsedChord, "quality" | "seventh" | "extensions" | "alterations"> | null {
  let rest = input.replace(/\s+/g, "");
  let quality: ParsedChordQuality = "major";
  let seventh: ParsedChord["seventh"] = null;
  const extensions: string[] = [];
  const alterations: string[] = [];
  // A "7" written, not implied by a 9: "F9/6" has none.
  let explicitSeventh = false;
  const take = (pattern: RegExp): RegExpExecArray | null => {
    const match = pattern.exec(rest);
    if (match) rest = rest.slice(match[0].length);
    return match;
  };
  // A degree beyond the seventh implies the seventh (C9 = C7 + 9).
  const extend = (degree: string | undefined) => {
    if (degree && degree !== "7") extensions.push(degree);
  };

  // The triad.
  if (take(/^[øØ]7?/)) {
    quality = "half-diminished";
    seventh = "minor";
  } else if (take(/^(?:m7b5|m7\(b5\)|min7b5|-7b5)/)) {
    quality = "half-diminished";
    seventh = "minor";
  } else if (take(/^(?:dim|°|o|d(?![a-z]))/)) {
    // "Fd", "F#d7": the French books' diminished (issue #203).
    quality = "diminished";
    if (take(/^7/)) seventh = "diminished";
  } else if (take(/^(?:aug|\+)/)) {
    quality = "augmented";
  } else if (take(/^(?:min|mi(?!n)|m(?!aj|a\d)|-)/)) {
    quality = "minor";
  } else if (/^5$/.test(rest)) {
    rest = "";
    quality = "power";
  }

  // The seventh and extensions.
  const major = take(/^\(?(?:maj|Maj|MAJ|ma|M|Δ|△)(7|9|11|13)?\)?/);
  if (major) {
    if (major[1]) {
      seventh = "major";
      extend(major[1]);
    }
  } else {
    const sixNine = take(/^6(?:\/?9)?/);
    if (sixNine) {
      extensions.push("6");
      if (sixNine[0].length > 1) extensions.push("9");
    }
    const degree = take(/^(7|9|11|13)/);
    if (degree) {
      if (degree[1] === "7") explicitSeventh = true;
      if (quality !== "half-diminished" && seventh === null) seventh = "minor";
      // "C11#", "E13b": the degree altered, written after it (issue #203).
      const sign = degree[1] !== "7" ? take(/^([#♯b♭])(?!\d)/) : null;
      if (sign) alterations.push(`${sign[1] === "#" || sign[1] === "♯" ? "#" : "b"}${degree[1]}`);
      else extend(degree[1]);
      // As French books write them (issue #203): "C7maj", "C7M", "Bb9maj" (major seventh), "C#7d" (diminished seventh).
      if (take(/^maj/i) || (degree[1] === "7" && take(/^M(?![a-zA-Z])/))) seventh = "major";
      else if (quality !== "diminished" && take(/^d(?![a-z])/)) {
        quality = "diminished";
        seventh = "diminished";
      }
    }
  }

  // Suspensions, additions and alterations, in any order.
  for (let progress = true; progress && rest.length > 0; ) {
    progress = false;
    // A number after a slash is part of the chord, not its bass (issue #203): "Dm7/9", "F9/6", "C#m7/b5", "D7/4".
    if (take(/^\/(?=[#♯b♭+-]?\d)/)) {
      progress = true;
      continue;
    }
    const sus = take(/^\(?sus(2|4)?\)?/);
    if (sus) {
      quality = sus[1] === "2" ? "sus2" : "sus4";
      // "Bsus7": the seventh written after.
      if (take(/^7/) && seventh === null) seventh = "minor";
      progress = true;
      continue;
    }
    // "A4", "D7/4": the fourth instead of the third - suspended; on a minor chord ("Am4"), added.
    if (take(/^4/)) {
      if (quality === "minor") extensions.push("add4");
      else quality = "sus4";
      progress = true;
      continue;
    }
    // "C7maj11#", "E13b": the alteration written after the degree.
    const after = take(/^(9|11|13)([#♯b♭])/);
    if (after) {
      alterations.push(`${after[2] === "#" || after[2] === "♯" ? "#" : "b"}${after[1]}`);
      progress = true;
      continue;
    }
    // "A7/5aug", "D5aug", "A9aug", "G#7+/C#": the fifth raised.
    if (take(/^(?:5?aug|\+(?!\d))/)) {
      if (quality === "major") quality = "augmented";
      else alterations.push("#5");
      progress = true;
      continue;
    }
    // Degrees written after another ("F9/6", "Dm7/9", "E4/7"), and a major seventh after them ("F2/7maj").
    const later = take(/^(6|7|9|11|13)/);
    if (later) {
      if (later[1] === "7") {
        explicitSeventh = true;
        if (seventh === null) seventh = take(/^maj/i) ? "major" : "minor";
      } else if (!extensions.includes(later[1]!)) extensions.push(later[1]!);
      progress = true;
      continue;
    }
    if (take(/^maj/i)) {
      seventh = "major";
      progress = true;
      continue;
    }
    const add = take(/^\(?add(2|4|9|11|13)\)?/);
    if (add) {
      extensions.push(`add${add[1]}`);
      progress = true;
      continue;
    }
    const alteration = take(/^\(?([#♯b♭+-])(5|9|11|13)\)?/);
    if (alteration) {
      const sign = alteration[1] === "#" || alteration[1] === "♯" || alteration[1] === "+" ? "#" : "b";
      alterations.push(`${sign}${alteration[2]}`);
      progress = true;
      continue;
    }
    if (take(/^alt/)) {
      alterations.push("alt");
      progress = true;
      continue;
    }
    // "C2": the second added (a common worship-chart shorthand).
    if (take(/^\(?2\)?/)) {
      extensions.push("add2");
      progress = true;
    }
  }

  if (rest.length > 0) return null;
  // "F9/6": a 6/9 chord - the nine added to the sixth, no seventh.
  if (extensions.includes("6") && extensions.includes("9") && !explicitSeventh && seventh === "minor") seventh = null;
  // "C#m7/b5": the minor seventh with its fifth flattened, written apart - half-diminished.
  if (quality === "minor" && seventh === "minor" && alterations.includes("b5")) {
    quality = "half-diminished";
    alterations.splice(alterations.indexOf("b5"), 1);
  }
  return { quality, seventh, extensions, alterations };
}

/** The note's pitch class: C = 0, C# = 1 … B = 11. */
export function semitoneOf(note: NoteName): number {
  return mod12(LETTER_SEMITONES[note.letter] + (note.accidental === "sharp" ? 1 : note.accidental === "flat" ? -1 : 0));
}

function noteText(note: NoteName, notation: ChordNotation = "english"): string {
  const name = notation === "solfege" ? SOLFEGE[note.letter] : note.letter;
  return name + (note.accidental === "sharp" ? "#" : note.accidental === "flat" ? "b" : "");
}

function rebuild(parts: ChordParts, notation: ChordNotation = "english"): string {
  const text = noteText(parts.root, notation) + parts.suffix + (parts.bass ? `/${noteText(parts.bass, notation)}` : "");
  return parts.optional ? `(${text})` : text;
}

/**
 * Whether keys like this one are written with flats (F, Bb, Dm...). A key
 * written with a sharp or a flat keeps it (F# and C#m use sharps, Gb and Ebm
 * flats); a natural one follows the usual spelling of its major (F and Dm
 * flats, G sharps). Null/unknown keys use sharps.
 */
export function keyUsesFlats(key: string | null | undefined): boolean {
  const match = key ? /^\s*([A-G])([#♯b♭]?)\s*(m(?!aj)|min|minor|-)?/i.exec(key) : null;
  if (!match) return false;
  if (match[2] === "#" || match[2] === "♯") return false;
  if (match[2] === "b" || match[2] === "♭") return true;
  const tonic = semitoneOf(toNote(match[1]!.toUpperCase(), match[2]!));
  const relativeMajor = match[3] ? mod12(tonic + 3) : tonic;
  return FLAT_MAJOR_KEYS.has(relativeMajor);
}

/**
 * The chord `steps` semitones up (or down, if negative), spelled for
 * `targetKey` (flats in F, Bb...; sharps otherwise). Only the root and bass
 * change. Anything that isn't a chord symbol comes back unchanged.
 */
export function transposeChord(raw: string, steps: number, targetKey?: string | null): string {
  const parts = splitChord(raw);
  if (!parts || mod12(steps) === 0) return raw;
  const spelling = keyUsesFlats(targetKey) ? FLAT_SPELLING : SHARP_SPELLING;
  const move = (note: NoteName) => spelling[mod12(semitoneOf(note) + steps)]!;
  return rebuild({ ...parts, root: move(parts.root), bass: parts.bass ? move(parts.bass) : null });
}

export interface DiatonicChord {
  /** The chord's degree in the key: "I", "ii", "vii°" (major), "i", "III" (minor). */
  degree: string;
  chord: string;
}

const MAJOR_SCALE: [number, string, string][] = [
  [0, "", "I"],
  [2, "m", "ii"],
  [4, "m", "iii"],
  [5, "", "IV"],
  [7, "", "V"],
  [9, "m", "vi"],
  [11, "dim", "vii°"],
];
const MINOR_SCALE: [number, string, string][] = [
  [0, "m", "i"],
  [2, "dim", "ii°"],
  [3, "", "III"],
  [5, "m", "iv"],
  [7, "m", "v"],
  [8, "", "VI"],
  [10, "", "VII"],
];

/**
 * The seven chords built on the key's scale, in order (G: G Am Bm C D Em
 * F#dim; Em: Em F#dim G Am Bm C D), spelled for the key. Empty for a key
 * it can't read.
 */
export function diatonicChords(key: string | null | undefined): DiatonicChord[] {
  const match = key ? /^\s*([A-G])([#♯b♭]?)\s*(m(?!aj)|min|minor|-)?\s*$/i.exec(key) : null;
  if (!match) return [];
  const tonic = semitoneOf(toNote(match[1]!.toUpperCase(), match[2]!));
  const spelling = keyUsesFlats(key) ? FLAT_SPELLING : SHARP_SPELLING;
  return (match[3] ? MINOR_SCALE : MAJOR_SCALE).map(([interval, suffix, degree]) => ({
    degree,
    chord: noteText(spelling[mod12(tonic + interval)]!) + suffix,
  }));
}

export type ChordNotation = "english" | "solfege" | "nashville" | "roman";
const SOLFEGE: Record<NoteLetter, string> = { C: "Do", D: "Ré", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si" };

/**
 * The chord with its notes named for `notation`: "Sol/Si" for "G/B" in
 * solfège; "1/3" in G as Nashville numbers, which need the key (letters
 * without one).
 */
export function formatChord(raw: string, notation: ChordNotation, key?: string | null): string {
  if (notation === "english") return raw;
  if (notation === "nashville") return nashvilleChord(raw, key);
  if (notation === "roman") return romanChord(raw, key);
  const parts = splitChord(raw);
  return parts ? rebuild(parts, notation) : raw;
}

// Each semitone above the key's tonic as a scale degree, as Nashville charts write them.
const DEGREES = ["1", "b2", "2", "b3", "3", "4", "#4", "5", "b6", "6", "b7", "7"];

/**
 * The chord as a Nashville number in `key` (issue #207): its root and bass as
 * degrees of the key, the rest as written - Em7 in D is "2m7", D/F# "1/3",
 * Bb in C "b7". A minor key counts from its own tonic (in Em, Em is "1m",
 * G "b3"). Without a key it can read, or for anything that isn't a chord,
 * the chord as written.
 */
export function nashvilleChord(raw: string, key: string | null | undefined): string {
  const parts = splitChord(raw);
  const match = key ? /^\s*([A-G])([#♯b♭]?)/i.exec(key) : null;
  if (!parts || !match) return raw;
  const tonic = semitoneOf(toNote(match[1]!.toUpperCase(), match[2]!));
  const degree = (note: NoteName) => DEGREES[mod12(semitoneOf(note) - tonic)]!;
  const text = degree(parts.root) + parts.suffix + (parts.bass ? `/${degree(parts.bass)}` : "");
  return parts.optional ? `(${text})` : text;
}

// Each semitone above the key's tonic as a Roman numeral, for a major chord on it.
const NUMERALS = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];

/**
 * The chord as a Roman numeral in `key` (issue #220): its root counted from
 * the key's tonic, as nashvilleChord counts, in capitals for a major chord and
 * lowercase for a minor or diminished one - Em7 in D is "ii7", A7 "V7",
 * C#m7b5 "viiø7", C#dim "vii°", Bb in C "♭VII". The bass of a slash chord
 * is a degree, as in Nashville (D/F# is "I/3"), never mistaken for a
 * secondary dominant (V/V). A minor key counts from its own tonic. Without
 * a key it can read, or for anything that isn't a chord, the chord as written.
 */
export function romanChord(raw: string, key: string | null | undefined): string {
  const parsed = parseChord(raw);
  const match = key ? /^\s*([A-G])([#♯b♭]?)/i.exec(key) : null;
  if (!parsed || parsed.kind !== "chord" || !match) return raw;
  const tonic = semitoneOf(toNote(match[1]!.toUpperCase(), match[2]!));
  const step = (note: NoteName) => mod12(semitoneOf(note) - tonic);
  const { quality, seventh, extensions, alterations } = parsed;
  const lower = quality === "minor" || quality === "diminished" || quality === "half-diminished";
  const numeral = lower ? NUMERALS[step(parsed.root)]!.toLowerCase() : NUMERALS[step(parsed.root)]!;
  // A 9, 11 or 13 over a seventh names the chord in its place (V9, Imaj13); the others follow.
  const upper: string[] = seventh ? extensions.filter((one) => one === "9" || one === "11" || one === "13") : [];
  const highest = upper.at(-1) ?? "7";
  const rest = extensions.filter((one) => !upper.includes(one));
  const added = rest.includes("6") && rest.includes("9") && rest.length === 2 ? "6/9" : rest.join("");
  const mark = quality === "diminished" ? "°" : quality === "half-diminished" ? "ø" : quality === "augmented" ? "+" : "";
  const sevenths = quality === "half-diminished" ? highest : seventh ? (seventh === "major" ? "maj" : "") + highest : "";
  const sus = quality === "sus2" || quality === "sus4" ? quality : quality === "power" ? "5" : "";
  const text = numeral + mark + sevenths + added + sus + alterations.join("") + (parsed.bass ? `/${DEGREES[step(parsed.bass)]}` : "");
  return parsed.optional ? `(${text})` : text;
}

/** A chord's family, for colouring it (issue #9): what it sounds like at a glance. */
export type ChordFamily = "major" | "minor" | "suspended" | "diminished" | "augmented" | "dominant";

/**
 * Which family a chord belongs to: a major triad with a minor seventh (G7,
 * G9, G13) is dominant; sus2 and sus4 (and 7sus4) suspended; half-diminished
 * diminished. Null for a power chord (no third), "N.C." and anything that
 * isn't a chord.
 */
export function chordFamily(raw: string): ChordFamily | null {
  const parsed = parseChord(raw);
  if (!parsed || parsed.kind !== "chord") return null;
  switch (parsed.quality) {
    case "major":
      return parsed.seventh === "minor" ? "dominant" : "major";
    case "minor":
      return "minor";
    case "sus2":
    case "sus4":
      return "suspended";
    case "diminished":
    case "half-diminished":
      return "diminished";
    case "augmented":
      return "augmented";
    default:
      return null;
  }
}

export interface SimplifyOptions {
  /** Keep only the triad: Gmaj7 -> G, Em7 -> Em, Bm7b5 -> Bdim, Csus4 stays. */
  dropExtensions?: boolean;
  /** Drop the bass note of a slash chord: D/F# -> D. */
  dropBass?: boolean;
}

/** A simpler version of the chord for a player who wants fewer changes to read. */
export function simplifyChord(raw: string, options: SimplifyOptions): string {
  const parts = splitChord(raw);
  const parsed = parseChord(raw);
  if (!parts || !parsed || parsed.kind !== "chord") return raw;
  const triad: Record<ParsedChordQuality, string> = {
    major: "",
    minor: "m",
    diminished: "dim",
    "half-diminished": "dim",
    augmented: "aug",
    sus2: "sus2",
    sus4: "sus4",
    power: "5",
  };
  return rebuild({
    ...parts,
    suffix: options.dropExtensions ? triad[parsed.quality] : parts.suffix,
    bass: options.dropBass ? null : parts.bass,
  });
}

export type BassRole = "root" | "third" | "fifth" | "seventh" | "key";

export interface ChordBassOption {
  /** The chord with this note in the bass: "C/E" (or "C" for its root). */
  chord: string;
  /** The bass note as written: "E". */
  bass: string;
  /** Which of the chord's notes it is (root position, 1st, 2nd or 3rd inversion), or "key": another note of the key under it. */
  role: BassRole;
}

const LETTERS: NoteLetter[] = ["C", "D", "E", "F", "G", "A", "B"];

/** The note `interval` semitones above the root, spelled `steps` letters above it (E in C, F# in D, D in Bb), or by the key's spelling when that would need a double sharp or flat. */
function spellAbove(root: NoteName, interval: number, steps: number, flats: boolean): NoteName {
  const pitch = mod12(semitoneOf(root) + interval);
  const letter = LETTERS[(LETTERS.indexOf(root.letter) + steps) % 7]!;
  const off = mod12(pitch - LETTER_SEMITONES[letter]);
  if (off === 0) return { letter, accidental: null };
  if (off === 1) return { letter, accidental: "sharp" };
  if (off === 11) return { letter, accidental: "flat" };
  return (flats ? FLAT_SPELLING : SHARP_SPELLING)[pitch]!;
}

/**
 * The bass notes a chord can take (issue #228), for a quick pick in the
 * editor: its own notes first - root position, then the 1st, 2nd and (for a
 * seventh) 3rd inversions, spelled from the chord (D/F#, Bb/D) - then the
 * key's other notes, for a bass line walking under it (C/B, C/D in G).
 * Empty for something that isn't a chord.
 */
export function chordBassOptions(raw: string, key?: string | null): ChordBassOption[] {
  const parts = splitChord(raw);
  const parsed = parseChord(raw);
  if (!parts || !parsed || parsed.kind !== "chord") return [];
  const flats = keyUsesFlats(key) || (!key && parts.root.accidental === "flat");
  const thirds: Record<ParsedChordQuality, [number, number] | null> = {
    major: [4, 2],
    augmented: [4, 2],
    minor: [3, 2],
    diminished: [3, 2],
    "half-diminished": [3, 2],
    sus2: [2, 1],
    sus4: [5, 3],
    power: null,
  };
  let fifth = parsed.quality === "diminished" || parsed.quality === "half-diminished" ? 6 : parsed.quality === "augmented" ? 8 : 7;
  if (parsed.alterations.includes("b5")) fifth = 6;
  if (parsed.alterations.includes("#5")) fifth = 8;
  const tones: [BassRole, NoteName][] = [["root", parts.root]];
  const third = thirds[parsed.quality];
  if (third) tones.push(["third", spellAbove(parts.root, third[0], third[1], flats)]);
  tones.push(["fifth", spellAbove(parts.root, fifth, 4, flats)]);
  if (parsed.seventh) tones.push(["seventh", spellAbove(parts.root, parsed.seventh === "major" ? 11 : parsed.seventh === "minor" ? 10 : 9, 6, flats)]);
  const own = new Set(tones.map(([, note]) => semitoneOf(note)));
  const rootPitch = semitoneOf(parts.root);
  const scale = diatonicChords(key)
    .map((one) => splitChord(one.chord)?.root)
    .filter((note): note is NoteName => !!note && !own.has(semitoneOf(note)))
    // Upward from the chord's root, as a bass walks.
    .sort((a, b) => mod12(semitoneOf(a) - rootPitch) - mod12(semitoneOf(b) - rootPitch));
  const options = [...tones, ...scale.map((note): [BassRole, NoteName] => ["key", note])];
  return options.map(([role, note]) => ({
    chord: rebuild({ ...parts, bass: role === "root" ? null : note }),
    bass: noteText(note),
    role,
  }));
}

/** Whether two chord symbols sound the same (same notes, however they're spelled or written). */
export function sameChord(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const [x, y] = [parseChord(a), parseChord(b)];
  if (!x || !y || x.kind !== y.kind) return false;
  if (x.kind === "no-chord" || y.kind === "no-chord") return true;
  return (
    semitoneOf(x.root) === semitoneOf(y.root) &&
    x.quality === y.quality &&
    x.seventh === y.seventh &&
    x.extensions.join() === y.extensions.join() &&
    x.alterations.join() === y.alterations.join() &&
    (x.bass ? semitoneOf(x.bass) : -1) === (y.bass ? semitoneOf(y.bass) : -1)
  );
}

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}
