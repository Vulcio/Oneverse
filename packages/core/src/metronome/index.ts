/**
 * The metronome's timeline (issue #2), apart from any way of playing it, so
 * the web app's Web Audio engine, Web MIDI (#98), Sync play (#13) and a
 * headless device (#62) all read the same beats.
 *
 * Positions are in beats of the time signature (a 6/8 bar is six beats,
 * each an eighth note) counted from the start, count-in included; the tempo
 * counts its own note (`tempoUnit`, issue #377; a 6/8 song's 71 counts
 * quarters unless it says, two of those beats each, issue #384). Ticks are MIDI's: 480 to a quarter note. A click is a
 * note on channel 10, General MIDI's drums, as a MIDI renderer will send it.
 */

/** Ticks to a quarter note, as in a Standard MIDI File. */
export const PPQ = 480;
export const METRONOME_CHANNEL = 10;
/** General MIDI's metronome bell (a bar's first beat, softer on a group's) and click. */
export const METRONOME_NOTES = { accent: 34, medium: 34, normal: 33, sub: 33 } as const;

export const MIN_TEMPO = 20;
export const MAX_TEMPO = 300;
export const METRONOME_DENOMINATORS = [2, 4, 8, 16] as const;
export const MAX_BEATS_PER_BAR = 16;
export const METRONOME_SOUNDS = ["click", "wood", "beep"] as const;

/**
 * The note a tempo counts (issue #377): "1/4" is a quarter note, a dot
 * makes it half as long again ("1/4." is a dotted quarter, three eighths).
 */
export const TEMPO_UNITS = ["1/8", "1/4", "1/2", "1/8.", "1/4.", "1/2.", "1/16"] as const;
export type TempoUnit = (typeof TEMPO_UNITS)[number];

export function isTempoUnit(value: unknown): value is TempoUnit {
  return (TEMPO_UNITS as readonly unknown[]).includes(value);
}

type TimeSignature = { numerator: number; denominator: number };

/** Compound time: 6/8, 9/8, 12/8 and the same in sixteenths, felt in groups of three. */
export function isCompound(timeSignature: TimeSignature): boolean {
  return timeSignature.numerator > 3 && timeSignature.numerator % 3 === 0 && (timeSignature.denominator === 8 || timeSignature.denominator === 16);
}

/**
 * The note a song's tempo counts when it doesn't say: the time signature's
 * own, except in compound time (6/8, 9/8, 12/8 and the same in sixteenths),
 * counted in notes of two beats (issue #384: 6/8 at 71 plays its eighths
 * at 142, twice as fast as 3/4 at 71, in a bar as long).
 */
export function defaultTempoUnit(timeSignature: { numerator: number; denominator: number } | null | undefined): TempoUnit {
  const numerator = timeSignature?.numerator ?? 4;
  const denominator = timeSignature?.denominator ?? 4;
  const compound = isCompound({ numerator, denominator });
  if (denominator === 8) return compound ? "1/4" : "1/8";
  if (denominator === 16) return compound ? "1/8" : "1/16";
  if (denominator === 2) return "1/2";
  return "1/4";
}

/** The time signature's own note: a tempo in it counts the beats as written (a recording's analysed tempo). */
export function beatTempoUnit(denominator: number): TempoUnit {
  return denominator === 2 ? "1/2" : denominator === 8 ? "1/8" : denominator === 16 ? "1/16" : "1/4";
}

/** How many of the time signature's beats one `unit` lasts: 3 for a dotted quarter in 6/8, 0.5 for an eighth in 4/4. */
export function beatsPerTempoUnit(unit: TempoUnit, denominator: number): number {
  const dotted = unit.endsWith(".");
  const note = Number(unit.slice(2, dotted ? -1 : undefined));
  return (denominator / note) * (dotted ? 1.5 : 1);
}

/**
 * How a beat sounds (issue #384): accented (the bar's first), medium (a
 * group's first: 4 in 6/8), small ("normal", every other beat), or not at
 * all ("mute").
 */
export const BEAT_LEVELS = ["accent", "medium", "normal", "mute"] as const;
export type BeatLevel = (typeof BEAT_LEVELS)[number];
/** Tapping a beat: accent, medium, small, off, and round again. */
export const NEXT_BEAT_LEVEL: Record<BeatLevel, BeatLevel> = { accent: "medium", medium: "normal", normal: "mute", mute: "accent" };

