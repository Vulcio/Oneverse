import type { SupportedImportFormat } from "../constants/index.js";
import type { ParsedSection } from "../schemas/parsed-song.js";
import { parseChordPro } from "../chordpro/parser.js";
import { LABEL_LINE } from "../chordpro/section-labels.js";
import { isChordLine, parseChordsOverLyrics } from "../chords-over-lyrics/parser.js";
import { parseLyricsOnly } from "../lyrics-only/parser.js";
import { isLrc } from "./lrc.js";

export type ImportFormatConfidence = "high" | "medium" | "low";

export interface ImportFormatDetection {
  format: SupportedImportFormat;
  /** How clear-cut the text's signals were - a hint for the UI to ask the user to check. */
  confidence: ImportFormatConfidence;
}

/**
 * Guesses which format pasted text is in, so the paste-import UI can
 * preselect it instead of making the user pick every time (they can still
 * override it). Every non-blank line that isn't a section label counts as
 * a signal for one format:
 *  - a `{directive}` line, or inline `[Chord]` markup - ChordPro;
 *  - a line that's nothing but chord tokens - chords over lyrics (the
 *    chord line that sits above its lyric line);
 *  - anything else is lyric text, which all three formats have.
 * Text with no chord signals at all is lyrics only. Otherwise the format
 * with more signals wins, and the confidence says how lopsided that was.
 */
export function detectImportFormatDetails(text: string): ImportFormatDetection {
  // Timed lyrics are words.
  if (isLrc(text)) return { format: "RAW_TEXT", confidence: "high" };
  let chordPro = 0;
  let chordLines = 0;
  let lyricLines = 0;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === "" || LABEL_LINE.test(trimmed)) continue;
    if (/^\{[^{}]+\}$/.test(trimmed)) chordPro++;
    else if (isChordLine(trimmed)) chordLines++;
    else if (/\[[^\]]+\]/.test(trimmed)) chordPro++;
    else lyricLines++;
  }

  if (chordPro === 0 && chordLines === 0) {
    if (lyricLines === 0) return { format: "CHORDPRO", confidence: "low" };
    return { format: "RAW_TEXT", confidence: lyricLines >= 4 ? "high" : "medium" };
  }
  const format: SupportedImportFormat = chordPro >= chordLines ? "CHORDPRO" : "CHORDS_OVER_LYRICS";
  const winning = Math.max(chordPro, chordLines);
  const share = winning / (chordPro + chordLines);
  const confidence: ImportFormatConfidence = share >= 0.9 && winning >= 2 ? "high" : share >= 0.6 ? "medium" : "low";
  return { format, confidence };
}

/** Just the format {@link detectImportFormatDetails} guesses. */
export function detectImportFormat(text: string): SupportedImportFormat {
  return detectImportFormatDetails(text).format;
}

/** Parses song text in the given format into parsed sections (see schemas/parsed-song.ts). */
export function parseSongText(text: string, format: SupportedImportFormat): ParsedSection[] {
  switch (format) {
    case "CHORDS_OVER_LYRICS":
      return parseChordsOverLyrics(text);
    case "RAW_TEXT":
      return parseLyricsOnly(text);
    default:
      return parseChordPro(text);
  }
}
