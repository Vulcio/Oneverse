import type { ChordV2, LineV2, SectionInstance, SectionV2, SongDocumentV2 } from "../schemas/song-document-v2.js";
import { passChanged } from "./pass.js";
import { flowItemId } from "../schemas/song-document-v2.js";

/**
 * Keeps IDs stable when a song is edited as text: the new text is parsed
 * into fresh sections, then matched against the stored ones, and anything
 * that's still there takes its old ID back. See docs/song-document-v2.md,
 * "Text mode".
 *
 * - Sections and lines are matched in order, by how similar their text is
 *   (so inserting or deleting one doesn't shift every ID after it); in a
 *   stretch between matches with as many old as new, they pair up in order
 *   (a line rewritten in place keeps its ID).
 * - Chords on a matched line are matched in order by symbol, then paired up
 *   in order within each stretch (a chord changed from G to A, or moved,
 *   keeps its ID).
 * - Anything unmatched keeps the new ID the parser gave it.
 */
export function reconcileSections(previous: SectionV2[], next: SectionV2[]): SectionV2[] {
  const sectionPairs = alignWithGaps(previous, next, sectionSimilarity, (a, b) => a.type === b.type);
  return next.map((section, j) => {
    const old = sectionPairs.get(j);
    if (!old) return section;
    const linePairs = alignWithGaps(old.lines, section.lines, lineSimilarity, () => true);
    const lines = section.lines.map((line, l) => {
      const oldLine = linePairs.get(l);
      return oldLine ? { ...line, id: oldLine.id, chords: reconcileChords(oldLine.chords, line.chords) } : line;
    });
    return {
      ...section,
      id: old.id,
      rhythm: withIds(section.rhythm ?? null, section.lines, lines),
      groove: section.groove ?? old.groove ?? null,
      lines,
    };
  });
}

/** A rhythm the text gave (bar lines, issue #460), pointing at the lines and chords by the IDs they took back. */
function withIds(rhythm: SectionV2["rhythm"] | null, before: LineV2[], after: LineV2[]): SectionV2["rhythm"] | null {
  if (!rhythm) return null;
  const ids = new Map<string, string>();
  before.forEach((line, l) => {
    ids.set(line.id, after[l]!.id);
    line.chords.forEach((chord, c) => ids.set(chord.id, after[l]!.chords[c]!.id));
  });
  const id = (value: string) => ids.get(value) ?? value;
  return {
    ...rhythm,
    bars: rhythm.bars.map((bar) => ({
      ...bar,
      chords: bar.chords.map((chord) => ({ ...chord, chordId: id(chord.chordId) })),
      ...(bar.lyricAnchor ? { lyricAnchor: { ...bar.lyricAnchor, lineId: id(bar.lyricAnchor.lineId) } } : {}),
      ...(bar.beatAnchors ? { beatAnchors: bar.beatAnchors.map((anchor) => ({ ...anchor, lineId: id(anchor.lineId) })) } : {}),
    })),
  };
}

function reconcileChords(previous: ChordV2[], next: ChordV2[]): ChordV2[] {
  const pairs = alignWithGaps(previous, next, (a, b) => (a.raw === b.raw ? 1 : null), () => true);
  return next.map((chord, j) => {
    const old = pairs.get(j);
    return old ? { ...chord, id: old.id } : chord;
  });
}

/**
 * The flow after the sections changed. A flow that was just the sections
 * in order follows the new order; one that was arranged by hand (repeats,
 * key changes) keeps its shape, loses passes through deleted sections and
 * gains new sections at the end.
 */
export function reconcileFlow(previous: SongDocumentV2 | null, sections: SectionV2[]): SectionInstance[] {
  const plain = (flow: SectionInstance[], order: SectionV2[]) =>
    flow.length === order.length &&
    flow.every((item, i) => item.sectionId === order[i]!.id && !item.label && !item.keyChange && !item.tempo && !item.timeSignature && !item.note && !passChanged(item));
  if (!previous || plain(previous.flow, previous.sections)) {
    return sections.map((section) => {
      const kept = previous?.flow.find((item) => item.sectionId === section.id);
      return kept ?? { id: flowItemId(section.id), sectionId: section.id };
    });
  }
  const ids = new Set(sections.map((section) => section.id));
  const flow = previous.flow.filter((item) => ids.has(item.sectionId));
  const inFlow = new Set(flow.map((item) => item.sectionId));
  for (const section of sections) {
    if (!inFlow.has(section.id)) flow.push({ id: flowItemId(section.id), sectionId: section.id });
  }
  return flow;
}