export function isBeatPattern(value: unknown, numerator: number): value is BeatLevel[] {
  return Array.isArray(value) && value.length === numerator && value.every((beat) => (BEAT_LEVELS as readonly unknown[]).includes(beat));
}
/** Clicks per beat: 1, eighths (2), triplets (3), sixteenths (4). */
export type Subdivision = 1 | 2 | 3 | 4;
export type MetronomeSound = (typeof METRONOME_SOUNDS)[number];

export interface MetronomeSettings {
  /** Beats a minute, of `tempoUnit`'s note. */
  tempo: number;
  /** The note the tempo counts (issue #377); left out, defaultTempoUnit(). */
  tempoUnit?: TempoUnit;
  numerator: number;
  denominator: number;
  /** One per beat of the bar: the pattern. */
  beats: BeatLevel[];
  /** The player's own pattern for each time signature they changed ("6/8"), the usual one for the others (issue #384). */
  patterns?: Record<string, BeatLevel[]>;
  subdivision: Subdivision;
  /** Bars counted in before the song starts. */
  countIn: number;
  /** Silent once the count-in is over: the beat still shows. */
  countInOnly: boolean;
  sound: MetronomeSound;
  /** 0-1. */
  volume: number;
}

export const DEFAULT_METRONOME: MetronomeSettings = {
  tempo: 100,
  numerator: 4,
  denominator: 4,
  beats: ["accent", "normal", "normal", "normal"],
  patterns: {},
  subdivision: 1,
  countIn: 0,
  countInOnly: false,
  sound: "click",
  volume: 0.8,
};

/** A tempo in range, in whole beats per minute - or, `fine`, to the hundredth: stems slowed to 85% of 97 BPM beat at 82.45 (issue #139). */
export function clampTempo(tempo: number, fine = false): number {
  if (!Number.isFinite(tempo)) return DEFAULT_METRONOME.tempo;
  return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, fine ? Math.round(tempo * 100) / 100 : Math.round(tempo)));
}

/** "6/8": how a pattern is kept for its time signature. */
export const signatureKey = (timeSignature: TimeSignature) => `${timeSignature.numerator}/${timeSignature.denominator}`;

/**
 * The ways a bar of 5 or 7 can be grouped (issue #384), the usual one
 * first: 5 as 3+2 or 2+3; 7 as 2+2+3, 3+2+2 or 2+3+2.
 */
export const BEAT_GROUPINGS: Readonly<Record<number, readonly (readonly number[])[]>> = {
  5: [
    [3, 2],
    [2, 3],
  ],
  7: [
    [2, 2, 3],
    [3, 2, 2],
    [2, 3, 2],
  ],
};

/** How a bar is felt: threes in compound time, 5 and 7 their usual grouping, one group otherwise (4/4, 3/4). */
export function defaultGrouping(timeSignature: TimeSignature): number[] {
  if (isCompound(timeSignature)) return Array.from({ length: timeSignature.numerator / 3 }, () => 3);
  const usual = BEAT_GROUPINGS[timeSignature.numerator]?.[0];
  return usual ? [...usual] : [timeSignature.numerator];
}

/** A pattern from groups of beats: the bar's first accented, each other group's first medium, the rest small. */
export function beatsFromGrouping(groups: readonly number[]): BeatLevel[] {
  return groups.flatMap((size, group) => Array.from({ length: size }, (_, i): BeatLevel => (i > 0 ? "normal" : group === 0 ? "accent" : "medium")));
}

/**
 * A bar's usual pattern (issue #384): its first beat accented, the first of
 * each other group medium. 3/4 is A s s, 4/4 A s s s, 6/8 A s s M s s.
 */
export function defaultBeats(timeSignature: TimeSignature): BeatLevel[] {
  return beatsFromGrouping(defaultGrouping(timeSignature));
}

const samePattern = (a: readonly BeatLevel[], b: readonly BeatLevel[]) => a.length === b.length && a.every((level, i) => level === b[i]);

function normalizePatterns(input: unknown, current: { key: string; beats: BeatLevel[] | null; usual: BeatLevel[] }): Record<string, BeatLevel[]> {
  const patterns: Record<string, BeatLevel[]> = {};
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [key, beats] of Object.entries(input as Record<string, unknown>).slice(0, 64)) {
      const match = /^(\d{1,2})\/(\d{1,2})$/.exec(key);
      if (match && (METRONOME_DENOMINATORS as readonly number[]).includes(Number(match[2])) && isBeatPattern(beats, Number(match[1]))) patterns[key] = [...beats];
    }
  } else if (current.beats && !samePattern(current.beats, current.usual)) {
    // Settings kept before patterns per time signature: the pattern they had is the one for theirs.
    patterns[current.key] = [...current.beats];
  }
  return patterns;
}

