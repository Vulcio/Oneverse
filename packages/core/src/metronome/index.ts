/**
 * The metronome's timeline (issue #2), apart from any way of playing it, so
 * the web app's Web Audio engine, Web MIDI (#98), Sync play (#13) and a
 * headless device (#62) all read the same beats.
 *
 * Positions are in beats of the time signature (a 6/8 bar is six beats,
 * each an eighth note) counted from the start, count-in included; the tempo
 * counts its own note (`tempoUnit`, issue #377: a 6/8 song's 71 is usually
 * dotted quarters, three of those beats each). Ticks are MIDI's: 480 to a quarter note. A click is a
 * note on channel 10, General MIDI's drums, as a MIDI renderer will send it.
 */

/** Ticks to a quarter note, as in a Standard MIDI File. */
export const PPQ = 480;
export const METRONOME_CHANNEL = 10;
/** General MIDI's metronome bell (a bar's first beat) and click. */
export const METRONOME_NOTES = { accent: 34, normal: 33, sub: 33 } as const;

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

/**
 * The note a song's tempo counts when it doesn't say: the time signature's
 * own, except in compound time (6/8, 9/8, 12/8 and the same in sixteenths),
 * counted in dotted notes of three beats.
 */
export function defaultTempoUnit(timeSignature: { numerator: number; denominator: number } | null | undefined): TempoUnit {
  const numerator = timeSignature?.numerator ?? 4;
  const denominator = timeSignature?.denominator ?? 4;
  const compound = numerator > 3 && numerator % 3 === 0;
  if (denominator === 8) return compound ? "1/4." : "1/8";
  if (denominator === 16) return compound ? "1/8." : "1/16";
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

const fits = (a: number, b: number) => Math.abs(a / b - Math.round(a / b)) < 1e-9;

/**
 * How many of the time signature's beats each main click lasts: the tempo's
 * note when it falls on the bar's own pulse (eighths or dotted quarters in
 * 6/8, halves or eighths in 4/4), else that pulse - a quarter in 6/8 or a
 * dotted eighth would click between or across its beats, never where its beats are, so
 * that note only sets the speed (issue #377).
 */
export function clickPulse(settings: Pick<MetronomeSettings, "tempoUnit" | "numerator" | "denominator">): number {
  const felt = beatsPerTempoUnit(defaultTempoUnit(settings), settings.denominator);
  const unit = beatsPerTempoUnit(settings.tempoUnit ?? defaultTempoUnit(settings), settings.denominator);
  // On the beats (whole beats, or an even split of one), and on the bar's pulse.
  const onBeats = fits(unit, 1) || fits(1, unit);
  return onBeats && (fits(felt, unit) || (fits(unit, felt) && fits(settings.numerator, unit))) ? unit : felt;
}

/** How a beat sounds: accented, as usual, or not at all. */
export type BeatLevel = "accent" | "normal" | "mute";
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

/** A bar's usual pattern: its first beat accented. */
export function defaultBeats(numerator: number): BeatLevel[] {
  return Array.from({ length: numerator }, (_, i) => (i === 0 ? "accent" : "normal"));
}

/** Settings made whole and valid, from whatever was stored or asked for. */
export function normalizeMetronome(input: Partial<MetronomeSettings> | null | undefined): MetronomeSettings {
  const value = input ?? {};
  const numerator = Number.isInteger(value.numerator) ? Math.min(MAX_BEATS_PER_BAR, Math.max(1, value.numerator!)) : DEFAULT_METRONOME.numerator;
  const denominator = (METRONOME_DENOMINATORS as readonly number[]).includes(value.denominator ?? 0) ? value.denominator! : DEFAULT_METRONOME.denominator;
  const levels: BeatLevel[] = ["accent", "normal", "mute"];
  const beats =
    Array.isArray(value.beats) && value.beats.length === numerator && value.beats.every((beat) => levels.includes(beat)) ? [...value.beats] : defaultBeats(numerator);
  return {
    tempo: clampTempo(value.tempo ?? DEFAULT_METRONOME.tempo, true),
    tempoUnit: isTempoUnit(value.tempoUnit) ? value.tempoUnit : defaultTempoUnit({ numerator, denominator }),
    numerator,
    denominator,
    beats,
    subdivision: ([1, 2, 3, 4] as const).includes(value.subdivision as Subdivision) ? (value.subdivision as Subdivision) : 1,
    countIn: Number.isInteger(value.countIn) ? Math.min(4, Math.max(0, value.countIn!)) : 0,
    countInOnly: !!value.countInOnly && Number.isInteger(value.countIn) && value.countIn! > 0,
    sound: (METRONOME_SOUNDS as readonly string[]).includes(value.sound ?? "") ? value.sound! : DEFAULT_METRONOME.sound,
    volume: typeof value.volume === "number" && Number.isFinite(value.volume) ? Math.min(1, Math.max(0, value.volume)) : DEFAULT_METRONOME.volume,
  };
}

/**
 * A song's tempo, the note it counts and time signature on top of the
 * player's own settings (their pattern kept when the bar is the same
 * length). A song that doesn't say its tempo's note counts the default for
 * its time signature, not the player's.
 */
export function metronomeForSong(
  current: MetronomeSettings,
  song: { tempo: number | null | undefined; tempoUnit?: TempoUnit | null; timeSignature?: { numerator: number; denominator: number } | null },
): MetronomeSettings {
  const numerator = song.timeSignature?.numerator ?? current.numerator;
  const denominator = song.timeSignature?.denominator ?? current.denominator;
  return normalizeMetronome({
    ...current,
    tempo: song.tempo ?? current.tempo,
    tempoUnit: song.tempo ? (song.tempoUnit ?? defaultTempoUnit({ numerator, denominator })) : current.tempoUnit,
    numerator,
    denominator,
    beats: numerator === current.numerator ? current.beats : defaultBeats(numerator),
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
  level: "accent" | "normal" | "sub";
  note: number;
  channel: number;
  /** 1-127, as MIDI's. */
  velocity: number;
  countIn: boolean;
}

const VELOCITY = { accent: 120, normal: 90, sub: 60 } as const;

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
 * The clicks from `from` (included) to `to` (not), in beats. The main
 * clicks follow the tempo's note from each bar's start where it falls on
 * the bar's pulse (clickPulse; issue #377: in 6/8 counted in dotted
 * quarters, beats 1 and 4), split into `subdivision`
 * (triplets there play every eighth). A main click on a beat sounds as the
 * pattern says, one between beats as usual; a muted beat mutes what falls in
 * it. During the count-in every main click sounds, the first of each bar
 * accented, without subdivisions; after it, with `countInOnly`, nothing does.
 */
export function clicksBetween(settings: MetronomeSettings, from: number, to: number): MetronomeClick[] {
  const clicks: MetronomeClick[] = [];
  const { numerator, subdivision } = settings;
  const step = 1 / subdivision;
  // A main click lasts `pulse` beats; each bar starts them again.
  const pulse = clickPulse(settings);
  const perBar = Math.ceil((numerator * subdivision) / pulse - 1e-9);
  for (let barIndex = Math.max(0, Math.floor(from / numerator)); barIndex * numerator < to; barIndex++) {
    for (let index = 0; index < perBar; index++) {
      // In subdivisions from the start: whole numbers when the pulse is a beat, so no float drift over hours.
      const position = (barIndex * numerator * subdivision + index * pulse) * step;
      if (position < from - 1e-9) continue;
      if (position >= to) break;
      const offset = (index * pulse) / subdivision;
      const beat = Math.floor(offset + 1e-9);
      const sub = index % subdivision;
      const main = sub === 0;
      const bar = barIndex - settings.countIn;
      const countIn = bar < 0;
      let level: MetronomeClick["level"] | null;
      if (countIn) level = main ? (index === 0 ? "accent" : "normal") : null;
      else if (settings.countInOnly) level = null;
      else if (settings.beats[beat] === "mute") level = null;
      else level = !main ? "sub" : Math.abs(offset - beat) < 1e-9 && settings.beats[beat] === "accent" ? "accent" : "normal";
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
