import { parseChord, sameChord, semitoneOf, transposeChord } from "../chords/chord.js";
import type { ArrangementDocumentV2 } from "../schemas/arrangement-document-v2.js";
import type { LineV2, SectionInstance, SectionV2, SongDocumentV2 } from "../schemas/song-document-v2.js";
import { remapArrangement, type ChartIdMap } from "./fold.js";

/**
 * A section that repeats an earlier one (issue #231): a pass of it, sung
 * again - as it is, moved up or down, with a few chords of its own, or
 * only a run of its lines - rather than kept twice. The same matching
 * reads a file in (import) and links the repeats of a song already kept.
 */
export type RepeatMatch =
  | { kind: "same" }
  /** Every chord moved by the same number of semitones: the pass transposed. */
  | { kind: "transposed"; steps: number }
  /** A few chords different (at most a third): the pass's own chords, written in the song's key; maybe transposed too. */
  | { kind: "chords"; steps: number; chords: { chordId: string; raw: string | null }[] }
  /** A run of the earlier section's lines: the pass leaves the others out. */
  | { kind: "lines"; hiddenLines: string[] };

/** A later section repeating an earlier one: what makes it a pass of it, and which of the earlier's lines and chords each of its own is. */
export interface FoundRepeat {
  /** The repeat, which goes. */
  sectionId: string;
  /** The section it repeats, which stays. */
  ofSectionId: string;
  match: RepeatMatch;
  ids: ChartIdMap;
  /** The repeat's own label ("Chorus 2"), kept on its passes; null when it's the earlier one's. */
  label: string | null;
}

/** The most chords a pass may have of its own and still be a pass: a third of them. */
const MAX_DIFFERENT = 1 / 3;

const lineShape = (line: LineV2) => JSON.stringify([line.kind, line.text, line.chords.map((chord) => chord.at)]);
const sameLine = (a: LineV2, b: LineV2) => lineShape(a) === lineShape(b) && a.chords.every((chord, i) => chord.raw === b.chords[i]!.raw);
const rootOf = (raw: string): number | null => {
  const parsed = parseChord(raw);
  return parsed && parsed.kind === "chord" ? semitoneOf(parsed.root) : null;
};
/** -5 to +6. */
const shortest = (steps: number) => {
  const up = ((steps % 12) + 12) % 12;
  return up > 6 ? up - 12 : up;
};

function idMap(sections: [string, string], lines: [LineV2, LineV2][]): ChartIdMap {
  const map: ChartIdMap = { sections: new Map([sections]), lines: new Map(), chords: new Map() };
  for (const [from, to] of lines) {
    map.lines.set(from.id, to.id);
    from.chords.forEach((chord, i) => map.chords.set(chord.id, to.chords[i]!.id));
  }
  return map;
}

/**
 * How `later` repeats `earlier`, or null when it doesn't: the same lyrics
 * and chord places, with the same chords, all moved alike, or at most a
 * third of them different; or exactly a run of its lines (two or more).
 * `key` is the song's, for spelling the chords a pass has of its own.
 */
export function matchRepeat(earlier: SectionV2, later: SectionV2, key: string | null): { match: RepeatMatch; ids: ChartIdMap } | null {
  if (earlier.id === later.id || later.lines.length === 0) return null;
  const sections: [string, string] = [later.id, earlier.id];
  if (earlier.type === later.type && earlier.lines.length === later.lines.length && earlier.lines.every((line, i) => lineShape(line) === lineShape(later.lines[i]!))) {
    const pairs = earlier.lines.flatMap((line, i) => line.chords.map((chord, c) => [chord, later.lines[i]!.chords[c]!] as const));
    const ids = idMap(sections, later.lines.map((line, i) => [line, earlier.lines[i]!]));
    // The shift most chords agree on (none first, on a tie).
    const votes = new Map<number, number>([[0, 0]]);
    for (const [a, b] of pairs) {
      const [x, y] = [rootOf(a.raw), rootOf(b.raw)];
      if (x !== null && y !== null) votes.set(shortest(y - x), (votes.get(shortest(y - x)) ?? 0) + 1);
    }
    const steps = [...votes.entries()].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0]![0];
    const different = pairs.filter(([a, b]) => !sameChord(transposeChord(a.raw, steps, key), b.raw));
    if (different.length === 0) return { match: steps === 0 ? { kind: "same" } : { kind: "transposed", steps }, ids };
    if (different.length <= pairs.length * MAX_DIFFERENT) {
      // Written in the song's key: the pass's transposition moves them with the rest.
      const chords = different.map(([a, b]) => ({ chordId: a.id, raw: transposeChord(b.raw, -steps, key) }));
      return { match: { kind: "chords", steps, chords }, ids };
    }
    return null;
  }
  // The end of the chorus again, written out.
  const run = later.lines.length;
  if (run >= 2 && run < earlier.lines.length) {
    for (let start = 0; start + run <= earlier.lines.length; start++) {
      if (!later.lines.every((line, i) => sameLine(earlier.lines[start + i]!, line))) continue;
      const kept = new Set(earlier.lines.slice(start, start + run).map((line) => line.id));
      return {
        match: { kind: "lines", hiddenLines: earlier.lines.filter((line) => !kept.has(line.id)).map((line) => line.id) },
        ids: idMap(sections, later.lines.map((line, i) => [line, earlier.lines[start + i]!])),
      };
    }
  }
  return null;
}

const ORDER: RepeatMatch["kind"][] = ["same", "transposed", "chords", "lines"];

