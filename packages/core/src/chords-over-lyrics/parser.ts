import type { ParsedSection } from "../schemas/parsed-song.js";
import type { SectionType } from "../constants/index.js";
import { generateId, ID_PREFIXES } from "../ids/index.js";
import { parseLine } from "../chordpro/parser.js";
import { barNotationMarkup, readBarNotation } from "./bar-notation.js";
import { LABEL_LINE, normalizeSectionType } from "../chordpro/section-labels.js";

// A chord token: a root note with an optional accidental, quality,
// extension digits, and an optional slash bass note - "G", "F#m7",
// "Csus4", "D/F#". Deliberately permissive (this classifies whole lines,
// it doesn't validate individual chords) so one unusual chord doesn't make
// an otherwise-obvious chord line get read as lyrics.
const CHORD_TOKEN = /^[A-G](?:#|b)?(?:maj|min|dim|aug|sus|add|m)?[0-9]*(?:\/[A-G](?:#|b)?)?$/;
const NON_CHORD_TOKENS = new Set(["N.C.", "NC", "%"]);

/** Exported for the format auto-detector, which uses the same "is this
 * line nothing but chord tokens" test to recognize the format. */
export function isChordLine(trimmedLine: string): boolean {
  if (trimmedLine === "") return false;
  if (readBarNotation(trimmedLine)) return true;
  const tokens = trimmedLine.split(/\s+/);
  return tokens.every((t) => CHORD_TOKEN.test(t) || NON_CHORD_TOKENS.has(t.toUpperCase()));
}

/** Finds each whitespace-delimited token's raw text and column offset in
 * the (untrimmed) original line, left to right. */
function findTokenPositions(rawLine: string): Array<{ token: string; column: number }> {
  const positions: Array<{ token: string; column: number }> = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rawLine)) !== null) {
    positions.push({ token: match[0], column: match.index });
  }
  return positions;
}

/**
 * Overlays a chord line's tokens onto the lyric line beneath it at
 * matching column positions, producing the same `[Chord]lyric` markup
 * ChordPro uses inline - so the shared `parseLine` can split it into
 * segments without a second implementation of that logic.
 */
function overlayChords(chordLine: string, lyricLine: string): string {
  const positions = findTokenPositions(chordLine);
  if (positions.length === 0) return lyricLine;

  // No lyric text to align against (an instrumental bar, a turnaround):
  // the chords alone, as far apart as they were written (issue #344).
  if (lyricLine.trim() === "") {
    let line = "";
    for (const { token, column } of positions) line += " ".repeat(Math.max(column - line.replace(/\[[^\]]*\]/g, "").length, 0)) + `[${token}]`;
    return line;
  }

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
    const bars = readBarNotation(trimmed);
    if (bars) {
      const line = parseLine(barNotationMarkup(bars));
      currentLines.push(line);
      (current!.bars ??= {})[line.id] = bars.bars;
      continue;
    }

    if (isChordLine(trimmed)) {
      const next = rawLines[i];
      const nextTrimmed = next?.trim() ?? "";
      const nextIsLyric = next !== undefined && nextTrimmed !== "" && !isChordLine(nextTrimmed) && !LABEL_LINE.test(nextTrimmed);
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
