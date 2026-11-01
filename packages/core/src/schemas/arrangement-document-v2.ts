import { PLAYBACK_SOURCES } from "../playback/index.js";
import "../zod-config.js";
import { z } from "zod";
import {
  ChordV2Schema,
  LineV2Schema,
  SectionInstanceSchema,
  chordPositionProblem,
  collectSongDocumentV2Ids,
  type SongDocumentV2,
} from "./song-document-v2.js";
import { TimeSignatureSchema } from "./shared.js";

/**
 * ArrangementDocument v2 - how a song is played: the order of its sections,
 * and what differs from the song on each pass. See
 * docs/arrangement-document-v2.md.
 *
 * Everything here is written in the song's own key. The arrangement's
 * `transposeSteps` and any key changes are applied afterwards, to the song's
 * chords and these alike.
 */

export const ArrangementDefaultsV2Schema = z.object({
  /** Semitones from the song's key (negative = down); the arrangement's key follows from it. */
  transposeSteps: z.number().int().min(-11).max(11).default(0),
  tempo: z.number().positive().max(400).nullable().optional(),
  timeSignature: TimeSignatureSchema.nullable().optional(),
  /** Capo fret for guitars. Display only: chords are stored at concert pitch. */
  capo: z.number().int().min(0).max(11).nullable().optional(),
  /** Tuning preset slug ("dadgad", "drop_d"...); null is standard tuning. */
  guitarTuning: z.string().max(40).nullable().optional(),
  /** Open strings low to high, set alongside guitarTuning. */
  guitarTuningNotes: z.array(z.string().max(3)).max(12).nullable().optional(),
});
export type ArrangementDefaultsV2 = z.infer<typeof ArrangementDefaultsV2Schema>;

/** Replace a chord on this pass. */
const ChordOverride = z.object({ type: z.literal("chord"), chordId: z.string().min(1), raw: z.string().trim().min(1).max(64) });
/** Leave a chord out on this pass (for everyone playing the arrangement). */
const HideChordOverride = z.object({ type: z.literal("hide_chord"), chordId: z.string().min(1) });
/**
 * Different words on this pass. The line's chords stay (same IDs); give
 * `chordPositions` for any that move, the rest keep their place (pulled in
 * to the end of a shorter line).
 */
const LyricOverride = z.object({
  type: z.literal("lyric"),
  lineId: z.string().min(1),
  text: z.string().max(2000),
  chordPositions: z.record(z.string(), z.number().int().nonnegative()).optional(),
});
const HideLineOverride = z.object({ type: z.literal("hide_line"), lineId: z.string().min(1) });
/** An extra line on this pass; its IDs start with "ins_" and belong to this arrangement. */
const InsertLineOverride = z.object({
  type: z.literal("insert_line"),
  /** Null inserts before the first line. */
  afterLineId: z.string().min(1).nullable(),
  line: LineV2Schema,
});
const PerformanceNoteOverride = z.object({ type: z.literal("performance_note"), lineId: z.string().min(1), note: z.string().min(1).max(500) });

export const OverrideV2Schema = z.discriminatedUnion("type", [
  ChordOverride,
  HideChordOverride,
  LyricOverride,
  HideLineOverride,
  InsertLineOverride,
  PerformanceNoteOverride,
]);
export type OverrideV2 = z.infer<typeof OverrideV2Schema>;

export const ArrangementItemV2Schema = SectionInstanceSchema.extend({
  overrides: z.array(OverrideV2Schema).max(200).default([]),
  /** How long this pass lasts, for autoscroll. */
  durationSeconds: z.number().positive().nullable().optional(),
});
export type ArrangementItemV2 = z.infer<typeof ArrangementItemV2Schema>;

export const ArrangementDocumentV2Schema = z.object({
  $schema: z.literal("arrangement-document/v2"),
  songVersionId: z.string().min(1),
  /** The song revision this arrangement was last checked against; a newer song means "review what changed". */
  songRevision: z.number().int().nonnegative(),
  defaults: ArrangementDefaultsV2Schema,
  items: z.array(ArrangementItemV2Schema).max(200),
});
export type ArrangementDocumentV2 = z.infer<typeof ArrangementDocumentV2Schema>;

export function parseArrangementDocumentV2(input: unknown): ArrangementDocumentV2 {
  return ArrangementDocumentV2Schema.parse(input);
}

