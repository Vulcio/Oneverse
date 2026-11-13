import {
  barBeatPlaces,
  barLinesFromRhythm,
  chartBars,
  characterBoundaries,
  keepPlacedBeats,
  rhythmFromBarLines,
  type BarLine,
  type SectionBarLines,
  flowItemId,
  generateId,
  ID_PREFIXES,
  type LineV2,
  type RenderedChart,
  type SectionInstance,
  type SectionType,
  type SectionV2,
  sectionNumbers,
} from "@oneverse/core";
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * The song's sections as the structured editor holds them, and back
 * (docs/song-document-v2.md, "Editor rules"): a section is a block, a line a
 * paragraph in it, and a chord an inline item sitting just before the
 * character it's pinned to - a bar line too (issue #238), from the section's
 * rhythm and back. IDs travel both ways untouched.
 */

export function newSectionJSON(type: SectionType, lines: JSONContent[] = [newLineJSON()]): JSONContent {
  return { type: "section", attrs: { id: generateId(ID_PREFIXES.section), type, label: null, showLabel: true }, content: lines };
}

export function newLineJSON(): JSONContent {
  return { type: "line", attrs: { id: generateId(ID_PREFIXES.line), kind: "lyric" } };
}

function lineJSON(line: LineV2, marks: BarLine[] = []): JSONContent {
  const content: JSONContent[] = [];
  let cursor = 0;
  const text = (to: number) => {
    if (to > cursor) content.push({ type: "text", text: line.text.slice(cursor, to) });
    cursor = Math.max(cursor, to);
  };
  const bars = [...marks].sort((a, b) => a.at - b.at || a.chordsBefore - b.chordsBefore);
  let next = 0;
  // The bar lines before the chord `index` pinned at `at`: before it in the line, or among chords on its character.
  const barsBefore = (index: number, at: number) => {
    while (next < bars.length && (bars[next]!.at < at || (bars[next]!.at === at && bars[next]!.chordsBefore <= index))) {
      const bar = bars[next++]!;
      text(Math.min(bar.at, line.text.length));
      content.push({ type: "barLine", attrs: { bars: bar.bars, cues: bar.cues ?? null } });
    }
  };
  line.chords.forEach((chord, index) => {
    barsBefore(index, Math.min(chord.at, line.text.length));
    text(Math.min(chord.at, line.text.length));
    content.push({ type: "chord", attrs: { id: chord.id, raw: chord.raw } });
  });
  barsBefore(line.chords.length, Number.POSITIVE_INFINITY);
  text(line.text.length);
  return { type: "line", attrs: { id: line.id, kind: line.kind }, ...(content.length > 0 && { content }) };
}

function sectionJSON(section: SectionV2, extra: { passId?: string | null; sung?: boolean; repeats?: string[] } = {}): JSONContent {
  const marks = barLinesFromRhythm(section);
  return {
    type: "section",
    attrs: {
      id: section.id,
      type: section.type,
      label: section.label ?? null,
      showLabel: section.showLabel !== false,
      rhythm: section.rhythm ?? null,
      groove: section.groove ?? null,
      passId: extra.passId ?? null,
      sung: extra.sung ?? true,
      repeats: extra.repeats ?? [],
    },
    content: section.lines.length > 0 ? section.lines.map((line) => lineJSON(line, marks[line.id])) : [newLineJSON()],
  };
}

/** The editor's document for these sections; an empty song gets one empty verse to type into. */
export function sectionsToEditorJSON(sections: SectionV2[]): JSONContent {
  const content = sections.map((section) => sectionJSON(section));
  return { type: "doc", content: content.length > 0 ? content : [newSectionJSON("verse")] };
}

/**
 * The song as the editor holds it (issue #205): in the order it's sung -
 * each section where it's first sung, a linked copy wherever it's sung
 * again - then the sections not sung at all, under "Not in the song order".
 * A song with no order of its own sings each section once, in order.
 */
