import type { SectionType } from "../constants/index.js";
import type { TimeSignature } from "../schemas/shared.js";

/**
 * Drum grooves (issue #105): built-in styles, each a few one-bar patterns -
 * Light, Simple, Full, Half-time - and a fill for a section's last bar. A
 * song's sections pick a style and a variation; the patterns play with the
 * metronome, on every device the same, offline and headless (Pulse), as a
 * kit made on the device or as MIDI (General MIDI drums, channel 10).
 *
 * A pattern is one bar, a row per drum, a character per step:
 * `X` accent, `x` a hit, `o` a ghost note, `.` nothing. A bar of 4/4 in
 * sixteenths is 16 steps; a shuffle's in triplets, 12; 6/8's eighths in
 * sixteenths, 12.
 */

export const GROOVE_DRUMS = ["kick", "snare", "rim", "hihat", "openHihat", "ride", "crash", "tomHigh", "tomLow"] as const;
export type GrooveDrum = (typeof GROOVE_DRUMS)[number];

/** General MIDI drum notes (channel 10). */
export const GROOVE_MIDI_NOTES: Readonly<Record<GrooveDrum, number>> = {
  kick: 36,
  snare: 38,
  rim: 37,
  hihat: 42,
  openHihat: 46,
  ride: 51,
  crash: 49,
  tomHigh: 48,
  tomLow: 43,
};

/** Each hit's MIDI velocity: accent, hit, ghost. */
export const GROOVE_VELOCITIES = { X: 118, x: 92, o: 46 } as const;

export const GROOVE_VARIANTS = ["light", "simple", "full", "halfTime"] as const;
export type GrooveVariant = (typeof GROOVE_VARIANTS)[number];

export type GroovePatternRows = Partial<Record<GrooveDrum, string>>;

export interface GrooveStyle {
  id: string;
  /** Its time signature: a style plays only in bars of it. */
  timeSignature: TimeSignature;
  /** Steps in a bar, evenly spread over it. */
  steps: number;
  variants: Readonly<Record<GrooveVariant, GroovePatternRows>>;
  fill: GroovePatternRows;
}

const four: TimeSignature = { numerator: 4, denominator: 4 };

