import { keyUsesFlats, parseChord, semitoneOf, type NoteLetter } from "../chords/chord.js";
import type { BeatMap, ChartBar } from "../song-document/bars.js";
import type { CuePoint } from "./cues.js";
import type { RecordingChord, RecordingChordQuality } from "./chords.js";

/**
 * A recording's chords in its bars (issue #393): what the stems' analysis
 * found (`readRecordingChords`), laid on the recording's own beats and bars
 * (its beat map, #299), so Songverse can suggest them in a chart - fill the
 * bars of a song without chords, mark where a chart and the recording
 * disagree, place each section's cue where its chords start, and offer to
 * move the bars' 1 where the chords change. Suggestions only: nothing here
 * changes a song.
 */

/** A bar of the recording: from one of its downbeats to the next. */
export interface RecordingBar {
  /** Seconds, from the recording's start. */
  start: number;
  /** How many of the recording's beats it holds. */
  beats: number;
  /** The chord sounding on each beat (index 0 is beat 1); null where there's none. */
  onBeats: (RecordingChord | null)[];
  /** Where the chord changes, on whole beats (1-based): beat 1 always, when a chord sounds there. */
  changes: { beat: number; chord: RecordingChord }[];
}

/** Each beat is read this far into it (a fraction of the beat), so a chord found a little early or late still counts on its beat. */
const READ_INTO_BEAT = 0.3;

const SUFFIX: Record<RecordingChordQuality, string> = {
  maj: "",
  min: "m",
  dim: "dim",
  aug: "aug",
  min6: "m6",
  maj6: "6",
  min7: "m7",
  minmaj7: "m(maj7)",
  maj7: "maj7",
  "7": "7",
  dim7: "dim7",
  hdim7: "m7b5",
  sus2: "sus2",
  sus4: "sus4",
};
const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const mod12 = (value: number) => ((value % 12) + 12) % 12;

/**
 * A recording's chord as a chord symbol ("C#m", "Bb/D"), moved `steps`
 * semitones (the song's key is the recording's moved so) and spelled for
 * the song's `key`: flats in F, Bb, Dm…, sharps otherwise.
 */
export function recordingChordSymbol(chord: Pick<RecordingChord, "root" | "quality" | "bass">, options: { steps?: number; key?: string | null } = {}): string {
  const names = keyUsesFlats(options.key) ? FLATS : SHARPS;
  const steps = options.steps ?? 0;
  const bass = chord.bass !== undefined && chord.bass !== chord.root ? `/${names[mod12(chord.bass + steps)]}` : "";
  return `${names[mod12(chord.root + steps)]}${SUFFIX[chord.quality]}${bass}`;
}

