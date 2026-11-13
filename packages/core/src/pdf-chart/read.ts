import { LABEL_LINE } from "../chordpro/section-labels.js";
import { isChordLine } from "../chords-over-lyrics/parser.js";
import { emptyDetails, plainDetail, type SongFileDetails } from "../import-detection/song-details.js";
import { chordProFromLines, linesOf, type PdfLine, type PdfTextItem } from "./index.js";

/**
 * A whole PDF chart read (issue #124): what each page prints besides the
 * song - its header and footer (page numbers, the site it came from, the
 * CCLI licence, the copyright) - left out, two columns read one after the
 * other, and the title, artist, key… at its top taken as the song's
 * details rather than as words.
 */

/** A page's size, in the same units as its text's positions (points for a PDF's text, pixels for a scan). */
export interface PdfPageSize {
  page: number;
  width: number;
  height: number;
}

export interface PdfChart {
  /** ChordPro-style chart: `Ama[G]zing grace`, section labels, blank lines between parts. */
  chart: string;
  details: SongFileDetails;
  /** The lines left out as the page's header or footer, for the import to say so. */
  dropped: string[];
}

// Lines that are never the song: licences, copyright, where it came from, page numbers.
const FURNITURE = [
  /\bccli\b/i,
  /©|\(c\)\s*\d{4}|\bcopyright\b|\ball rights reserved\b|\btous droits r[ée]serv[ée]s\b|\bused by permission\b|\badmin(?:istered|\.)? by\b/i,
  /\bfor use solely\b|\bsongselect\b|\bterms of use\b|\bpraisecharts\b|\bultimate-guitar\b|\bworshiptogether\b|\bmultitracks\b|\bonsong\b/i,
  /\bhttps?:\/\/|\bwww\.|\.(?:com|org|net|fr|de|io)\b/i,
  /^(?:page|p\.?)\s*\d+(?:\s*(?:of|sur|\/|de|von)\s*\d+)?$/i,
  /^[-–—\s]*\d{1,3}[-–—\s]*$/,
  /^\d{1,3}\s*\/\s*\d{1,3}$/,
  /^(?:printed|generated|imprim[ée])\b.*\d/i,
];

/** The band at the top and the bottom of a page where a header and a footer are, as a share of its height. */
const BAND = 0.12;

/** A line's text with its numbers as "#", so "Page 1" and "Page 2" are the same footer. */
const shape = (text: string) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

function pageSizes(items: PdfTextItem[], given: PdfPageSize[]): Map<number, PdfPageSize> {
  const sizes = new Map(given.map((size) => [size.page, size]));
  for (const item of items) {
    if (given.some((size) => size.page === item.page)) continue;
    const size = sizes.get(item.page) ?? { page: item.page, width: 0, height: 0 };
    size.width = Math.max(size.width, item.x + item.width);
    size.height = Math.max(size.height, item.y + item.height);
    sizes.set(item.page, size);
  }
  return sizes;
}

/**
 * The page's header and footer lines: in the band at its top or bottom,
 * the ones that repeat on another page (numbers aside) or say what's never
 * the song; and a licence or copyright line anywhere. Their details (the
 * CCLI number, the copyright) are kept.
 */
