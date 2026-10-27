import "../zod-config.js";
import { z } from "zod";
import { SECTION_TYPES } from "../constants/index.js";
import { TimeSignatureSchema } from "./shared.js";

/**
 * SongDocument v2 - a song's music: its sections, lines, chords and timing.
 * See docs/song-document-v2.md for the full contract.
 *
 * What a song is called, who wrote it, its rights and identifiers are
 * SongVersion columns, never copied in here.
 */

/** How long a song's text can get before it's clearly not a song. */
export const SONG_DOCUMENT_LIMITS = {
  sections: 200,
  linesPerSection: 500,
  lineLength: 2000,
  chordsPerLine: 200,
  chordLength: 64,
  flowItems: 500,
} as const;

/**
 * A chord, pinned to a character of its line's text: `at` is the index
 * (UTF-16, as JavaScript counts) of the character it sits above - 0 for the
 * first, `text.length` for after the last. The symbol is kept exactly as
 * written; parseChord() reads it.
 */
export const ChordV2Schema = z.object({
  id: z.string().min(1),
  at: z.number().int().nonnegative(),
  raw: z.string().trim().min(1).max(SONG_DOCUMENT_LIMITS.chordLength),
});
export type ChordV2 = z.infer<typeof ChordV2Schema>;

export const LINE_KINDS = ["lyric", "note"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

/**
 * A line: lyrics (possibly empty, for a line of chords only) with its
 * chords, or a note for the band ("×2", "softly") with none.
 */
export const LineV2Schema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(LINE_KINDS).default("lyric"),
    text: z.string().max(SONG_DOCUMENT_LIMITS.lineLength),
    chords: z.array(ChordV2Schema).max(SONG_DOCUMENT_LIMITS.chordsPerLine).default([]),
  })
  .superRefine((line, ctx) => {
    if (line.kind === "note" && line.chords.length > 0) {
      ctx.addIssue({ code: "custom", path: ["chords"], message: "A note line has no chords" });
    }
    const problem = chordPositionProblem(line.text, line.chords);
    if (problem) ctx.addIssue({ code: "custom", path: ["chords", problem.index, "at"], message: problem.message });
  });
export type LineV2 = z.infer<typeof LineV2Schema>;

/** Where something is anchored in the lyrics: a character of a line. Used by timing, notes and annotations. */
export const LyricAnchorSchema = z.object({
  lineId: z.string().min(1),
  at: z.number().int().nonnegative(),
});
export type LyricAnchor = z.infer<typeof LyricAnchorSchema>;

/** A chord change on a beat of a bar. */
export const BarChordSchema = z.object({
  chordId: z.string().min(1),
  /** 1-based; may be fractional (2.5 = the "and" of 2). */
  beat: z.number().positive(),
});

export const BarSchema = z.object({
  /** Chord changes in this bar; none means the previous chord carries on. */
  chords: z.array(BarChordSchema).default([]),
  /** Where the lyrics are when the bar starts. */
  lyricAnchor: LyricAnchorSchema.nullable().optional(),
  cue: z.string().max(200).nullable().optional(),
  /** Its own length in beats, when it isn't the section's: a pickup, a 2/4 bar before the chorus. */
  beats: z.number().int().positive().max(32).nullable().optional(),
});

/** An optional bar-by-bar timing layer on a section; the lines stay the structure. */
export const RhythmSchema = z.object({
  /** Defaults to the time signature's top number. */
  beatsPerBar: z.number().int().positive().nullable().optional(),
  bars: z.array(BarSchema).max(512),
});
export type Rhythm = z.infer<typeof RhythmSchema>;

export const GrooveRefSchema = z.object({
  styleId: z.string().min(1),
  variant: z.string().min(1),
  tempoRelative: z.number().positive().default(1.0),
});
export type GrooveRef = z.infer<typeof GrooveRefSchema>;

