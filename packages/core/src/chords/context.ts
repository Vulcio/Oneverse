import { diatonicChords, keyUsesFlats, parseChord, sameChord, semitoneOf, simplifyChord, type ParsedChord } from "./chord.js";
import { formatKey, parseKey, type ParsedKey } from "../music-keys/transpose.js";
import type { SectionV2 } from "../schemas/song-document-v2.js";

/**
 * Chords that seem out of context (issue #356): a chord outside the song's
 * key and the chords songs in that key usually borrow, or unlike the same
 * place in the song's other sections of its kind (a typo such as Bm where
 * every other chorus has D). Each comes with why, and a suggestion when
 * there's a likely one. Only ever suggested: nothing here changes a chart.
 *
 * Chords are stored in the song's key (a key change in the order moves
 * them when they're shown), so every chord is read in the song's key. A
 * song without a key is read in the key its chords fit, when they clearly
 * fit one; a song whose chords mostly don't fit its key gets that said
 * once, instead of a mark on every chord.
 */

/** Why a chord seems out of place. */
export type ChordCheckReason =
  /** Not one of the key's chords, nor one songs in that key often borrow, and rare in the song. */
  | { kind: "outsideKey"; key: string; inKey: string[]; borrowed: string[]; times: number }
  /** The other sections of its kind (`others` of them) all have `usual` at this place. */
  | { kind: "unlikeOthers"; sectionType: string; others: number; usual: string };

export interface ChordCheck {
  chordId: string;
  sectionId: string;
  lineId: string;
  raw: string;
  reason: ChordCheckReason;
  /** The chord it's likely meant to be, written as it would go in the chart; null when there's no clear one. */
  suggestion: string | null;
}

export interface KeyCheck {
  /** The key written for the song. */
  written: string;
  /** The key the chords fit best. */
  fits: string;
  /** How many of the song's chords are outside the written key, and outside the one they fit. */
  outsideWritten: number;
  outsideFits: number;
  total: number;
}

export interface ChartChordChecks {
  /** The key the chords were read in: the song's, or the one they fit when it has none; null when neither. */
  key: string | null;
  keyGuessed: boolean;
  /** Set when the chords mostly don't fit the written key, but fit another. */
  keyCheck: KeyCheck | null;
  chords: ChordCheck[];
}

type Quality = "major" | "minor" | "diminished" | "other";

interface ChordAt {
  chordId: string;
  sectionId: string;
  lineId: string;
  raw: string;
  parsed: ParsedChord;
}

// The key's own chords, by interval above the tonic and quality.
const MAJOR_OWN: Record<number, Quality> = { 0: "major", 2: "minor", 4: "minor", 5: "major", 7: "major", 9: "minor", 11: "diminished" };
const MINOR_OWN: Record<number, Quality> = { 0: "minor", 2: "diminished", 3: "major", 5: "minor", 7: "minor", 8: "major", 10: "major" };

/**
 * What songs in a key commonly use beyond its own chords. In a major key:
 * major chords on bIII, bVI and bVII and a minor iv (borrowed from the minor),
 * the secondary dominants (I7, II, III, VI, VII), and diminished chords
 * leading to the next chord up. In a minor key: the major V and IV, a major
 * I, II, the ii minor, and the same passing diminished chords. A half-diminished
 * chord leading to the vi (Bm7b5 in G) counts with the passing ones.
 */
const MAJOR_BORROWED: Record<Quality, number[]> = {
  major: [0, 2, 3, 4, 8, 9, 10, 11],
  minor: [5],
  diminished: [0, 1, 2, 3, 4, 6, 8],
  other: [],
};
const MINOR_BORROWED: Record<Quality, number[]> = {
  major: [0, 2, 5, 7],
  minor: [2],
  diminished: [1, 6, 9, 11],
  other: [],
};
// Shown as examples of what's borrowed, in this order (in G: F, Eb, Cm, A, E).
const MAJOR_EXAMPLES: [number, string][] = [
  [10, ""],
  [8, ""],
  [5, "m"],
  [2, ""],
  [4, ""],
];
const MINOR_EXAMPLES: [number, string][] = [
  [7, ""],
  [5, ""],
  [0, ""],
];

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** How many times a chord outside the key may come before it reads as meant. */
const RARE = 2;

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function qualityOf(chord: ParsedChord): Quality {
  if (chord.quality === "major" || chord.quality === "augmented") return "major";
  if (chord.quality === "minor") return "minor";
  if (chord.quality === "diminished" || chord.quality === "half-diminished") return "diminished";
  return "other";
}

function scaleOf(key: ParsedKey): number[] {
  return Object.keys(key.minor ? MINOR_OWN : MAJOR_OWN).map(Number);
}

