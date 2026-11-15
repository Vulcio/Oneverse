import type { NotatedBar } from "../chords-over-lyrics/bar-notation.js";
import { rhythmFromBarLines, barLineBeforeEachChord, type BarLine, type SectionBarLines } from "../song-document/bar-lines.js";
import type { SectionType } from "../constants/index.js";
import type { Line, Segment } from "./shared.js";
import type { LineV2, Rhythm, SectionV2, SongDocumentV2 } from "./song-document-v2.js";

/**
 * A section as the import parsers (ChordPro, chords over lyrics, plain
 * lyrics) read it: each line cut into segments at its chords. Turned into
 * SongDocument v2 by `parsedSectionsToV2`; never stored.
 */
export interface ParsedSection {
  id: string;
  type: SectionType;
  label?: string | null;
  lines: Line[];
  /** Lines written as bars of chords ("| G | C |", issue #344), by line ID: their bars. */
  bars?: Record<string, NotatedBar[]>;
}

/** A chord that is a bar line: "[|]", "[||]", "[|:]", "[:|]", "[|.]" (issue #460). */
const BAR_CHORD = /^(?::?\|{1,2}:?|\|\.)$/;

/**
 * Bar lines written among the chords of an import (issue #460), by line
 * ID, kept beside the sections while the import tidies them, and the
 * beats bar notation gives its chords. See `importedRhythm`.
 */
export interface ImportedBars {
  marks: Map<string, BarLine[]>;
  beats: Map<string, number>;
}

export const importedBars = (): ImportedBars => ({ marks: new Map(), beats: new Map() });

/** A line's segments as one text, chords pinned where each segment began; a bar line among them goes to `marks`. */
function joinSegments(id: string, segments: Segment[], marks?: BarLine[]): LineV2 {
  let text = "";
  const chords: LineV2["chords"] = [];
  const bars: BarLine[] = [];
  for (const segment of segments) {
    if (segment.chord && BAR_CHORD.test(segment.chord.raw.trim())) bars.push({ at: text.length, chordsBefore: chords.length, bars: 1 });
    else if (segment.chord) chords.push({ id: segment.chord.id, at: text.length, raw: segment.chord.raw });
    text += segment.lyric;
  }
  for (const [i, bar] of bars.entries()) {
    // The same place twice ("||" written apart): one bar line.
    if (bars[i - 1]?.at === bar.at && bars[i - 1]?.chordsBefore === bar.chordsBefore) continue;
    // One closing the line, no chord after it: the next bar starts with the next line's.
    if (bar.chordsBefore === chords.length) continue;
    // Only spaces before the first: it starts the line.
    marks?.push(bar.chordsBefore === 0 && text.slice(0, bar.at).trim() === "" ? { ...bar, at: 0 } : bar);
  }
  // A line that was only bar lines: nothing.
  if (bars.length > 0 && chords.length === 0) text = text.trimEnd();
  return { id, kind: "lyric", text, chords };
}

/**
 * A section's rhythm from its lines written as bars (issue #344), when they're
 * all it has: an instrumental, "| G | C | D | G |". With words as well, its
 * bars can't be placed among them, so it has none and the bar lines are
 * lines of chords alone. Each line's bars start where it does.
 */
function rhythmOf(section: ParsedSection, lines: LineV2[]): Rhythm | null {
  const bars = section.bars ?? {};
  if (Object.keys(bars).length === 0) return null;
  if (!lines.every((line) => bars[line.id] || (line.text.trim() === "" && line.chords.length === 0))) return null;
  const rhythm: Rhythm = { beatsPerBar: null, bars: [] };
  for (const line of lines) {
    for (const bar of bars[line.id] ?? []) {
      const chords = bar.chords.flatMap(({ index, beat }) => (line.chords[index] ? [{ chordId: line.chords[index].id, beat }] : []));
      // A bar with chords starts at its place on the line; one with none carries the one before on.
      rhythm.bars.push({ chords, lyricAnchor: chords.length > 0 ? { lineId: line.id, at: 0 } : null });
    }
  }
  return rhythm.bars.length > 0 ? rhythm : null;
}

/**
 * Parsed sections as v2 sections, without timing but what bar notation
 * gives. Bar lines written among a section's chords ("|C#m  B  |E", "[|]")
 * go to `bars`, with its lines of bar notation's as well, to be made its
 * rhythm once the import is tidied (`importedRhythm`).
 */