/**
 * Matches `next` items to `previous` ones: an in-order alignment that
 * maximizes similarity (a score, or null for "can't be the same"), then,
 * in each stretch between matches holding as many old as new items that
 * `compatible` allows, pairs them in order. Returns the old item for each
 * matched index of `next`.
 */
function alignWithGaps<T>(
  previous: T[],
  next: T[],
  similarity: (a: T, b: T) => number | null,
  compatible: (a: T, b: T) => boolean,
): Map<number, T> {
  const n = previous.length;
  const m = next.length;
  // best[i][j]: the best total for previous[i..] and next[j..].
  const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const score = (i: number, j: number) => similarity(previous[i]!, next[j]!);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = score(i, j);
      best[i]![j] = Math.max(best[i + 1]![j]!, best[i]![j + 1]!, s === null ? -Infinity : s + best[i + 1]![j + 1]!);
    }
  }
  const matches: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    const s = score(i, j);
    if (s !== null && best[i]![j] === s + best[i + 1]![j + 1]!) {
      matches.push([i, j]);
      i++;
      j++;
    } else if (best[i]![j] === best[i + 1]![j]) i++;
    else j++;
  }

  const result = new Map<number, T>(matches.map(([i, j]) => [j, previous[i]!]));
  // Pair up equal-sized stretches between matches, in order.
  const bounds = [[-1, -1] as [number, number], ...matches, [n, m] as [number, number]];
  for (let k = 0; k < bounds.length - 1; k++) {
    const [i0, j0] = bounds[k]!;
    const [i1, j1] = bounds[k + 1]!;
    if (i1 - i0 !== j1 - j0) continue;
    for (let d = 1; i0 + d < i1; d++) {
      const old = previous[i0 + d]!;
      if (compatible(old, next[j0 + d]!)) result.set(j0 + d, old);
    }
  }
  return result;
}

const SECTION_THRESHOLD = 0.3;
const LINE_THRESHOLD = 0.4;

function sectionSimilarity(a: SectionV2, b: SectionV2): number | null {
  const words = (section: SectionV2) => section.lines.flatMap((line) => line.text.toLowerCase().split(/\s+/).filter(Boolean));
  const [x, y] = [words(a), words(b)];
  if (x.length === 0 && y.length === 0) return a.type === b.type ? 0.5 : null;
  const similarity = dice(x, y);
  if (similarity < SECTION_THRESHOLD) return null;
  return similarity + (a.type === b.type ? 0.25 : 0);
}

function lineSimilarity(a: LineV2, b: LineV2): number | null {
  if (a.kind !== b.kind) return null;
  const [x, y] = [a.text.toLowerCase().trim(), b.text.toLowerCase().trim()];
  if (!x && !y) {
    // Chord-only lines: alike when their chords are.
    const [cx, cy] = [a.chords.map((c) => c.raw).join(" "), b.chords.map((c) => c.raw).join(" ")];
    return cx === cy ? 1 : 0.5;
  }
  if (!x || !y) return null;
  if (x === y) return 1;
  const similarity = dice(bigrams(x), bigrams(y));
  return similarity < LINE_THRESHOLD ? null : similarity;
}

function bigrams(text: string): string[] {
  if (text.length < 2) return [text];
  return Array.from({ length: text.length - 1 }, (_, i) => text.slice(i, i + 2));
}

/** Sørensen-Dice similarity of two multisets: 1 for identical, 0 for nothing in common. */
function dice(a: string[], b: string[]): number {
  if (a.length + b.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const item of a) counts.set(item, (counts.get(item) ?? 0) + 1);
  let common = 0;
  for (const item of b) {
    const count = counts.get(item) ?? 0;
    if (count > 0) {
      common++;
      counts.set(item, count - 1);
    }
  }
  return (2 * common) / (a.length + b.length);
}
