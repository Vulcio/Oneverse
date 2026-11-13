import type { CuePoint } from "./cues.js";
import { passLines } from "../song-document/pass.js";
import { NAMED_SECTION_TYPES, sectionNumbers } from "../song-document/section-names.js";
import { lineToInlineText } from "../song-document/text.js";
import type { SectionInstance, SongDocumentV2 } from "../schemas/song-document-v2.js";

/**
 * The song's words as the analysis server reads them (issue #450, Sonic
 * API 1.9): the chart in the order it's sung, one block per pass - its
 * name as a "{c: …}" heading, then its lines with their chords - so the
 * server knows which sections to expect and in what order, and places each
 * on the recording's bars. Names are in English and numbered as everywhere
 * ("Verse 2"), the words the server knows a section's kind by; a section
 * of no named kind goes by its label, else "Part n". `passes` lists, for
 * each block, the section it sings: the answer's `hint` is an index in it.
 */
export function lyricsForAnalysis(doc: Pick<SongDocumentV2, "sections" | "flow">): { text: string; passes: string[] } | null {
  const byId = new Map(doc.sections.map((section) => [section.id, section]));
  const order: SectionInstance[] = doc.flow.length > 0 ? doc.flow : doc.sections.map((section) => ({ id: section.id, sectionId: section.id }));
  const numbers = sectionNumbers(doc.sections);
  const blocks: string[] = [];
  const passes: string[] = [];
  for (const item of order) {
    const section = byId.get(item.sectionId);
    if (!section) continue;
    const kind = NAMED_SECTION_TYPES.has(section.type) ? englishName(section.type) : null;
    const number = numbers.get(section.id);
    // Its kind, not its label: passes of the same kind are expected to sound alike, and the label's words may be any.
    const name = kind ? (number ? `${kind} ${number}` : kind) : section.label || `Part ${doc.sections.indexOf(section) + 1}`;
    // As this pass sings it: its own words, lines it leaves out.
    const lines = passLines(section, item).lines.map((line) => lineToInlineText(line)).filter((line) => line.trim());
    blocks.push([`{c: ${name.replace(/[{}]/g, "")}}`, ...lines].join("\n"));
    passes.push(section.id);
  }
  if (passes.length === 0) return null;
  return { text: blocks.join("\n\n") + "\n", passes };
}

function englishName(type: string): string {
  return type
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("-");
}

/** A section the server placed from the song's words: where it starts, and which pass it is (its index in `passes`). */
export interface HintedSection {
  start: number;
  hint?: number;
}

/**
 * Cue points from the sections the server placed from the song's words
 * (issue #450): each section with a `hint` is that pass's section, where it
 * starts. Sections without one (a stretch the chart doesn't have) are left
 * out; an empty list when none has a hint, so the caller falls back to
 * cuesFromSections.
 */
export function cuesFromHints(found: readonly HintedSection[], passes: readonly string[], doc: Pick<SongDocumentV2, "sections">): CuePoint[] {
  const known = new Set(doc.sections.map((section) => section.id));
  const cues: CuePoint[] = [];
  for (const section of [...found].sort((a, b) => a.start - b.start)) {
    const hint = section.hint;
    if (typeof hint !== "number" || !Number.isInteger(hint) || hint < 0 || hint >= passes.length) continue;
    if (!Number.isFinite(section.start) || section.start < 0) continue;
    const sectionId = passes[hint]!;
    if (!known.has(sectionId)) continue;
    cues.push({ at: Math.round(section.start * 100) / 100, sectionId });
  }
  return cues;
}
