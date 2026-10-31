import type { SectionType } from "../constants/index.js";
import { sectionHeading } from "../chordpro/section-labels.js";
import type { SectionV2, SongDocumentV2 } from "../schemas/song-document-v2.js";

/**
 * How a song's sections are named (issue #344), the one rule every client
 * follows: a section's own label when it has one; else its type, in the
 * reader's language, numbered by where it's written only when the song
 * has more than one of that type - "Chorus" alone, "Chorus 1" and
 * "Chorus 2" when there are two. A pass sung again is named as the section
 * it sings, unless it has a label of its own. "Other" sections have no name.
 */

/** The section types named by their type when they have no label ("other" isn't). */
export const NAMED_SECTION_TYPES: ReadonlySet<string> = new Set<SectionType>(["intro", "verse", "pre-chorus", "chorus", "post-chorus", "bridge", "vamp", "breakdown", "instrumental", "interlude", "outro", "tag"]);

/** Each section's number among those of its type, in written order; null when it's the only one of its type. */
export function sectionNumbers(sections: readonly Pick<SectionV2, "id" | "type">[]): Map<string, number | null> {
  const ofType = new Map<string, string[]>();
  for (const section of sections) ofType.set(section.type, [...(ofType.get(section.type) ?? []), section.id]);
  return new Map(
    sections.map((section) => {
      const same = ofType.get(section.type)!;
      return [section.id, same.length > 1 ? same.indexOf(section.id) + 1 : null];
    }),
  );
}

/** The type's name in the reader's language ("Chorus", "Refrain"). */
export type SectionTypeName = (type: SectionType) => string;

/** A section's name: its label, else its type and number ("Verse 2"); null for an unlabelled "other". */
export function sectionName(section: { type: string; label?: string | null }, number: number | null | undefined, typeName: SectionTypeName): string | null {
  if (section.label) return section.label;
  if (!NAMED_SECTION_TYPES.has(section.type)) return null;
  const name = typeName(section.type as SectionType);
  return number ? `${name} ${number}` : name;
}

/** A pass's name: its own label, else the name of the section it sings. */
export function passName(pass: { label?: string | null }, section: { type: string; label?: string | null }, number: number | null | undefined, typeName: SectionTypeName): string | null {
  return pass.label || sectionName(section, number, typeName);
}

/**
 * Whether a label only says what the name already would: the section's
 * type ("Refrain" on a chorus, in any language songs come in) with no
 * number, or with the section's own number ("Verse 2" on the second
 * verse; "Chorus 1" on the only chorus). Such a label is left out, so the
 * name follows the rule and the reader's language. On a pass (`pass`),
 * any number goes when the section has none: "Chorus 2" is its second
 * time, still the song's one chorus.
 */
export function isPlainLabel(label: string, section: Pick<SectionV2, "type">, number: number | null, pass = false): boolean {
  const heading = sectionHeading(label);
  if (!heading || heading.type !== section.type || heading.type === "other") return false;
  if (heading.number === null) return true;
  if (!/^\d+$/.test(heading.number)) return false;
  const written = Number(heading.number);
  return number === null ? written === 1 || pass : written === number;
}

/** The document with the labels that only repeat their section's name left out (on import, issue #344). */
export function withoutPlainLabels<T extends Pick<SongDocumentV2, "sections" | "flow">>(doc: T): T {
  const numbers = sectionNumbers(doc.sections);
  const byId = new Map(doc.sections.map((section) => [section.id, section]));
  return {
    ...doc,
    sections: doc.sections.map((section) => (section.label && isPlainLabel(section.label, section, numbers.get(section.id) ?? null) ? { ...section, label: null } : section)),
    flow: doc.flow.map((item) => {
      const section = byId.get(item.sectionId);
      if (!item.label || !section) return item;
      // The label of the section it sings (as it was written) says nothing more either.
      if (item.label !== section.label && !isPlainLabel(item.label, section, numbers.get(section.id) ?? null, true)) return item;
      return Object.fromEntries(Object.entries(item).filter(([key]) => key !== "label")) as typeof item;
    }),
  };
}
