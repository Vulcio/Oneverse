/**
 * Text a PDF holds but doesn't show (issue #124): some charts are made
 * with tricks a reader never sees but a PDF's text has - words joined by
 * white full stops instead of spaces ("A.thousand.generations"), a summary
 * of the song placed outside the area the page shows, words drawn
 * invisibly over a picture. pdf.js gives a page's text without its colours
 * or clipping, so this follows the page's drawing operators alongside it
 * (`page.getOperatorList()`): each letter drawn in white, fully
 * transparent, invisibly, or outside the clipped area becomes a space, so
 * what's left is what the page shows.
 */

/** pdf.js's `page.getOperatorList()`, as far as it's read here. */
export interface PdfOperatorList {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

/** pdf.js's text items, as far as they're read here: the text and where it starts, in the page's own space. */
export interface PdfTextContentItem {
  str: string;
  transform: number[];
}

type Matrix = [number, number, number, number, number, number];
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface State {
  ctm: Matrix;
  clip: Box | null;
  fill: string;
  alpha: number;
  mode: number;
}
interface Glyph {
  char: string;
  unseen: boolean;
  clip: Box | null;
}

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

/** A box in some space, as the page sees it: its corners through the matrix. */
function boxThrough(box: Box, m: Matrix): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [box.x0, box.y0],
    [box.x0, box.y1],
    [box.x1, box.y0],
    [box.x1, box.y1],
  ] as const) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const intersect = (a: Box | null, b: Box): Box => (a ? { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) } : b);

/** White, or nearly: drawn on a white page, it can't be seen. */
const blank = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) && [1, 3, 5].every((i) => parseInt(hex.slice(i, i + 2), 16) >= 0xf0);

const numbers = (value: unknown): number[] | null => {
  if (value === null || typeof value !== "object" || !("length" in value)) return null;
  const list = Array.from(value as ArrayLike<unknown>);
  return list.every((n) => typeof n === "number") ? (list as number[]) : null;
};

/** Every letter the page draws, in order, with whether it can be seen. */
function glyphsOf(operators: PdfOperatorList, OPS: Record<string, number>): Glyph[] {
  const glyphs: Glyph[] = [];
  let state: State = { ctm: [1, 0, 0, 1, 0, 0], clip: null, fill: "#000000", alpha: 1, mode: 0 };
  const stack: State[] = [];
  let clipping = false;
  for (let i = 0; i < operators.fnArray.length; i++) {
    const fn = operators.fnArray[i];
    const args = operators.argsArray[i] as unknown[] | null;
    switch (fn) {
      case OPS.save:
        stack.push(state);
        state = { ...state };
        break;
      case OPS.restore:
        state = stack.pop() ?? state;
        break;
      case OPS.transform: {
        const m = numbers(args);
        if (m && m.length === 6) state.ctm = multiply(m as Matrix, state.ctm);
        break;
      }
      case OPS.paintFormXObjectBegin: {
        stack.push(state);
        state = { ...state };
        const m = numbers(args?.[0]);
        if (m && m.length === 6) state.ctm = multiply(m as Matrix, state.ctm);
        const bbox = numbers(args?.[1]);
        if (bbox && bbox.length === 4) state.clip = intersect(state.clip, boxThrough({ x0: bbox[0]!, y0: bbox[1]!, x1: bbox[2]!, y1: bbox[3]! }, state.ctm));
        break;
      }
      case OPS.paintFormXObjectEnd:
        state = stack.pop() ?? state;
        break;
      case OPS.clip:
      case OPS.eoClip:
        clipping = true;
        break;
      case OPS.constructPath: {
        // The path's extent (pdf.js gives it last); a clip takes the area it bounds.
        const minMax = numbers(args?.[args.length - 1]);
        if (clipping && minMax && minMax.length === 4 && minMax.every(Number.isFinite)) {
          state.clip = intersect(state.clip, boxThrough({ x0: minMax[0]!, y0: minMax[1]!, x1: minMax[2]!, y1: minMax[3]! }, state.ctm));
        }
        clipping = false;
        break;
      }
      case OPS.endPath:
        clipping = false;
        break;
      case OPS.setFillRGBColor:
        if (typeof args?.[0] === "string") state.fill = args[0];
        break;
      case OPS.setGState:
        for (const entry of (args?.[0] as unknown[] | undefined) ?? []) {
          if (Array.isArray(entry) && entry[0] === "ca" && typeof entry[1] === "number") state.alpha = entry[1];
        }
        break;
      case OPS.setTextRenderingMode:
        if (typeof args?.[0] === "number") state.mode = args[0];
        break;
      case OPS.showText:
      case OPS.showSpacedText:
      case OPS.nextLineShowText:
      case OPS.nextLineSetSpacingShowText: {
        const list = (args?.[args.length - 1] ?? []) as unknown[];
        // Mode 3 draws nothing, 7 only clips.
        const unseen = blank(state.fill) || state.alpha === 0 || state.mode === 3 || state.mode === 7;
        for (const glyph of Array.isArray(list) ? list : []) {
          const unicode = glyph && typeof glyph === "object" && "unicode" in glyph ? String((glyph as { unicode: unknown }).unicode ?? "") : "";
          for (const char of unicode.normalize("NFKC")) glyphs.push({ char, unseen, clip: state.clip });
        }
        break;
      }
    }
  }
  return glyphs;
}

/**
 * Each text item's text with the letters the page doesn't show as spaces,
 * matched to the letters it draws in order. A letter that can't be matched
 * is kept.
 */
export function shownText(items: PdfTextContentItem[], operators: PdfOperatorList, OPS: Record<string, number>): string[] {
  const glyphs = glyphsOf(operators, OPS).filter((glyph) => glyph.char.trim() !== "");
  let next = 0;
  return items.map((item) => {
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    let out = "";
    for (const char of item.str) {
      if (char.trim() === "") {
        out += char;
        continue;
      }
      let found = -1;
      for (let i = next; i < Math.min(glyphs.length, next + 8); i++) {
        if (glyphs[i]!.char === char) {
          found = i;
          break;
        }
      }
      if (found < 0) {
        out += char;
        continue;
      }
      next = found + 1;
      const { unseen, clip } = glyphs[found]!;
      const clipped = clip !== null && (x < clip.x0 - 1 || x > clip.x1 + 1 || y < clip.y0 - 1 || y > clip.y1 + 1);
      out += unseen || clipped ? " " : char;
    }
    return out;
  });
}
