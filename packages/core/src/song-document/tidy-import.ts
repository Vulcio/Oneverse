import { generateId, ID_PREFIXES } from "../ids/index.js";
import type { LineV2, SectionV2 } from "../schemas/song-document-v2.js";

/**
 * A file read in, tidied where it says less than it means (issue #438):
 * how many times a section is sung ("(x2)" on a line of its own), a block
 * of words that runs several sections together with no headings or blank
 * lines between them, a section headed as the wrong kind, a section of
 * chords alone. Only for importing (`mergeRepeats`): typed text is taken
 * as written.
 */

const words = (line: LineV2) => line.text.trim().replace(/\s+/g, " ").toLowerCase();
const lyricLines = (section: SectionV2) => section.lines.filter((line) => line.kind === "lyric" && line.text.trim() !== "");
const TIMES_LINE = /^\(?\s*(?:[x×]\s*(\d{1,2})|(\d{1,2})\s*[x×]|(bis))\s*\)?$/i;

/** "(x2)", "x3", "(bis)" alone on the section's first or last line: taken out, and how many times it's sung (1 without). */
export function takeRepeatCount(section: SectionV2): number {
  for (const index of [0, section.lines.length - 1]) {
    const line = section.lines[index];
    if (!line || line.chords.length > 0 || section.lines.length < 2) continue;
    const match = TIMES_LINE.exec(line.text.trim());
    if (!match) continue;
    section.lines.splice(index, 1);
    return Math.min(8, Math.max(1, match[3] ? 2 : Number(match[1] ?? match[2])));
  }
  return 1;
}

const sameWords = (a: LineV2[], b: LineV2[]) => a.length === b.length && a.every((line, i) => words(line) === words(b[i]!));

/**
 * A section that is several run together: cut where an earlier section's
 * words come again whole, and where a run of lines is sung again straight
 * after itself ("Une pluie de guérisons…" three times). Null when it's one
 * section. The first part keeps the section's heading; a part that is an
 * earlier section again takes its kind, so it's then read as a pass of it.
 */
export function splitRunTogether(section: SectionV2, earlier: SectionV2[]): SectionV2[] | null {
  const lines = section.lines;
  if (lines.length < 4 || lines.some((line) => line.kind !== "lyric")) return null;
  const cuts = new Set<number>();
  const kinds = new Map<number, SectionV2>();
  // An earlier section's words, whole.
  for (const other of earlier) {
    const theirs = lyricLines(other);
    if (theirs.length < 2 || theirs.length >= lines.length) continue;
    for (let start = 0; start + theirs.length <= lines.length; start++) {
      if (!sameWords(lines.slice(start, start + theirs.length), theirs)) continue;
      cuts.add(start);
      cuts.add(start + theirs.length);
      kinds.set(start, other);
      start += theirs.length - 1;
    }
  }
  // Within what's left: a run sung again straight after itself.
  const bounds = [0, ...[...cuts].filter((cut) => cut > 0 && cut < lines.length).sort((a, b) => a - b), lines.length];
  for (let b = 0; b + 1 < bounds.length; b++) {
    const [from, to] = [bounds[b]!, bounds[b + 1]!];
    if (kinds.has(from)) continue;
    const length = to - from;
    for (let period = 2; period * 2 <= length; period++) {
      if (length % period !== 0) continue;
      const first = lines.slice(from, from + period);
      let whole = true;
      for (let at = from + period; at < to && whole; at += period) whole = sameWords(lines.slice(at, at + period), first);
      if (!whole) continue;
      for (let at = from + period; at < to; at += period) cuts.add(at);
      break;
    }
  }
  const points = [...cuts].filter((cut) => cut > 0 && cut < lines.length).sort((a, b) => a - b);
  if (points.length === 0) return null;
  const starts = [0, ...points];
  return starts.map((start, i) => {
    const part = lines.slice(start, starts[i + 1] ?? lines.length);
    if (i === 0) return { ...section, lines: part };
    const of = kinds.get(start);
    return { ...section, id: generateId(ID_PREFIXES.section), type: of?.type ?? "other", label: null, lines: part };
  });
}

/**
 * A section headed as one kind ("Chorus") whose words are none of that
 * kind's, but which shares a third of its lines or more with another kind
 * written before (the second verse, headed "Chorus" again by mistake):
 * that other kind, its heading dropped.
 */
export function retypeByWords(section: SectionV2, earlier: SectionV2[]): void {
  if (section.type === "other") return;
  const mine = lyricLines(section).map(words);
  // Too short to tell (an ending of two lines): as headed.
  if (mine.length < 3) return;
  const shared = (type: string) => {
    const theirs = new Set(earlier.filter((other) => other.type === type).flatMap((other) => lyricLines(other).map(words)));
    return mine.filter((text) => theirs.has(text)).length;
  };
  if (!earlier.some((other) => other.type === section.type) || shared(section.type) > 0) return;
  const types = [...new Set(earlier.map((other) => other.type))].filter((type) => type !== section.type && type !== "other");
  const best = types.map((type) => [type, shared(type)] as const).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] * 3 >= mine.length) {
    section.type = best[0];
    section.label = null;
  }
}

/** A section of chords alone, with no words: an intro, an instrumental, an outro. */
export function chordsOnly(section: SectionV2): boolean {
  return section.lines.length > 0 && section.lines.every((line) => line.kind === "lyric" && line.text.trim() === "" && line.chords.length > 0);
}
