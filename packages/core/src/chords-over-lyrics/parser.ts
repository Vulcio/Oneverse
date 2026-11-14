import type { ParsedSection } from "../schemas/parsed-song.js";
import type { SectionType } from "../constants/index.js";
import { generateId, ID_PREFIXES } from "../ids/index.js";
import { parseLine } from "../chordpro/line.js";
import { isChordLineMark, isChordsOnly } from "../chords/chord-token.js";
import { barNotationMarkup, readBarNotation } from "./bar-notation.js";
import { LABEL_LINE, normalizeSectionType } from "../chordpro/section-labels.js";

/** Exported for the format auto-detector, which uses the same "is this
 * line nothing but chord tokens" test to recognize the format. */
export function isChordLine(trimmedLine: string): boolean {
  if (trimmedLine === "") return false;
  if (readBarNotation(trimmedLine)) return true;
  return isChordsOnly(trimmedLine);
}

/** Finds each whitespace-delimited token's raw text and column offset in
 * the (untrimmed) original line, left to right. A bar line ("|", "||:")
 * is a token of its own, "[|]" in the markup, even touching a chord
 * ("|C#m"); one just before a chord stands at the chord's column, so the
 * bar starts with it (issue #460). */
function findTokenPositions(rawLine: string): Array<{ token: string; column: number; bar?: number }> {
  const positions: Array<{ token: string; column: number; end: number; bar?: number }> = [];
  // "(x 2)" is one mark.
  const re = /\(\s*[x×]\s*\d{1,2}\s*\)|:?\|+:?|[^\s|]+?(?=:?\||\s|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rawLine)) !== null) {
    const end = match.index + match[0].length;
    if (BAR_TOKEN.test(match[0])) {
      positions.push({ token: "|", column: match.index, end });
      continue;
    }
    // Only chords go over the words: "-", "x2" are how the line was laid out.
    if (isChordLineMark(match[0].replace(/\s+/g, ""))) continue;
    const before = positions.at(-1);
    // A bar line just before a chord stands with it; the chord remembers where the bar line was.
    const glued = before?.token === "|" && match.index - before.end <= 1 ? before : null;
    if (glued) before!.column = match.index;
    positions.push({ token: match[0], column: match.index, end, ...(glued ? { bar: glued.end - 1 } : {}) });
  }
  // Two bar lines together ("| |" left by a mark between them) are one.
  return positions.filter((position, i) => !(position.token === "|" && positions[i + 1]?.token === "|" && positions[i + 1]!.column === position.column));
}

const BAR_TOKEN = /^:?\|+:?$/;
// A beat mark between bar lines: the line is a grid of beats, not chords over words.
const BEAT_MARK = /(?:^|\s)[./-](?=\s|\||$)/;

/** Whether a line of bars of chords ("|C#m  B  |E/G#  A") is written over the words under it (issue #460), not an instrumental's bars. */
export function barsOverWords(trimmedLine: string, nextIsLyric: boolean): boolean {
  return nextIsLyric && !trimmedLine.includes("[") && !BEAT_MARK.test(trimmedLine);
}

/**
 * Overlays a chord line's tokens onto the lyric line beneath it at
 * matching column positions, producing the same `[Chord]lyric` markup
 * ChordPro uses inline - so the shared `parseLine` can split it into
 * segments without a second implementation of that logic.
 */
export function overlayChords(chordLine: string, lyricLine: string): string {
  const positions = findTokenPositions(chordLine);
  if (positions.length === 0) return lyricLine;

  // No lyric text to align against (an instrumental bar, a turnaround):
  // the chords alone, as far apart as they were written (issue #344).
  if (lyricLine.trim() === "") {
    let line = "";
    for (const { token, column } of positions) line += " ".repeat(Math.max(column - line.replace(/\[[^\]]*\]/g, "").length, 0)) + `[${token}]`;
    return line;
  }

  // "|G" over "Amazing": the bar line, not the chord, is printed where the word starts, so both go there.
  const wordStart = (column: number) => /\S/.test(lyricLine[column] ?? "") && (column === 0 || /\s/.test(lyricLine[column - 1]!));
  positions.forEach((position, i) => {
    if (position.bar === undefined || wordStart(position.column) || !wordStart(position.bar)) return;
    position.column = position.bar;
    positions[i - 1]!.column = position.bar;
  });
  const lastColumn = positions[positions.length - 1]?.column ?? 0;
  const padded = lyricLine.length <= lastColumn ? lyricLine + " ".repeat(lastColumn - lyricLine.length + 1) : lyricLine;

  let result = "";
  let cursor = 0;
  for (const { token, column } of positions) {
    result += padded.slice(cursor, column);
    result += `[${token}]`;
    cursor = column;
  }
  result += padded.slice(cursor);
  return result.replace(/\s+$/, "");
}

/**
 * Parses "chords on their own line above the lyric line" text - the plain
 * format most tab/chord sites display on-screen - into SongDocument
 * sections. A chord line with no lyric line under it (an instrumental
 * bar, a turnaround) still produces a line, just with empty lyric text
 * under each chord. Section labels ("Verse 1", "[Chorus]") work the same
 * way they do for ChordPro-ish paste-in text.
 */
export function parseChordsOverLyrics(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let currentLines: ParsedSection["lines"] = [];

  const startSection = (type: SectionType, label: string | null) => {
    currentLines = [];
    current = { id: generateId(ID_PREFIXES.section), type, label, lines: currentLines };
    sections.push(current);
  };
  const ensureSection = () => {
    if (!current) startSection("other", null);
  };

  const rawLines = text.split(/\r\n|\r|\n/);
  let i = 0;
  while (i < rawLines.length) {
    const rawLine = rawLines[i] ?? "";
    const trimmed = rawLine.trim();
    i++;

    if (trimmed === "") {
      current = null;
      continue;
    }

    const labelMatch = LABEL_LINE.exec(trimmed);
    if (labelMatch) {
      startSection(normalizeSectionType(labelMatch[1] ?? ""), trimmed);
      continue;
    }

    ensureSection();

    // Bars of chords, "| G | C | D | G |" (issue #344).
    const next = rawLines[i];
    const nextTrimmed = next?.trim() ?? "";
    const nextIsLyric = next !== undefined && nextTrimmed !== "" && !isChordLine(nextTrimmed) && !LABEL_LINE.test(nextTrimmed);
    const bars = readBarNotation(trimmed);
    if (bars && !barsOverWords(trimmed, nextIsLyric)) {
      const line = parseLine(barNotationMarkup(bars));
      currentLines.push(line);
      (current!.bars ??= {})[line.id] = bars.bars;
      continue;
    }

    if (isChordLine(trimmed)) {
      if (nextIsLyric) {
        currentLines.push(parseLine(overlayChords(rawLine, next ?? "")));
        i++;
        continue;
      }
      currentLines.push(parseLine(overlayChords(rawLine, "")));
      continue;
    }

    currentLines.push(parseLine(rawLine));
  }

  return sections;
}
