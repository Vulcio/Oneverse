import type { NotatedBar } from "../chords-over-lyrics/bar-notation.js";
import type { SectionType } from "../constants/index.js";
import type { Line, Segment } from "./shared.js";
import type { LineV2, Rhythm, SongDocumentV2 } from "./song-document-v2.js";

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

/** A line's segments as one text, chords pinned where each segment began. */
function joinSegments(id: string, segments: Segment[]): LineV2 {
  let text = "";
  const chords: LineV2["chords"] = [];
  for (const segment of segments) {
    if (segment.chord) chords.push({ id: segment.chord.id, at: text.length, raw: segment.chord.raw });
    text += segment.lyric;
  }
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

/** Parsed sections as v2 sections, without timing but what bar notation gives. */
export function parsedSectionsToV2(sections: ParsedSection[]): SongDocumentV2["sections"] {
  return sections.map((section) => {
    const lines = section.lines.map((line) => joinSegments(line.id, line.segments));
    return {
      id: section.id,
      type: section.type,
      label: section.label ?? null,
      showLabel: true,
      lines,
      rhythm: rhythmOf(section, lines),
      groove: null,
    };
  });
}