export function parsedSectionsToV2(sections: ParsedSection[], bars: ImportedBars = importedBars()): SongDocumentV2["sections"] {
  return sections.map((section) => {
    const written = new Map<string, BarLine[]>();
    const lines = section.lines.map((line) => {
      const marks: BarLine[] = [];
      const joined = joinSegments(line.id, line.segments, marks);
      if (marks.length > 0) written.set(line.id, marks);
      return joined;
    });
    if (written.size > 0) {
      for (const [lineId, marks] of written) bars.marks.set(lineId, marks);
      // Its lines of bar notation: a bar line before each bar, its chords on the beats written.
      for (const line of lines) {
        const notated = section.bars?.[line.id];
        if (!notated) continue;
        bars.marks.set(
          line.id,
          notated.map((bar, b) => ({ at: 0, chordsBefore: bar.chords[0]?.index ?? notated.slice(b + 1).find((next) => next.chords.length > 0)?.chords[0]?.index ?? line.chords.length, bars: 1 })),
        );
        for (const bar of notated) for (const { index, beat } of bar.chords) if (line.chords[index]) bars.beats.set(line.chords[index].id, beat);
      }
    }
    return {
      id: section.id,
      type: section.type,
      label: section.label ?? null,
      showLabel: true,
      lines,
      rhythm: written.size > 0 ? null : rhythmOf(section, lines),
      groove: null,
    };
  });
}

/**
 * A section's rhythm from the bar lines written in it (issue #460): each
 * starts a bar (`rhythmFromBarLines`), its first chord on beat 1 and the
 * chords up to the next one sharing the bar evenly - two in 4/4 on beats
 * 1 and 3; bar notation's chords on the beats it gives. A bar whose first
 * chord comes after some words keeps the chords where the words put them. A line with chords but no
 * bar line has one before each chord. Null when none was written.
 */
export function importedRhythm(section: SectionV2, bars: ImportedBars, beatsPerBar = 4): Rhythm | null {
  if (!section.lines.some((line) => bars.marks.has(line.id))) return null;
  const suggested = barLineBeforeEachChord(section);
  const marks: SectionBarLines = {};
  for (const line of section.lines) {
    if (line.kind === "note") continue;
    const written = bars.marks.get(line.id);
    if (written) marks[line.id] = written;
    else if (line.chords.length > 0) marks[line.id] = suggested[line.id]!;
  }
  // Spaces a line starts with hold no beats: "      |E/G# A" over "        Jésus est…" starts its bar with the words.
  const lead = new Map(section.lines.map((line) => [line.id, line.chords.length > 0 || marks[line.id] ? Math.min(line.text.length - line.text.trimStart().length, ...line.chords.map((chord) => chord.at), ...(marks[line.id] ?? []).filter((mark) => mark.chordsBefore > 0).map((mark) => mark.at)) : 0]));
  const shift = (lineId: string, at: number) => Math.max(0, at - (lead.get(lineId) ?? 0));
  const trimmed = {
    lines: section.lines.map((line) => ({ ...line, text: line.text.slice(lead.get(line.id) ?? 0), chords: line.chords.map((chord) => ({ ...chord, at: shift(line.id, chord.at) })) })),
  };
  const rhythm = rhythmFromBarLines(
    trimmed,
    Object.fromEntries(Object.entries(marks).map(([lineId, list]) => [lineId, list.map((mark) => ({ ...mark, at: shift(lineId, mark.at) }))])),
    beatsPerBar,
  );
  if (!rhythm) return null;
  for (const bar of rhythm.bars) if (bar.lyricAnchor) bar.lyricAnchor = { ...bar.lyricAnchor, at: bar.lyricAnchor.at + (lead.get(bar.lyricAnchor.lineId) ?? 0) };
  const beats = Math.max(1, Math.round(beatsPerBar));
  for (const bar of rhythm.bars) {
    if (bar.chords.some((chord) => bars.beats.has(chord.chordId))) {
      bar.chords = bar.chords.map((chord) => ({ ...chord, beat: bars.beats.get(chord.chordId) ?? chord.beat }));
    } else if (bar.chords[0]?.beat === 1) {
      // A bar starting with its chord: its chords share it evenly, as a lead sheet means them -
      // words are rarely printed as they're sung. Half beats when there are more chords than beats.
      const step = bar.chords.length > beats ? 2 : 1;
      bar.chords = bar.chords.map((chord, i) => ({ ...chord, beat: 1 + Math.round(((i * beats) / bar.chords.length) * step) / step }));
    }
  }
  return rhythm;
}