export const SectionV2Schema = z.object({
  id: z.string().min(1),
  type: z.enum(SECTION_TYPES),
  /** Shown instead of the type's name ("Verse 2", "Tag"); null uses the type's name. */
  label: z.string().max(100).nullable().optional(),
  /** False hides the heading on the chart (the section is still one). */
  showLabel: z.boolean().default(true),
  lines: z.array(LineV2Schema).max(SONG_DOCUMENT_LIMITS.linesPerSection),
  rhythm: RhythmSchema.nullable().optional(),
  groove: GrooveRefSchema.nullable().optional(),
});
export type SectionV2 = z.infer<typeof SectionV2Schema>;

/**
 * A modulation, from this point on: `steps` semitones from the key in
 * effect before it (authoritative), and the new key as written.
 */
export const KeyChangeSchema = z.object({
  steps: z.number().int().min(-11).max(11).refine((steps) => steps !== 0, "A key change changes the key"),
  key: z.string().min(1).max(12),
});
export type KeyChange = z.infer<typeof KeyChangeSchema>;

/**
 * One time through a section, in the order it's sung. The song's own
 * `flow` and an arrangement's `items` share this shape, so one renderer and
 * one transport walk both.
 */
export const SectionInstanceSchema = z.object({
  id: z.string().min(1),
  sectionId: z.string().min(1),
  /** "Chorus 2", "Final chorus"; null uses the section's own label. */
  label: z.string().max(100).nullable().optional(),
  keyChange: KeyChangeSchema.nullable().optional(),
  tempo: z.number().positive().max(400).nullable().optional(),
  timeSignature: TimeSignatureSchema.nullable().optional(),
  /** For the band: "softer", "band re-enters bar 5". */
  note: z.string().max(500).nullable().optional(),
  /** This pass only, a few semitones up or down (issue #205); a key change carries on, this doesn't. */
  transpose: z.number().int().min(-11).max(11).nullable().optional(),
  /**
   * This pass's own chords (issue #205): each chord (by ID, so it survives
   * edits) becomes `raw`, written in the song's key, or is left out (null).
   */
  chords: z
    .array(z.object({ chordId: z.string().min(1), raw: z.string().trim().min(1).max(SONG_DOCUMENT_LIMITS.chordLength).nullable() }))
    .max(500)
    .optional(),
  /** Lines this pass leaves out (by ID, issue #205): the end of the chorus again, say. */
  hiddenLines: z.array(z.string().min(1)).max(SONG_DOCUMENT_LIMITS.linesPerSection).optional(),
  /** This pass's own words for some lines (issue #205): words removed or replaced, the chords following their words. */
  lyrics: z
    .array(z.object({ lineId: z.string().min(1), text: z.string().max(SONG_DOCUMENT_LIMITS.lineLength) }))
    .max(SONG_DOCUMENT_LIMITS.linesPerSection)
    .optional(),
});
export type SectionInstance = z.infer<typeof SectionInstanceSchema>;

export const SongDefaultsV2Schema = z.object({
  /** As written ("G", "Bb", "F#m"); parseKey() reads it. */
  key: z.string().max(12).nullable().optional(),
  tempo: z.number().positive().max(400).nullable().optional(),
  timeSignature: TimeSignatureSchema.nullable().optional(),
  durationSeconds: z.number().positive().nullable().optional(),
});
export type SongDefaultsV2 = z.infer<typeof SongDefaultsV2Schema>;

export const SongDocumentV2Schema = z
  .object({
    $schema: z.literal("song-document/v2"),
    /** Goes up by one on every saved change; arrangements and editors say which revision they worked from. */
    revision: z.number().int().nonnegative(),
    defaults: SongDefaultsV2Schema,
    sections: z.array(SectionV2Schema).max(SONG_DOCUMENT_LIMITS.sections),
    /** The order the song is sung in, each distinct section stored once. */
    flow: z.array(SectionInstanceSchema).max(SONG_DOCUMENT_LIMITS.flowItems),
  })
  .superRefine((doc, ctx) => {
    for (const issue of songDocumentIntegrityIssues(doc)) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  });
export type SongDocumentV2 = z.infer<typeof SongDocumentV2Schema>;

