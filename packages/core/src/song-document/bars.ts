import type { ChordFamily } from "../chords/chord.js";
import type { Rhythm, SongDocumentV2 } from "../schemas/song-document-v2.js";
import type { RenderedChart, RenderedChord, RenderedPass } from "./render.js";

/**
 * Bars (issue #238): a song's chords in bars and beats, through the order
 * it's played in - what a chord row or a chord grid shows, and what follows
 * the metronome or a recording beat by beat.
 *
 * A section's own `rhythm` says its bars when it has one. Otherwise they're
 * filled in from the chart: each chord of a line gets a bar, a sung line
 * takes at least two (one chord and the bar it carries on), a line of
 * chords alone one bar per chord, a pass with no lines two bars. Notes take
 * none. The beats of a bar are its pass's time signature's top number (4
 * without one), or the rhythm's own, or the bar's own (a pickup, an odd bar).
 */

export interface ChartBarChord {
  /** The chord's ID in the song: the same as on the chart. */
  id: string;
  /** 1-based; fractional between beats (2.5 is the "and" of 2). */
  beat: number;
  /** As the chart shows it: transposed, capo, notation - everything applied. */
  label: string;
  sounding: string;
  family: ChordFamily | null;
}

export interface ChartBar {
  /** 0-based through the song. */
  index: number;
  /** The pass of the chart it's in, and its place there (0-based) of how many. */
  passIndex: number;
  passId: string;
  sectionId: string;
  barInPass: number;
  barsInPass: number;
  beats: number;
  /** Where it starts, in beats from the song's start. */
  start: number;
  tempo: number | null;
  /** Its chord changes, in order. */
  chords: ChartBarChord[];
  /** The chord sounding as it starts, carried on from before: null when one changes on beat 1, or before the first chord. */
  carried: ChartBarChord | null;
  /** The lyric line it's under; null for none (an intro without words). */
  lineId: string | null;
  /** Where it starts in that line's text, when its section's rhythm places it there (a bar line in the lyrics); null otherwise. */
  lyricAt: number | null;
  /** Its section says it (`rhythm`), rather than worked out from the chart. */
  fromRhythm: boolean;
}

/** Bars a sung line takes at least, filled in from the chart; as autoscroll paces a chart (chartSeconds). */
const BARS_PER_LINE = 2;

/** The bars of a rendered chart, in order; `song` gives the sections' own rhythm, where they have one. */
export function chartBars(chart: Pick<RenderedChart, "passes" | "timeSignature">, song?: Pick<SongDocumentV2, "sections"> | null): ChartBar[] {
  const rhythms = new Map((song?.sections ?? []).map((section) => [section.id, section.rhythm ?? null]));
  const bars: ChartBar[] = [];
  let start = 0;
  let sounding: ChartBarChord | null = null;
  chart.passes.forEach((pass, passIndex) => {
    const beats = Math.max(1, (pass.timeSignature ?? chart.timeSignature)?.numerator ?? 4);
    const rhythm = rhythms.get(pass.section.id);
    const planned = rhythm && rhythm.bars.length > 0 ? fromRhythm(pass, rhythm, beats) : fromChart(pass);
    planned.forEach((bar, barInPass) => {
      const carried = bar.chords[0]?.beat === 1 ? null : sounding;
      bars.push({
        index: bars.length,
        passIndex,
        passId: pass.id,
        sectionId: pass.section.id,
        barInPass,
        barsInPass: planned.length,
        beats: bar.beats,
        start,
        tempo: pass.tempo,
        chords: bar.chords,
        carried,
        lineId: bar.lineId,
        lyricAt: bar.lyricAt,
        fromRhythm: bar.fromRhythm,
      });
      start += bar.beats;
      sounding = bar.chords.at(-1) ?? sounding;
    });
  });
  return bars;

  function fromChart(pass: RenderedPass) {
    const beats = Math.max(1, (pass.timeSignature ?? chart.timeSignature)?.numerator ?? 4);
    const planned: { beats: number; chords: ChartBarChord[]; lineId: string | null; lyricAt: number | null; fromRhythm: boolean }[] = [];
    for (const line of pass.lines) {
      if (line.kind === "note") continue;
      // A line of chords alone (an intro, a turnaround): a bar each.
      const sung = line.text.trim().length > 0;
      const count = Math.max(line.chords.length, sung ? BARS_PER_LINE : 1);
      for (let bar = 0; bar < count; bar++) {
        const chord = line.chords[bar];
        planned.push({ beats, chords: chord ? [barChord(chord, 1)] : [], lineId: line.id, lyricAt: null, fromRhythm: false });
      }
    }
    if (planned.length === 0) for (let bar = 0; bar < BARS_PER_LINE; bar++) planned.push({ beats, chords: [], lineId: null, lyricAt: null, fromRhythm: false });
    return planned;
  }

  function fromRhythm(pass: RenderedPass, rhythm: Rhythm, timeBeats: number) {
    const beats = rhythm.beatsPerBar ?? timeBeats;
    const chords = new Map(pass.lines.flatMap((line) => line.chords.map((chord) => [chord.id, chord] as const)));
    const lines = new Set(pass.lines.map((line) => line.id));
    let lineId: string | null = null;
    return rhythm.bars.map((bar) => {
      const anchored = !!bar.lyricAnchor && lines.has(bar.lyricAnchor.lineId);
      if (anchored) lineId = bar.lyricAnchor!.lineId;
      // A bar of its own length (a pickup, an odd bar), else the section's.
      const length = bar.beats ?? beats;
      return {
        lyricAt: anchored ? bar.lyricAnchor!.at : null,
        beats: length,
        // A chord left out on this pass (hidden, or not in its lines) isn't played.
        chords: bar.chords
          .filter((one) => one.beat < length + 1 && chords.has(one.chordId))
          .sort((a, b) => a.beat - b.beat)
          .map((one) => barChord(chords.get(one.chordId)!, one.beat)),
        lineId,
        fromRhythm: true,
      };
    });
  }
}

