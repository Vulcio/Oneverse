import type { ParsedSection } from "../schemas/parsed-song.js";
import { SECTION_TYPES, type SectionType } from "../constants/index.js";
import { generateId, ID_PREFIXES } from "../ids/index.js";
import { LABEL_LINE, normalizeSectionType } from "./section-labels.js";
import { barNotationMarkup, readBarNotation } from "../chords-over-lyrics/bar-notation.js";
import { isChordLine, overlayChords } from "../chords-over-lyrics/parser.js";
import { parseLine } from "./line.js";

// Chords are kept as written (`raw`); `parseChord` in ../chords reads them
// when they're transposed or shown, so `normalized` stays null.

// ChordPro's standard short/long section directives - see
// https://www.chordpro.org/chordpro/directives-env/ - plus
// {start_of_x}/{end_of_x} for every other section type (ChordPro 6 allows
// any section name), which is how Songverse writes them.
const SECTION_DIRECTIVES: Record<string, SectionType> = {
  sov: "verse",
  soc: "chorus",
  sob: "bridge",
  sot: "instrumental",
  sog: "instrumental",
  start_of_tab: "instrumental",
  start_of_grid: "instrumental",
  ...Object.fromEntries(SECTION_TYPES.flatMap((type) => [[`start_of_${type}`, type], [`start_of_${type.replace(/-/g, "_")}`, type]])),
};
const END_DIRECTIVES = new Set([
  "eov",
  "eoc",
  "eob",
  "eot",
  "end_of_tab",
  "eog",
  "end_of_grid",
  ...SECTION_TYPES.flatMap((type) => [`end_of_${type}`, `end_of_${type.replace(/-/g, "_")}`]),
]);

// "{start_of_verse}", "{start_of_verse: Verse 1}", "{start_of_verse: label=\"Verse 1\"}",
// "{start_of_chorus label=\"Refrain\"}" (ChordPro 6's attributes).
const DIRECTIVE = /^\{([^:}]+)(?::\s*(.*))?\}$/;
const ATTRIBUTES = /^(\S+)\s+(\w+\s*=.*)$/;

/** A section directive's label: as written, or its `label="…"` attribute. */
function directiveLabel(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const attribute = /(?:^|\s)label\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i.exec(value);
  if (attribute) return (attribute[1] ?? attribute[2] ?? attribute[3] ?? "").trim() || null;
  return value.trim();
}

/**
 * Parses ChordPro-ish text into parsed sections (see schemas/parsed-song.ts). Supports the
 * standard {start_of_x}/{end_of_x} directives, plain-text section labels
 * ("Verse 1", "[Chorus]"), and falls back to one blank-line-separated
 * section per block when neither is present. Any other `{directive}`
 * line (title, key, tempo, comments, etc.) is silently skipped - those
 * map to the song's own metadata/defaults fields, entered separately.
 */
export function parseChordPro(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let explicitBlock = false;

  let currentLines: ParsedSection["lines"] = [];
  const startSection = (type: SectionType, label: string | null) => {
    currentLines = [];
    current = { id: generateId(ID_PREFIXES.section), type, label, lines: currentLines };
    sections.push(current);
  };
  const ensureSection = () => {
    if (!current) startSection("other", null);
  };

  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const line = rawLine.trim();
    // A line starting with "#" is a comment in the file, for whoever edits it.
    if (rawLine.startsWith("#")) continue;

    const directiveMatch = DIRECTIVE.exec(line);
    if (directiveMatch) {
      let name = (directiveMatch[1] ?? "").trim();
      let value = directiveMatch[2];
      const attributes = ATTRIBUTES.exec(name);
      if (attributes) [name, value] = [attributes[1]!, attributes[2]];
      const key = name.toLowerCase().replace(/\s+/g, "_");
      const sectionType = SECTION_DIRECTIVES[key];
      if (sectionType) {
        startSection(sectionType, directiveLabel(value));
        explicitBlock = true;
      } else if (END_DIRECTIVES.has(key)) {
        current = null;
        explicitBlock = false;
      }
      // other directives (title, key, tempo, comment, ...) are ignored here
      continue;
    }

    if (line === "") {
      // A blank line ends an implicit (label-detected) section, but not
      // an explicit {start_of_x}...{end_of_x} block, which only {end_of_x}
      // can close.
      if (!explicitBlock) current = null;
      continue;
    }

    const labelMatch = LABEL_LINE.exec(line);
    if (labelMatch && !explicitBlock) {
      startSection(normalizeSectionType(labelMatch[1] ?? ""), line);
      continue;
    }

    ensureSection();
    // Bars of chords, "| G | C | D | G |" or "| [G] | [C] |" (issue #344).
    const bars = readBarNotation(line);
    if (bars) {
      const barLine = parseLine(barNotationMarkup(bars));
      currentLines.push(barLine);
      (current!.bars ??= {})[barLine.id] = bars.bars;
      continue;
    }
    // Chords written above the words, as on chord sites, in a file saved as ChordPro.
    if (!line.includes("[") && isChordLine(line)) {
      const next = lines[i + 1];
      const nextTrimmed = next?.trim() ?? "";
      const nextIsLyric = next !== undefined && nextTrimmed !== "" && !nextTrimmed.includes("[") && !nextTrimmed.startsWith("{") && !isChordLine(nextTrimmed) && !LABEL_LINE.test(nextTrimmed);
      currentLines.push(parseLine(overlayChords(rawLine, nextIsLyric ? next : "")));
      if (nextIsLyric) i++;
      continue;
    }
    currentLines.push(parseLine(rawLine));
  }

  return sections;
}