export function parseSongDocumentV2(input: unknown): SongDocumentV2 {
  return SongDocumentV2Schema.parse(input);
}

export function safeParseSongDocumentV2(input: unknown) {
  return SongDocumentV2Schema.safeParse(input);
}

/**
 * Chords must be in order along the line, and sit on a character boundary
 * (never inside an accented letter or emoji written as several code units).
 */
export function chordPositionProblem(text: string, chords: { at: number }[]): { index: number; message: string } | null {
  const boundaries = characterBoundaries(text);
  let previous = 0;
  for (const [index, chord] of chords.entries()) {
    if (chord.at > text.length) return { index, message: "The chord is past the end of the line" };
    if (chord.at < previous) return { index, message: "Chords must be in order along the line" };
    if (!boundaries.has(chord.at)) return { index, message: "The chord splits a character" };
    previous = chord.at;
  }
  return null;
}

/** Every index where a user-perceived character starts, plus the end of the text. */
export function characterBoundaries(text: string): Set<number> {
  const boundaries = new Set<number>([text.length]);
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    for (const { index } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) boundaries.add(index);
  } else {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0xdc00 || code > 0xdfff) boundaries.add(i);
    }
  }
  return boundaries;
}

/** IDs are unique across the whole document, and the flow only points at sections that exist. */
function songDocumentIntegrityIssues(doc: {
  sections: { id: string; lines: { id: string; chords: { id: string }[] }[]; rhythm?: Rhythm | null }[];
  flow: { id: string; sectionId: string }[];
}): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const seen = new Set<string>();
  const unique = (id: string, path: (string | number)[]) => {
    if (seen.has(id)) issues.push({ path, message: `Duplicate id ${id}` });
    seen.add(id);
  };
  const chordIds = new Set<string>();
  const lineIds = new Set<string>();
  doc.sections.forEach((section, s) => {
    unique(section.id, ["sections", s, "id"]);
    section.lines.forEach((line, l) => {
      unique(line.id, ["sections", s, "lines", l, "id"]);
      lineIds.add(line.id);
      line.chords.forEach((chord, c) => {
        unique(chord.id, ["sections", s, "lines", l, "chords", c, "id"]);
        chordIds.add(chord.id);
      });
    });
  });
  const sectionIds = new Set(doc.sections.map((section) => section.id));
  doc.flow.forEach((item, i) => {
    unique(item.id, ["flow", i, "id"]);
    if (!sectionIds.has(item.sectionId)) issues.push({ path: ["flow", i, "sectionId"], message: `No section ${item.sectionId}` });
  });
  doc.sections.forEach((section, s) => {
    section.rhythm?.bars.forEach((bar, b) => {
      bar.chords.forEach((event, e) => {
        if (!chordIds.has(event.chordId)) {
          issues.push({ path: ["sections", s, "rhythm", "bars", b, "chords", e, "chordId"], message: `No chord ${event.chordId}` });
        }
      });
      if (bar.lyricAnchor && !lineIds.has(bar.lyricAnchor.lineId)) {
        issues.push({ path: ["sections", s, "rhythm", "bars", b, "lyricAnchor"], message: `No line ${bar.lyricAnchor.lineId}` });
      }
    });
  });
  return issues;
}

/** Every stable ID in the document, for resolving references (arrangements, notes, annotations). */
export function collectSongDocumentV2Ids(doc: SongDocumentV2) {
  const sectionIds = new Set<string>();
  const lineIds = new Map<string, LineV2>();
  const chordIds = new Set<string>();
  for (const section of doc.sections) {
    sectionIds.add(section.id);
    for (const line of section.lines) {
      lineIds.set(line.id, line);
      for (const chord of line.chords) chordIds.add(chord.id);
    }
  }
  return { sectionIds, lineIds, chordIds };
}

/** A section's first flow item's ID derives from the section's, so building a flow twice gives the same one. */
export function flowItemId(sectionId: string): string {
  return `fi_${sectionId.replace(/^sec_/, "")}`;
}
