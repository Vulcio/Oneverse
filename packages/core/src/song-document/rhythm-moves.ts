import type { Rhythm, SectionV2 } from "../schemas/song-document-v2.js";
import { wordStart } from "./bars.js";
import { moveRhythmChord, rhythmBarBeats } from "./rhythm-edit.js";

/**
 * Moving chords in the chord grid (issue #462), the way a video editor moves
 * clips. A chord dragged to a beat takes the others with it:
 *
 * - Ripple: it and every chord after it in its section move by as much; bars
 *   are added or taken off at the end. For a missing or extra beat.
 * - In place: only the chords between the key chords on either side of it
 *   move, spread evenly between them (on whole beats, halves when there's no
 *   room); the bars stay.
 *
 * Key chords (`pinned`) stay put when others move: a chord on beat 1 is one
 * unless unpinned, and a chord moved by hand becomes one. The words follow
 * their chords - they're cut where the chords are (`barLyricSpans`), and a
 * bar line placed in them goes with the chord it started on.
 */

export type RhythmMoveMode = "ripple" | "inPlace";

type Bar = Rhythm["bars"][number];
type BarChord = Bar["chords"][number];

/** Why a move can't be made, and the chord in the way. */
export type RhythmMoveProblem =
  /** Not a beat of the section. */
  | { problem: "outside" }
  /** Ripple keeps the chart's order: it can't pass the chord before it. */
  | { problem: "order"; chordId: string }
  /** In place stops at the key chords on either side. */
  | { problem: "pinned"; chordId: string }
  /** No room between the key chords for the chords between them. */
  | { problem: "room" };

export type RhythmMove =
  | {
      ok: true;
      rhythm: Rhythm;
      /** The other chords that changed place. */
      moved: string[];
      /** How far the chord moved, in beats. */
      by: number;
      /** Bars added (or, below 0, taken off) at the end. */
      bars: number;
    }
  | ({ ok: false } & RhythmMoveProblem);

const EPS = 1e-6;
/** Times kept to a thousandth of a beat, so sums of halves don't drift. */
const tidy = (time: number) => Math.round(time * 1000) / 1000;

/** A key chord: stays put when others move. Pinned or unpinned by hand, else one on beat 1. */
export function isKeyChord(chord: Pick<BarChord, "beat" | "pinned">): boolean {
  return chord.pinned ?? Math.abs(chord.beat - 1) < EPS;
}

/** A chord's `pinned`, left out when it says what its beat already does. */
function withPin(chordId: string, beat: number, key: boolean): BarChord {
  const chord: BarChord = { chordId, beat };
  if (key !== isKeyChord(chord)) chord.pinned = key;
  return chord;
}

function layout(rhythm: Rhythm, timeBeats: number) {
  const lengths = rhythm.bars.map((bar) => rhythmBarBeats(rhythm, bar, timeBeats));
  const starts: number[] = [];
  let total = 0;
  for (const length of lengths) {
    starts.push(total);
    total += length;
  }
  return { lengths, starts, total };
}

function barAtTime(starts: readonly number[], lengths: readonly number[], time: number): number {
  for (let index = starts.length - 1; index >= 0; index--) if (time >= starts[index]! - EPS) return time < starts[index]! + lengths[index]! - EPS ? index : -1;
  return -1;
}

/** The section's chords in the chart's order, with where the rhythm has them (beats from the section's start). */
function placedChords(section: Pick<SectionV2, "lines">, rhythm: Rhythm, timeBeats: number) {
  const { starts } = layout(rhythm, timeBeats);
  const placed = new Map<string, { time: number; key: boolean; bar: number; beat: number }>();
  rhythm.bars.forEach((bar, index) => {
    for (const chord of bar.chords) placed.set(chord.chordId, { time: tidy(starts[index]! + chord.beat - 1), key: isKeyChord(chord), bar: index, beat: chord.beat });
  });
  const order = section.lines.flatMap((line) => (line.kind === "note" ? [] : line.chords.map((chord) => chord.id))).filter((id) => placed.has(id));
  return { placed, order };
}