/** How a chord sits in a key: one of its own, commonly borrowed, or outside. */
function fitIn(chord: ParsedChord, key: ParsedKey): "own" | "borrowed" | "outside" {
  const step = mod12(semitoneOf(chord.root) - key.semitone);
  const quality = qualityOf(chord);
  const own = key.minor ? MINOR_OWN : MAJOR_OWN;
  // A suspended or power chord has no third: its root decides.
  if (quality === "other") return step in own ? "own" : (key.minor ? MINOR_BORROWED : MAJOR_BORROWED).major.includes(step) ? "borrowed" : "outside";
  if (own[step] === quality) return "own";
  // The harmonic minor's diminished vii° and the minor key's own ii° read as its own.
  if ((key.minor ? MINOR_BORROWED : MAJOR_BORROWED)[quality].includes(step)) return "borrowed";
  return "outside";
}

function keyName(key: ParsedKey): string {
  return formatKey(key);
}

function noteIn(semitone: number, key: string): string {
  return (keyUsesFlats(key) ? FLAT : SHARP)[mod12(semitone)]!;
}

function borrowedExamples(key: ParsedKey, name: string): string[] {
  // The chords borrowed from the minor are written with flats in a sharp key too (Eb in G, not D#).
  return (key.minor ? MINOR_EXAMPLES : MAJOR_EXAMPLES).map(([step, suffix]) => ([3, 8, 10].includes(step) ? FLAT[mod12(key.semitone + step)]! : noteIn(key.semitone + step, name)) + suffix);
}

function chordsOf(sections: readonly Pick<SectionV2, "id" | "lines">[]): ChordAt[] {
  const all: ChordAt[] = [];
  for (const section of sections) {
    for (const line of section.lines) {
      for (const chord of [...line.chords].sort((a, b) => a.at - b.at)) {
        const parsed = parseChord(chord.raw);
        if (parsed?.kind === "chord") all.push({ chordId: chord.id, sectionId: section.id, lineId: line.id, raw: chord.raw, parsed });
      }
    }
  }
  return all;
}

const ALL_KEYS: ParsedKey[] = Array.from({ length: 24 }, (_, index) => ({ semitone: index % 12, minor: index >= 12 }));

/** How well the chords fit each key: own chords count 1, borrowed ones a half; starting and ending on its tonic chord count too. */
function keyScores(chords: ChordAt[]): { key: ParsedKey; score: number; outside: number }[] {
  const first = chords[0]?.parsed;
  const last = chords.at(-1)?.parsed;
  const isTonic = (chord: ParsedChord | undefined, key: ParsedKey) => !!chord && semitoneOf(chord.root) === key.semitone && qualityOf(chord) === (key.minor ? "minor" : "major");
  return ALL_KEYS.map((key) => {
    let score = 0;
    let outside = 0;
    for (const chord of chords) {
      const fit = fitIn(chord.parsed, key);
      if (fit === "own") score += 1;
      else if (fit === "borrowed") score += 0.5;
      else outside += 1;
    }
    // A tie between a major key and its relative minor goes to the one the song starts or ends on.
    score += (isTonic(first, key) ? 1 : 0) + (isTonic(last, key) ? 1 : 0);
    return { key, score, outside };
  }).sort((a, b) => b.score - a.score || (a.key.minor === b.key.minor ? 0 : a.key.minor ? 1 : -1));
}

