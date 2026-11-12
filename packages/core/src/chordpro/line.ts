import type { Line, Segment } from "../schemas/shared.js";
import { generateId, ID_PREFIXES } from "../ids/index.js";

/** Splits one lyric line into segments at each `[Chord]` marker. Text
 * before the first chord (if any) becomes a chord-less leading segment.
 * Shared with the chords-over-lyrics parser, which overlays its own
 * chord-line tokens into this same `[Chord]lyric` markup first. */
export function parseLine(raw: string): Line {
  const segments: Segment[] = [];
  const re = /\[([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let pendingChord: string | null = null;

  const pushSegment = (lyric: string, chordRaw: string | null) => {
    if (lyric === "" && chordRaw === null) return;
    segments.push({
      id: generateId(ID_PREFIXES.segment),
      lyric,
      chord: chordRaw ? { id: generateId(ID_PREFIXES.chord), raw: chordRaw, normalized: null } : null,
    });
  };

  while ((match = re.exec(raw)) !== null) {
    const textBefore = raw.slice(lastIndex, match.index);
    pushSegment(textBefore, pendingChord);
    pendingChord = match[1] ?? null;
    lastIndex = re.lastIndex;
  }
  pushSegment(raw.slice(lastIndex), pendingChord);

  // A line with no chords and no lyric text at all (pure whitespace)
  // still needs one segment so the line renders as a blank spacer.
  if (segments.length === 0) segments.push({ id: generateId(ID_PREFIXES.segment), lyric: "", chord: null });

  return { id: generateId(ID_PREFIXES.line), segments };
}
