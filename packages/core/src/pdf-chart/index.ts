import { isChordLine } from "../chords-over-lyrics/parser.js";
import { isChordLineMark } from "../chords/chord-token.js";
import { LABEL_LINE } from "../chordpro/section-labels.js";

/**
 * A chart read from a PDF's text (issue #124): chords above lyrics, placed
 * by where they are on the page rather than by counting spaces, so a chord
 * lands on the syllable it's printed over even in a proportional font.
 *
 * The PDF reader (pdf.js in the web app) hands over its text pieces with
 * their positions; this turns them into ChordPro - `Ama[G]zing grace` -
 * which the song form then reads like any pasted chart.
 */

/** A piece of text on a page, as a PDF reader gives it. Coordinates in points, `y` the baseline, growing down the page. */
export interface PdfTextItem {
  page: number;
  text: string;
  x: number;
  y: number;
  width: number;
  /** The font size (the text's height). */
  height: number;
  /**
   * Where each character starts and ends, when the reader knows better than
   * an estimate from the piece's width (OCR of a fixed-width font, issue #124).
   */
  chars?: { x0: number; x1: number }[];
  /** Which part of the page it's in (a header, a column…), counted down the page: set by `readPdfChart`. */
  part?: number;
}

export interface PlacedChar {
  char: string;
  x0: number;
  x1: number;
}

export interface PdfLine {
  page: number;
  part: number;
  /** Where its first piece starts. */
  x: number;
  y: number;
  height: number;
  chars: PlacedChar[];
  text: string;
  /** The pieces it's made of. */
  items: PdfTextItem[];
}

// Helvetica's widths (thousandths of an em), for where each character of a
// piece of text is: the piece's own width is shared out in these
// proportions, so the estimate is close for most fonts and exact for
// Helvetica. Letters with accents take their base letter's width.
const WIDTHS: Record<string, number> = Object.fromEntries(
  [
    [" !\"#$%&'()*+,-./", [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278]],
    ["0123456789:;<=>?@", [556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015]],
    ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", [667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611]],
    ["[\\]^_`", [278, 278, 278, 469, 556, 333]],
    ["abcdefghijklmnopqrstuvwxyz", [556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500]],
    ["{|}~", [334, 260, 334, 584]],
  ].flatMap(([chars, widths]) => [...(chars as string)].map((char, i) => [char, (widths as number[])[i]!])),
);
const charWidth = (char: string) => WIDTHS[char] ?? WIDTHS[char.normalize("NFD")[0] ?? ""] ?? 556;

/**
 * Whether the text is set in a fixed-width font (Courier, as many chord
 * sheets are): every piece has the same width per character, relative to
 * its size. Then each character takes an equal share of its piece.
 */
function isMonospaced(items: PdfTextItem[]): boolean {
  const pitches = items.filter((item) => [...item.text].length >= 3).map((item) => item.width / [...item.text].length / item.height);
  if (pitches.length < 2) return false;
  const sorted = [...pitches].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return pitches.every((pitch) => Math.abs(pitch - median) <= median * 0.02);
}

/** Each character of a piece of text, with where it starts and ends. */
function placeChars(item: PdfTextItem, monospaced: boolean): PlacedChar[] {
  const chars = [...item.text];
  if (item.chars?.length === chars.length) return chars.map((char, i) => ({ char, x0: item.chars![i]!.x0, x1: item.chars![i]!.x1 }));
  const weight = (char: string) => (monospaced ? 1 : charWidth(char));
  const total = chars.reduce((sum, char) => sum + weight(char), 0) || 1;
  let x = item.x;
  return chars.map((char) => {
    const width = (weight(char) / total) * item.width;
    const placed = { char, x0: x, x1: x + width };
    x += width;
    return placed;
  });
}