/** Settings made whole and valid, from whatever was stored or asked for. */
export function normalizeMetronome(input: Partial<MetronomeSettings> | null | undefined): MetronomeSettings {
  const value = input ?? {};
  const numerator = Number.isInteger(value.numerator) ? Math.min(MAX_BEATS_PER_BAR, Math.max(1, value.numerator!)) : DEFAULT_METRONOME.numerator;
  const denominator = (METRONOME_DENOMINATORS as readonly number[]).includes(value.denominator ?? 0) ? value.denominator! : DEFAULT_METRONOME.denominator;
  const signature = { numerator, denominator };
  const key = signatureKey(signature);
  const given = isBeatPattern(value.beats, numerator) ? [...value.beats] : null;
  const patterns = normalizePatterns(value.patterns, { key, beats: given, usual: defaultBeats(signature) });
  const beats = given ?? (patterns[key] ? [...patterns[key]] : defaultBeats(signature));
  return {
    tempo: clampTempo(value.tempo ?? DEFAULT_METRONOME.tempo, true),
    tempoUnit: isTempoUnit(value.tempoUnit) ? value.tempoUnit : defaultTempoUnit({ numerator, denominator }),
    numerator,
    denominator,
    beats,
    patterns,
    subdivision: ([1, 2, 3, 4] as const).includes(value.subdivision as Subdivision) ? (value.subdivision as Subdivision) : 1,
    countIn: Number.isInteger(value.countIn) ? Math.min(4, Math.max(0, value.countIn!)) : 0,
    countInOnly: !!value.countInOnly && Number.isInteger(value.countIn) && value.countIn! > 0,
    sound: (METRONOME_SOUNDS as readonly string[]).includes(value.sound ?? "") ? value.sound! : DEFAULT_METRONOME.sound,
    volume: typeof value.volume === "number" && Number.isFinite(value.volume) ? Math.min(1, Math.max(0, value.volume)) : DEFAULT_METRONOME.volume,
  };
}

/** The player's pattern for a time signature: the one they set for it, else the usual one. */
export function patternFor(settings: Pick<MetronomeSettings, "patterns">, timeSignature: TimeSignature): BeatLevel[] {
  const own = settings.patterns?.[signatureKey(timeSignature)];
  return isBeatPattern(own, timeSignature.numerator) ? [...own] : defaultBeats(timeSignature);
}

/**
 * A change to the player's settings: a new pattern is kept for its time
 * signature (the usual one forgotten); a new time signature brings the
 * pattern the player has for it, else its usual one (issue #384: 6/8 and
 * 6/4 are two patterns).
 */
export function changeMetronome(current: MetronomeSettings, change: Partial<MetronomeSettings>): MetronomeSettings {
  const numerator = change.numerator ?? current.numerator;
  const denominator = change.denominator ?? current.denominator;
  const signature = { numerator, denominator };
  const patterns = { ...current.patterns, ...change.patterns };
  if (change.beats && isBeatPattern(change.beats, numerator)) {
    const key = signatureKey(signature);
    if (samePattern(change.beats, defaultBeats(signature))) delete patterns[key];
    else patterns[key] = [...change.beats];
    return normalizeMetronome({ ...current, ...change, patterns });
  }
  const moved = numerator !== current.numerator || denominator !== current.denominator;
  return normalizeMetronome({ ...current, ...change, patterns, beats: moved ? patternFor({ patterns }, signature) : (change.beats ?? current.beats) });
}

/**
 * A song's tempo, the note it counts and time signature on top of the
 * player's own settings. The pattern is the song's (its version's, issue
 * #384) when it has one for that time signature, else the player's for it.
 * A song that doesn't say its tempo's note counts the default for its time
 * signature, not the player's.
 */
export function metronomeForSong(
  current: MetronomeSettings,
  song: { tempo: number | null | undefined; tempoUnit?: TempoUnit | null; timeSignature?: TimeSignature | null; beats?: readonly BeatLevel[] | null },
): MetronomeSettings {
  const numerator = song.timeSignature?.numerator ?? current.numerator;
  const denominator = song.timeSignature?.denominator ?? current.denominator;
  const signature = { numerator, denominator };
  return normalizeMetronome({
    ...current,
    tempo: song.tempo ?? current.tempo,
    tempoUnit: song.tempo ? (song.tempoUnit ?? defaultTempoUnit(signature)) : current.tempoUnit,
    numerator,
    denominator,
    beats: isBeatPattern(song.beats, numerator) ? [...song.beats] : patternFor(current, signature),
  });
}