/** The pitch class (0 = C) of a key's tonic ("Bb", "F#m"); null for one it can't read. */
function tonicOf(key: string | null | undefined): number | null {
  const match = key ? /^\s*([A-G])([#♯b♭]?)/i.exec(key) : null;
  if (!match) return null;
  const accidental = match[2] === "#" || match[2] === "♯" ? "sharp" : match[2] === "b" || match[2] === "♭" ? "flat" : null;
  return semitoneOf({ letter: match[1]!.toUpperCase() as NoteLetter, accidental });
}

/**
 * The semitones from the recording's key to the song's (D to E: 2), so its
 * chords are written in the song's key; between -5 and 6. Null when either
 * isn't known: then `cuesFromChords` finds it from the chords themselves.
 */
export function recordingSteps(songKey: string | null | undefined, recordingKey: string | null | undefined): number | null {
  const song = tonicOf(songKey);
  const recording = tonicOf(recordingKey);
  if (song === null || recording === null) return null;
  const steps = mod12(song - recording);
  return steps > 6 ? steps - 12 : steps;
}

const same = (a: RecordingChord | null, b: RecordingChord | null) => a === b || (!!a && !!b && a.root === b.root && a.quality === b.quality && a.bass === b.bass);

/**
 * The recording's bars, from its beat map: one per downbeat, as long as the
 * beats up to the next (the last, the beats left but no longer than the bar
 * before), with the chord sounding
 * on each beat and where it changes. Empty without beats and downbeats.
 */
export function recordingBars(map: BeatMap, chords: readonly RecordingChord[]): RecordingBar[] {
  const beats = map.beats.filter(Number.isFinite);
  if (beats.length < 2) return [];
  const nearest = (time: number) => {
    let best = 0;
    for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i]! - time) < Math.abs(beats[best]! - time)) best = i;
    return best;
  };
  const downs = [...new Set(map.downbeats.filter(Number.isFinite).map(nearest))].sort((a, b) => a - b);
  let next = 0;
  const sounding = (time: number): RecordingChord | null => {
    while (next < chords.length && chords[next]!.end <= time) next++;
    const chord = chords[next];
    return chord && chord.start <= time ? chord : null;
  };
  return downs.map((first, index) => {
    // The last bar as long as the one before, at most: beats past it start a bar the map doesn't say.
    const last = downs[index + 1] !== undefined ? downs[index + 1]! - 1 : Math.min(beats.length - 1, index > 0 ? first + (first - downs[index - 1]!) - 1 : beats.length - 1);
    const onBeats: (RecordingChord | null)[] = [];
    for (let beat = first; beat <= last; beat++) {
      const length = (beats[beat + 1] ?? beats[beat]! + (beats[beat]! - beats[beat - 1]!)) - beats[beat]!;
      onBeats.push(sounding(beats[beat]! + length * READ_INTO_BEAT));
    }
    const changes: RecordingBar["changes"] = [];
    onBeats.forEach((chord, beat) => {
      if (chord && (beat === 0 || !same(chord, onBeats[beat - 1]!))) changes.push({ beat: beat + 1, chord });
    });
    return { start: beats[first]!, beats: onBeats.length, onBeats, changes };
  });
}

/** A chord as it's compared: root and kind (major, minor, diminished…), its extensions and bass aside; "5" for a power chord. */
type ChordClass = { root: number; kind: "maj" | "min" | "dim" | "aug" | "5" };

function classOfRecording(chord: RecordingChord | null, steps: number): ChordClass | null {
  if (!chord) return null;
  const kind = chord.quality.startsWith("min") ? "min" : chord.quality === "dim" || chord.quality === "dim7" || chord.quality === "hdim7" ? "dim" : chord.quality === "aug" ? "aug" : "maj";
  return { root: mod12(chord.root + steps), kind };
}

function classOfSymbol(symbol: string | null | undefined): ChordClass | null {
  const parsed = symbol ? parseChord(symbol) : null;
  if (!parsed || parsed.kind !== "chord") return null;
  const kind = parsed.quality === "minor" ? "min" : parsed.quality === "diminished" || parsed.quality === "half-diminished" ? "dim" : parsed.quality === "augmented" ? "aug" : parsed.quality === "power" ? "5" : "maj";
  return { root: semitoneOf(parsed.root), kind };
}

/** Whether two chords are the same for a chart: same root and kind (a sus chord is heard as major, a power chord as either). */
function agree(a: ChordClass, b: ChordClass): boolean {
  return a.root === b.root && (a.kind === b.kind || a.kind === "5" || b.kind === "5");
}

/** The chord a chart bar has sounding on its first beat. */
function chartChordOnOne(bar: ChartBar): string | null {
  const first = bar.chords[0];
  return first && first.beat < 2 ? first.sounding : (bar.carried?.sounding ?? null);
}

/** The recording's bar where a cue falls: its downbeat nearest the cue, within half a bar; null without one. */
function barAtCue(bars: readonly RecordingBar[], at: number): number | null {
  let best: number | null = null;
  bars.forEach((bar, index) => {
    if (best === null || Math.abs(bar.start - at) < Math.abs(bars[best]!.start - at)) best = index;
  });
  if (best === null) return null;
  const length = (bars[best + 1]?.start ?? bars[best]!.start + (bars[best]!.start - (bars[best - 1]?.start ?? 0))) - bars[best]!.start;
  return Math.abs(bars[best]!.start - at) <= length / 2 + 1e-6 ? best : null;
}