function furniture(lines: PdfLine[], sizes: Map<number, PdfPageSize>, details: SongFileDetails): Set<PdfLine> {
  const inBand = (line: PdfLine) => {
    const height = sizes.get(line.page)?.height ?? 0;
    return height > 0 && (line.y < height * BAND || line.y > height * (1 - BAND));
  };
  const pagesWith = new Map<string, Set<number>>();
  for (const line of lines.filter(inBand)) {
    const key = shape(line.text);
    pagesWith.set(key, (pagesWith.get(key) ?? new Set()).add(line.page));
  }
  const dropped = new Set<PdfLine>();
  for (const line of lines) {
    const text = line.text.trim();
    if (isChordLine(text) || LABEL_LINE.test(text)) continue;
    const repeated = inBand(line) && (pagesWith.get(shape(text))?.size ?? 0) > 1;
    if (!repeated && !FURNITURE.some((pattern) => pattern.test(text))) continue;
    dropped.add(line);
    // "CCLI Song # 4768151 · © 2006 sixsteps Music": its parts.
    for (const part of text.split(/\s+[|·•]\s+|\s{2,}|\s+-\s+(?=©|\(c\)|copyright|ccli|for use)/i)) {
      const ccli = /\bccli\s*(?:song|#|no\.?|number|n°|\s)*\s*:?\s*#?\s*(\d{3,9})\b/i.exec(part);
      if (ccli && !/licen[cs]e/i.test(part)) details.ccli ??= ccli[1];
      else if (/^(?:©|\(c\)\s|copyright\b)/i.test(part.trim())) plainDetail(details, part.trim());
    }
  }
  return dropped;
}

/** Whether a line reaches across `gap` (a title, a footer: text on both sides of it, close together, or over it). */
function spans(line: PdfLine, gap: number): boolean {
  const left = line.items.filter((item) => item.x + item.width <= gap);
  const right = line.items.filter((item) => item.x >= gap);
  if (left.length + right.length < line.items.length) return true;
  if (!left.length || !right.length) return false;
  return Math.min(...right.map((item) => item.x)) - Math.max(...left.map((item) => item.x + item.width)) < line.height * 1.5;
}

/**
 * Where a page is cut into two columns: a gap from top to bottom of its
 * body that no line reaches across, with lines on both sides. Lines across
 * it above the columns (a title) or below them are read before or after.
 */
function columnGap(lines: PdfLine[], width: number): number | null {
  if (lines.length < 4 || width <= 0) return null;
  let best: { x: number; score: number } | null = null;
  for (let x = width * 0.3; x <= width * 0.7; x += width / 100) {
    const across = lines.filter((line) => spans(line, x));
    const inColumns = lines.filter((line) => !across.includes(line));
    const left = inColumns.filter((line) => line.items.some((item) => item.x + item.width <= x));
    const right = inColumns.filter((line) => line.items.some((item) => item.x >= x));
    if (left.length < 4 || right.length < 4) continue;
    const top = Math.min(...right.map((line) => line.y));
    const bottom = Math.max(...right.map((line) => line.y));
    if (across.some((line) => line.y >= top && line.y <= bottom)) continue;
    // The widest gap between the columns' text wins.
    const leftEnd = Math.max(...left.flatMap((line) => line.items.filter((item) => item.x + item.width <= x).map((item) => item.x + item.width)));
    const rightStart = Math.min(...right.flatMap((line) => line.items.filter((item) => item.x >= x).map((item) => item.x)));
    const score = rightStart - leftEnd;
    if (score > 0 && (!best || score > best.score)) best = { x: (leftEnd + rightStart) / 2, score };
  }
  return best?.x ?? null;
}

/** Each item's part of its page: 0 above the columns, 1 the left one, 2 the right one, 3 below. */
function partsOf(items: PdfTextItem[], sizes: Map<number, PdfPageSize>): PdfTextItem[] {
  const out: PdfTextItem[] = [];
  for (const page of new Set(items.map((item) => item.page))) {
    const lines = linesOf(items.filter((item) => item.page === page));
    const gap = columnGap(lines, sizes.get(page)?.width ?? 0);
    if (gap === null) {
      out.push(...lines.flatMap((line) => line.items.map((item) => ({ ...item, part: 0 }))));
      continue;
    }
    const top = Math.min(...lines.filter((line) => !spans(line, gap)).map((line) => line.y));
    for (const line of lines) {
      if (spans(line, gap)) out.push(...line.items.map((item) => ({ ...item, part: line.y < top ? 0 : 3 })));
      else out.push(...line.items.map((item) => ({ ...item, part: item.x >= gap ? 2 : 1 })));
    }
  }
  return out;
}

/** "Key - G | Tempo - 72 | Time - 3/4", "Key of G": as the lines a text file starts with. */
function detailParts(text: string): string[] {
  return text
    .replace(/\b(key|tonalit[ée]|tempo|bpm|time|capo|ccli)\s*[-–—=]\s*/gi, "$1: ")
    .replace(/\bkey of\s+/gi, "Key: ")
    .split(/\s+[-–—|·•]\s+|\s{3,}|\t/)
    .map((part) => part.trim().replace(/^(capo)\s*:\s*/i, "$1 "))
    .filter(Boolean);
}

/**
 * The details at the top of the first page: the lines before the first
 * chords or section label (a few at most). The biggest one is the title
 * when it's bigger than the rest; a line of names after it, the artist.
 */
function headerDetails(lines: PdfLine[], details: SongFileDetails): Set<PdfLine> {
  const taken = new Set<PdfLine>();
  const first = lines.findIndex((line) => isChordLine(line.text.trim()) || LABEL_LINE.test(line.text.trim()));
  if (first <= 0 || first > 6) return taken;
  const header = lines.slice(0, first).filter((line) => line.page === lines[0]!.page);
  const body = lines.slice(first).filter((line) => !isChordLine(line.text.trim()));
  const sizes = body.map((line) => line.height).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] ?? 0;
  const biggest = header.reduce<PdfLine | null>((big, line) => (!big || line.height > big.height ? line : big), null);
  const title = biggest && bodySize > 0 && biggest.height >= bodySize * 1.2 ? biggest : null;
  const found = emptyDetails();
  // The parts of the header that aren't details: a title, names.
  const loose: { line: PdfLine; text: string }[] = [];
  for (const line of header) {
    if (line === title) continue;
    for (const part of detailParts(line.text)) if (!plainDetail(found, part)) loose.push({ line, text: part });
  }
  // Without a bigger title, the header must say something (a key, a capo…) to be one.
  if (!title && loose.length === header.length) return taken;
  const used = new Set<{ line: PdfLine; text: string }>();
  const titleLine = title ?? loose[0]?.line;
  if (title) found.title = title.text.trim();
  else if (loose[0]) {
    found.title = loose[0].text;
    used.add(loose[0]);
  }
  // Names under the title ("Chris Tomlin | John Newton"), not a sentence.
  const names = loose.filter((part) => !used.has(part) && part.line !== titleLine && part.text.length <= 80 && !/[.!?]$/.test(part.text));
  const artistLine = names[0]?.line;
  for (const part of names.filter((part) => part.line === artistLine)) {
    found.artists.push(
      ...part.text
        .split(/\s*(?:[,;/&]|\band\b|\bet\b)\s*/i)
        .map((name) => name.trim())
        .filter(Boolean),
    );
    used.add(part);
  }
  // A line is taken out of the chart when everything on it went into the details.
  if (titleLine) taken.add(titleLine);
  for (const line of header) if (line !== titleLine && !loose.some((part) => part.line === line && !used.has(part))) taken.add(line);
  Object.assign(details, { ...found, ccli: details.ccli ?? found.ccli, copyright: details.copyright ?? found.copyright });
  return taken;
}

/** A PDF chart's words and chords, and its details, from its text with positions. */
export function readPdfChart(items: PdfTextItem[], pages: PdfPageSize[] = []): PdfChart {
  const text = items.filter((item) => item.text.trim() !== "");
  const sizes = pageSizes(text, pages);
  const details = emptyDetails();
  // The header and footer first, across the page's width; then its columns.
  const furnitureLines = furniture(linesOf(text), sizes, details);
  const furnitureItems = new Set([...furnitureLines].flatMap((line) => line.items));
  const lines = linesOf(partsOf(text.filter((item) => !furnitureItems.has(item)), sizes));
  const header = headerDetails(lines, details);
  return {
    chart: chordProFromLines(lines.filter((line) => !header.has(line))),
    details,
    dropped: [...furnitureLines].map((line) => line.text.trim()),
  };
}
