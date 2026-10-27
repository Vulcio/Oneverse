import type { Rhythm, SectionV2 } from "../schemas/song-document-v2.js";

/**
 * Editing a section's bars in the chord grid (issue #238): its chords placed
 * on beats (the "and" too), bars added, removed or given a length of their
 * own (a pickup, a 2/4 bar before the chorus). Each edit gives a new
 * `rhythm`, or null when it can't be made - the chart's order stays: a chord
 * never moves past its neighbours, so the bars and the lyric chart never
 * disagree.
 */

type RhythmBar = Rhythm["bars"][number];

const MAX_BARS = 512;
const MAX_BEATS = 32;

/** The words a chord pinned at `at` starts with: where the grid cuts a line. */
function wordStart(text: string, at: number): number {
  let start = Math.min(at, text.length);
  while (start > 0 && /\S/.test(text[start - 1]!)) start--;
  return start;
}

/**
 * A section's rhythm, to edit: its own, else the bars `chartBars()` fills in
 * from the chart written as one - each chord a bar on its first beat, a sung
 * line at least two, a line of chords alone a bar a chord, two empty bars
 * without lines - each line's first bar placed at its start and the others
 * where their chord's word starts, so the grid shows the same bars and words
 * before and after.
 */
export function editableRhythm(section: Pick<SectionV2, "lines" | "rhythm">): Rhythm {
  if (section.rhythm && section.rhythm.bars.length > 0) return section.rhythm;
  const bars: RhythmBar[] = [];
  for (const line of section.lines) {
    if (line.kind === "note") continue;
    const sung = line.text.trim().length > 0;
    const count = Math.max(line.chords.length, sung ? 2 : 1);
    let anchoredAt = 0;
    for (let index = 0; index < count && bars.length < MAX_BARS; index++) {
      const chord = line.chords[index];
      const at = chord && sung ? wordStart(line.text, chord.at) : null;
      const anchor = index === 0 ? { lineId: line.id, at: 0 } : at !== null && at > anchoredAt ? { lineId: line.id, at } : null;
      if (anchor) anchoredAt = anchor.at;
      bars.push({ chords: chord ? [{ chordId: chord.id, beat: 1 }] : [], lyricAnchor: anchor });
    }
  }
  if (bars.length === 0) bars.push({ chords: [], lyricAnchor: null }, { chords: [], lyricAnchor: null });
  return { beatsPerBar: section.rhythm?.beatsPerBar ?? null, bars };
}

/** A bar's length in beats: its own, else the rhythm's, else the time signature's top number. */
export function rhythmBarBeats(rhythm: Pick<Rhythm, "beatsPerBar">, bar: Pick<RhythmBar, "beats">, timeBeats = 4): number {
  return bar.beats ?? rhythm.beatsPerBar ?? Math.max(1, Math.round(timeBeats));
}

/**
 * Moves a chord of the section to beat `beat` (1-based, 2.5 is the "and" of
 * 2) of bar `bar` (0-based), or places it there if the rhythm hasn't got it
 * yet. Null when the beat isn't in the bar, or the chord would pass the one
 * before or after it in the chart. Moved into an earlier bar, a bar that
 * started at its word (as `editableRhythm` places them) no longer does: its
 * word is sung in the earlier bar now, so the words carry on through it.
 */
export function moveRhythmChord(section: Pick<SectionV2, "lines">, rhythm: Rhythm, chordId: string, bar: number, beat: number, timeBeats = 4): Rhythm | null {
  const target = rhythm.bars[bar];
  if (!target || !Number.isFinite(beat) || beat < 1 || beat >= rhythmBarBeats(rhythm, target, timeBeats) + 1) return null;
  const order = section.lines.flatMap((line) => (line.kind === "note" ? [] : line.chords.map((chord) => chord.id)));
  const index = order.indexOf(chordId);
  if (index < 0) return null;
  // Every other chord's place, in beats from the section's start.
  const places = new Map<string, number>();
  let start = 0;
  const starts = rhythm.bars.map((one) => {
    const at = start;
    for (const chord of one.chords) if (chord.chordId !== chordId) places.set(chord.chordId, at + chord.beat - 1);
    start += rhythmBarBeats(rhythm, one, timeBeats);
    return at;
  });
  const place = starts[bar]! + beat - 1;
  const before = order.slice(0, index).reverse().find((id) => places.has(id));
  const after = order.slice(index + 1).find((id) => places.has(id));
  if (before !== undefined && places.get(before)! >= place - 1e-9) return null;
  if (after !== undefined && places.get(after)! <= place + 1e-9) return null;
  const from = rhythm.bars.findIndex((one) => one.chords.some((chord) => chord.chordId === chordId));
  const line = section.lines.find((one) => one.chords.some((chord) => chord.id === chordId))!;
  const word = wordStart(line.text, line.chords.find((chord) => chord.id === chordId)!.at);
  const startedAtWord = (one: RhythmBar, at: number) => from > bar && at > bar && at <= from && word > 0 && one.lyricAnchor?.lineId === line.id && one.lyricAnchor.at === word;
  return {
    ...rhythm,
    bars: rhythm.bars.map((one, at) => {
      const chords = one.chords.filter((chord) => chord.chordId !== chordId);
      if (at === bar) chords.push({ chordId, beat });
      const moved = chords.length !== one.chords.length || at === bar;
      if (startedAtWord(one, at)) return { ...one, chords: chords.sort((a, b) => a.beat - b.beat), lyricAnchor: null };
      return moved ? { ...one, chords: chords.sort((a, b) => a.beat - b.beat) } : one;
    }),
  };
}