export function songToEditorJSON(sections: SectionV2[], flow: SectionInstance[]): JSONContent {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const passes = flow.filter((item) => byId.has(item.sectionId));
  if (passes.length === 0) return { type: "doc", content: sections.length > 0 ? sections.map((section) => sectionJSON(section, { passId: flowItemId(section.id) })) : [newSectionJSON("verse")] };
  const seen = new Set<string>();
  const content: JSONContent[] = [];
  let head: SectionInstance | null = null;
  for (const item of passes) {
    // Sung again straight after, the same way: a repeat of the block before (×2), not a block of its own.
    if (head && repeatsPass(head, item)) {
      (content.at(-1)!.attrs!.repeats as string[]).push(item.id);
      continue;
    }
    head = item;
    if (seen.has(item.sectionId)) content.push({ type: "linked", attrs: { passId: item.id, sectionId: item.sectionId, repeats: [] } });
    else {
      seen.add(item.sectionId);
      content.push(sectionJSON(byId.get(item.sectionId)!, { passId: item.id }));
    }
  }
  for (const section of sections) if (!seen.has(section.id)) content.push(sectionJSON(section, { sung: false }));
  return { type: "doc", content };
}

/**
 * The song's sections and order from the editor (issue #205): the sections
 * in the order they appear, and the order they're sung in - each sung
 * section and linked copy a pass, keeping what `previous` had for it (its
 * label, key change, note, its own changes).
 */
export function editorToSong(doc: PMNode, previous: SectionInstance[]): { sections: SectionV2[]; flow: SectionInstance[] } {
  const sections = editorToSections(doc);
  const kept = new Set(sections.map((section) => section.id));
  const before = new Map(previous.map((item) => [item.id, item]));
  const flow: SectionInstance[] = [];
  doc.forEach((node) => {
    if (node.type.name === "section") {
      if (node.attrs.sung === false || !kept.has(node.attrs.id as string)) return;
      const id = (node.attrs.passId as string | null) ?? flowItemId(node.attrs.id as string);
      const head: SectionInstance = { ...(before.get(id) ?? {}), id, sectionId: node.attrs.id as string };
      flow.push(head, ...repeatPasses(head, node.attrs.repeats as string[] | null, before));
    } else if (node.type.name === "linked") {
      const sectionId = node.attrs.sectionId as string;
      if (!kept.has(sectionId) || !flow.some((item) => item.sectionId === sectionId)) return;
      const id = node.attrs.passId as string;
      const head: SectionInstance = { ...(before.get(id) ?? {}), id, sectionId };
      flow.push(head, ...repeatPasses(head, node.attrs.repeats as string[] | null, before));
    }
  });
  return { sections, flow };
}

/*
 * Repeats (a section sung again straight after, "×2"): one block in the
 * editor, a pass each in the song's order, as every player reads it. The
 * block's first pass leads; the others are sung as it is (transposed, its
 * own words and chords, its tempo), without its key change or its note,
 * which happen once. A pass that's sung differently is a block of its own.
 */

/** What a pass sings, to compare: all but its place, its name, its key change and its note. */
function sungAs(item: SectionInstance): string {
  return JSON.stringify([
    item.transpose || null,
    item.tempo ?? null,
    item.timeSignature ?? null,
    item.chords?.length ? item.chords : null,
    item.hiddenLines?.length ? item.hiddenLines : null,
    item.lyrics?.length ? item.lyrics : null,
  ]);
}

/** Whether `next`, straight after `head`, is a repeat of it: the same section, sung the same, nothing of its own to say. */
export function repeatsPass(head: SectionInstance, next: SectionInstance): boolean {
  return (
    next.sectionId === head.sectionId &&
    !next.keyChange &&
    !next.note?.trim() &&
    (next.label == null || next.label === head.label) &&
    sungAs(next) === sungAs(head)
  );
}

/** The passes of a block's repeats (`ids`), sung as its first pass `head`; each keeps its name if it had one. */
export function repeatPasses(head: SectionInstance, ids: string[] | null | undefined, before: Map<string, SectionInstance>): SectionInstance[] {
  if (!ids?.length) return [];
  const sung: Partial<SectionInstance> = { ...head };
  for (const own of ["id", "sectionId", "label", "keyChange", "note"] as const) delete sung[own];
  return ids.map((id) => {
    const label = before.get(id)?.label;
    return { ...sung, id, sectionId: head.sectionId, ...(label != null && { label }) };
  });
}