/** The bars again, each chord in the bar its time falls in. */
function rebuild(props: Omit<Bar, "chords">[], lengths: readonly number[], times: Map<string, { time: number; key: boolean }>): Bar[] {
  const starts: number[] = [];
  let total = 0;
  for (const length of lengths) {
    starts.push(total);
    total += length;
  }
  const bars: Bar[] = props.map((one) => ({ ...one, chords: [] }));
  for (const [chordId, { time, key }] of times) {
    const index = barAtTime(starts, lengths, time);
    if (index < 0) continue;
    bars[index]!.chords.push(withPin(chordId, tidy(time - starts[index]! + 1), key));
  }
  for (const bar of bars) bar.chords.sort((a, b) => a.beat - b.beat);
  return bars;
}

/** The bar's props but its chords, as the rhythm had them. */
function propsOf(bar: Bar): Omit<Bar, "chords"> {
  const { chords: _chords, ...rest } = bar;
  return rest;
}

/**
 * The chord whose word a bar placed in the lyrics starts at (`lyricAnchor`
 * past a line's start): the bar line goes with it.
 */
function anchorChord(section: Pick<SectionV2, "lines">, anchor: { lineId: string; at: number }): string | null {
  const line = section.lines.find((one) => one.id === anchor.lineId);
  return line?.chords.find((chord) => wordStart(line.text, chord.at) === anchor.at)?.id ?? null;
}

/** Spreads `count` chords evenly between two times (both left out): whole beats, else halves; null without room. */
function spread(from: number, to: number, count: number): number[] | null {
  for (const step of [1, 0.5]) {
    const out: number[] = [];
    let last = from;
    for (let index = 1; index <= count; index++) {
      let time = Math.round((from + ((to - from) * index) / (count + 1)) / step) * step;
      if (time <= last + EPS) time = last + step;
      if (time >= to - EPS) break;
      out.push(tidy(time));
      last = time;
    }
    if (out.length === count) return out;
  }
  return null;
}

/**
 * Moves chord `chordId` to beat `beat` (1-based, 2.5 the "and" of 2) of bar
 * `bar` (0-based) of its section's rhythm, ripple or in place. A chord the
 * rhythm hasn't got yet is placed there on its own (`moveRhythmChord`).
 */
export function moveChordInRhythm(section: Pick<SectionV2, "lines">, rhythm: Rhythm, chordId: string, bar: number, beat: number, mode: RhythmMoveMode, timeBeats = 4): RhythmMove {
  const { starts, lengths } = layout(rhythm, timeBeats);
  if (bar < 0 || bar >= rhythm.bars.length || !Number.isFinite(beat) || beat < 1 || beat >= lengths[bar]! + 1) return { ok: false, problem: "outside" };
  const { placed } = placedChords(section, rhythm, timeBeats);
  if (!placed.has(chordId)) {
    const next = moveRhythmChord(section, rhythm, chordId, bar, beat, timeBeats);
    return next ? { ok: true, rhythm: next, moved: [], by: 0, bars: 0 } : { ok: false, problem: "outside" };
  }
  return moveTo(section, rhythm, chordId, tidy(starts[bar]! + beat - 1), mode, timeBeats);
}

/**
 * Moves chord `chordId` by `by` beats (below 0: earlier), as the arrows do:
 * a beat, or a bar's length. Ripple may take it past the section's end
 * (bars are added); in place may not.
 */
export function nudgeChordInRhythm(section: Pick<SectionV2, "lines">, rhythm: Rhythm, chordId: string, by: number, mode: RhythmMoveMode, timeBeats = 4): RhythmMove {
  const { placed } = placedChords(section, rhythm, timeBeats);
  const chord = placed.get(chordId);
  if (!chord) return { ok: false, problem: "outside" };
  return moveTo(section, rhythm, chordId, tidy(chord.time + by), mode, timeBeats);
}

