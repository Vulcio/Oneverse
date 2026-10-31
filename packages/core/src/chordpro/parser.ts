import type { ParsedSection } from "../schemas/parsed-song.js";
import type { Line, Segment } from "../schemas/shared.js";
import { SECTION_TYPES, type SectionType } from "../constants/index.js";
import { generateId, ID_PREFIXES } from "../ids/index.js";
import { LABEL_LINE, normalizeSectionType } from "./section-labels.js";
import { barNotationMarkup, readBarNotation } from "../chords-over-lyrics/bar-notation.js";

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
  start_of_tab: "instrumental",
  ...Object.fromEntries(SECTION_TYPES.flatMap((type) => [[`start_of_${type}`, type], [`start_of_${type.replace(/-/g, "_")}`, type]])),
};
const END_DIRECTIVES = new Set([
  "eov",
  "eoc",
  "eob",
  "eot",
  "end_of_tab",
  ...SECTION_TYPES.flatMap((type) => [`end_of_${type}`, `end_of_${type.replace(/-/g, "_")}`]),
]);

/** Splits one lyric line into segments at each `[Chord]` marker. Text
 * before the first chord (if any) becomes a chord-less leading segment.
 * Shared with the chords-over-lyrics parser, which overlays its own
 * chord-line tokens into this same `[Chord]lyric` markup first. */
export function parseLine(raw: string): Line {
  const segments: Segment[] = [];
  const re = /\[([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let pendingChord: string | null = null;

  const pushSegment = (lyric: string, chordRaw: string | null) => {
    if (lyric === "" && chordRaw === null) return;
    segments.push({
      id: generateId(ID_PREFIXES.segment),
      lyric,
      chord: chordRaw ? { id: generateId(ID_PREFIXES.chord), raw: chordRaw, normalized: null } : null,
    });
  };

  while ((match = re.exec(raw)) !== null) {
    const textBefore = raw.slice(lastIndex, match.index);
    pushSegment(textBefore, pendingChord);
    pendingChord = match[1] ?? null;
    lastIndex = re.lastIndex;
  }
  pushSegment(raw.slice(lastIndex), pendingChord);

  // A line with no chords and no lyric text at all (pure whitespace)
  // still needs one segment so the line renders as a blank spacer.
  if (segments.length === 0) segments.push({ id: generateId(ID_PREFIXES.segment), lyric: "", chord: null });

  return { id: generateId(ID_PREFIXES.line), segments };
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

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();

    const directiveMatch = /^\{([^:}]+)(?::\s*(.*))?\}$/.exec(line);
    if (directiveMatch) {
      const key = (directiveMatch[1] ?? "").trim().toLowerCase().replace(/\s+/g, "_");
      const sectionType = SECTION_DIRECTIVES[key];
      if (sectionType) {
        startSection(sectionType, directiveMatch[2]?.trim() || null);
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
    currentLines.push(parseLine(rawLine));
  }

  return sections;
}