/** The order with each block's repeats sung as its first pass again (after that pass changed by itself: transposed, say). */
export function followRepeats(doc: PMNode, flow: SectionInstance[]): SectionInstance[] {
  const byId = new Map(flow.map((item) => [item.id, item]));
  const follow = new Map<string, SectionInstance>();
  doc.forEach((node) => {
    const ids = node.attrs.repeats as string[] | null | undefined;
    const passId = (node.attrs.passId as string | null) ?? (node.type.name === "section" ? flowItemId(node.attrs.id as string) : null);
    const head = passId ? byId.get(passId) : undefined;
    if (head && ids?.length) for (const pass of repeatPasses(head, ids, byId)) follow.set(pass.id, pass);
  });
  return follow.size === 0 ? flow : flow.map((item) => follow.get(item.id) ?? item);
}

/** The same passes in the same order (what the editor's blocks are), whatever else they say. */
export function sameOrder(a: SectionInstance[], b: SectionInstance[]): boolean {
  return a.length === b.length && a.every((item, i) => item.id === b[i]!.id && item.sectionId === b[i]!.sectionId);
}

export function lineFromNode(node: PMNode): LineV2 {
  let text = "";
  const chords: LineV2["chords"] = [];
  node.forEach((child) => {
    if (child.isText) text += child.text;
    else if (child.type.name === "chord") chords.push({ id: child.attrs.id as string, raw: (child.attrs.raw as string).trim(), at: text.length });
  });
  // A chord typed inside a character written as several code units (an emoji, an accented letter) sits before it.
  const boundaries = characterBoundaries(text);
  for (const chord of chords) {
    while (!boundaries.has(chord.at)) chord.at--;
  }
  const kind = node.attrs.kind === "note" && chords.length === 0 ? "note" : "lyric";
  return { id: node.attrs.id as string, kind, text, chords };
}

/** A line's bar lines (issue #238): where each stands in its text, among its chords. */
function barLinesOf(node: PMNode): BarLine[] {
  const marks: BarLine[] = [];
  let at = 0;
  let chords = 0;
  node.forEach((child) => {
    if (child.isText) at += child.text!.length;
    else if (child.type.name === "chord") chords++;
    else if (child.type.name === "barLine") marks.push({ at, chordsBefore: chords, bars: (child.attrs.bars as number) ?? 1, ...(child.attrs.cues ? { cues: child.attrs.cues as (string | null)[] } : {}) });
  });
  return marks;
}

/**
 * Where a bar line at character `at`, after `chordsBefore` of its chords,
 * goes in the line `node` (at `linePos`): a document position.
 */
export function linePosition(node: PMNode, linePos: number, at: number, chordsBefore: number): number {
  let text = 0;
  let chords = 0;
  let found: number | null = null;
  node.forEach((child, offset) => {
    if (found !== null) return;
    const pos = linePos + 1 + offset;
    if (child.isText) {
      const length = child.text!.length;
      if (text === at && chords >= chordsBefore) found = pos;
      else if (at > text && at < text + length) found = pos + (at - text);
      text += length;
    } else if (child.type.name === "chord") {
      if (text === at && chords >= chordsBefore) found = pos;
      else chords++;
    }
  });
  return found ?? linePos + node.nodeSize - 1;
}

const isBlank = (line: LineV2) => !line.text.trim() && line.chords.length === 0;

/**
 * The sections the editor holds. Empty lines at the end of a section (an
 * Enter too many) and sections with nothing in them are left out.
 */
export function editorToSections(doc: PMNode): SectionV2[] {
  const sections: SectionV2[] = [];
  doc.forEach((node) => {
    const section = sectionFromNode(node, (doc.attrs.beats as number | undefined) ?? 4);
    if (section) sections.push(section);
  });
  return sections;
}

