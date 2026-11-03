/**
 * The tuner's note maths (issue #3): frequency to the nearest note and how
 * far off it is, against a concert pitch (A4) and a temperament - the
 * temperament taken from a key, so Just intonation in G is Just in G.
 */

export const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;

export const DEFAULT_A4 = 440;
export const MIN_A4 = 392;
export const MAX_A4 = 466;

export const TEMPERAMENTS = ["equal", "just", "pythagorean", "meantone"] as const;
export type Temperament = (typeof TEMPERAMENTS)[number];

/** Just intonation's ratios above the key's tonic, a semitone at a time (5-limit). */
const JUST_RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 16 / 9, 15 / 8];
/** Fifths from the tonic for each semitone: Pythagorean and meantone are chains of fifths, from five down to six up. */
const FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

/** Cents away from equal temperament for each semitone above the key's tonic. */
export function temperamentOffsets(temperament: Temperament): number[] {
  switch (temperament) {
    case "just":
      return JUST_RATIOS.map((ratio, step) => 1200 * Math.log2(ratio) - 100 * step);
    case "pythagorean":
      // A pure fifth is 1.955 cents wider than an equal one.
      return FIFTHS.map((fifths) => fifths * (1200 * Math.log2(3 / 2) - 700));
    case "meantone":
      // Quarter-comma: each fifth a quarter of the syntonic comma narrow, so thirds are pure.
      return FIFTHS.map((fifths) => fifths * (1200 * Math.log2(5 ** 0.25) - 700));
    default:
      return Array.from({ length: 12 }, () => 0);
  }
}

/** MIDI number (C4 = 60, A4 = 69) of a name such as "E2", "Bb3", "F#4", "Cb4" (= B3), or null. */
export function parseNoteName(name: string): number | null {
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim());
  if (!match) return null;
  const natural = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]!.toUpperCase() as "C"]!;
  const alter = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  // Octaves are the natural's: Cb4 is a semitone below C4, B#3 a semitone above B3.
  return (Number(match[3]) + 1) * 12 + natural + alter;
}

export function midiToHz(midi: number, a4: number = DEFAULT_A4): number {
  return a4 * 2 ** ((midi - 69) / 12);
}

export function hzToMidi(hz: number, a4: number = DEFAULT_A4): number {
  return 12 * Math.log2(hz / a4) + 69;
}

export function noteName(midi: number, flats = false): string {
  return (flats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[((Math.round(midi) % 12) + 12) % 12]!;
}

export function octaveOf(midi: number): number {
  return Math.floor(Math.round(midi) / 12) - 1;
}

export interface TunerNote {
  /** The nearest note, as a MIDI number. */
  midi: number;
  /** How far from its target, in cents: positive is sharp. */
  cents: number;
  /** The target, in Hz: equal-tempered, moved by the temperament. */
  targetHz: number;
}

export interface TuningReference {
  a4?: number;
  temperament?: Temperament;
  /** The key's tonic, 0 (C) to 11: what the temperament is tuned from. */
  tonic?: number;
}

/** The note nearest `hz`, and how far off it is (issue #3). */
export function nearestNote(hz: number, { a4 = DEFAULT_A4, temperament = "equal", tonic = 0 }: TuningReference = {}): TunerNote {
  const exact = hzToMidi(hz, a4);
  const offsets = temperamentOffsets(temperament);
  // The note whose (tempered) target is nearest: a tempered note can move by up to 20 cents.
  let midi = Math.round(exact);
  let best = Infinity;
  for (const candidate of [midi - 1, midi, midi + 1]) {
    const offset = offsets[(((candidate - tonic) % 12) + 12) % 12]!;
    const distance = Math.abs((exact - candidate) * 100 - offset);
    if (distance < best) {
      best = distance;
      midi = candidate;
    }
  }
  const offset = offsets[(((midi - tonic) % 12) + 12) % 12]!;
  return { midi, cents: (exact - midi) * 100 - offset, targetHz: midiToHz(midi, a4) * 2 ** (offset / 1200) };
}
