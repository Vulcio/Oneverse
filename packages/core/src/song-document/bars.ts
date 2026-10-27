import type { ChordFamily } from "../chords/chord.js";
import type { BeatAnchor, Rhythm, SongDocumentV2 } from "../schemas/song-document-v2.js";
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
  /** Its beats placed in the lyrics by hand (in this pass's lines); `barBeatPlaces` places the others. */
  beatAnchors: BeatAnchor[];
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
        beatAnchors: bar.beatAnchors,
      });
      start += bar.beats;
      sounding = bar.chords.at(-1) ?? sounding;
    });
  });
  return bars;

  function fromChart(pass: RenderedPass) {
    const beats = Math.max(1, (pass.timeSignature ?? chart.timeSignature)?.numerator ?? 4);
    const planned: { beats: number; chords: ChartBarChord[]; lineId: string | null; lyricAt: number | null; fromRhythm: boolean; beatAnchors: BeatAnchor[] }[] = [];
    for (const line of pass.lines) {
      if (line.kind === "note") continue;
      // A line of chords alone (an intro, a turnaround): a bar each.
      const sung = line.text.trim().length > 0;
      const count = Math.max(line.chords.length, sung ? BARS_PER_LINE : 1);
      for (let bar = 0; bar < count; bar++) {
        const chord = line.chords[bar];
        planned.push({ beats, chords: chord ? [barChord(chord, 1)] : [], lineId: line.id, lyricAt: null, fromRhythm: false, beatAnchors: [] });
      }
    }
    if (planned.length === 0) for (let bar = 0; bar < BARS_PER_LINE; bar++) planned.push({ beats, chords: [], lineId: null, lyricAt: null, fromRhythm: false, beatAnchors: [] });
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
        beatAnchors: (bar.beatAnchors ?? []).filter((anchor) => anchor.beat < length + 1 && lines.has(anchor.lineId)),
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

/** Where a bar's words are: part of a line's text, from `from` up to `to`. */
export interface BarLyricSpan {
  lineId: string;
  from: number;
  to: number;
}

/**
 * Where the words sung in each bar are (issue #238), for a chord grid with
 * the lyrics under its bars: a line's words are cut where its chords are
 * pinned, each piece going to the bar its chord is in, and the words before
 * a line's first chord to its first bar. A chord pinned inside a word cuts
 * before the word: a grid reads words, not syllables. A bar with no change
 * of the line's chords gets none (the words carry on); one with no words to
 * sing (an intro, a line of chords alone) null. A bar placed in the lyrics
 * (a bar line, `lyricAt`) is cut there instead, and words before a line's
 * first bar line go to the bar before.
 */
export function barLyricSpans(chart: Pick<RenderedChart, "passes">, bars: readonly ChartBar[]): (BarLyricSpan[] | null)[] {
  const spans: (BarLyricSpan[] | null)[] = bars.map((bar) => (bar.lineId === null ? null : []));
  let run = 0;
  while (run < bars.length) {
    const first = bars[run]!;
    // A line's bars, one after another in its pass.
    let end = run + 1;
    while (end < bars.length && bars[end]!.passIndex === first.passIndex && bars[end]!.lineId === first.lineId) end++;
    const line = lineOf(chart, first);
    if (!line || line.text.trim() === "") for (let index = run; index < end; index++) spans[index] = null;
    else {
      const at = new Map(line.chords.map((chord) => [chord.id, wordStart(line.text, chord.at)]));
      const cuts: { bar: number; at: number }[] = [];
      for (let index = run; index < end; index++) {
        const bar = bars[index]!;
        const pinned = bar.chords.flatMap((chord) => (at.has(chord.id) ? [at.get(chord.id)!] : []));
        const cut = bar.lyricAt !== null ? Math.min(bar.lyricAt, line.text.length) : index === run ? 0 : pinned.length > 0 ? Math.min(...pinned) : null;
        // A cut never goes back: a chord pinned earlier in the line than the bar before's.
        if (cut !== null && cut > (cuts.at(-1)?.at ?? -1)) cuts.push({ bar: index, at: cut });
      }
      cuts.forEach((cut, i) => {
        spans[cut.bar] = [{ lineId: line.id, from: cut.at, to: cuts[i + 1]?.at ?? line.text.length }];
      });
      // Words before the line's first bar line: the end of the bar before (sung on from the line above).
      const before = cuts[0]?.at ?? 0;
      if (line.text.slice(0, before).trim() && run > 0) spans[run - 1] = [...(spans[run - 1] ?? []), { lineId: line.id, from: 0, to: before }];
    }
    run = end;
  }
  return spans;
}

/** The words sung in each bar, as `barLyricSpans` cuts them: "" when they carry on from the bar before, null for none to sing. */
export function barLyrics(chart: Pick<RenderedChart, "passes">, bars: readonly ChartBar[]): (string | null)[] {
  return barLyricSpans(chart, bars).map((spans, index) => {
    if (spans === null) return null;
    const pass = chart.passes[bars[index]!.passIndex];
    return spans
      .map((span) => (pass?.lines.find((line) => line.id === span.lineId)?.text ?? "").slice(span.from, span.to).trim())
      .filter(Boolean)
      .join(" ");
  });
}

/** Where a beat is sung: a character of a line. */
export interface BeatPlace {
  lineId: string;
  at: number;
  /** Placed there by hand (`beatAnchors`), rather than worked out. */
  placed: boolean;
}

function lineOf(chart: Pick<RenderedChart, "passes">, bar: Pick<ChartBar, "passIndex" | "lineId">) {
  return bar.lineId === null ? undefined : chart.passes[bar.passIndex]?.lines.find((one) => one.id === bar.lineId);
}

function wordStart(text: string, at: number): number {
  let start = Math.min(at, text.length);
  while (start > 0 && /\S/.test(text[start - 1]!)) start--;
  return start;
}

/** A bar's letters in order (spaces left out), and the beats fixed among them: the bar line, the beats placed by hand, its chords' words, its end. */
function barPoints(chart: Pick<RenderedChart, "passes">, bar: ChartBar, spans: BarLyricSpan[] | null, skipBeat?: number) {
  const pass = chart.passes[bar.passIndex];
  const letters: { lineId: string; at: number; word: boolean }[] = [];
  for (const span of spans ?? []) {
    const text = pass?.lines.find((line) => line.id === span.lineId)?.text ?? "";
    for (let at = span.from; at < Math.min(span.to, text.length); at++) {
      if (/\s/.test(text[at]!)) continue;
      letters.push({ lineId: span.lineId, at, word: at === 0 || /\s/.test(text[at - 1]!) });
    }
  }
  const index = (lineId: string, at: number) => letters.findIndex((letter) => letter.lineId === lineId && letter.at === at);
  // Beats counted from 0; the letters' index, the end being past the last one.
  const points: { beat: number; letter: number; placed: boolean }[] = [];
  const add = (beat: number, letter: number, placed: boolean) => {
    if (letter < 0 || beat <= 0 || beat >= bar.beats || points.some((one) => one.beat === beat)) return;
    // Kept only in order with the others: a beat later is sung later in the words.
    if (points.some((one) => (one.beat < beat && one.letter >= letter) || (one.beat > beat && one.letter <= letter))) return;
    points.push({ beat, letter, placed });
  };
  if (letters.length > 0) {
    points.push({ beat: 0, letter: 0, placed: false }, { beat: bar.beats, letter: letters.length, placed: false });
    for (const anchor of bar.beatAnchors) if (anchor.beat !== skipBeat) add(anchor.beat - 1, index(anchor.lineId, anchor.at), true);
    // A chord on a beat (not its "and") is sung on its word.
    for (const chord of bar.chords) {
      const pinned = pass?.lines.find((one) => one.chords.some((other) => other.id === chord.id));
      const at = pinned?.chords.find((other) => other.id === chord.id)?.at;
      if (pinned && at !== undefined && Number.isInteger(chord.beat)) add(chord.beat - 1, index(pinned.id, wordStart(pinned.text, at)), false);
    }
  }
  return { letters, points: points.sort((a, b) => a.beat - b.beat) };
}

/**
 * Where each beat of each bar is sung (issue #238): the beat ticks in a
 * chord grid's words, and what follows the music on the screens. A bar's
 * first beat is where its words start; a beat placed by hand
 * (`beatAnchors`) is where it was put, and a chord's beat its word; the
 * others are spread evenly between those and the bar's end, each on the
 * word starting nearest - none (null) when no word starts there: a word
 * held over the beat. A bar with no words to sing has none.
 */
export function barBeatPlaces(chart: Pick<RenderedChart, "passes">, bars: readonly ChartBar[]): (BeatPlace | null)[][] {
  const spans = barLyricSpans(chart, bars);
  return bars.map((bar, index) => {
    const { letters, points } = barPoints(chart, bar, spans[index]!);
    const places: (BeatPlace | null)[] = [];
    let last = -1;
    for (let beat = 0; beat < bar.beats; beat++) {
      const fixed = points.find((one) => one.beat === beat);
      let letter: number | null = null;
      if (fixed) letter = fixed.letter;
      else {
        const before = points.filter((one) => one.beat < beat).at(-1);
        const after = points.find((one) => one.beat > beat);
        if (before && after) {
          const aim = before.letter + ((beat - before.beat) / (after.beat - before.beat)) * (after.letter - before.letter);
          for (let at = Math.max(before.letter, last) + 1; at < after.letter; at++) {
            if (letters[at]!.word && (letter === null || Math.abs(at - aim) < Math.abs(letter - aim))) letter = at;
          }
        }
      }
      if (letter === null || letter >= letters.length) places.push(null);
      else {
        last = letter;
        places.push({ lineId: letters[letter]!.lineId, at: letters[letter]!.at, placed: !!fixed?.placed });
      }
    }
    return places;
  });
}

/**
 * Where beat `beat` (1-based) of bar `bar` may be put in the lyrics, as
 * parts of lines; empty when nowhere. The first beat moves the bar line
 * within its line: after the bar before's and before the next one's and
 * this bar's chords'. Another beat stays in its bar's words, between the
 * beats fixed before and after it.
 */
export function beatPlaceRange(chart: Pick<RenderedChart, "passes">, bars: readonly ChartBar[], bar: number, beat: number): BarLyricSpan[] {
  const target = bars[bar];
  if (!target || !Number.isInteger(beat) || beat < 1 || beat > target.beats) return [];
  const spans = barLyricSpans(chart, bars);
  if (beat === 1) {
    const line = lineOf(chart, target);
    if (!line || line.text.trim() === "") return [];
    const cutOf = (index: number) => spans[index]?.find((span) => span.lineId === line.id)?.from;
    let from = 0;
    for (let index = bar - 1; index >= 0 && bars[index]!.passIndex === target.passIndex && bars[index]!.lineId === line.id; index--) {
      const cut = cutOf(index);
      if (cut !== undefined) {
        from = cut + 1;
        break;
      }
    }
    let to = line.text.length;
    for (let index = bar + 1; index < bars.length && bars[index]!.passIndex === target.passIndex && bars[index]!.lineId === line.id; index++) {
      const cut = cutOf(index);
      if (cut !== undefined) {
        to = cut;
        break;
      }
    }
    for (const chord of target.chords) {
      const pinned = line.chords.find((one) => one.id === chord.id);
      if (pinned && chord.beat > 1) to = Math.min(to, wordStart(line.text, pinned.at));
    }
    return from < to ? [{ lineId: line.id, from, to }] : [];
  }
  const { letters, points } = barPoints(chart, target, spans[bar]!, beat);
  const before = points.filter((one) => one.beat < beat - 1).at(-1);
  const after = points.find((one) => one.beat > beat - 1);
  if (!before || !after) return [];
  const range: BarLyricSpan[] = [];
  for (const letter of letters.slice(before.letter + 1, after.letter)) {
    const last = range.at(-1);
    if (last && last.lineId === letter.lineId) last.to = letter.at + 1;
    else range.push({ lineId: letter.lineId, from: letter.at, to: letter.at + 1 });
  }
  return range;
}

/**
 * The lyric line sung at `position` (in beats from the song's start), as
 * `barBeatPlaces` places the beats: the last beat placed in the words at or
 * before it, in the same pass. Null before its pass's first words are sung
 * (an intro, an instrumental), or outside the song.
 */
export function lineAtPosition(bars: readonly ChartBar[], places: readonly (BeatPlace | null)[][], position: number): { passIndex: number; lineId: string } | null {
  const now = barAt(bars, position);
  if (!now) return null;
  const pass = bars[now.bar]!.passIndex;
  for (let index = now.bar; index >= 0 && bars[index]!.passIndex === pass; index--) {
    const beats = places[index] ?? [];
    for (let beat = index === now.bar ? Math.min(now.beat, beats.length - 1) : beats.length - 1; beat >= 0; beat--) {
      const place = beats[beat];
      if (place) return { passIndex: pass, lineId: place.lineId };
    }
  }
  return null;
}
