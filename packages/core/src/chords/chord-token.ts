import { parseChord } from "./chord.js";

// A chord name that's also a short word ("Do", "Ad", "Ed": diminished chords
// as French books write them, issue #203): a chord only beside other chords.
const WORD_LIKE = /^[A-G][od]$/;
// What a line of chords may hold besides chords: beat and bar marks, "N.C.",
// and how many times to play it ("x2", "(x2)", "2x", "bis").
const MARKS = /^(?:[-–—./|%*]+|:?\|+:?|\(?\s*(?:[x×]\s*\d{1,2}|\d{1,2}\s*[x×]|bis)\s*\)?)$/i;

/** Whether a token written on a line of chords is a chord ("F#7sus4", "G(add9)", "(D)", "N.C."). */
export function isChordToken(token: string): boolean {
  return parseChord(token) !== null;
}

/** Whether a token is a mark a line of chords may hold beside its chords: "-", ".", "|", "%", "x2", "(x2)". */
export function isChordLineMark(token: string): boolean {
  return MARKS.test(token);
}

/**
 * Whether a line holds only chords (and the marks a line of chords has):
 * "G  D/F#  Em  C", "G - D - Em - C", "(G)   (C)", "G D Em C (x2)". It needs
 * one chord at least, and one that isn't also a word ("Do" alone is a word).
 */
export function isChordsOnly(trimmedLine: string): boolean {
  const tokens = trimmedLine
    .replace(/\(\s*([x×])\s*(\d{1,2})\s*\)/gi, "($1$2)")
    .split(/\s+/)
    .filter(Boolean);
  let chords = 0;
  let strong = false;
  for (const token of tokens) {
    if (isChordToken(token)) {
      chords++;
      if (!WORD_LIKE.test(token)) strong = true;
    } else if (!isChordLineMark(token)) {
      return false;
    }
  }
  return chords > 0 && strong;
}
