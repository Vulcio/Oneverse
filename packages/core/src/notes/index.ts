import "../zod-config.js";
import { z } from "zod";
import type { SongDocumentV2 } from "../schemas/song-document-v2.js";
import type { ChartIdMap } from "../song-document/fold.js";
import type { RenderedChart } from "../song-document/render.js";

/**
 * Notes on songs (issues #104, #256): one person writes one, pins it to a
 * place in the song, and saves it somewhere - which decides who sees it and
 * where it shows.
 */

/** Where a note is saved: just its author, a team, a shared songbook, a set, or the song itself. */
export const NOTE_PLACES = ["ME", "TEAM", "SONGBOOK", "SET", "SONG"] as const;
export type NotePlace = (typeof NOTE_PLACES)[number];

const id = z.string().min(1).max(80);

/**
 * Where a note is pinned, by the chart's IDs (which survive edits). Inside a
 * section, `passId` (a flow item) keeps it to the pass it was written on;
 * without, it shows on every pass of the section.
 */
export const NoteAnchorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("song") }),
  z.strictObject({ kind: z.literal("section"), sectionId: id, passId: id.optional() }),
  /** Between two sections: after this pass. */
  z.strictObject({ kind: z.literal("afterPass"), passId: id }),
  /** Between two lines: after this one. */
  z.strictObject({ kind: z.literal("afterLine"), sectionId: id, lineId: id, passId: id.optional() }),
  z.strictObject({ kind: z.literal("line"), sectionId: id, lineId: id, passId: id.optional() }),
  z.strictObject({ kind: z.literal("chord"), sectionId: id, lineId: id, chordId: id, passId: id.optional() }),
  /** A word or syllable: the character it starts at (UTF-16, as LyricAnchor). */
  z.strictObject({ kind: z.literal("word"), sectionId: id, lineId: id, at: z.number().int().nonnegative().max(2000), passId: id.optional() }),
], { error: (issue) => (issue.code === "invalid_union" && issue.note === "No matching discriminator" ? "anchor's kind must be one of song, section, afterPass, afterLine, line, chord, word" : undefined) });
export type NoteAnchor = z.infer<typeof NoteAnchorSchema>;
export type NoteAnchorKind = NoteAnchor["kind"];

/** A note's anchor as the song is now: unchanged, or moved up (chord → line → section → song) when what it was pinned to is gone. Never dropped. */
export interface ResolvedNoteAnchor {
  anchor: NoteAnchor;
  /** What it was pinned to is gone: say so beside the note. */
  moved: boolean;
}

export function resolveNoteAnchor(doc: Pick<SongDocumentV2, "sections" | "flow">, anchor: NoteAnchor): ResolvedNoteAnchor {
  if (anchor.kind === "song") return { anchor, moved: false };
  const passOf = (passId: string | undefined, sectionId: string) => {
    if (passId === undefined) return { passId: undefined, gone: false };
    const pass = doc.flow.find((item) => item.id === passId);
    return pass && pass.sectionId === sectionId ? { passId, gone: false } : { passId: undefined, gone: true };
  };
  const withPass = <T extends object>(value: T, passId: string | undefined): T => (passId === undefined ? value : { ...value, passId });
  if (anchor.kind === "afterPass") {
    return doc.flow.some((item) => item.id === anchor.passId) ? { anchor, moved: false } : { anchor: { kind: "song" }, moved: true };
  }

  // A line may have moved to another section: follow it.
  let sectionId = anchor.sectionId;
  let line: SongDocumentV2["sections"][number]["lines"][number] | undefined;
  if (anchor.kind !== "section") {
    for (const section of doc.sections) {
      line = section.lines.find((candidate) => candidate.id === anchor.lineId);
      if (line) {
        sectionId = section.id;
        break;
      }
    }
  }
  const section = doc.sections.find((candidate) => candidate.id === sectionId);
  if (!section) return { anchor: { kind: "song" }, moved: true };
  const pass = passOf(anchor.passId, sectionId);
  const asSection = (moved: boolean): ResolvedNoteAnchor => ({ anchor: withPass({ kind: "section", sectionId }, pass.passId), moved });
  if (anchor.kind === "section") return asSection(pass.gone);
  if (!line) return asSection(true);
  const onLine = { sectionId, lineId: line.id };
  if (anchor.kind === "line" || anchor.kind === "afterLine") return { anchor: withPass({ kind: anchor.kind, ...onLine }, pass.passId), moved: pass.gone };
  if (anchor.kind === "chord") {
    return line.chords.some((chord) => chord.id === anchor.chordId)
      ? { anchor: withPass({ kind: "chord", ...onLine, chordId: anchor.chordId }, pass.passId), moved: pass.gone }
      : { anchor: withPass({ kind: "line", ...onLine }, pass.passId), moved: true };
  }
  // A word: still on its line, at most at its end.
  return { anchor: withPass({ kind: "word", ...onLine, at: Math.min(anchor.at, line.text.length) }, pass.passId), moved: pass.gone };
}

