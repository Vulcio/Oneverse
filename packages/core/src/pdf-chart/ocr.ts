import { isChordLineMark, isChordsOnly, isChordToken } from "../chords/chord-token.js";
import type { PdfTextItem } from "./index.js";

/**
 * A scanned chart or a photo of one, read by OCR (issue #124): the
 * engine (Tesseract, on the device or in the API's Worker) gives each line,
 * word and letter with its box; this turns them into the same pieces of
 * text a PDF's text layer gives, with each letter's exact place, so
 * `readPdfChart` puts each chord on the letter printed under it.
 *
 * Chords are what OCR reads worst - short, apart, not words - so a line
 * that is nearly all chords is read again with only the characters chords
 * are made of.
 */

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OcrSymbol extends OcrBox {
  text: string;
}
export interface OcrWord extends OcrBox {
  text: string;
  symbols: OcrSymbol[];
}
export interface OcrLine extends OcrBox {
  words: OcrWord[];
  /** The line the letters sit on, when the engine gives it. */
  baseline?: OcrBox;
}

/**
 * Reads the page's image: all of it, or - with `strip` - one word of it
 * as a chord, allowing only `CHORD_CHARACTERS`. Boxes are always in the
 * whole image's pixels.
 */
export type OcrReader = (strip?: OcrBox) => Promise<OcrLine[]>;

/** The characters a line of chords is written with, for the engine's second reading of one. */
export const CHORD_CHARACTERS = "ABCDEFGHNabdgijmnosu#b()/+-0123456789°ø.|x%";