export function safeParseArrangementDocumentV2(input: unknown) {
  return ArrangementDocumentV2Schema.safeParse(input);
}

/**
 * The arrangement's references that don't resolve in `song`, and lyric
 * overrides whose chord positions no longer fit. Shown to the arrangement's
 * owner as "review": never silently dropped.
 */
export function findArrangementProblems(arrangement: ArrangementDocumentV2, song: SongDocumentV2): string[] {
  const { sectionIds, lineIds, chordIds } = collectSongDocumentV2Ids(song);
  const problems: string[] = [];
  for (const item of arrangement.items) {
    const where = `item ${item.id}`;
    if (!sectionIds.has(item.sectionId)) problems.push(`${where}: section ${item.sectionId} not found`);
    const insertedChords = new Set(
      item.overrides.flatMap((override) => (override.type === "insert_line" ? override.line.chords.map((chord) => chord.id) : [])),
    );
    // A line added after another added line (earlier in the pass) follows it.
    const insertedLines = new Set<string>();
    // A note can go on any line added on the pass.
    const addedLines = new Set(item.overrides.flatMap((override) => (override.type === "insert_line" ? [override.line.id] : [])));
    for (const override of item.overrides) {
      switch (override.type) {
        case "chord":
        case "hide_chord":
          if (!chordIds.has(override.chordId) && !insertedChords.has(override.chordId)) {
            problems.push(`${where}: chord ${override.chordId} not found`);
          }
          break;
        case "hide_line":
          if (!lineIds.has(override.lineId)) problems.push(`${where}: line ${override.lineId} not found`);
          break;
        case "performance_note":
          if (!lineIds.has(override.lineId) && !addedLines.has(override.lineId)) problems.push(`${where}: line ${override.lineId} not found`);
          break;
        case "insert_line":
          if (override.afterLineId && !lineIds.has(override.afterLineId) && !insertedLines.has(override.afterLineId)) {
            problems.push(`${where}: line ${override.afterLineId} not found`);
          }
          insertedLines.add(override.line.id);
          break;
        case "lyric": {
          const line = lineIds.get(override.lineId);
          if (!line) {
            problems.push(`${where}: line ${override.lineId} not found`);
            break;
          }
          const chords = placeChords(line.chords, override.text, override.chordPositions);
          const problem = chordPositionProblem(override.text, chords);
          if (problem) problems.push(`${where}: lyric override on ${override.lineId}: ${problem.message}`);
          break;
        }
      }
    }
  }
  return problems;
}

/** A line's chords over replacement words: moved where `positions` says, otherwise kept in place (within the line). */
export function placeChords<T extends Pick<z.infer<typeof ChordV2Schema>, "id" | "at">>(
  chords: T[],
  text: string,
  positions: Record<string, number> = {},
): T[] {
  return chords
    .map((chord) => ({ ...chord, at: Math.min(positions[chord.id] ?? chord.at, text.length) }))
    .sort((a, b) => a.at - b.at);
}

/**
 * A player's own view of a chart - kept per user, per arrangement (or per
 * song without one), never shared and never changing the arrangement.
 * See docs/arrangement-document-v2.md, "Personal chart preferences".
 */
export const ChartPreferencesSchema = z.object({
  $schema: z.literal("chart-preferences/v1"),
  /** Chords this player doesn't want to see (song or inserted chord IDs). */
  hiddenChordIds: z.array(z.string().min(1)).max(2000).default([]),
  /** Show every chord as its basic triad (Gmaj7 -> G). */
  simplifyChords: z.boolean().default(false),
  /** Drop slash-chord bass notes (D/F# -> D). */
  hideBassNotes: z.boolean().default(false),
  /** How the song reads in Live and Practice (issue #155): its chart, its chords in bars (issue #238) or a PDF; left out, the player's default (User.liveView). */
  view: z.enum(["CHART", "GRID", "PDF"]).optional(),
  /** Which of the song's PDFs, with the PDF view; left out, its first. */
  pdfId: z.string().min(1).max(64).optional(),
  /** What plays with the song (issue #366): left out, what it has decides (defaultPlaybackSource). */
  playback: z.enum(PLAYBACK_SOURCES).optional(),
});
export type ChartPreferences = z.infer<typeof ChartPreferencesSchema>;