/** A section block of the editor as the song will have it; null for one with nothing in it. `beats`: a bar's, by default. */
export function sectionFromNode(node: PMNode, beats = 4): SectionV2 | null {
  if (node.type.name !== "section") return null;
  const lines: LineV2[] = [];
  const marks: SectionBarLines = {};
  node.forEach((child) => {
    const line = lineFromNode(child);
    lines.push(line);
    const bars = barLinesOf(child);
    if (bars.length > 0 && line.kind !== "note") marks[line.id] = bars;
  });
  while (lines.length > 0 && isBlank(lines.at(-1)!) && !marks[lines.at(-1)!.id]) lines.pop();
  if (lines.length === 0 && !node.attrs.label) return null;
  // Its rhythm from its bar lines (issue #238): as loaded while they're where they were (its own beats kept), else worked out again,
  // the beats and bar lengths placed in the chord grid kept where their bars are unchanged.
  const loaded = (node.attrs.rhythm as SectionV2["rhythm"]) ?? null;
  const before = loaded ? barLinesFromRhythm({ lines, rhythm: loaded }) : null;
  const unchanged = !!before && lines.every((line) => JSON.stringify(before[line.id] ?? []) === JSON.stringify(marks[line.id] ?? []));
  const rhythm = unchanged ? loaded : keepPlacedBeats(loaded, rhythmFromBarLines({ lines }, marks, beats));
  return {
    id: node.attrs.id as string,
    type: node.attrs.type as SectionType,
    label: (node.attrs.label as string | null)?.trim() || null,
    showLabel: node.attrs.showLabel !== false,
    lines,
    rhythm,
    groove: node.attrs.groove ?? null,
  };
}

/**
 * Where each beat of a section's bars is sung (issue #238), as the chord
 * grid places them (`barBeatPlaces`): the section as the only pass of a
 * chart. Its bars are its rhythm's, one for one; none without one.
 */
export function sectionBeatPlaces(section: SectionV2, beats = 4) {
  if (!section.rhythm || section.rhythm.bars.length === 0) return null;
  const pass = {
    id: section.id,
    section: { id: section.id },
    lines: section.lines.map((line) => ({ id: line.id, kind: line.kind, text: line.text, chords: line.chords.map((chord) => ({ id: chord.id, at: chord.at })) })),
    timeSignature: null,
    tempo: null,
  };
  const chart = { passes: [pass], timeSignature: { numerator: beats, denominator: 4 } } as unknown as RenderedChart;
  const bars = chartBars(chart, { sections: [section] });
  return { chart, bars, places: barBeatPlaces(chart, bars) };
}

/** Sections in one canonical shape, so two copies of the same chart compare equal however they were built. */
export function sameSections(a: SectionV2[], b: SectionV2[]): boolean {
  const canonical = (sections: SectionV2[]) =>
    JSON.stringify(
      sections.map((section) => [
        section.id,
        section.type,
        section.label ?? null,
        section.showLabel !== false,
        section.rhythm ?? null,
        section.groove ?? null,
        section.lines.map((line) => [line.id, line.kind ?? "lyric", line.text, line.chords.map((chord) => [chord.id, chord.at, chord.raw])]),
      ]),
    );
  return canonical(a) === canonical(b);
}

/** The same order, passes and all, however it was built. */
export function sameFlow(a: SectionInstance[], b: SectionInstance[]): boolean {
  const canonical = (flow: SectionInstance[]) =>
    JSON.stringify(
      flow.map((item) => [
        item.id,
        item.sectionId,
        item.label ?? null,
        item.keyChange ? [item.keyChange.steps, item.keyChange.key] : null,
        item.tempo ?? null,
        item.timeSignature ?? null,
        item.note ?? null,
      ]),
    );
  return canonical(a) === canonical(b);
}

/** A section's number among those of its type, as the editor has them written (issue #344): null when it's the only one. */
export function sectionNumberIn(doc: PMNode, sectionId: string): number | null {
  const sections: { id: string; type: string }[] = [];
  doc.forEach((node) => {
    if (node.type.name === "section") sections.push({ id: node.attrs.id as string, type: node.attrs.type as string });
  });
  return sectionNumbers(sections as { id: string; type: SectionV2["type"] }[]).get(sectionId) ?? null;
}