/** The built-in styles, in the order they're offered. */
export const GROOVE_STYLES: readonly GrooveStyle[] = [
  {
    id: "pop-rock",
    timeSignature: four,
    steps: 16,
    variants: {
      light: { kick: "x.......x.......", rim: "....x.......x...", hihat: "x...x...x...x..." },
      simple: { kick: "x.......x.......", snare: "....X.......X...", hihat: "x.x.x.x.x.x.x.x." },
      full: { kick: "x.....x.x.x.....", snare: "....X.......X...", hihat: "X.x.X.x.X.x.X.x." },
      halfTime: { kick: "x.........x.....", snare: "........X.......", hihat: "x.x.x.x.x.x.x.x." },
    },
    fill: { kick: "x.......x.......", snare: "....X...x.x.xxXX", hihat: "x.x.x.x.........", tomHigh: "..........x.....", tomLow: "............x..." },
  },
  {
    id: "worship",
    timeSignature: four,
    steps: 16,
    variants: {
      light: { kick: "x...x...x...x...", hihat: "..x...x...x...x." },
      simple: { kick: "x...x...x...x...", snare: "....x.......x...", openHihat: "..x...x...x...x." },
      full: { kick: "x...x...x...x...", snare: "....X.......X...", hihat: "x...x...x...x...", openHihat: "..X...X...X...X." },
      halfTime: { kick: "x.......x.......", snare: "........X.......", hihat: "x.x.x.x.x.x.x.x." },
    },
    fill: { kick: "x...x...x...x...", snare: "........xxxxXXXX", hihat: "x...x..........." },
  },
  {
    id: "ballad",
    timeSignature: four,
    steps: 16,
    variants: {
      light: { kick: "x.........x.....", rim: "....x.......x...", hihat: "x...x...x...x..." },
      simple: { kick: "x.........x.....", snare: "....x.......x...", hihat: "x.x.x.x.x.x.x.x." },
      full: { kick: "x......xx.x.....", snare: "....X.......X...", ride: "x.x.x.x.x.x.x.x." },
      halfTime: { kick: "x...............", snare: "........x.......", hihat: "x...x...x...x..." },
    },
    fill: { kick: "x...............", snare: "........x.x.x.XX", hihat: "x...x...........", tomHigh: "..........x.....", tomLow: "............x.x." },
  },
  {
    id: "ballad-6-8",
    timeSignature: { numerator: 6, denominator: 8 },
    steps: 12,
    variants: {
      light: { kick: "x...........", rim: "......x.....", hihat: "x...x...x..." },
      simple: { kick: "x...........", snare: "......X.....", hihat: "x.x.x.x.x.x." },
      full: { kick: "x...x.......", snare: "......X.....", hihat: "X.x.x.X.x.x." },
      halfTime: { kick: "x...........", ride: "x.x.x.x.x.x.", rim: "......x....." },
    },
    fill: { kick: "x...........", snare: "......x.x.XX", hihat: "x.x.x.......", tomHigh: "........x...", tomLow: "..........x." },
  },
  {
    id: "rock-6-8",
    timeSignature: { numerator: 6, denominator: 8 },
    steps: 12,
    variants: {
      light: { kick: "x.....x.....", snare: "......x.....", hihat: "x.x.x.x.x.x." },
      simple: { kick: "x...x.x.....", snare: "......X.....", hihat: "X.x.x.X.x.x." },
      full: { kick: "x.x.x.x.x...", snare: "......X.....", ride: "X.x.x.X.x.x." },
      halfTime: { kick: "x.....x.....", hihat: "x.x.x.x.x.x.", rim: "......x....." },
    },
    fill: { kick: "x.....x.....", snare: "x.x.x.X.x.X.", tomHigh: "..x.........", tomLow: "........x.x." },
  },
  {
    id: "waltz",
    timeSignature: { numerator: 3, denominator: 4 },
    steps: 12,
    variants: {
      light: { kick: "x...........", rim: "....x...x...", hihat: "x...x...x..." },
      simple: { kick: "x...........", snare: "....x...x...", hihat: "x.x.x.x.x.x." },
      full: { kick: "x.......x...", snare: "....X...X...", ride: "x.x.x.x.x.x." },
      halfTime: { kick: "x...........", snare: "........x...", hihat: "x...x...x..." },
    },
    fill: { kick: "x...........", snare: "....x.x.x.XX", tomLow: "......x.x..." },
  },
  {
    id: "shuffle",
    timeSignature: four,
    steps: 12,
    variants: {
      light: { kick: "x.....x.....", rim: "...x.....x..", hihat: "x.xx.xx.xx.x" },
      simple: { kick: "x.....x.....", snare: "...X.....X..", hihat: "x.xx.xx.xx.x" },
      full: { kick: "x....xx.....", snare: "...X.....X..", ride: "X.xX.xX.xX.x" },
      halfTime: { kick: "x.....x.....", snare: "......X.....", hihat: "x.xx.xx.xx.x" },
    },
    fill: { kick: "x.....x.....", snare: "...X..x.xX.X", tomHigh: "......x.....", tomLow: "........x..." },
  },
  {
    id: "gospel-shuffle",
    timeSignature: four,
    steps: 12,
    variants: {
      light: { kick: "x.....x.....", snare: "...o.....o..", hihat: "x..x..x..x.." },
      simple: { kick: "x.....x.....", snare: "..oX..o..X.o", hihat: "x.xx.xx.xx.x" },
      full: { kick: "x....xx....x", snare: "..oX..o.oX.o", hihat: "X.xX.xX.xX.x" },
      halfTime: { kick: "x........x..", snare: "......X.....", hihat: "x.xx.xx.xx.x" },
    },
    fill: { kick: "x.....x.....", snare: "...X..xxx.XX", tomHigh: "......x.....", tomLow: "........x..." },
  },
  {
    id: "bossa",
    timeSignature: four,
    steps: 16,
    variants: {
      light: { kick: "x..xx..xx..xx..x", hihat: "x.x.x.x.x.x.x.x." },
      simple: { kick: "x..xx..xx..xx..x", rim: "x..x..x...x..x..", hihat: "x.x.x.x.x.x.x.x." },
      full: { kick: "x..xx..xx..xx..x", rim: "x..x..x...x..x..", ride: "xxxxxxxxxxxxxxxx" },
      halfTime: { kick: "x.......x.......", rim: "x..x..x...x..x..", hihat: "x...x...x...x..." },
    },
    fill: { kick: "x..xx..x........", snare: "........x.x.x.xX", rim: "x..x..x........." },
  },
  {
    id: "half-time",
    timeSignature: four,
    steps: 16,
    variants: {
      light: { kick: "x...............", rim: "........x.......", hihat: "x...x...x...x..." },
      simple: { kick: "x.........x.....", snare: "........X.......", hihat: "x.x.x.x.x.x.x.x." },
      full: { kick: "x.....x...x.....", snare: "........X.......", ride: "X.x.X.x.X.x.X.x." },
      halfTime: { kick: "x...............", snare: "........x.......", hihat: "x...x...x...x..." },
    },
    fill: { kick: "x.........x.....", snare: "........x.xxX.XX", tomHigh: "...........x....", tomLow: ".............x.." },
  },
];