function barChord(chord: RenderedChord, beat: number): ChartBarChord {
  return { id: chord.id, beat, label: chord.label, sounding: chord.sounding, family: chord.family };
}

/** The song's length, in beats. */
export function barsLength(bars: readonly Pick<ChartBar, "start" | "beats">[]): number {
  const last = bars.at(-1);
  return last ? last.start + last.beats : 0;
}

export interface BarPosition {
  /** The bar's index. */
  bar: number;
  /** 0-based beat of the bar. */
  beat: number;
  /** How far through the beat, 0 to 1. */
  fraction: number;
  /** The chord sounding there: the bar's last change at or before it, else the one carried on; null before the first. */
  chord: ChartBarChord | null;
}

/** Where a position (in beats from the song's start) falls among the bars; null before the start or past the end. */
export function barAt(bars: readonly ChartBar[], position: number): BarPosition | null {
  if (!Number.isFinite(position) || position < 0 || position >= barsLength(bars)) return null;
  // The last bar starting at or before it.
  let low = 0;
  let high = bars.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (bars[middle]!.start <= position) low = middle;
    else high = middle - 1;
  }
  const bar = bars[low]!;
  const within = position - bar.start;
  const beat = Math.floor(within);
  const changes = bar.chords.filter((chord) => chord.beat - 1 <= within + 1e-9);
  return { bar: bar.index, beat, fraction: within - beat, chord: changes.at(-1) ?? bar.carried };
}

/** A recording's beats and the first beat of each of its bars, in seconds from its start (issue #299): what the stem separation's analysis finds. */
export interface BeatMap {
  beats: readonly number[];
  downbeats: readonly number[];
}

/**
 * Where the music is among a song's bars, in beats from its start, at
 * `seconds` into a recording, from the recording's own beats and bars
 * (issue #299) rather than one tempo: it follows a recording that speeds up
 * or slows down, and each of the recording's bars starts one of the song's.
 * Between beats it moves evenly; before the first beat and past the last
 * it goes on at the nearest beats' pace, and past the last downbeat at the
 * last bar's length. A bar of the recording longer than the song's holds on
 * the song's last beat until the next downbeat. Negative before bar 1;
 * null when the map has fewer than two beats or no downbeat.
 */
export function recordingBeatPosition(map: BeatMap, seconds: number, bars: readonly Pick<ChartBar, "start" | "beats">[]): number | null {
  const beats = map.beats.filter(Number.isFinite);
  if (beats.length < 2 || !map.downbeats.some(Number.isFinite) || !Number.isFinite(seconds)) return null;
  const index = (time: number): number => {
    const last = beats.length - 1;
    if (time < beats[0]!) return (time - beats[0]!) / (beats[1]! - beats[0]!);
    if (time >= beats[last]!) return last + (time - beats[last]!) / (beats[last]! - beats[last - 1]!);
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (beats[middle]! <= time) low = middle;
      else high = middle;
    }
    return low + (time - beats[low]!) / (beats[low + 1]! - beats[low]!);
  };
  // Each downbeat as the beat it falls on.
  const downs = [...new Set(map.downbeats.filter(Number.isFinite).map((one) => Math.round(index(one))))].sort((a, b) => a - b);
  const at = index(seconds);
  const first = downs[0]!;
  if (at < first) return at - first;
  let bar = 0;
  while (bar + 1 < downs.length && downs[bar + 1]! <= at + 1e-9) bar++;
  let within = at - downs[bar]!;
  // Past the last downbeat: bars as long as the last one.
  if (bar === downs.length - 1) {
    const length = downs.length > 1 ? downs[bar]! - downs[bar - 1]! : (bars[0]?.beats ?? 4);
    const more = Math.floor(within / length);
    bar += more;
    within -= more * length;
  }
  const song = bars[bar];
  if (!song) return barsLength(bars) + (bar - bars.length) * (bars.at(-1)?.beats ?? 4) + within;
  return song.start + Math.min(within, song.beats - 1e-6);
}