/** The page's pieces of text, as lines: pieces on one baseline, left to right, a space where there's a gap. */
export function linesOf(items: PdfTextItem[]): PdfLine[] {
  const monospaced = isMonospaced(items.filter((item) => item.text.trim() !== "" && !item.chars));
  const sorted = items.filter((item) => item.text.trim() !== "").sort((a, b) => a.page - b.page || (a.part ?? 0) - (b.part ?? 0) || a.y - b.y || a.x - b.x);
  const groups: PdfTextItem[][] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    const head = last?.[0];
    if (head && head.page === item.page && (head.part ?? 0) === (item.part ?? 0) && Math.abs(head.y - item.y) <= Math.max(head.height, item.height) * 0.4) last.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => {
    group.sort((a, b) => a.x - b.x);
    const chars: PlacedChar[] = [];
    for (const item of group) {
      const previous = chars[chars.length - 1];
      // A gap wider than a narrow space between two pieces is a space.
      if (previous && previous.char !== " " && item.x - previous.x1 > item.height * 0.15 && !item.text.startsWith(" ")) {
        chars.push({ char: " ", x0: previous.x1, x1: item.x });
      }
      chars.push(...placeChars(item, monospaced));
    }
    return { page: group[0]!.page, part: group[0]!.part ?? 0, x: group[0]!.x, y: group[0]!.y, height: Math.max(...group.map((item) => item.height)), chars, text: chars.map((c) => c.char).join(""), items: group };
  });
}

/** The chords of a chord line, each with where it starts on the page. */
function chordsOf(line: PdfLine): { chord: string; x: number }[] {
  const chords: { chord: string; x: number }[] = [];
  let start = -1;
  for (let i = 0; i <= line.chars.length; i++) {
    const char = line.chars[i];
    if (char && char.char.trim() !== "") {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const chord = line.chars.slice(start, i).map((c) => c.char).join("");
      // Only chords go over the words: "-", "|", "x2" are how the line was laid out.
      if (!isChordLineMark(chord)) chords.push({ chord, x: line.chars[start]!.x0 });
      start = -1;
    }
  }
  return chords;
}

/**
 * A lyric line with its chords: each goes before the first character that
 * sits mostly to its right - the one printed under the chord's start.
 */
function withChords(lyric: PdfLine, chords: { chord: string; x: number }[]): string {
  const text = lyric.text.replace(/\s+$/, "");
  const at = chords.map(({ chord, x }) => {
    let index = lyric.chars.findIndex((char) => (char.x0 + char.x1) / 2 > x - 0.5);
    if (index < 0 || index > text.length) index = text.length;
    // Chords mostly start words: one printed within a quarter em of a word's start goes there
    // (letters' widths are estimates, and a scan's edges blur).
    const starts = lyric.chars.flatMap((char, i) => (char.char !== " " && (i === 0 || lyric.chars[i - 1]!.char === " ") ? [i] : []));
    const near = starts.find((i) => Math.abs(lyric.chars[i]!.x0 - x) <= lyric.height * 0.25);
    if (near !== undefined) index = near;
    return { chord, index };
  });
  let out = "";
  let cursor = 0;
  for (const { chord, index } of at) {
    out += text.slice(cursor, index) + `[${chord}]`;
    cursor = Math.max(cursor, index);
  }
  // Chords past the end of the words: after a space, as they're printed apart.
  return (out + text.slice(cursor)).replace(/([^\s\]])(\[[^\]]+\])$/, "$1 $2");
}

/**
 * ChordPro from a PDF's text: chord lines joined to the lyric line under
 * them, chords placed by position; a chord line on its own (an intro, a
 * turnaround) as chords only; section labels and other lines as they are;
 * a blank line where the page leaves a gap. Empty when there's no text
 * (a scanned page).
 */
export function chordProFromPdfText(items: PdfTextItem[]): string {
  return chordProFromLines(linesOf(items));
}

/** The same, from lines already put together. */
export function chordProFromLines(lines: PdfLine[]): string {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const previous = lines[i - 1];
    // A gap of more than about a line and a half, or a new page, is a break between parts.
    // Never right under a section's label: it heads what follows.
    const underLabel = previous && LABEL_LINE.test(previous.text.trim());
    if (previous && !underLabel && (previous.page !== line.page || previous.part !== line.part || line.y - previous.y > Math.max(line.height, previous.height) * 1.9) && out[out.length - 1] !== "") out.push("");
    const text = line.text.trim();
    if (isChordLine(text)) {
      const next = lines[i + 1];
      const lyricBelow =
        next && next.page === line.page && next.part === line.part && next.y - line.y < Math.max(line.height, next.height) * 1.9 && !isChordLine(next.text.trim()) && !LABEL_LINE.test(next.text.trim());
      if (lyricBelow) {
        out.push(withChords(next, chordsOf(line)));
        i++;
      } else {
        out.push(chordsOf(line).map(({ chord }) => `[${chord}]`).join(" "));
      }
      continue;
    }
    out.push(text);
  }
  return out.join("\n").trim();
}