/** How far a pass may start after the one before ends, in bars: an instrumental, a chorus sung once more than written. */
const MAX_GAP = 16;
const MATCH = 1;
const MISMATCH = -0.5;
const GAP = 0.1;
const SKIP = 1;

export interface ChordCues {
  /** Each pass placed by its chords, at the downbeat where they start. */
  cues: CuePoint[];
  /** The semitones from the recording's chords to the chart's. */
  steps: number;
  /** The share of the chart's bars with a chord that the recording agrees with. */
  agreement: number;
}

/**
 * Where each pass of a chart starts in a recording (issue #393), by matching
 * the chart's chords, bar by bar through the order it's played in
 * (`chartBars`), to the recording's (`recordingBars`): passes in order, each
 * where its progression fits best, the recording free to play bars the chart
 * doesn't have (an instrumental, a chorus once more) or leave a pass out.
 * Tried in each key unless `steps` says it. Null when the chart has too few
 * chords, or the recording agrees with fewer than 60% of them: then a cue is
 * left to the analysis's sections, or to people.
 */
export function cuesFromChords(chart: readonly ChartBar[], recording: readonly RecordingBar[], options: { steps?: number | null } = {}): ChordCues | null {
  const passes: { sectionId: string; bars: (ChordClass | null)[] }[] = [];
  for (const bar of chart) {
    if (bar.barInPass === 0) passes.push({ sectionId: bar.sectionId, bars: [] });
    passes.at(-1)?.bars.push(classOfSymbol(chartChordOnOne(bar)));
  }
  const known = passes.reduce((sum, pass) => sum + pass.bars.filter(Boolean).length, 0);
  if (known < 8 || recording.length < 8) return null;
  const tries = options.steps === null || options.steps === undefined ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [mod12(options.steps)];
  let best: (ChordCues & { score: number }) | null = null;
  for (const shift of tries) {
    const heard = recording.map((bar) => classOfRecording(bar.onBeats[0] ?? null, shift));
    const found = place(passes, heard);
    if (!found || (best && found.score <= best.score)) continue;
    const steps = mod12(shift) > 6 ? mod12(shift) - 12 : mod12(shift);
    best = { score: found.score, steps, agreement: found.agreed / known, cues: found.starts.map(({ pass, bar }) => ({ at: Math.round(recording[bar]!.start * 100) / 100, sectionId: passes[pass]!.sectionId })) };
  }
  if (!best || best.agreement < 0.6) return null;
  return { cues: best.cues, steps: best.steps, agreement: Math.round(best.agreement * 100) / 100 };
}

/** The passes laid on the recording's bars in order, scoring the most agreeing bars (a dynamic programme over passes and bars). */
function place(passes: { bars: (ChordClass | null)[] }[], heard: (ChordClass | null)[]) {
  const bars = heard.length;
  type Cell = { score: number; agreed: number; from: number; start: number | null } | null;
  // table[p][r]: the best with passes before p placed and the recording used up to bar r.
  const table: Cell[][] = passes.map(() => new Array<Cell>(bars + 1).fill(null));
  table.push(new Array<Cell>(bars + 1).fill(null));
  for (let r = 0; r <= Math.min(bars, MAX_GAP); r++) table[0]![r] = { score: -GAP * r, agreed: 0, from: -1, start: null };
  passes.forEach((pass, p) => {
    for (let r = 0; r <= bars; r++) {
      const cell = table[p]![r];
      if (!cell) continue;
      const offer = (to: number, score: number, agreed: number, start: number | null) => {
        const existing = table[p + 1]![to];
        if (!existing || score > existing.score) table[p + 1]![to] = { score, agreed, from: r, start };
      };
      // Left out of the recording.
      offer(r, cell.score - SKIP, cell.agreed, null);
      for (let gap = 0; gap <= MAX_GAP && r + gap < bars; gap++) {
        const start = r + gap;
        let score = cell.score - GAP * gap;
        let agreed = cell.agreed;
        let length = 0;
        for (; length < pass.bars.length && start + length < bars; length++) {
          const want = pass.bars[length];
          const got = heard[start + length];
          if (!want || !got) continue;
          if (agree(want, got)) {
            score += MATCH;
            agreed++;
          } else score += MISMATCH;
        }
        offer(start + length, score, agreed, start);
      }
    }
  });
  let end = -1;
  for (let r = 0; r <= bars; r++) if (table[passes.length]![r] && (end < 0 || table[passes.length]![r]!.score > table[passes.length]![end]!.score)) end = r;
  if (end < 0) return null;
  const last = table[passes.length]![end]!;
  const starts: { pass: number; bar: number }[] = [];
  let r = end;
  for (let p = passes.length; p > 0; p--) {
    const cell = table[p]![r]!;
    if (cell.start !== null && passes[p - 1]!.bars.some(Boolean)) starts.unshift({ pass: p - 1, bar: cell.start });
    r = cell.from;
  }
  return { score: last.score, agreed: last.agreed, starts };
}

