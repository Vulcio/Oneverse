import { bestRepeat, repeatPass, type RepeatMatch } from "./repeats.js";
import type { SupportedImportFormat } from "../constants/index.js";
import { passChanged, passLines } from "./pass.js";
import { parseSongText } from "../import-detection/detect-format.js";
import { sectionHeading } from "../chordpro/section-labels.js";
import { transposeChord } from "../chords/chord.js";
import { generateId, ID_PREFIXES } from "../ids/index.js";
import { parseKey } from "../music-keys/transpose.js";
import { parsedSectionsToV2 } from "../schemas/parsed-song.js";
import {
  flowItemId,
  parseSongDocumentV2,
  type SectionInstance,
  type SectionV2,
  type SongDefaultsV2,
  type SongDocumentV2,
} from "../schemas/song-document-v2.js";
import { reconcileFlow, reconcileSections } from "./reconcile.js";
import { withoutPlainLabels } from "./section-names.js";

// A ChordPro comment ("{comment: x2}") is a note line for the band. The import
// parsers have no notes, so each goes through it marked, with its brackets
// hidden so they aren't read as chords, and is turned back afterwards.
const COMMENT_LINE = /^\s*\{\s*(?:comment|c|comment_italic|ci|comment_box|cb)\s*:\s*(.*?)\s*\}\s*$/i;
const NOTE_MARK = "\u2063note\u2063";
const OPEN = "\uE000";
const CLOSE = "\uE001";