/**
 * Where in a recording a position among the song's bars (in beats from its
 * start) is heard, from the recording's own beats and bars (issue #299): the
 * other way round from `recordingBeatPosition`, to play from a bar of the
 * chord grid. The first moment it's reached, in seconds; null when the map
 * has too little to follow.
 */
export function recordingSecondsAt(map: BeatMap, position: number, bars: readonly Pick<ChartBar, "start" | "beats">[]): number | null {
  const beats = map.beats.filter(Number.isFinite);
  if (!Number.isFinite(position) || recordingBeatPosition(map, beats[0] ?? 0, bars) === null) return null;
  // The position only ever goes forward with time: halved until it's within a tenth of a millisecond.
  let low = beats[0]! - 3600;
  let high = beats.at(-1)! + 3600;
  while (high - low > 1e-4) {
    const middle = (low + high) / 2;
    if (recordingBeatPosition(map, middle, bars)! >= position - 1e-9) high = middle;
    else low = middle;
  }
  return Math.round(high * 1000) / 1000;
}

/**
 * The words sung in each bar (issue #238), for a chord grid with the lyrics
 * under its bars: a line's words are cut where its chords are pinned, each
 * piece going to the bar its chord is in, and the words before a line's
 * first chord to its first bar. A chord pinned inside a word cuts before
 * the word: a grid reads words, not syllables. A bar with no change of the
 * line's chords gets "" (the words carry on); one with no words to sing (an
 * intro, a line of chords alone) null. A bar placed in the lyrics (a bar
 * line, `lyricAt`) is cut there instead, and words before a line's first
 * bar line go to the bar before.
 */
export function barLyrics(chart: Pick<RenderedChart, "passes">, bars: readonly ChartBar[]): (string | null)[] {
  const words: (string | null)[] = bars.map((bar) => (bar.lineId === null ? null : ""));
  let run = 0;
  while (run < bars.length) {
    const first = bars[run]!;
    // A line's bars, one after another in its pass.
    let end = run + 1;
    while (end < bars.length && bars[end]!.passIndex === first.passIndex && bars[end]!.lineId === first.lineId) end++;
    const line = first.lineId === null ? undefined : chart.passes[first.passIndex]?.lines.find((one) => one.id === first.lineId);
    if (!line || line.text.trim() === "") for (let index = run; index < end; index++) words[index] = null;
    else {
      const wordStart = (at: number) => {
        let start = Math.min(at, line.text.length);
        while (start > 0 && /\S/.test(line.text[start - 1]!)) start--;
        return start;
      };
      const at = new Map(line.chords.map((chord) => [chord.id, wordStart(chord.at)]));
      const cuts: { bar: number; at: number }[] = [];
      for (let index = run; index < end; index++) {
        const bar = bars[index]!;
        const pinned = bar.chords.flatMap((chord) => (at.has(chord.id) ? [at.get(chord.id)!] : []));
        const cut = bar.lyricAt !== null ? Math.min(bar.lyricAt, line.text.length) : index === run ? 0 : pinned.length > 0 ? Math.min(...pinned) : null;
        // A cut never goes back: a chord pinned earlier in the line than the bar before's.
        if (cut !== null && cut > (cuts.at(-1)?.at ?? -1)) cuts.push({ bar: index, at: cut });
      }
      cuts.forEach((cut, i) => {
        words[cut.bar] = line.text.slice(cut.at, cuts[i + 1]?.at ?? line.text.length).trim();
      });
      // Words before the line's first bar line: the end of the bar before (sung on from the line above).
      const before = line.text.slice(0, cuts[0]?.at ?? 0).trim();
      if (before && run > 0) words[run - 1] = [words[run - 1], before].filter(Boolean).join(" ");
    }
    run = end;
  }
  return words;
}