/** The earlier section `later` repeats best (as it is first, then moved, then with chords of its own, then in part), among `earlier`. */
export function bestRepeat(earlier: SectionV2[], later: SectionV2, key: string | null): { of: SectionV2; match: RepeatMatch; ids: ChartIdMap } | null {
  let best: { of: SectionV2; match: RepeatMatch; ids: ChartIdMap } | null = null;
  for (const of of earlier) {
    const found = matchRepeat(of, later, key);
    if (found && (!best || ORDER.indexOf(found.match.kind) < ORDER.indexOf(best.match.kind))) best = { of, ...found };
  }
  return best;
}

/** What a pass of the earlier section needs to sing it as the repeat was written. */
export function repeatPass(match: RepeatMatch): Pick<SectionInstance, "transpose" | "chords" | "hiddenLines"> {
  switch (match.kind) {
    case "same":
      return {};
    case "transposed":
      return { transpose: match.steps };
    case "chords":
      return { ...(match.steps && { transpose: match.steps }), chords: match.chords };
    case "lines":
      return { hiddenLines: match.hiddenLines };
  }
}

/**
 * A song's sections that repeat an earlier one, each with the earliest it
 * repeats best - for linking them in a song already kept. A section that
 * is itself a repeat isn't one others are matched to.
 */
export function findRepeats(doc: Pick<SongDocumentV2, "sections" | "defaults">): FoundRepeat[] {
  const key = doc.defaults.key ?? null;
  const originals: SectionV2[] = [];
  const found: FoundRepeat[] = [];
  for (const section of doc.sections) {
    const best = bestRepeat(originals, section, key);
    if (best) found.push({ sectionId: section.id, ofSectionId: best.of.id, match: best.match, ids: best.ids, label: section.label && section.label !== best.of.label ? section.label : null });
    else originals.push(section);
  }
  return found;
}

/** A pass's IDs pointed at the other section's. */
function mapPass<T extends SectionInstance>(item: T, ids: ChartIdMap): T {
  const line = (id: string) => ids.lines.get(id) ?? id;
  return {
    ...item,
    sectionId: ids.sections.get(item.sectionId) ?? item.sectionId,
    ...(item.chords && { chords: item.chords.map((change) => ({ ...change, chordId: ids.chords.get(change.chordId) ?? change.chordId })) }),
    ...(item.hiddenLines && { hiddenLines: item.hiddenLines.map(line) }),
    ...(item.lyrics && { lyrics: item.lyrics.map((change) => ({ ...change, lineId: line(change.lineId) })) }),
  };
}

/**
 * A pass of the repeat (its IDs already the earlier section's) as a pass of
 * the earlier section: the match's transposition, chords and lines left
 * out, with what the pass had of its own on top - its chords, written in
 * the repeat's key, moved back to the song's.
 */
function withMatch<T extends SectionInstance>(item: T, repeat: FoundRepeat, key: string | null): T {
  const extra = repeatPass(repeat.match);
  const steps = extra.transpose ?? 0;
  const own = (item.chords ?? []).map((change) => ({ ...change, raw: change.raw === null ? null : transposeChord(change.raw, -steps, key) }));
  const chords = [...(extra.chords ?? []).filter((change) => !own.some((mine) => mine.chordId === change.chordId)), ...own];
  const hidden = [...new Set([...(extra.hiddenLines ?? []), ...(item.hiddenLines ?? [])])];
  const transpose = shortest((item.transpose ?? 0) + steps);
  const label = item.label ?? repeat.label;
  const out: T = { ...item, ...(label && { label }) };
  delete out.transpose;
  delete out.chords;
  delete out.hiddenLines;
  return { ...out, ...(transpose && { transpose }), ...(chords.length && { chords }), ...(hidden.length && { hiddenLines: hidden }) };
}

/** A pass in the song's order, or an arrangement's, once the repeat is linked: unchanged unless it sings the repeat. */
export function linkRepeatInPass<T extends SectionInstance>(item: T, repeat: FoundRepeat, key: string | null): T {
  return item.sectionId === repeat.sectionId ? withMatch(mapPass(item, repeat.ids), repeat, key) : item;
}

/**
 * The song with a repeat linked (issue #231): the repeat goes, and each
 * pass of it becomes a pass of the section it repeats, as it was sung.
 * The revision moves on.
 */
export function linkRepeat(doc: SongDocumentV2, repeat: FoundRepeat): SongDocumentV2 {
  const key = doc.defaults.key ?? null;
  return {
    ...doc,
    revision: doc.revision + 1,
    sections: doc.sections.filter((section) => section.id !== repeat.sectionId),
    flow: doc.flow.map((item) => linkRepeatInPass(item, repeat, key)),
  };
}

/** An arrangement of the song once a repeat is linked: its passes of the repeat sung from the section it repeats. */
export function linkRepeatInArrangement(arrangement: ArrangementDocumentV2, repeat: FoundRepeat, key: string | null): ArrangementDocumentV2 {
  const remapped = remapArrangement(arrangement, repeat.ids, arrangement.songVersionId);
  return {
    ...remapped,
    songRevision: arrangement.songRevision,
    items: remapped.items.map((item, i) => (arrangement.items[i]!.sectionId === repeat.sectionId ? withMatch(item, repeat, key) : item)),
  };
}

/** The song with these repeats linked, one after the other (each found in the song as it was). */
export function linkRepeats(doc: SongDocumentV2, repeats: FoundRepeat[]): SongDocumentV2 {
  if (repeats.length === 0) return doc;
  const linked = repeats.reduce((song, repeat) => linkRepeat(song, repeat), doc);
  return { ...linked, revision: doc.revision + 1 };
}