// "{chorus}" (or "{chorus: Final chorus}") sings the last chorus again, and
// "{key: A}" after the first changes key from there on. Each goes through the
// parser as a section of its own holding just a marker, and becomes part of
// the flow afterwards.
const REPEAT_CHORUS = /^\s*\{\s*chorus\s*(?::\s*(.*?)\s*)?\}\s*$/i;
const KEY_LINE = /^\s*\{\s*key\s*:\s*(.*?)\s*\}\s*$/i;
const BLOCK_START = /^\s*\{\s*(start_of_\w[\w-]*|so[vcbt])\b/i;
const BLOCK_END = /^\s*\{\s*(end_of_\w[\w-]*|eo[vcbt])\b/i;
const REPEAT_MARK = "\u2063repeat\u2063";
const KEY_MARK = "\u2063key\u2063";

// Comments before the first section that aren't about the music: the
// song's copyright, and its address on the site it came from.
const COPYRIGHT_NOTE = /^(?:©|\(c\)\s|copyright\b)/i;
const ADDRESS_NOTE = /^(?:https?:\/\/|www\.)\S+/i;
// A comment saying the key changes, right after the "{key: A}" that changes it.
const KEY_CHANGE_NOTE = /\b(?:key change|change of key|modulation|changement de (?:tonalit[ée]|ton)|cambio de (?:tonalidad|tono)|mudan[çc]a de tom|tonartwechsel)/iu;

/** A chart: its sections, each once, and the order they're sung in. */
export interface SongChart {
  sections: SectionV2[];
  flow: SectionInstance[];
  /** The key the text starts in ("{key: A}"), if it gives one. */
  key: string | null;
  /** A copyright line before the first section ("{comment: © 2020 …}"), if there is one. */
  copyright: string | null;
}

/**
 * The first line's "2. " dropped when it numbers a section headed "Verse 2" (or
 * a verse headed without a number), its chords moved with it.
 */
function withoutVerseNumber(section: SectionV2, number: string | null): void {
  const first = section.lines.find((line) => line.kind !== "note");
  const digits = number === null ? (section.type === "verse" ? "\\d+" : null) : number.match(/^\d+/)?.[0];
  if (!first || !digits) return;
  const prefix = new RegExp(`^${digits}[.)]\\s+`).exec(first.text)?.[0];
  if (!prefix) return;
  first.text = first.text.slice(prefix.length);
  first.chords = first.chords.map((chord) => ({ ...chord, at: Math.max(0, chord.at - prefix.length) }));
}

/** Semitones from one key to another, the shorter way (-5 to +6); null if either can't be read. */
function keySteps(from: string, to: string): number | null {
  const [a, b] = [parseKey(from), parseKey(to)];
  if (!a || !b) return null;
  const up = (((b.semitone - a.semitone) % 12) + 12) % 12;
  return up > 6 ? up - 12 : up;
}

const sameContent = (a: SectionV2, b: SectionV2) =>
  a.type === b.type &&
  JSON.stringify(a.lines.map((line) => [line.kind, line.text, line.chords.map((c) => [c.at, c.raw])])) ===
    JSON.stringify(b.lines.map((line) => [line.kind, line.text, line.chords.map((c) => [c.at, c.raw])]));

/**
 * Pasted or typed text (ChordPro, chords over lyrics, plain lyrics) as v2
 * sections with fresh IDs, and the order they're sung in: as written, plus
 * a pass for each ChordPro "{chorus}". Comments standing between sections
 * ("{comment: Softer}") become the note of the pass that follows, and a
 * "{key: A}" after the first a key change on it - with the sections written
 * after it (in the new key, as ChordPro does) stored back in the song's key,
 * and one that then matches an earlier section sung as that section again.
 * A comment that only names a section ("{comment: Verse 2}", "Refrain",
 * "Pont") sets the type and label of the section after it, and a "2. "
 * numbering its first line is dropped. Comments before the first section
 * give the song's copyright ("© …") or are its address on a site, left out;
 * one saying the key changes, right after a "{key}", is left out too.
 * `mergeRepeats` (importing a file): a section written out again is sung
 * as that section again rather than kept twice - as it was, moved up or
 * down, with a few chords of its own, or only its end (issue #231, see
 * matchRepeat).
 */
export function songFromText(text: string, format: SupportedImportFormat, options: { mergeRepeats?: boolean } = {}): SongChart {
  if (!text.trim()) return { sections: [], flow: [], key: null, copyright: null };
  const hide = (value: string) => value.replaceAll("[", OPEN).replaceAll("]", CLOSE);
  const unmark = (value: string) => value.replaceAll(OPEN, "[").replaceAll(CLOSE, "]");
  let marked = text;
  if (format === "CHORDPRO") {
    let inBlock = false;
    const marker = (mark: string, value: string) => (inBlock ? "" : `{start_of_other}\n${mark}${hide(value)}\n{end_of_other}`);
    marked = text
      .split(/\r\n|\r|\n/)
      .map((line) => {
        if (BLOCK_START.test(line)) inBlock = true;
        else if (BLOCK_END.test(line)) inBlock = false;
        const comment = COMMENT_LINE.exec(line);
        if (comment) return NOTE_MARK + hide(comment[1]!);
        const repeat = REPEAT_CHORUS.exec(line);
        if (repeat) return marker(REPEAT_MARK, repeat[1] ?? "");
        const key = KEY_LINE.exec(line);
        if (key) return marker(KEY_MARK, key[1]!);
        return line;
      })
      .join("\n");
  }

  const sections: SectionV2[] = [];
  const flow: SectionInstance[] = [];
  let lastChorus: SectionV2 | null = null;
  // Comments standing between sections: a cue for the pass that follows.
  let cue: SectionV2 | null = null;
  let songKey: string | null = null;
  let currentKey: string | null = null;
  let shift = 0;
  let keyChange: SectionInstance["keyChange"] = null;
  let copyright: string | null = null;
  // Just after a "{key}" line: a comment saying so is left out.
  let afterKey = false;
  // A comment naming the section that follows ("{comment: Verse 2}") is its heading, not part of its note.
  const takeHeading = () => {
    const found = cue ? sectionHeading(cue.lines[0]!.text) : null;
    if (!found) return null;
    const text = cue!.lines[0]!.text.trim().replace(/^\[\s*|\s*:?\s*\]?$/g, "");
    cue!.lines = cue!.lines.slice(1);
    if (cue!.lines.length === 0) cue = null;
    // A plain name ("Chorus", "Refrain") is shown in the reader's language; a numbered one as written.
    return { ...found, label: found.number ? text : null };
  };
  const pass = (item: SectionInstance): SectionInstance => {
    const note = cue ? cue.lines.map((line) => line.text).join(" / ").slice(0, 500) : null;
    const change = keyChange;
    cue = null;
    keyChange = null;
    return { ...item, ...(note && { note }), ...(change && { keyChange: change }) };
  };
  const addSection = (section: SectionV2) => {
    sections.push(section);
    flow.push({ id: flowItemId(section.id), sectionId: section.id });
  };

  for (const section of parsedSectionsToV2(parseSongText(marked, format))) {
    const only = section.lines.length === 1 ? section.lines[0]!.text : "";
    if (only.startsWith(KEY_MARK)) {
      const key = unmark(only.slice(KEY_MARK.length)).trim();
      afterKey = currentKey !== null;
      if (currentKey === null) {
        songKey = currentKey = key;
      } else {
        const steps = keySteps(currentKey, key);
        if (steps) {
          keyChange = { steps, key };
          shift += steps;
          currentKey = key;
        }
      }
      continue;
    }
    if (only.startsWith(REPEAT_MARK)) {
      const written = unmark(only.slice(REPEAT_MARK.length)).trim();
      const label = written || takeHeading()?.label;
      if (lastChorus) flow.push(pass({ id: generateId(ID_PREFIXES.flowItem), sectionId: lastChorus.id, ...(label && { label }) }));
      continue;
    }
    section.lines = section.lines.map((line) =>
      line.text.startsWith(NOTE_MARK) ? { ...line, kind: "note", text: unmark(line.text.slice(NOTE_MARK.length)), chords: [] } : line,
    );
    if (section.type === "other" && !section.label && section.lines.length > 0 && section.lines.every((line) => line.kind === "note")) {
      section.lines = section.lines.filter((line) => {
        if (!line.text.trim() || (afterKey && KEY_CHANGE_NOTE.test(line.text))) return false;
        if (sections.length > 0) return true;
        if (COPYRIGHT_NOTE.test(line.text.trim())) {
          copyright ??= line.text.trim();
          return false;
        }
        return !ADDRESS_NOTE.test(line.text.trim());
      });
      if (section.lines.length === 0) continue;
      // Two cues in a row: the first was a section of notes after all.
      if (cue) addSection(cue);
      cue = section;
      continue;
    }
    afterKey = false;
    const heading = takeHeading();
    if (heading) {
      section.type = heading.type;
      section.label ??= heading.label;
    }
    const named = heading ?? (section.label ? sectionHeading(section.label) : null);
    if (named) withoutVerseNumber(section, named.number);
    if (shift % 12 !== 0) {
      // Written in the key it's sung in: stored in the song's key.
      for (const line of section.lines) {
        line.chords = line.chords.map((chord) => ({ ...chord, raw: transposeChord(chord.raw, -shift, songKey) }));
      }
    }
    // Sung again (issue #231): as written, moved up or down, with a few chords of its own, or the end of it -
    // a pass of the earlier section; after a key change, only as written.
    const earlier = options.mergeRepeats
      ? bestRepeat(sections, section, songKey)
      : shift % 12 !== 0
        ? (() => {
            const same = sections.find((other) => sameContent(other, section));
            return same ? { of: same, match: { kind: "same" } as RepeatMatch } : null;
          })()
        : null;
    if (earlier) {
      flow.push(
        pass({
          id: generateId(ID_PREFIXES.flowItem),
          sectionId: earlier.of.id,
          ...(section.label && section.label !== earlier.of.label && { label: section.label }),
          ...repeatPass(earlier.match),
        }),
      );
      continue;
    }
    sections.push(section);
    flow.push(pass({ id: flowItemId(section.id), sectionId: section.id }));
    if (section.type === "chorus") lastChorus = section;
  }
  // Notes at the very end: nothing follows, so they stay a section.
  if (cue) addSection(cue);
  // Imported (issue #344): a "Verse 2" that only says what the name would is left out, so it's named by the rule, in the reader's language.
  if (options.mergeRepeats) return { ...withoutPlainLabels({ sections, flow }), key: songKey, copyright };
  return { sections, flow, key: songKey, copyright };
}

/** Pasted or typed text as v2 sections, with fresh IDs (see songFromText). */
export function sectionsFromText(text: string, format: SupportedImportFormat): SectionV2[] {
  return songFromText(text, format).sections;
}

/**
 * The song after its content was edited as text: the text parsed, IDs
 * kept from `previous` wherever the content is still there, and the
 * revision moved on. `content` undefined keeps the previous sections. The
 * flow follows the text when it repeats a section ("{chorus}"); otherwise
 * the previous flow keeps its shape (see reconcileFlow).
 */
export function songDocumentFromText(
  previous: SongDocumentV2 | null,
  change: { content?: string; format: SupportedImportFormat; defaults?: SongDefaultsV2; mergeRepeats?: boolean },
): SongDocumentV2 {
  const parsed = change.content === undefined ? null : songFromText(change.content, change.format, { mergeRepeats: change.mergeRepeats });
  const sections = parsed ? reconcileSections(previous?.sections ?? [], parsed.sections) : (previous?.sections ?? []);
  let flow: SectionInstance[];
  if (parsed && parsed.flow.length > parsed.sections.length) {
    // The reconciled sections line up with the parsed ones.
    const ids = new Map(parsed.sections.map((section, i) => [section.id, sections[i]!.id]));
    // A section's passes keep their IDs, in order (notes and arrangements point at them, issue #256).
    const before = new Map<string, string[]>();
    for (const item of previous?.flow ?? []) before.set(item.sectionId, [...(before.get(item.sectionId) ?? []), item.id]);
    const seen = new Map<string, number>();
    flow = parsed.flow.map((item) => {
      const sectionId = ids.get(item.sectionId)!;
      const n = seen.get(sectionId) ?? 0;
      seen.set(sectionId, n + 1);
      return { ...item, id: n === 0 ? flowItemId(sectionId) : (before.get(sectionId)?.[n] ?? item.id), sectionId };
    });
  } else {
    flow = reconcileFlow(previous, sections);
  }
  return parseSongDocumentV2({
    $schema: "song-document/v2",
    revision: (previous?.revision ?? 0) + 1,
    defaults: { ...(previous?.defaults ?? {}), ...(change.defaults ?? {}) },
    sections,
    flow,
  });
}

/**
 * The song after its sections (and/or its flow) were edited in the
 * structured editor, which keeps IDs itself: taken as they are - the flow
 * following the sections when it isn't given - and the revision moved on.
 */
export function songDocumentFromSections(
  previous: SongDocumentV2 | null,
  change: { sections?: SectionV2[]; flow?: SectionInstance[]; defaults?: SongDefaultsV2 },
): SongDocumentV2 {
  const sections = change.sections ?? previous?.sections ?? [];
  return parseSongDocumentV2({
    $schema: "song-document/v2",
    revision: (previous?.revision ?? 0) + 1,
    defaults: { ...(previous?.defaults ?? {}), ...(change.defaults ?? {}) },
    sections,
    flow: change.flow ?? reconcileFlow(previous, sections),
  });
}

/**
 * A stored song document, checked. Anything but SongDocument v2 throws,
 * naming the format it found.
 */
export function readSongDocument(json: unknown): SongDocumentV2 {
  const schema = (json as { $schema?: unknown } | null)?.$schema;
  if (schema !== "song-document/v2") throw new Error(`Not a SongDocument v2 (its $schema is ${JSON.stringify(schema ?? null)})`);
  return parseSongDocumentV2(json);
}


/** A line with its chords inline: "[G]Amazing grace how [G7]sweet". */
export function lineToInlineText(line: SectionV2["lines"][number]): string {
  if (line.kind === "note") return `{comment: ${line.text}}`;
  let text = "";
  let cursor = 0;
  for (const chord of line.chords) {
    text += line.text.slice(cursor, chord.at) + `[${chord.raw}]`;
    cursor = chord.at;
  }
  return text + line.text.slice(cursor);
}

/**
 * The chart as ChordPro, without the song's details: what the song editor
 * shows as text, and the body of a ChordPro export. Each section once, in
 * stored order. sectionsFromText() reads it back to the same sections
 * (with new IDs).
 */
export function sectionsToChordPro(sections: SectionV2[]): string {
  const lines: string[] = [];
  for (const section of sections) {
    // Every section as a {start_of_x} environment (ChordPro 6 allows any name), so its type and label read back.
    const environment = section.type.replace(/-/g, "_");
    lines.push(section.label ? `{start_of_${environment}: ${section.label}}` : `{start_of_${environment}}`);
    for (const line of section.lines) lines.push(lineToInlineText(line));
    lines.push(`{end_of_${environment}}`, "");
  }
  const text = lines.join("\n").trimEnd();
  return text ? text + "\n" : "";
}

/** The song's details a ChordPro export carries (they live in SongVersion columns, not the document). */
export interface ChordProDetails {
  title: string;
  subtitle?: string | null;
  artists?: string[];
  composers?: string[];
  lyricists?: string[];
  album?: string | null;
  year?: number | null;
  copyright?: string | null;
  ccli?: string | null;
  capo?: number | null;
}

/**
 * The chart in the order it's sung, as ChordPro: each section in full the
 * first time; a chorus sung again as "{chorus}", any other section written
 * out again. A key change is a "{key: A}" before its pass, and from there on
 * sections are written out in full in the new key (as other ChordPro apps
 * expect); a pass's note is a comment before it.
 */
export function flowToChordPro(doc: Pick<SongDocumentV2, "sections" | "flow">): string {
  if (doc.flow.length === 0) return sectionsToChordPro(doc.sections);
  const byId = new Map(doc.sections.map((section) => [section.id, section]));
  const seen = new Set<string>();
  const blocks: string[] = [];
  let shift = 0;
  let key: string | null = null;
  for (const item of doc.flow) {
    const section = byId.get(item.sectionId);
    if (!section) continue;
    const before: string[] = [];
    if (item.keyChange) {
      shift += item.keyChange.steps;
      key = item.keyChange.key;
      before.push(`{key: ${item.keyChange.key}}`);
    }
    if (item.note) before.push(`{comment: ${item.note}}`);
    const label = item.label ?? section.label ?? null;
    let body: string;
    // A pass with changes of its own (issue #205) is written out in full: ChordPro can't say "this chorus, but".
    const own = passChanged(item);
    if (!own && seen.has(section.id) && section.type === "chorus" && shift % 12 === 0) {
      body = label ? `{chorus: ${label}}` : "{chorus}";
    } else {
      const steps = shift + (item.transpose ?? 0);
      const lines = passLines(section, item).lines.map(({ replaced: _replaced, lyricChanged: _changed, ...line }) => ({
        ...line,
        chords: line.chords.map((chord) => ({ ...chord, raw: steps % 12 === 0 ? chord.raw : transposeChord(chord.raw, steps, key) })),
      }));
      body = sectionsToChordPro([{ ...section, label, lines }]).trimEnd();
    }
    seen.add(section.id);
    blocks.push([...before, body].join("\n"));
  }
  return blocks.join("\n\n") + "\n";
}

/** A ChordPro file for the song: its details as directives, then the chart in the order it's sung. */
export function songToChordPro(doc: SongDocumentV2, details: ChordProDetails): string {
  const header: string[] = [];
  const directive = (name: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && String(value).trim()) header.push(`{${name}: ${String(value).trim()}}`);
  };
  directive("title", details.title);
  directive("subtitle", details.subtitle);
  for (const artist of details.artists ?? []) directive("artist", artist);
  for (const composer of details.composers ?? []) directive("composer", composer);
  for (const lyricist of details.lyricists ?? []) directive("lyricist", lyricist);
  directive("album", details.album);
  directive("year", details.year);
  directive("copyright", details.copyright);
  directive("ccli", details.ccli);
  directive("key", doc.defaults.key);
  directive("tempo", doc.defaults.tempo);
  if (doc.defaults.timeSignature) directive("time", `${doc.defaults.timeSignature.numerator}/${doc.defaults.timeSignature.denominator}`);
  if (details.capo) directive("capo", details.capo);
  const body = doc.sections.length > 0 ? flowToChordPro(doc) : "";
  return [header.join("\n"), body].filter(Boolean).join("\n\n").trimEnd() + "\n";
}