function moveTo(section: Pick<SectionV2, "lines">, rhythm: Rhythm, chordId: string, target: number, mode: RhythmMoveMode, timeBeats: number): RhythmMove {
  const { starts, lengths, total } = layout(rhythm, timeBeats);
  const { placed, order } = placedChords(section, rhythm, timeBeats);
  const index = order.indexOf(chordId);
  const old = placed.get(chordId)!.time;
  if (target < -EPS || (mode === "inPlace" && target >= total - EPS)) return { ok: false, problem: "outside" };
  const times = new Map([...placed].map(([id, one]) => [id, { time: one.time, key: one.key }]));
  if (Math.abs(target - old) < EPS) return { ok: true, rhythm, moved: [], by: 0, bars: 0 };
  return mode === "ripple" ? ripple() : inPlace();

  function ripple(): RhythmMove {
    const before = order[index - 1];
    if (before !== undefined && placed.get(before)!.time >= target - EPS) return { ok: false, problem: "order", chordId: before };
    const by = tidy(target - old);
    const shifted = order.slice(index);
    for (const id of shifted) times.set(id, { time: tidy(placed.get(id)!.time + by), key: id === chordId ? true : placed.get(id)!.key });
    // The bars: as many more (or fewer) at the end as the section grew by.
    const sizes = [...lengths];
    const props = rhythm.bars.map(propsOf);
    const fallback = rhythm.beatsPerBar ?? Math.max(1, Math.round(timeBeats));
    const last = Math.max(...[...times.values()].map((one) => one.time));
    let sum = total;
    while ((sum < total + by - EPS || sum <= last + EPS) && sizes.length < 512) {
      sizes.push(fallback);
      props.push({ lyricAnchor: null });
      sum += fallback;
    }
    // From the bar the change starts in: the words placed again from where their chords are now.
    const first = Math.min(old, target);
    const from = barAtTime(starts, lengths, first);
    while (by < 0 && sizes.length > Math.max(1, from + 1) && sum - sizes.at(-1)! >= total + by - EPS && sum - sizes.at(-1)! > last + EPS) {
      sum -= sizes.pop()!;
      props.pop();
    }
    // A bar starting where the chord was is in what moves: its place in the words too.
    const clearFrom = starts[from]! >= old - EPS ? from : from + 1;
    for (let at = clearFrom; at < props.length; at++) {
      const { lyricAnchor: _lyric, beatAnchors: _beats, ...rest } = props[at]!;
      props[at] = { ...rest, lyricAnchor: null };
    }
    const own = props[from]!;
    if (own.beatAnchors) {
      const kept = own.beatAnchors.filter((anchor) => starts[from]! + anchor.beat - 1 < first - EPS);
      if (kept.length > 0) props[from] = { ...own, beatAnchors: kept };
      else {
        const { beatAnchors: _gone, ...rest } = own;
        props[from] = rest;
      }
    }
    const bars = rebuild(props, sizes, times);
    const barOf = (id: string) => bars.findIndex((one) => one.chords.some((chord) => chord.chordId === id));
    rhythm.bars.forEach((one, at) => {
      if (at < clearFrom || !one.lyricAnchor) return;
      const anchor = one.lyricAnchor;
      let to = -1;
      if (anchor.at === 0) {
        const line = section.lines.find((other) => other.id === anchor.lineId);
        const firstChord = line?.chords.find((chord) => times.has(chord.id));
        to = firstChord ? barOf(firstChord.id) : barAtTime(layout({ ...rhythm, bars }, timeBeats).starts, sizes, starts[at]! + (starts[at]! >= old - EPS ? by : 0));
      } else {
        const chord = anchorChord(section, anchor);
        if (chord) {
          to = barOf(chord);
          if (to >= 0 && !bars[to]!.chords.some((one) => one.chordId === chord && Math.abs(one.beat - 1) < EPS)) to = -1;
        }
      }
      if (to >= clearFrom && !bars[to]!.lyricAnchor) bars[to] = { ...bars[to]!, lyricAnchor: anchor };
    });
    return { ok: true, rhythm: { ...rhythm, bars }, moved: shifted.slice(1), by, bars: sizes.length - lengths.length };
  }

  function inPlace(): RhythmMove {
    let keyBefore = -1;
    for (let at = index - 1; at >= 0; at--) if (placed.get(order[at]!)!.key) {
      keyBefore = at;
      break;
    }
    let keyAfter = -1;
    for (let at = index + 1; at < order.length; at++) if (placed.get(order[at]!)!.key) {
      keyAfter = at;
      break;
    }
    if (keyBefore >= 0 && target <= placed.get(order[keyBefore]!)!.time + EPS) return { ok: false, problem: "pinned", chordId: order[keyBefore]! };
    if (keyAfter >= 0 && target >= placed.get(order[keyAfter]!)!.time - EPS) return { ok: false, problem: "pinned", chordId: order[keyAfter]! };
    const moved: string[] = [];
    const place = (ids: string[], at: number[]) =>
      ids.forEach((id, i) => {
        if (Math.abs(placed.get(id)!.time - at[i]!) > EPS) moved.push(id);
        times.set(id, { time: at[i]!, key: false });
      });
    // Between the key chord before and this one; with none before, only when they're in the way.
    const before = order.slice(keyBefore + 1, index);
    if (before.length > 0) {
      if (keyBefore >= 0) {
        const at = spread(placed.get(order[keyBefore]!)!.time, target, before.length);
        if (!at) return { ok: false, problem: "room" };
        place(before, at);
      } else if (placed.get(before.at(-1)!)!.time >= target - EPS) {
        const at = spread(-1, target, before.length);
        if (!at || at[0]! < 0) return { ok: false, problem: "room" };
        place(before, at);
      }
    }
    const after = order.slice(index + 1, keyAfter >= 0 ? keyAfter : order.length);
    if (after.length > 0) {
      if (keyAfter >= 0) {
        const at = spread(target, placed.get(order[keyAfter]!)!.time, after.length);
        if (!at) return { ok: false, problem: "room" };
        place(after, at);
      } else if (placed.get(after[0]!)!.time <= target + EPS) {
        const at = spread(target, total, after.length);
        if (!at) return { ok: false, problem: "room" };
        place(after, at);
      }
    }
    times.set(chordId, { time: target, key: true });
    const bars = rebuild(rhythm.bars.map(propsOf), lengths, times);
    // A bar placed at a chord's word no longer starts there once that chord has left its beat 1.
    rhythm.bars.forEach((one, at) => {
      const anchor = one.lyricAnchor;
      if (!anchor || anchor.at === 0) return;
      const chord = anchorChord(section, anchor);
      if (!chord || !one.chords.some((other) => other.chordId === chord && Math.abs(other.beat - 1) < EPS)) return;
      if (!bars[at]!.chords.some((other) => other.chordId === chord && Math.abs(other.beat - 1) < EPS)) bars[at] = { ...bars[at]!, lyricAnchor: null };
    });
    return { ok: true, rhythm: { ...rhythm, bars }, moved, by: tidy(target - old), bars: 0 };
  }
}

