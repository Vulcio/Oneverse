import type { Rhythm, SectionV2 } from "../schemas/song-document-v2.js";

/**
 * Bar lines in the lyrics (issue #238): where each bar of a section starts,
 * placed between two characters of a line as a lead sheet marks them -
 * what the editor shows and lets you drag. They're the section's `rhythm`
 * seen another way: a bar line starts a bar at its place (the bar's
 * `lyricAnchor`), `bars` above 1 adds bars after it with no words of their
 * own (a held word, an instrumental bar), and the chords between one bar
 * line and the next fall in those bars, on beats spread as the words are.
 */
export interface BarLine {
  /** The character it stands before, in its line's text (its length: at the end). */
  at: number;
  /** How many of its line's chords come before it: places it among chords pinned to the same character (a line of chords alone). */
  chordsBefore: number;
  /** Bars starting here: 1, or more for bars after it with no words of their own. */
  bars: number;
  /** Its bars' cues, kept as they were ("hold"); left out when there are none. */
  cues?: (string | null)[];
}

/** A section's bar lines, by line ID, each line's in order. */
export type SectionBarLines = Record<string, BarLine[]>;

const MAX_BARS = 512;
/** How many characters' room a chord takes on a line of chords alone, for spreading beats. */
const CHORD_ROOM = 8;

type Item = { kind: "chord"; id: string; offset: number } | { kind: "bar"; lineId: string; at: number; bars: number; cues?: (string | null)[]; offset: number };

/**
 * A section's rhythm from its bar lines; null without any. The section
 * starts on a bar: words or chords before its first bar line get one of
 * their own. Each bar line's chords are placed on the beats their words
 * reach - a chord a third of the way through a bar's words falls on its
 * second beat in 4/4 - rounded to the beat, half a beat apart at least;
 * between chords with no words between them, evenly. `beatsPerBar` is the
 * song's time signature's top number (4 without one); the rhythm leaves
 * its own `beatsPerBar` to the time signature.
 */
export function rhythmFromBarLines(section: Pick<SectionV2, "lines">, marks: SectionBarLines, beatsPerBar = 4): Rhythm | null {
  const beats = Math.max(1, Math.round(beatsPerBar));
  const items: Item[] = [];
  let offset = 0;
  let any = false;
  for (const line of section.lines) {
    if (line.kind === "note") continue;
    const lineMarks = [...(marks[line.id] ?? [])].sort((a, b) => a.at - b.at || a.chordsBefore - b.chordsBefore);
    let next = 0;
    // How far into the line: its characters; on a line of chords alone, the chords before.
    const alone = line.text.length === 0;
    const reach = (at: number, chordsBefore: number) => offset + (alone ? chordsBefore * CHORD_ROOM : at);
    // The bar lines before the chord `index`, pinned at `at` (all that are left, at the line's end).
    const pushMarks = (index: number, at: number) => {
      while (next < lineMarks.length && (lineMarks[next]!.at < at || (lineMarks[next]!.at === at && lineMarks[next]!.chordsBefore <= index))) {
        const mark = lineMarks[next++]!;
        const markAt = Math.min(Math.max(0, mark.at), line.text.length);
        items.push({ kind: "bar", lineId: line.id, at: markAt, bars: Math.max(1, Math.round(mark.bars)), ...(mark.cues ? { cues: mark.cues } : {}), offset: reach(markAt, Math.min(index, line.chords.length)) });
        any = true;
      }
    };
    line.chords.forEach((chord, index) => {
      const at = Math.min(chord.at, line.text.length);
      pushMarks(index, at);
      items.push({ kind: "chord", id: chord.id, offset: reach(at, index) });
    });
    pushMarks(line.chords.length, Number.POSITIVE_INFINITY);
    offset += alone ? Math.max(1, line.chords.length) * CHORD_ROOM : line.text.length;
  }
  if (!any) return null;

  // Words or chords before the first bar line: a bar of their own from the section's start.
  const first = items.findIndex((item) => item.kind === "bar");
  const firstLine = section.lines.find((line) => line.kind !== "note");
  if ((first > 0 || (items[first] as Extract<Item, { kind: "bar" }>).offset > 0) && firstLine) items.unshift({ kind: "bar", lineId: firstLine.id, at: 0, bars: 1, offset: 0 });

  const bars: Rhythm["bars"] = [];
  for (let index = 0; index < items.length; index++) {
    const mark = items[index]!;
    if (mark.kind !== "bar") continue;
    let end = index + 1;
    while (end < items.length && items[end]!.kind !== "bar") end++;
    const until = items[end]?.offset ?? offset;
    const chords = items.slice(index + 1, end) as Extract<Item, { kind: "chord" }>[];
    const total = mark.bars * beats;
    const length = until - mark.offset;
    // Each chord's beat from the bar line's start, 0-based.
    const placed: number[] = [];
    chords.forEach((chord, i) => {
      let beat = length > 0 ? Math.round(((chord.offset - mark.offset) / length) * total) : Math.floor((i * total) / chords.length);
      beat = Math.min(Math.max(0, beat), total - 1);
      const previous = placed.at(-1);
      if (previous !== undefined && beat <= previous) beat = previous + Math.min(0.5, (total - previous) / 2);
      placed.push(beat);
    });
    for (let bar = 0; bar < mark.bars && bars.length < MAX_BARS; bar++) {
      bars.push({
        chords: chords.flatMap((chord, i) => (Math.floor(placed[i]! / beats) === bar || (bar === mark.bars - 1 && placed[i]! >= total) ? [{ chordId: chord.id, beat: placed[i]! - bar * beats + 1 }] : [])),
        lyricAnchor: bar === 0 ? { lineId: mark.lineId, at: mark.at } : null,
        ...(mark.cues?.[bar] ? { cue: mark.cues[bar] } : {}),
      });
    }
  }
  return { beatsPerBar: null, bars };
}