/** The chord written in the key's spelling with the same root: its own triad there (Dm in G is D), keeping a written 7th. */
function ownChordOn(chord: ParsedChord, raw: string, key: ParsedKey, name: string): string | null {
  const step = mod12(semitoneOf(chord.root) - key.semitone);
  const quality = (key.minor ? MINOR_OWN : MAJOR_OWN)[step];
  if (!quality) return null;
  const triad = diatonicChords(name).find((one) => mod12(semitoneOf(parsedRoot(one.chord)) - key.semitone) === step)?.chord;
  if (!triad) return null;
  const seventh = chord.seventh === "minor" && quality !== "diminished" ? "7" : "";
  const bass = /\/([A-G][#b♯♭]?)\s*\)?$/.exec(raw)?.[1];
  return triad + seventh + (bass ? `/${bass}` : "");
}

function parsedRoot(raw: string) {
  return (parseChord(raw) as ParsedChord).root;
}

/** The key's own chord a semitone away with the same quality, when there's only one (G#m in G is Am; C#m has none). */
function nearbyOwnChord(chord: ParsedChord, key: ParsedKey, name: string): string | null {
  const quality = qualityOf(chord);
  const near = diatonicChords(name).filter((one) => {
    const parsed = parseChord(one.chord) as ParsedChord;
    const apart = mod12(semitoneOf(parsed.root) - semitoneOf(chord.root));
    return (apart === 1 || apart === 11) && qualityOf(parsed) === quality;
  });
  return near.length === 1 ? near[0]!.chord : null;
}

/** The same chord for the purpose of comparing sections: the triad, without extensions or bass. */
function triadKey(raw: string): string {
  return simplifyChord(raw.replace(/^\((.*)\)$/, "$1"), { dropExtensions: true, dropBass: true });
}

/**
 * The places where one section of a kind differs from all the others of its
 * kind (at least two of them, agreeing): the same line, the same number of
 * chords, and this chord the only one that's different on it.
 */
function unlikeOthers(sections: readonly Pick<SectionV2, "id" | "type" | "lines">[]): Map<string, { usual: string; others: number; sectionType: string }> {
  const found = new Map<string, { usual: string; others: number; sectionType: string }>();
  const byType = new Map<string, Pick<SectionV2, "id" | "type" | "lines">[]>();
  for (const section of sections) byType.set(section.type, [...(byType.get(section.type) ?? []), section]);
  for (const [type, group] of byType) {
    if (group.length < 3) continue;
    const lines = Math.max(...group.map((section) => section.lines.length));
    for (let index = 0; index < lines; index++) {
      const rows = group.map((section) => {
        const line = section.lines[index];
        return line ? [...line.chords].sort((a, b) => a.at - b.at).filter((chord) => parseChord(chord.raw)?.kind === "chord") : null;
      });
      for (let candidate = 0; candidate < group.length; candidate++) {
        const mine = rows[candidate];
        const others = rows.filter((row, at) => at !== candidate && row && row.length > 0);
        if (!mine || mine.length === 0 || others.length < 2 || others.some((row) => row!.length !== mine.length)) continue;
        // The others agree with each other everywhere on the line.
        const agree = mine.every((_, place) => others.every((row) => sameChord(triadKey(row![place]!.raw), triadKey(others[0]![place]!.raw))));
        if (!agree) continue;
        const differ = mine.map((chord, place) => !sameChord(triadKey(chord.raw), triadKey(others[0]![place]!.raw)));
        if (differ.filter(Boolean).length !== 1) continue;
        const place = differ.indexOf(true);
        found.set(mine[place]!.id, { usual: others[0]![place]!.raw, others: others.length, sectionType: type });
      }
    }
  }
  return found;
}

/**
 * The chords of a chart that seem out of place, in the order they're
 * written, and whether its key looks wrong. `key` is the song's key as
 * written ("G", "F#m"); empty or null when it has none.
 */
export function checkChartChords(chart: {
  key?: string | null;
  sections: readonly Pick<SectionV2, "id" | "type" | "lines">[];
  /** The key is kept as written though the chords fit another: mark each chord outside it instead. */
  ignoreKeyCheck?: boolean;
}): ChartChordChecks {
  const chords = chordsOf(chart.sections);
  const written = chart.key ? parseKey(chart.key) : null;
  const scores = keyScores(chords);
  const best = scores[0];
  let key = written;
  let keyGuessed = false;
  let keyCheck: KeyCheck | null = null;

  if (!written && best && chords.length >= 6 && best.outside <= chords.length * 0.15) {
    key = best.key;
    keyGuessed = true;
  }
  if (written && best && chords.length >= 8 && !chart.ignoreKeyCheck) {
    const mine = scores.find((one) => one.key.semitone === written.semitone && one.key.minor === written.minor)!;
    // The relative major or minor shares the chords: not a different key.
    const relative = best.key.minor !== written.minor && mod12(best.key.semitone - written.semitone) === (written.minor ? 3 : 9);
    const same = best.key.semitone === written.semitone && best.key.minor === written.minor;
    if (!same && !relative && mine.outside >= chords.length * 0.25 && best.outside * 2 <= mine.outside) {
      keyCheck = { written: chart.key!.trim(), fits: keyName(best.key), outsideWritten: mine.outside, outsideFits: best.outside, total: chords.length };
    }
  }

  const name = key ? (!keyGuessed && diatonicChords(chart.key).length > 0 ? chart.key!.trim() : keyName(key)) : null;
  const unlike = unlikeOthers(chart.sections);
  const counts = new Map<string, number>();
  for (const chord of chords) counts.set(triadKey(chord.raw), (counts.get(triadKey(chord.raw)) ?? 0) + 1);
  const scale = key ? scaleOf(key) : [];

  const checks: ChordCheck[] = [];
  for (const chord of chords) {
    const differs = unlike.get(chord.chordId);
    if (differs) {
      checks.push({ ...place(chord), reason: { kind: "unlikeOthers", ...differs }, suggestion: differs.usual });
      continue;
    }
    // A key that looks wrong is said once; every chord marked against it would only be noise.
    if (!key || !name || keyCheck) continue;
    if (fitIn(chord.parsed, key) !== "outside") continue;
    const times = counts.get(triadKey(chord.raw)) ?? 0;
    if (times > RARE) continue;
    const onScale = scale.includes(mod12(semitoneOf(chord.parsed.root) - key.semitone));
    const suggestion = onScale ? ownChordOn(chord.parsed, chord.raw, key, name) : nearbyOwnChord(chord.parsed, key, name);
    checks.push({
      ...place(chord),
      reason: { kind: "outsideKey", key: name, inKey: diatonicChords(name).map((one) => one.chord), borrowed: borrowedExamples(key, name), times },
      suggestion: suggestion && !sameChord(suggestion, chord.raw) ? suggestion : null,
    });
  }
  return { key: name, keyGuessed, keyCheck, chords: checks };
}

function place(chord: ChordAt) {
  return { chordId: chord.chordId, sectionId: chord.sectionId, lineId: chord.lineId, raw: chord.raw };
}