/**
 * The passes of a chart a note shows on, by their IDs (a set's arrangement
 * has passes of its own): none for one on the whole song (shown above the
 * chart). On one pass: that pass, or the section's first when the chart
 * doesn't have it. On a line: only passes that show the line.
 */
export function notePasses(chart: Pick<RenderedChart, "passes">, anchor: NoteAnchor): string[] {
  if (anchor.kind === "song") return [];
  if (anchor.kind === "afterPass") return chart.passes.some((pass) => pass.id === anchor.passId) ? [anchor.passId] : [];
  const lineId = anchor.kind === "section" ? null : anchor.lineId;
  const passes = chart.passes.filter((pass) => pass.section.id === anchor.sectionId && (lineId === null || pass.lines.some((line) => line.id === lineId)));
  if (anchor.passId === undefined) return passes.map((pass) => pass.id);
  const own = passes.find((pass) => pass.id === anchor.passId);
  return own ? [own.id] : passes.slice(0, 1).map((pass) => pass.id);
}

/** A note's anchor moved onto another song's IDs (a duplicate folded into it, issue #75); what has no match there moves up. */
export function remapNoteAnchor(anchor: NoteAnchor, map: ChartIdMap, flow: Map<string, string> = new Map()): NoteAnchor {
  if (anchor.kind === "song") return anchor;
  if (anchor.kind === "afterPass") {
    const passId = flow.get(anchor.passId);
    return passId ? { kind: "afterPass", passId } : { kind: "song" };
  }
  const sectionId = map.sections.get(anchor.sectionId);
  if (!sectionId) return { kind: "song" };
  const passId = anchor.passId === undefined ? undefined : flow.get(anchor.passId);
  const pass = passId === undefined ? {} : { passId };
  if (anchor.kind === "section") return { kind: "section", sectionId, ...pass };
  const lineId = map.lines.get(anchor.lineId);
  if (!lineId) return { kind: "section", sectionId, ...pass };
  if (anchor.kind === "chord") {
    const chordId = map.chords.get(anchor.chordId);
    return chordId ? { kind: "chord", sectionId, lineId, chordId, ...pass } : { kind: "line", sectionId, lineId, ...pass };
  }
  if (anchor.kind === "word") return { kind: "word", sectionId, lineId, at: anchor.at, ...pass };
  return { kind: anchor.kind, sectionId, lineId, ...pass };
}

/** What a viewer chose to see, for one mode (Edit, Practice, Live): every note, their own, or none. */
export const NOTE_SHOWS = ["ALL", "MINE", "NONE"] as const;
export type NoteShow = (typeof NOTE_SHOWS)[number];

/** The notes a viewer sees, as their Display setting says: all of them, only theirs, or none. Resolved notes stay off the chart. */
export function shownNotes<T extends { authorId: string; resolved: boolean }>(notes: T[], show: NoteShow, viewerId: string): T[] {
  if (show === "NONE") return [];
  return notes.filter((note) => !note.resolved && (show === "ALL" || note.authorId === viewerId));
}

/** Each pass of one song's order matched to another's (for remapNoteAnchor): the nth pass of a section to the nth pass of its match there. */
export function mapFlowIds(from: Pick<SongDocumentV2, "flow">, to: Pick<SongDocumentV2, "flow">, map: ChartIdMap): Map<string, string> {
  const nth = (flow: SongDocumentV2["flow"]) => {
    const seen = new Map<string, number>();
    return flow.map((item) => {
      const n = seen.get(item.sectionId) ?? 0;
      seen.set(item.sectionId, n + 1);
      return { id: item.id, sectionId: item.sectionId, n };
    });
  };
  const target = new Map(nth(to.flow).map((item) => [`${item.sectionId}#${item.n}`, item.id]));
  const result = new Map<string, string>();
  for (const item of nth(from.flow)) {
    const sectionId = map.sections.get(item.sectionId);
    const match = sectionId ? target.get(`${sectionId}#${item.n}`) : undefined;
    if (match) result.set(item.id, match);
  }
  return result;
}