/** What OCR makes of chords' signs, put back: "F♯m" → "F#m", "Brn" → "Bm". */
function fixChord(read: string): string {
  const token = read.replace(/♯/g, "#").replace(/♭/g, "b");
  if (isChordToken(token)) return token;
  const fixed = token
    .replace(/rn/g, "m")
    .replace(/\?/g, "")
    .replace(/^([A-G][#b]?[^/IilL|1]*)[IilL|1]([A-G][#b]?)$/, "$1/$2")
    .replace(/^([A-G])\s*[#]\s*/, "$1#")
    .replace(/^[|[\]]+|[|[\]]+$/g, "");
  return isChordToken(fixed) ? fixed : token;
}

/** What OCR makes of a capital I before an apostrophe: "l've" → "I've". */
const fixWord = (word: string) => word.replace(/^l(?=['’](?:ve|m|ll|d)$)/, "I");

const lineText = (words: OcrWord[]) => words.map((word) => word.text).join(" ");

/** Whether a line is nearly all chords, OCR having misread some: worth reading again as chords. */
function nearlyChords(words: OcrWord[]): boolean {
  const tokens = words.map((word) => word.text);
  const chords = tokens.filter((token) => isChordToken(token)).length;
  const others = tokens.filter((token) => !isChordToken(token) && !isChordLineMark(token));
  return chords > 0 && chords * 3 >= tokens.length && others.every((token) => token.length <= 4);
}

/** Where the line's letters sit at `x`. */
function baselineAt(line: OcrLine, x: number, word: OcrWord): number {
  const base = line.baseline;
  if (!base || base.x1 === base.x0) return word.y1;
  return base.y0 + ((base.y1 - base.y0) * (x - base.x0)) / (base.x1 - base.x0);
}

const hasLower = (line: OcrLine) => /\p{Ll}/u.test(lineText(line.words));

/** How unevenly a word's letters start: the spread of the steps from one to the next, relative to their mean. */
function unevenness(symbols: OcrSymbol[]): number {
  const steps = symbols.slice(1).map((symbol, i) => symbol.x0 - symbols[i]!.x0);
  const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length;
  return mean > 0 ? Math.sqrt(steps.reduce((sum, step) => sum + (step - mean) ** 2, 0) / steps.length) / mean : Infinity;
}

/**
 * Whether the page is set in a fixed-width font: in most words OCR boxed
 * letter by letter, the letters start evenly spaced (about 5% apart in
 * Courier; 25% and more in a proportional font).
 */
function monospaced(lines: OcrLine[]): boolean {
  const spreads = lines
    .flatMap((line) => line.words)
    .map((word) => word.symbols.filter((symbol) => symbol.text !== ""))
    .filter((symbols) => symbols.length >= 4)
    .map(unevenness)
    .sort((a, b) => a - b);
  return spreads.length >= 5 && spreads[Math.floor(spreads.length / 2)]! < 0.15;
}

/** A word's letters' places in a fixed-width font: its width shared out equally. */
function evenly(word: OcrWord, count: number): { x0: number; x1: number }[] {
  const pitch = (word.x1 - word.x0) / count;
  return Array.from({ length: count }, (_, i) => ({ x0: word.x0 + i * pitch, x1: word.x0 + (i + 1) * pitch }));
}

/** A page's text from OCR, as pieces with their letters' places. */
export async function readOcrPage(page: number, read: OcrReader): Promise<PdfTextItem[]> {
  // One at a time: an engine reads one image at once.
  let queue = Promise.resolve<unknown>(undefined);
  const readAgain = (strip: OcrBox) => {
    const next = queue.then(() => read(strip));
    queue = next.catch(() => undefined);
    return next;
  };
  const lines = (await read()).filter((line) => line.words.some((word) => word.text.trim() !== ""));
  // The words' size: from how far apart lines are (about 1.25 em, as charts are set), else from a
  // line with small letters, about an em high from ascenders to descenders.
  const own = (line: OcrLine) => (hasLower(line) ? (line.y1 - line.y0) * 0.8 : (line.y1 - line.y0) * 1.1);
  const pitches = lines
    .slice(1)
    .map((line, i) => line.y1 - lines[i]!.y1)
    .filter((pitch) => pitch > 0)
    .sort((a, b) => a - b);
  const sizes = lines
    .filter(hasLower)
    .map(own)
    .sort((a, b) => a - b);
  const bodySize = (pitches.length >= 3 ? pitches[Math.floor(pitches.length / 3)]! / 1.25 : sizes[Math.floor(sizes.length / 2)]) ?? Math.max(1, ...lines.map(own));

  // Tesseract's boxes for single letters are rough; where words start and end is sure. In a
  // fixed-width font (Courier, as many charts are) each letter takes an equal share of its word;
  // otherwise it's shared out by the letters' usual widths, as for a PDF's text.
  const fixedWidth = monospaced(lines);
  const items: PdfTextItem[] = [];
  for (const line of lines) {
    let words = line.words.map((word) => ({ ...word, text: fixWord(fixChord(word.text)) }));
    let chords = isChordsOnly(lineText(words));
    if (!chords && nearlyChords(words)) {
      // Each word that isn't a chord read again on its own, as chords only.
      const again = await Promise.all(
        words.map(async (word) => {
          if (isChordToken(word.text) || isChordLineMark(word.text)) return word;
          const pad = (line.y1 - line.y0) * 0.3;
          const read = (await readAgain({ x0: Math.max(0, word.x0 - pad), y0: Math.max(0, line.y0 - pad), x1: word.x1 + pad, y1: line.y1 + pad })).flatMap((l) => l.words);
          return { ...word, text: fixChord(read.map((w) => w.text).join("")), symbols: [] };
        }),
      );
      if (isChordsOnly(lineText(again))) {
        words = again;
        chords = true;
      }
    }
    // Every line the words' size, but one clearly bigger (a title).
    const height = !chords && own(line) > bodySize * 1.15 ? own(line) : bodySize;
    for (const word of words) {
      if (word.text.trim() === "") continue;
      const letters = [...word.text];
      items.push({
        page,
        text: word.text,
        x: word.x0,
        // One line's words on one baseline, as the engine found them, even on a page scanned askew.
        y: baselineAt(line, (line.x0 + line.x1) / 2, word),
        width: word.x1 - word.x0,
        height,
        chars: fixedWidth ? evenly(word, letters.length) : undefined,
      });
    }
  }
  return items;
}

/** What Tesseract (tesseract.js's `blocks` output) gives for a page, as far as it's read here. */
export interface TesseractBlocks {
  blocks?: { paragraphs: { lines: { bbox: OcrBox; baseline?: OcrBox; words: { text: string; bbox: OcrBox; symbols?: { text: string; bbox: OcrBox }[] }[] }[] }[] }[] | null;
}

/** Tesseract's lines as `readOcrPage` takes them: the same on the device and in the API's Worker. */
export function ocrLinesFromTesseract(data: TesseractBlocks): OcrLine[] {
  return (data.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.map((line) => ({
        ...box(line.bbox),
        baseline: line.baseline ? box(line.baseline) : undefined,
        words: line.words.map((word) => ({ ...box(word.bbox), text: word.text, symbols: (word.symbols ?? []).map((symbol) => ({ ...box(symbol.bbox), text: symbol.text })) })),
      })),
    ),
  );
}

const box = ({ x0, y0, x1, y1 }: OcrBox): OcrBox => ({ x0, y0, x1, y1 });

/** The languages the OCR reads: English and French, what Songverse's songs are mostly in (Tesseract's names). */
export const OCR_LANGUAGES = ["eng", "fra"] as const;

/** Whether a PDF page's text is too little to be its chart (a scan, maybe with a page number): read it by OCR instead. */
export function pageNeedsOcr(items: PdfTextItem[]): boolean {
  return items.reduce((count, item) => count + item.text.replace(/\s/g, "").length, 0) < 20;
}