type Speed = Pick<MetronomeSettings, "tempo" | "tempoUnit" | "numerator" | "denominator">;

/** The time signature's beats a minute: the tempo times how many of them its note lasts. */
export const beatsPerMinute = (settings: Partial<Speed> & Pick<Speed, "tempo">) => {
  const signature = { numerator: settings.numerator ?? 4, denominator: settings.denominator ?? 4 };
  return settings.tempo * beatsPerTempoUnit(isTempoUnit(settings.tempoUnit) ? settings.tempoUnit : defaultTempoUnit(signature), signature.denominator);
};
/** How long one of the time signature's beats lasts, in seconds. */
export const secondsPerBeat = (settings: Partial<Speed> & Pick<Speed, "tempo">) => 60 / beatsPerMinute(settings);
export const ticksPerBeat = (settings: Pick<MetronomeSettings, "denominator">) => (PPQ * 4) / settings.denominator;

/** One click: where it falls, and how it sounds. */
export interface MetronomeClick {
  /** In beats from the start (count-in included); a subdivision falls between. */
  position: number;
  tick: number;
  /** 0-based; negative during the count-in (-1 is the bar before the song). */
  bar: number;
  /** 0-based beat of the bar. */
  beat: number;
  /** 0 on the beat, then 1, 2… for the subdivisions. */
  sub: number;
  level: "accent" | "medium" | "normal" | "sub";
  note: number;
  channel: number;
  /** 1-127, as MIDI's. */
  velocity: number;
  countIn: boolean;
}

const VELOCITY = { accent: 120, medium: 90, normal: 90, sub: 60 } as const;

/** Where a position in beats falls: its bar (negative in the count-in), beat, and how far through the beat. */
export function beatAt(settings: Pick<MetronomeSettings, "numerator" | "countIn">, position: number): { bar: number; beat: number; fraction: number } {
  const whole = Math.floor(position);
  return {
    bar: Math.floor(whole / settings.numerator) - settings.countIn,
    beat: ((whole % settings.numerator) + settings.numerator) % settings.numerator,
    fraction: position - whole,
  };
}

/**
 * The clicks from `from` (included) to `to` (not), in beats: one on every
 * beat of the time signature (every dot of the pattern: six in 6/8), split
 * into `subdivision`. The tempo's note only sets how fast they come (issue
 * #377: 6/8 at 71 quarters plays its eighths at 142). Each beat sounds at
 * its level in the pattern (issue #384); a muted beat mutes its
 * subdivisions. During the count-in every beat sounds, at the pattern's
 * level (a muted one small), without subdivisions; after it, with
 * `countInOnly`, nothing does.
 */
export function clicksBetween(settings: MetronomeSettings, from: number, to: number): MetronomeClick[] {
  const clicks: MetronomeClick[] = [];
  const step = 1 / settings.subdivision;
  // Index of the first subdivision at or after `from`, exactly (no float drift over hours).
  let index = Math.max(0, Math.ceil(from * settings.subdivision - 1e-9));
  for (; index / settings.subdivision < to; index++) {
    const position = index * step;
    const whole = Math.floor(index / settings.subdivision);
    const sub = index % settings.subdivision;
    const { bar, beat } = beatAt(settings, whole);
    const countIn = bar < 0;
    let level: MetronomeClick["level"] | null;
    const pattern = settings.beats[beat] ?? "normal";
    if (countIn) level = sub === 0 ? (pattern === "mute" ? "normal" : pattern) : null;
    else if (settings.countInOnly) level = null;
    else if (pattern === "mute") level = null;
    else level = sub === 0 ? pattern : "sub";
    if (!level) continue;
    clicks.push({
      position,
      tick: Math.round(position * ticksPerBeat(settings)),
      bar,
      beat,
      sub,
      level,
      note: METRONOME_NOTES[level],
      channel: METRONOME_CHANNEL,
      velocity: VELOCITY[level],
      countIn,
    });
  }
  return clicks;
}

/** A tap tempo: beats a minute from the times of the last taps (ms), or null until there are two close enough. */
export function tapTempo(taps: number[]): number | null {
  // A pause of more than two seconds starts again.
  const recent: number[] = [];
  for (const tap of taps) {
    if (recent.length && tap - recent[recent.length - 1]! > 2000) recent.length = 0;
    recent.push(tap);
  }
  const last = recent.slice(-6);
  if (last.length < 2) return null;
  const average = (last[last.length - 1]! - last[0]!) / (last.length - 1);
  return average > 0 ? clampTempo(60000 / average) : null;
}