/** Pins a chord as a key chord, or unpins it to follow the ones around it. Null when the rhythm hasn't got it. */
export function pinRhythmChord(rhythm: Rhythm, chordId: string, pinned: boolean): Rhythm | null {
  if (!rhythm.bars.some((bar) => bar.chords.some((chord) => chord.chordId === chordId))) return null;
  return {
    ...rhythm,
    bars: rhythm.bars.map((bar) => (bar.chords.some((chord) => chord.chordId === chordId) ? { ...bar, chords: bar.chords.map((chord) => (chord.chordId === chordId ? withPin(chordId, chord.beat, pinned) : chord)) } : bar)),
  };
}

/** How a section matches another for the chord grid: the same chords and words (a copy), or the same chords to other words (another verse). */
export interface SectionMatch {
  sectionId: string;
  same: "words" | "chords";
}

const chordsOf = (section: Pick<SectionV2, "lines">) => section.lines.flatMap((line) => (line.kind === "note" ? [] : line.chords.map((chord) => chord.raw)));
const wordsOf = (section: Pick<SectionV2, "lines">) =>
  section.lines
    .filter((line) => line.kind !== "note")
    .map((line) => line.text.trim().replace(/\s+/g, " ").toLowerCase())
    .join("\n");

/**
 * The other sections with the same chords, in the same order, as section
 * `sectionId` (issue #462): a change of its bars is made in them too (the
 * same words) or offered (other words). None for a section without chords.
 */
export function matchingSections(sections: readonly Pick<SectionV2, "id" | "lines">[], sectionId: string): SectionMatch[] {
  const section = sections.find((one) => one.id === sectionId);
  if (!section) return [];
  const chords = chordsOf(section).join(" ");
  if (!chords) return [];
  const words = wordsOf(section);
  return sections.filter((one) => one.id !== sectionId && chordsOf(one).join(" ") === chords).map((one) => ({ sectionId: one.id, same: wordsOf(one) === words ? "words" : "chords" }));
}

/**
 * Section `from`'s bars given to section `to`, which has the same chords
 * (`matchingSections`): each of its chords where `from`'s is, in bars of the
 * same lengths. Its words are placed by its own lines - matched line for
 * line when the two have as many, with as many chords each, else at the
 * start of each line's first bar. Beats placed in the words by hand stay
 * `from`'s. Null when the chords don't match.
 */