/**
 * Gives bar `bar` a length of its own (`beats`), or the section's again
 * (null). Null when a chord of the bar would fall past its end.
 */
export function setRhythmBarBeats(rhythm: Rhythm, bar: number, beats: number | null, timeBeats = 4): Rhythm | null {
  const target = rhythm.bars[bar];
  if (!target) return null;
  const sections = rhythm.beatsPerBar ?? Math.max(1, Math.round(timeBeats));
  const length = beats === null ? sections : Math.round(beats);
  if (length < 1 || length > MAX_BEATS || target.chords.some((chord) => chord.beat >= length + 1)) return null;
  const next: RhythmBar = { ...target, beats: length };
  if (length === sections) delete next.beats;
  // Beats it no longer has aren't placed anywhere.
  if (target.beatAnchors) {
    const kept = target.beatAnchors.filter((anchor) => anchor.beat <= length);
    if (kept.length > 0) next.beatAnchors = kept;
    else delete next.beatAnchors;
  }
  return { ...rhythm, bars: rhythm.bars.map((one, at) => (at === bar ? next : one)) };
}

/** An empty bar before bar `at` (the rhythm's length: after the last); the chord before carries on through it. Null past 512 bars. */
export function insertRhythmBar(rhythm: Rhythm, at: number): Rhythm | null {
  if (at < 0 || at > rhythm.bars.length || rhythm.bars.length >= MAX_BARS) return null;
  const bars = [...rhythm.bars];
  bars.splice(at, 0, { chords: [], lyricAnchor: null });
  return { ...rhythm, bars };
}

/**
 * Removes bar `bar`. Only a bar with no chord changes, and never the last
 * one left: move its chords first. Its place in the lyrics goes to the bar
 * after, when that one has none.
 */
export function removeRhythmBar(rhythm: Rhythm, bar: number): Rhythm | null {
  const target = rhythm.bars[bar];
  if (!target || target.chords.length > 0 || rhythm.bars.length <= 1) return null;
  const bars = [...rhythm.bars];
  const next = bars[bar + 1];
  if (target.lyricAnchor && next && !next.lyricAnchor) bars[bar + 1] = { ...next, lyricAnchor: target.lyricAnchor };
  bars.splice(bar, 1);
  return { ...rhythm, bars };
}

/**
 * Places beat `beat` (1-based) of bar `bar` at a character of a line, or
 * lets the grid place it again (null). The first beat is where the bar
 * starts: placing it moves the bar line (`lyricAnchor`), and it's never
 * unplaced. Where it may go is `beatPlaceRange`'s to say; null when the bar
 * hasn't got that beat.
 */
export function placeRhythmBeat(rhythm: Rhythm, bar: number, beat: number, place: { lineId: string; at: number } | null, timeBeats = 4): Rhythm | null {
  const target = rhythm.bars[bar];
  if (!target || !Number.isInteger(beat) || beat < 1 || beat > rhythmBarBeats(rhythm, target, timeBeats)) return null;
  let next: RhythmBar;
  if (beat === 1) {
    if (!place) return null;
    next = { ...target, lyricAnchor: { lineId: place.lineId, at: place.at } };
  } else {
    const anchors = (target.beatAnchors ?? []).filter((anchor) => anchor.beat !== beat);
    if (place) anchors.push({ beat, lineId: place.lineId, at: place.at });
    next = { ...target, beatAnchors: anchors.sort((a, b) => a.beat - b.beat) };
    if (anchors.length === 0) delete next.beatAnchors;
  }
  return { ...rhythm, bars: rhythm.bars.map((one, at) => (at === bar ? next : one)) };
}

/**
 * A rhythm worked out again from bar lines (`rhythmFromBarLines`), keeping
 * what was placed by hand in `previous`: a bar starting at the same place in
 * the lyrics (or as many bars after it) with the same chords keeps their
 * beats and its own length. The editor saves bar lines this way, so moving
 * one doesn't undo the grid's work elsewhere.
 */
export function keepPlacedBeats(previous: Rhythm | null | undefined, next: Rhythm | null): Rhythm | null {
  if (!previous || !next) return next;
  const keys = (rhythm: Rhythm) => {
    let anchor = "start";
    let after = 0;
    return rhythm.bars.map((bar) => {
      if (bar.lyricAnchor) {
        anchor = `${bar.lyricAnchor.lineId}:${bar.lyricAnchor.at}`;
        after = 0;
      } else after++;
      return `${anchor}#${after}`;
    });
  };
  const chordsOf = (bar: RhythmBar) =>
    bar.chords
      .map((chord) => chord.chordId)
      .sort()
      .join(",");
  const before = new Map<string, RhythmBar>();
  keys(previous).forEach((key, index) => before.set(key, previous.bars[index]!));
  const nextKeys = keys(next);
  return {
    ...next,
    beatsPerBar: previous.beatsPerBar ?? next.beatsPerBar ?? null,
    bars: next.bars.map((bar, index) => {
      const kept = before.get(nextKeys[index]!);
      if (!kept || chordsOf(kept) !== chordsOf(bar)) return bar;
      return { ...bar, chords: kept.chords, ...(kept.beats ? { beats: kept.beats } : {}), ...(kept.beatAnchors?.length ? { beatAnchors: kept.beatAnchors } : {}) };
    }),
  };
}
