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
  // The words' size: a line with small letters is about an em high, ascenders to descenders.
  const heights = lines
    .filter(hasLower)
    .map((line) => (line.y1 - line.y0) * 0.8)
    .sort((a, b) => a - b);
  const bodySize = heights[Math.floor(heights.length / 2)] ?? Math.max(1, ...lines.map((line) => line.y1 - line.y0));

  const items: PdfTextItem[] = [];
  for (const line of lines) {
    let words = line.words.map((word) => ({ ...word, text: fixChord(word.text) }));
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
    const height = chords ? bodySize : hasLower(line) ? (line.y1 - line.y0) * 0.8 : Math.max(bodySize, (line.y1 - line.y0) * 1.1);
    for (const word of words) {
      if (word.text.trim() === "") continue;
      const symbols = word.symbols.filter((symbol) => symbol.text !== "");
      items.push({
        page,
        text: word.text,
        x: word.x0,
        // One line's words on one baseline, as the engine found them, even on a page scanned askew.
        y: baselineAt(line, (line.x0 + line.x1) / 2, word),
        width: word.x1 - word.x0,
        height,
        // Each letter's place, when the word is still the letters OCR boxed (not fixed).
        chars: symbols.length === [...word.text].length ? symbols.map((symbol) => ({ x0: symbol.x0, x1: symbol.x1 })) : undefined,
      });
    }
  }
  return items;
}