export function grooveStyle(id: string | null | undefined): GrooveStyle | null {
  return GROOVE_STYLES.find((style) => style.id === id) ?? null;
}

export function isGrooveVariant(value: unknown): value is GrooveVariant {
  return typeof value === "string" && (GROOVE_VARIANTS as readonly string[]).includes(value);
}

const sameSignature = (a: TimeSignature, b: TimeSignature) => a.numerator === b.numerator && a.denominator === b.denominator;

/** The styles that play in a time signature (4/4 without one). */
export function groovesFor(timeSignature: TimeSignature | null | undefined): GrooveStyle[] {
  return GROOVE_STYLES.filter((style) => sameSignature(style.timeSignature, timeSignature ?? four));
}

/** The variation a section gets when a style is picked for the whole song: verses Simple, choruses Full, a bridge Half-time, the edges Light. */
export function defaultGrooveVariant(type: SectionType): GrooveVariant {
  switch (type) {
    case "intro":
    case "outro":
    case "interlude":
    case "vamp":
    case "breakdown":
      return "light";
    case "chorus":
    case "post-chorus":
    case "tag":
    case "instrumental":
      return "full";
    case "bridge":
      return "halfTime";
    default:
      return "simple";
  }
}

export interface GrooveHit {
  drum: GrooveDrum;
  /** 0-based step of the bar. */
  step: number;
  /** MIDI velocity, 1-127. */
  velocity: number;
}

/** A pattern's hits, in step order. */
export function grooveHits(rows: GroovePatternRows, steps: number): GrooveHit[] {
  const hits: GrooveHit[] = [];
  for (let step = 0; step < steps; step++) {
    for (const drum of GROOVE_DRUMS) {
      const mark = rows[drum]?.[step];
      if (mark === "X" || mark === "x" || mark === "o") hits.push({ drum, step, velocity: GROOVE_VELOCITIES[mark] });
    }
  }
  return hits;
}

/** What a section asks for: a style, a variation, and a fill on its last bar. */
export interface SectionGroove {
  styleId: string;
  variant: string;
  fill?: boolean | null;
}

export interface GrooveBar {
  style: GrooveStyle;
  variant: GrooveVariant;
  fill: boolean;
  /** The bar's pattern, with a crash on its first step when a section starts. */
  rows: GroovePatternRows;
  hits: GrooveHit[];
}

/**
 * What plays in a bar: its section's groove, the fill on the section's last
 * bar when it asks for one, a crash as a section (other than the first, or
 * a Light one) starts. Null without a groove, for a style it doesn't know, or
 * in a bar of another time signature (the click plays instead).
 */
export function grooveBar(groove: SectionGroove | null | undefined, bar: { barInPass: number; barsInPass: number; index: number; beats: number }, timeSignature: TimeSignature | null | undefined): GrooveBar | null {
  if (!groove) return null;
  const style = grooveStyle(groove.styleId);
  if (!style || !isGrooveVariant(groove.variant)) return null;
  if (!sameSignature(style.timeSignature, timeSignature ?? four) || bar.beats !== style.timeSignature.numerator) return null;
  const fill = !!groove.fill && bar.barInPass === bar.barsInPass - 1 && bar.barsInPass > 1;
  const rows: GroovePatternRows = { ...(fill ? style.fill : style.variants[groove.variant]) };
  if (bar.barInPass === 0 && bar.index > 0 && groove.variant !== "light") {
    rows.crash = "X" + ".".repeat(style.steps - 1);
    // The crash takes the first hi-hat or ride's place.
    for (const drum of ["hihat", "ride"] as const) {
      const row = rows[drum];
      if (row) rows[drum] = "." + row.slice(1);
    }
  }
  return { style, variant: groove.variant, fill, rows, hits: grooveHits(rows, style.steps) };
}
