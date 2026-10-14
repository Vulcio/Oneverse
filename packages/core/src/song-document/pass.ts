import { transposeChord } from "../chords/chord.js";
import { generateId, ID_PREFIXES } from "../ids/index.js";
import type { ChordV2, LineV2, SectionInstance, SectionV2 } from "../schemas/song-document-v2.js";
import { transposeKey } from "../music-keys/transpose.js";

/**
 * A linked copy of a section (issue #205): another pass of it in the song's
 * order, the same section - changed for that pass only by differences from
 * it. Lines removed, words replaced or removed, chords replaced or left out,
 * and the whole pass moved up or down; everything else follows the section.
 */

/** A piece of a word diff: kept, removed from the first text, or added in the second. */
export interface WordChange {
  kind: "same" | "removed" | "added";
  text: string;
}

// Words (with their apostrophes), punctuation marks one by one, and runs of spaces.
const tokens = (text: string) => text.match(/\s+|[\p{L}\p{N}\p{M}'’]+|[^\s\p{L}\p{N}\p{M}'’]/gu) ?? [];

/**
 * How `after` differs from `before`, word by word (spaces and punctuation are words too):
 * the longest run of words kept in order, the rest removed or added -
 * removals before additions where a word was replaced.
 */
export function wordDiff(before: string, after: string): WordChange[] {
  const a = tokens(before);
  const b = tokens(after);
  // Longest common subsequence, from the end.
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  }
  const changes: WordChange[] = [];
  const push = (kind: WordChange["kind"], text: string) => {
    const last = changes.at(-1);
    if (last?.kind === kind) last.text += text;
    else changes.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && table[i + 1]![j]! >= table[i]![j + 1]!)) {
      push("removed", a[i++]!);
    } else {
      push("added", b[j++]!);
    }
  }
  return changes;
}

/**
 * A line's chords over new words: each stays on its character where that
 * word is kept, and goes to where its word was replaced (the start of what
 * replaced it) or removed (the next word kept).
 */
export function followChords<T extends Pick<ChordV2, "at">>(before: string, after: string, chords: T[]): T[] {
  if (before === after) return chords;
  // Each character of `before`: where it is in `after`.
  const at = new Array<number>(before.length + 1).fill(0);
  let i = 0;
  let j = 0;
  let pending: number[] = []; // removed characters waiting for where their place lands
  for (const change of wordDiff(before, after)) {
    if (change.kind === "same") {
      for (const index of pending) at[index] = j;
      pending = [];
      for (let k = 0; k < change.text.length; k++) at[i + k] = j + k;
      i += change.text.length;
      j += change.text.length;
    } else if (change.kind === "removed") {
      for (let k = 0; k < change.text.length; k++) pending.push(i + k);
      i += change.text.length;
    } else {
      // Replaced: the removed words' chords go to the start of what replaced them.
      for (const index of pending) at[index] = j;
      pending = [];
      j += change.text.length;
    }
  }
  for (const index of pending) at[index] = j;
  at[before.length] = after.length;
  return chords.map((chord) => ({ ...chord, at: Math.min(at[Math.min(chord.at, before.length)]!, after.length) })).sort((x, y) => x.at - y.at);
}

/** A line as a linked copy sings it: its own words and chords, and which of them differ. */
export interface PassLine extends LineV2 {
  /** Chords this pass replaces. */
  replaced: string[];
  /** This pass changes its words. */
  lyricChanged: boolean;
}

/** Whether a pass differs from its section: transposed, lines removed, its own words or chords. */
export function passChanged(pass: SectionInstance): boolean {
  return !!pass.transpose || passEdited(pass);
}

/**
 * The pass has words, lines or chords of its own (issue #252) - marked * -
 * as opposed to only being moved up or down, which shows as its own badge.
 */
export function passEdited(pass: SectionInstance): boolean {
  return (pass.chords?.length ?? 0) > 0 || (pass.hiddenLines?.length ?? 0) > 0 || (pass.lyrics?.length ?? 0) > 0;
}

/**
 * The section's lines as this pass sings them (before any transposition):
 * lines removed, words replaced (the chords following their words), chords
 * replaced or left out. What the pass names and the section no longer has
 * is a problem, said rather than dropped.
 */
export function passLines(section: SectionV2, pass: SectionInstance): { lines: PassLine[]; problems: string[] } {
  const problems: string[] = [];
  const lineIds = new Set(section.lines.map((line) => line.id));
  const chordIds = new Set(section.lines.flatMap((line) => line.chords.map((chord) => chord.id)));
  for (const id of pass.hiddenLines ?? []) if (!lineIds.has(id)) problems.push(`line ${id} not found`);
  for (const change of pass.lyrics ?? []) if (!lineIds.has(change.lineId)) problems.push(`line ${change.lineId} not found`);
  for (const change of pass.chords ?? []) if (!chordIds.has(change.chordId)) problems.push(`chord ${change.chordId} not found`);
  const hidden = new Set(pass.hiddenLines ?? []);
  const words = new Map((pass.lyrics ?? []).map((change) => [change.lineId, change.text]));
  const chords = new Map((pass.chords ?? []).map((change) => [change.chordId, change.raw]));
  const lines = section.lines
    .filter((line) => !hidden.has(line.id))
    .map((line): PassLine => {
      const text = words.get(line.id);
      const placed = text === undefined ? line.chords : followChords(line.text, text, line.chords);
      return {
        ...line,
        text: text ?? line.text,
        chords: placed.flatMap((chord) => {
          const raw = chords.get(chord.id);
          return raw === null ? [] : [{ ...chord, raw: raw ?? chord.raw }];
        }),
        replaced: placed.filter((chord) => typeof chords.get(chord.id) === "string").map((chord) => chord.id),
        lyricChanged: text !== undefined && text !== line.text,
      };
    });
  return { lines, problems };
}

/**
 * The copy made unique (issue #205): a section of its own, its changes
 * written in - lines removed, words and chords as the pass has them,
 * chords moved by its transposition (spelt for `key`, the key the section
 * is written in, moved). New IDs throughout, so it no longer follows the
 * section. `newId` makes them, given the kind of thing.
 */
export function uniquePass(
  section: SectionV2,
  pass: SectionInstance,
  key: string | null,
  newId: (kind: "section" | "line" | "chord") => string = (kind) => generateId(ID_PREFIXES[kind]),
): SectionV2 {
  const steps = pass.transpose ?? 0;
  const spelling = key && steps ? (transposeKey(key, steps) ?? key) : key;
  return {
    ...section,
    id: newId("section"),
    label: pass.label ?? section.label ?? null,
    lines: passLines(section, pass).lines.map(({ replaced: _replaced, lyricChanged: _changed, ...line }) => ({
      ...line,
      id: newId("line"),
      chords: line.chords.map((chord) => ({ ...chord, id: newId("chord"), raw: steps ? transposeChord(chord.raw, steps, spelling) : chord.raw })),
    })),
  };
}
