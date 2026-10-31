import type { SectionType } from "../constants/index.js";
import type { SongDocumentV2 } from "../schemas/song-document-v2.js";
import { structureGroupOf, type StructureGroup } from "../song-document/structure.js";
import { sectionNumbers } from "../song-document/section-names.js";

/**
 * Cue points (issue #110): where each section starts in a recording -
 * "Intro 0:00, Verse 1 0:12.4, Chorus 0:41.0…". Kept with a multitrack's
 * files (the same on each, like its key and tempo), in the recording's own
 * order: they describe the audio, which may sing a chorus once more than
 * the song's order does. Each points at a section by its ID, so it
 * survives edits to the song.
 */
export interface CuePoint {
  /** Seconds from the recording's 0:00. */
  at: number;
  sectionId: string;
}

/** A section as cue points name it: V1, C, B… in the structure bar's colours. */
export interface CueSection {
  id: string;
  type: SectionType;
  /** Its own label ("Tag"), if it has one. */
  label: string | null;
  /** Verse 1, verse 2…: which of its type, when the song has several; null when it has one. */
  number: number | null;
  group: StructureGroup;
}

/** The song's sections for cue points, and the order it's sung in (section IDs): what to place, and in which order by default. */
export function cueSectionsOf(doc: Pick<SongDocumentV2, "sections" | "flow">): { sections: CueSection[]; flow: string[] } {
  const flow = doc.flow.map((pass) => pass.sectionId).filter((id) => doc.sections.some((section) => section.id === id));
  // In the order they're first sung, then any never sung; numbered as everywhere, by where they're written (issue #344).
  const order = [...new Set([...flow, ...doc.sections.map((section) => section.id)])];
  const numbers = sectionNumbers(doc.sections);
  const sections = order.map((id) => {
    const section = doc.sections.find((candidate) => candidate.id === id)!;
    return { id, type: section.type as SectionType, label: section.label ?? null, number: numbers.get(id) ?? null, group: structureGroupOf(section.type as SectionType) };
  });
  return { sections, flow };
}

/** Cue points in time order, only those of sections the song still has. */
export function sortedCues(cues: CuePoint[] | null | undefined, sections: Pick<CueSection, "id">[]): CuePoint[] {
  return (cues ?? []).filter((cue) => sections.some((section) => section.id === cue.sectionId)).sort((a, b) => a.at - b.at);
}

/** The cue point playing at `position` (s): the last one started; null before the first. */
export function cueAt(cues: CuePoint[], position: number): number | null {
  let found: number | null = null;
  cues.forEach((cue, index) => {
    if (cue.at <= position + 1e-6) found = index;
  });
  return found;
}

/**
 * The section to place next when tapping along (issue #110): the one after
 * the last placed in the song's order, counting how many times each has
 * been placed - so a recording that sings the order through gets it in
 * order. Past the end of the order, the last section again.
 */
export function nextCueSection(flow: string[], placed: CuePoint[]): string | null {
  if (flow.length === 0) return null;
  return flow[Math.min(placed.length, flow.length - 1)] ?? null;
}

/** A time snapped to the nearest beat of a recording with a tempo (its first beat at `firstBeat`); never before 0. */
export function snapToBeat(at: number, beat: { tempo: number; firstBeat: number } | null): number {
  if (!beat || beat.tempo <= 0) return Math.max(0, at);
  const length = 60 / beat.tempo;
  return Math.max(0, beat.firstBeat + Math.round((at - beat.firstBeat) / length) * length);
}

/** A section of a recording as an analyser labels it (issue #175): where it starts, and what kind it seems. */
export interface AnalysedSection {
  start: number;
  label: string;
}

/** The kinds of the song's sections an analyser's label can be ("inst" and "solo" as All-In-One says). */
const LABEL_TYPES: Record<string, readonly SectionType[]> = {
  intro: ["intro"],
  verse: ["verse", "pre-chorus"],
  "pre-chorus": ["pre-chorus", "verse"],
  prechorus: ["pre-chorus", "verse"],
  chorus: ["chorus", "post-chorus"],
  bridge: ["bridge", "vamp"],
  inst: ["instrumental", "interlude", "breakdown"],
  instrumental: ["instrumental", "interlude", "breakdown"],
  solo: ["instrumental", "interlude"],
  break: ["breakdown", "interlude", "instrumental"],
  interlude: ["interlude", "instrumental"],
  outro: ["outro", "tag"],
  tag: ["tag", "outro"],
};

/**
 * Cue points from an analyser's sections (issue #175): each label matched,
 * in order, to the next pass of the song's flow of that kind - so "verse,
 * chorus, verse, chorus" lands on verse 1, the chorus, verse 2, the chorus.
 * A label the flow has no more of (a chorus sung once more than written)
 * takes the last section of that kind already placed, else the first in the
 * song - two choruses in a row are two cues. Labels it can't place
 * ("start", "end", one the song has no section of) are left out.
 */
export function cuesFromSections(found: AnalysedSection[], doc: Pick<SongDocumentV2, "sections" | "flow">): CuePoint[] {
  const typeOf = new Map(doc.sections.map((section) => [section.id, section.type as SectionType]));
  const flow = (doc.flow.length > 0 ? doc.flow.map((pass) => pass.sectionId) : doc.sections.map((section) => section.id)).filter((id) => typeOf.has(id));
  const cues: CuePoint[] = [];
  let next = 0;
  const lastOfType = new Map<SectionType, string>();
  for (const segment of [...found].sort((a, b) => a.start - b.start)) {
    const types = LABEL_TYPES[segment.label.trim().toLowerCase()];
    if (!types || !Number.isFinite(segment.start) || segment.start < 0) continue;
    let sectionId: string | undefined;
    const ahead = flow.findIndex((id, index) => index >= next && types.includes(typeOf.get(id)!));
    if (ahead >= 0) {
      sectionId = flow[ahead];
      next = ahead + 1;
    } else {
      sectionId = types.map((type) => lastOfType.get(type)).find(Boolean) ?? doc.sections.find((section) => types.includes(section.type as SectionType))?.id;
    }
    if (!sectionId) continue;
    lastOfType.set(typeOf.get(sectionId)!, sectionId);
    cues.push({ at: Math.round(segment.start * 100) / 100, sectionId });
  }
  return cues;
}