/** A section's bars as the recording plays them: chord symbols on whole beats. */
export interface SuggestedBar {
  beats: number;
  chords: { beat: number; symbol: string }[];
}

/**
 * Bars for each section of a song without chords (issue #393), from the
 * recording: the bars from each of its passes' cues to the next cue, and
 * where the passes of a section disagree, what most of them play (the
 * passes with the most usual number of bars only). Chords spelled in the
 * song's key (`steps` from the recording's, `key`). A section with no cue
 * gets nothing; one a recording plays with no chord at all neither.
 */
export function suggestedSectionBars(cues: readonly CuePoint[], recording: readonly RecordingBar[], options: { steps?: number; key?: string | null; end?: number } = {}): Map<string, SuggestedBar[]> {
  const sorted = [...cues].sort((a, b) => a.at - b.at);
  const passes = new Map<string, RecordingBar[][]>();
  sorted.forEach((cue, index) => {
    const from = barAtCue(recording, cue.at);
    if (from === null) return;
    const nextCue = sorted[index + 1];
    const to = nextCue ? (barAtCue(recording, nextCue.at) ?? recording.findIndex((bar) => bar.start >= nextCue.at - 1e-6)) : recording.length;
    const bars = recording.slice(from, to < 0 ? recording.length : to);
    if (bars.length === 0) return;
    passes.set(cue.sectionId, [...(passes.get(cue.sectionId) ?? []), bars]);
  });
  const out = new Map<string, SuggestedBar[]>();
  for (const [sectionId, played] of passes) {
    const usual = mostCommon(played.map((bars) => bars.length))!;
    const alike = played.filter((bars) => bars.length === usual);
    const bars: SuggestedBar[] = [];
    for (let index = 0; index < usual; index++) {
      const versions = alike.map((pass) => {
        const bar = pass[index]!;
        return { beats: bar.beats, chords: bar.changes.map((change) => ({ beat: change.beat, symbol: recordingChordSymbol(change.chord, options) })) };
      });
      const chosen = mostCommon(versions.map((version) => JSON.stringify(version)))!;
      bars.push(JSON.parse(chosen) as SuggestedBar);
    }
    if (bars.some((bar) => bar.chords.length > 0)) out.set(sectionId, bars);
  }
  return out;
}

function mostCommon<T>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | undefined;
  for (const [value, count] of counts) if (best === undefined || count > counts.get(best)!) best = value;
  return best;
}

/** A chord of the chart the recording plays differently (issue #393). */
export interface ChordDifference {
  chordId: string;
  sectionId: string;
  /** As the chart shows it. */
  chart: string;
  /** What the recording plays there, spelled in the song's key. */
  recording: string;
  /** How many times the song plays it, and how many of those the recording plays the other chord. */
  heard: number;
  differs: number;
}

/**
 * Where a chart and its recording disagree (issue #393): each chord change
 * of the chart, on the beat it's on, against what the recording plays there
 * - each pass laid on the recording from its cue. A chord is marked when at
 * least two thirds of the times it's played the recording plays one other
 * chord (same root and kind, extensions aside); a chord it plays sometimes
 * one way, sometimes another, isn't.
 */