export function copyRhythmPlacement(from: Pick<SectionV2, "lines">, rhythm: Rhythm, to: Pick<SectionV2, "lines">): Rhythm | null {
  const fromLines = from.lines.filter((line) => line.kind !== "note");
  const toLines = to.lines.filter((line) => line.kind !== "note");
  const fromIds = fromLines.flatMap((line) => line.chords.map((chord) => chord.id));
  const toIds = toLines.flatMap((line) => line.chords.map((chord) => chord.id));
  if (fromIds.length !== toIds.length || chordsOf(from).join(" ") !== chordsOf(to).join(" ")) return null;
  const ids = new Map(fromIds.map((id, index) => [id, toIds[index]!]));
  const sameLines = fromLines.length === toLines.length && fromLines.every((line, index) => line.chords.length === toLines[index]!.chords.length);
  const lineIds = new Map(sameLines ? fromLines.map((line, index) => [line.id, toLines[index]!.id]) : []);
  const anchorFor = (anchor: Bar["lyricAnchor"]): Bar["lyricAnchor"] => {
    if (!anchor || !lineIds.has(anchor.lineId)) return null;
    const lineId = lineIds.get(anchor.lineId)!;
    if (anchor.at === 0) return { lineId, at: 0 };
    const chord = anchorChord(from, anchor);
    const line = to.lines.find((one) => one.id === lineId)!;
    const mine = chord ? line.chords.find((one) => one.id === ids.get(chord)) : undefined;
    return mine ? { lineId, at: wordStart(line.text, mine.at) } : null;
  };
  const bars: Bar[] = rhythm.bars.map((bar) => {
    const next: Bar = { chords: bar.chords.flatMap((chord) => (ids.has(chord.chordId) ? [{ ...chord, chordId: ids.get(chord.chordId)! }] : [])), lyricAnchor: anchorFor(bar.lyricAnchor) };
    if (bar.beats) next.beats = bar.beats;
    return next;
  });
  if (!sameLines) {
    // Each line from its first chord's bar.
    for (const line of toLines) {
      const chord = line.chords[0];
      const at = chord ? bars.findIndex((bar) => bar.chords.some((one) => one.chordId === chord.id)) : -1;
      if (at >= 0 && !bars[at]!.lyricAnchor) bars[at] = { ...bars[at]!, lyricAnchor: { lineId: line.id, at: 0 } };
    }
  }
  return { beatsPerBar: rhythm.beatsPerBar ?? null, bars };
}

/** Whether two sections with the same chords have them in the same places, in bars of the same lengths. */
export function samePlacement(a: Pick<SectionV2, "lines">, aRhythm: Rhythm, b: Pick<SectionV2, "lines">, bRhythm: Rhythm, timeBeats = 4): boolean {
  const one = layout(aRhythm, timeBeats);
  const other = layout(bRhythm, timeBeats);
  if (one.lengths.join(",") !== other.lengths.join(",")) return false;
  const first = placedChords(a, aRhythm, timeBeats);
  const second = placedChords(b, bRhythm, timeBeats);
  if (first.order.length !== second.order.length) return false;
  return first.order.every((id, index) => {
    const x = first.placed.get(id)!;
    const y = second.placed.get(second.order[index]!)!;
    return Math.abs(x.time - y.time) < EPS && x.key === y.key;
  });
}

/**
 * A section given `count` bars (issue #462): empty ones added at its end, or
 * the last ones taken off - only bars without chord changes. Null when a bar
 * to take off has some (move them first), or below 1 or past 512.
 */
export function setRhythmBarCount(rhythm: Rhythm, count: number): Rhythm | null {
  if (!Number.isInteger(count) || count < 1 || count > 512) return null;
  if (count === rhythm.bars.length) return rhythm;
  if (count > rhythm.bars.length) return { ...rhythm, bars: [...rhythm.bars, ...Array.from({ length: count - rhythm.bars.length }, (): Bar => ({ chords: [], lyricAnchor: null }))] };
  if (rhythm.bars.slice(count).some((bar) => bar.chords.length > 0)) return null;
  return { ...rhythm, bars: rhythm.bars.slice(0, count) };
}