/**
 * A section's bar lines from its rhythm, to show and move them: each bar
 * with a place in the lyrics starts a bar line, and the bars after it with
 * none add to its count. Bars before the first with a place start at the
 * section's first line. Empty without a rhythm.
 */
export function barLinesFromRhythm(section: Pick<SectionV2, "lines" | "rhythm">): SectionBarLines {
  const bars = section.rhythm?.bars ?? [];
  const lines = new Map(section.lines.filter((line) => line.kind !== "note").map((line) => [line.id, line]));
  const firstLine = section.lines.find((line) => line.kind !== "note");
  if (bars.length === 0 || !firstLine) return {};
  const marks: { lineId: string; at: number; bars: number; cues: (string | null)[]; chordsBefore: Set<string> }[] = [];
  const earlier = new Set<string>();
  for (const bar of bars) {
    const anchor = bar.lyricAnchor && lines.has(bar.lyricAnchor.lineId) ? bar.lyricAnchor : null;
    const last = marks.at(-1);
    if (anchor || !last) {
      const lineId = anchor?.lineId ?? firstLine.id;
      const at = Math.min(anchor?.at ?? 0, lines.get(lineId)!.text.length);
      marks.push({ lineId, at, bars: 1, cues: [bar.cue ?? null], chordsBefore: new Set(earlier) });
    } else {
      last.bars++;
      last.cues.push(bar.cue ?? null);
    }
    for (const chord of bar.chords) earlier.add(chord.chordId);
  }
  const result: SectionBarLines = {};
  for (const mark of marks) {
    const line = lines.get(mark.lineId)!;
    const chordsBefore = line.chords.filter((chord) => chord.at < mark.at || (chord.at === mark.at && mark.chordsBefore.has(chord.id))).length;
    const cues = mark.cues.some(Boolean) ? { cues: mark.cues } : {};
    (result[mark.lineId] ??= []).push({ at: mark.at, chordsBefore, bars: mark.bars, ...cues });
  }
  for (const list of Object.values(result)) list.sort((a, b) => a.at - b.at || a.chordsBefore - b.chordsBefore);
  return result;
}

/**
 * Bar lines where the chart's own bars would be (what `chartBars()` fills
 * in): one before each chord, a sung line taking at least two bars, a line
 * of chords alone a bar each - a start to move them from.
 */
export function suggestedBarLines(section: Pick<SectionV2, "lines">): SectionBarLines {
  const result: SectionBarLines = {};
  for (const line of section.lines) {
    if (line.kind === "note") continue;
    const sung = line.text.trim().length > 0;
    const marks: BarLine[] = line.chords.map((chord, index) => ({ at: Math.min(chord.at, line.text.length), chordsBefore: index, bars: 1 }));
    if (marks.length === 0) marks.push({ at: 0, chordsBefore: 0, bars: sung ? 2 : 1 });
    // A sung line with one chord holds it for a second bar.
    else if (sung && marks.length === 1) marks[0]!.bars = 2;
    result[line.id] = marks;
  }
  return result;
}