export function chordDifferences(chart: readonly ChartBar[], cues: readonly CuePoint[], recording: readonly RecordingBar[], options: { steps?: number; key?: string | null } = {}): ChordDifference[] {
  const steps = options.steps ?? 0;
  const starts = new Map<number, number>();
  const sorted = [...cues].sort((a, b) => a.at - b.at);
  // Each cue starts the next pass of its section not yet placed, in order.
  const used = new Set<number>();
  for (const cue of sorted) {
    const pass = chart.find((bar) => bar.barInPass === 0 && bar.sectionId === cue.sectionId && !used.has(bar.passIndex) && [...used].every((one) => one < bar.passIndex));
    const at = barAtCue(recording, cue.at);
    if (!pass || at === null) continue;
    used.add(pass.passIndex);
    starts.set(pass.passIndex, at);
  }
  const heard = new Map<string, { sectionId: string; chart: string; label: string; plays: (RecordingChord | null)[] }>();
  for (const bar of chart) {
    const start = starts.get(bar.passIndex);
    const played = start === undefined ? undefined : recording[start + bar.barInPass];
    if (!played) continue;
    for (const chord of bar.chords) {
      const beat = Math.floor(chord.beat);
      if (beat < 1 || beat > played.beats) continue;
      const entry = heard.get(chord.id) ?? { sectionId: bar.sectionId, chart: chord.sounding, label: chord.label, plays: [] };
      entry.plays.push(played.onBeats[beat - 1] ?? null);
      heard.set(chord.id, entry);
    }
  }
  const out: ChordDifference[] = [];
  for (const [chordId, entry] of heard) {
    const want = classOfSymbol(entry.chart);
    if (!want) continue;
    const others = entry.plays.filter((chord): chord is RecordingChord => {
      const got = classOfRecording(chord, steps);
      return !!got && !agree(want, got);
    });
    if (others.length * 3 < entry.plays.length * 2) continue;
    const symbol = mostCommon(others.map((chord) => recordingChordSymbol(chord, options)))!;
    const alike = others.filter((chord) => recordingChordSymbol(chord, options) === symbol).length;
    if (alike * 3 < entry.plays.length * 2) continue;
    out.push({ chordId, sectionId: entry.sectionId, chart: entry.label, recording: symbol, heard: entry.plays.length, differs: alike });
  }
  return out;
}

/**
 * How many beats the recording's bars should move so their 1 is where its
 * chords change (issue #393): when most chord changes fall on one other beat
 * of the bar and few on the 1, that beat - 1 when they change on beat 2, so
 * each bar would start a beat later. 0 when the bars look right, or there
 * are too few changes to tell (fewer than 8).
 */
export function downbeatShift(bars: readonly RecordingBar[]): number {
  const counts = new Map<number, number>();
  let total = 0;
  bars.forEach((bar, index) => {
    for (const change of bar.changes) {
      // A bar's first chord is a change only when the chord before it was another.
      if (change.beat === 1) {
        const before = bars[index - 1]?.onBeats.at(-1) ?? null;
        if (same(before, change.chord)) continue;
      }
      counts.set(change.beat - 1, (counts.get(change.beat - 1) ?? 0) + 1);
      total++;
    }
  });
  if (total < 8) return 0;
  const [phase, count] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
  if (phase === 0 || count < total / 2 || (counts.get(0) ?? 0) >= total / 4) return 0;
  return phase;
}

/** The beat map with each bar moved `shift` beats later (its downbeats on the beats `shift` after them); the beats stay. */
export function shiftDownbeats(map: BeatMap, shift: number): BeatMap {
  const beats = map.beats.filter(Number.isFinite);
  if (shift === 0 || beats.length === 0) return { beats: [...map.beats], downbeats: [...map.downbeats] };
  const indexOf = (time: number) => {
    let best = 0;
    for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i]! - time) < Math.abs(beats[best]! - time)) best = i;
    return best;
  };
  const moved = map.downbeats
    .filter(Number.isFinite)
    .map((time) => indexOf(time) + shift)
    .filter((index) => index >= 0 && index < beats.length)
    .map((index) => beats[index]!);
  return { beats: [...map.beats], downbeats: moved };
}
