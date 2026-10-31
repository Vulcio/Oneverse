/**
 * Bar notation (issue #344): an instrumental written as bars of chords,
 * "| G | C | D | G |", "||: Em . . . | C . D . :|| x2". Each cell between bar
 * lines is a bar: its chords, and beat marks ("." or "/") where they're
 * written (one per beat, the chord's own token counting as its first);
 * "%" or an empty cell carries the bar before on. A trailing "x2" plays the
 * bars that many times. Read by the ChordPro and chords-over-lyrics
 * importers; the bars become the section's rhythm (see parsedSectionsToV2).
 */

const CHORD = /^[A-G](?:#|b)?(?:maj|min|dim|aug|sus|add|m|M|\+|°|ø)?[0-9]*(?:(?:add|sus|maj|b|#)[0-9]+)*(?:\/[A-G](?:#|b)?)?$/;
const BEAT_MARKS = new Set([".", "/", "-"]);
const NO_CHORD = new Set(["N.C.", "NC", "N.C"]);
const REPEAT = /\s*\(?\s*[x×]\s*(\d{1,2})\s*\)?$/i;
const MAX_REPEATS = 8;

/** One bar: its chords, by their place among the line's chords, on 1-based beats. */
export interface NotatedBar {
  chords: { index: number; beat: number }[];
}

/** A line of bar notation: its chords, in order, and its bars. */
export interface BarNotation {
  chords: string[];
  bars: NotatedBar[];
}

/** How a cell's chords fall in a 4-beat bar when no beats are marked: evenly, on beats or half beats. */
function spread(count: number, position: number): number {
  return 1 + Math.round(((position * 4) / count) * 2) / 2;
}

/**
 * A line of bar notation as chords and bars; null when the line isn't one
 * (it must start with a bar line, and every cell hold only chords, beat
 * marks or "%"). Chords may be in brackets, as ChordPro writes them.
 */
export function readBarNotation(trimmedLine: string): BarNotation | null {
  let line = trimmedLine.trim();
  if (!line.startsWith("|")) return null;
  let times = 1;
  const repeat = REPEAT.exec(line);
  if (repeat) {
    times = Math.min(MAX_REPEATS, Math.max(1, Number(repeat[1])));
    line = line.slice(0, repeat.index).trim();
  }
  // Repeat signs are bar lines too: "||:", ":||", "|:", ":|".
  const cells = line
    .replace(/:?\|+:?/g, "|")
    .split("|")
    .map((cell) => cell.trim());
  // The line starts with a bar line, so the first cell is empty; the last is too when it ends with one.
  cells.shift();
  if (cells.at(-1) === "") cells.pop();
  if (cells.length === 0) return null;

  const once: { chords: string[]; beats: number[] }[] = [];
  for (const cell of cells) {
    if (cell === "" || cell === "%") {
      const before = once.at(-1);
      // The bar before again: one chord carries on by itself; several are played again.
      once.push(before && before.chords.length > 1 ? { chords: [...before.chords], beats: [...before.beats] } : { chords: [], beats: [] });
      continue;
    }
    const tokens = cell.split(/\s+/).map((token) => token.replace(/^\[(.+)\]$/, "$1"));
    const chords: string[] = [];
    const at: number[] = [];
    let marked = false;
    for (const [position, token] of tokens.entries()) {
      if (BEAT_MARKS.has(token)) {
        marked = true;
        continue;
      }
      if (!CHORD.test(token) && !NO_CHORD.has(token.toUpperCase())) return null;
      chords.push(token);
      at.push(position);
    }
    if (chords.length === 0 && !marked) return null;
    once.push({ chords, beats: at.map((position, i) => (marked ? position + 1 : spread(chords.length, i))) });
  }
  if (!once.some((bar) => bar.chords.length > 0)) return null;

  const notation: BarNotation = { chords: [], bars: [] };
  for (let time = 0; time < times; time++) {
    for (const bar of once) {
      notation.bars.push({ chords: bar.chords.map((chord, i) => ({ index: notation.chords.length + i, beat: bar.beats[i]! })) });
      notation.chords.push(...bar.chords);
    }
  }
  return notation;
}

/** The chords as a line of chords alone, in the inline markup the parsers share: "[G][C][D][G]". */
export function barNotationMarkup(notation: BarNotation): string {
  return notation.chords.map((chord) => `[${chord}]`).join("");
}
