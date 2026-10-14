import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { findRepeats, linkRepeatInArrangement, linkRepeats, lyricsSearchText, readSongDocument, safeParseArrangementDocumentV2, type FoundRepeat } from "@songverse/core";
import { Prisma } from "@songverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import { SongHistoryService } from "./song-history.service.js";

/** A repeat as the editor shows it: which section, the one it repeats, and how. */
export interface RepeatSummary {
  sectionId: string;
  ofSectionId: string;
  kind: FoundRepeat["match"]["kind"];
  /** Semitones it's moved (transposed, or with chords of its own). */
  steps: number;
  /** Chords of its own. */
  chords: number;
  /** Lines of the earlier section it leaves out. */
  hiddenLines: number;
}

export const summarizeRepeat = ({ sectionId, ofSectionId, match }: FoundRepeat): RepeatSummary => ({
  sectionId,
  ofSectionId,
  kind: match.kind,
  steps: match.kind === "transposed" || match.kind === "chords" ? match.steps : 0,
  chords: match.kind === "chords" ? match.chords.length : 0,
  hiddenLines: match.kind === "lines" ? match.hiddenLines.length : 0,
});

/**
 * A song's repeated sections linked (issue #231): each repeat becomes a
 * pass of the section it repeats - the same, transposed, with its own
 * chords or only some of its lines - and what pointed at it (arrangements,
 * recordings' cue points) points at that section. Kept in the song's
 * history, so it can be undone.
 */
@Injectable()
export class SongRepeatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly history: SongHistoryService,
  ) {}

  async list(songVersionId: string): Promise<{ revision: number; repeats: RepeatSummary[] }> {
    const song = await this.prisma.client.songVersion.findUnique({ where: { id: songVersionId }, select: { documentJson: true } });
    if (!song) throw new NotFoundException("Song version not found");
    const doc = readSongDocument(song.documentJson);
    return { revision: doc.revision, repeats: findRepeats(doc).map(summarizeRepeat) };
  }

  /**
   * These repeats linked (all of them when `sectionIds` is left out, or
   * only those of the kinds in `kinds`), on the song as it was at
   * `revision` (null: as it is). Returns how many were linked.
   */
  async link(
    songVersionId: string,
    authorUserId: string | null,
    options: { revision: number | null; sectionIds?: string[]; kinds?: FoundRepeat["match"]["kind"][] },
  ): Promise<{ linked: number; revision: number }> {
    return this.prisma.client.$transaction(async (tx) => {
      const song = await tx.songVersion.findUnique({ where: { id: songVersionId }, select: { documentJson: true } });
      if (!song) throw new NotFoundException("Song version not found");
      const doc = readSongDocument(song.documentJson);
      if (options.revision !== null && options.revision !== doc.revision) throw new ConflictException("The song was changed since: look at its repeats again");
      const chosen = findRepeats(doc).filter(
        (repeat) => (!options.sectionIds || options.sectionIds.includes(repeat.sectionId)) && (!options.kinds || options.kinds.includes(repeat.match.kind)),
      );
      if (chosen.length === 0) return { linked: 0, revision: doc.revision };
      const before = await this.history.before(tx, songVersionId);
      const next = linkRepeats(doc, chosen);
      const { count } = await tx.songVersion.updateMany({
        where: { id: songVersionId, documentJson: { path: ["revision"], equals: doc.revision } },
        data: { documentJson: next as object, lyricsText: lyricsSearchText(next) },
      });
      if (count === 0) throw new ConflictException("The song was changed since: look at its repeats again");
      const key = doc.defaults.key ?? null;
      // Its arrangements: their passes of a repeat sung from the section it repeats.
      const arrangements = await tx.arrangement.findMany({ where: { songVersionId }, select: { id: true, documentJson: true } });
      for (const arrangement of arrangements) {
        const parsed = safeParseArrangementDocumentV2(arrangement.documentJson);
        if (!parsed.success) continue;
        const linked = chosen.reduce((arr, repeat) => linkRepeatInArrangement(arr, repeat, key), parsed.data);
        await tx.arrangement.update({ where: { id: arrangement.id }, data: { documentJson: linked as object } });
      }
      // Recordings' cue points: a repeat's start is now its section's.
      const sections = new Map(chosen.map((repeat) => [repeat.sectionId, repeat.ofSectionId]));
      const cued = await tx.attachment.findMany({ where: { songVersionId, cuePoints: { not: Prisma.DbNull } }, select: { id: true, cuePoints: true } });
      for (const file of cued) {
        const cues = Array.isArray(file.cuePoints) ? (file.cuePoints as { at: number; sectionId: string }[]) : [];
        if (!cues.some((cue) => sections.has(cue.sectionId))) continue;
        await tx.attachment.update({ where: { id: file.id }, data: { cuePoints: cues.map((cue) => ({ ...cue, sectionId: sections.get(cue.sectionId) ?? cue.sectionId })) } });
      }
      await this.history.record(tx, songVersionId, { kind: "EDITED", authorUserId, before });
      return { linked: chosen.length, revision: next.revision };
    });
  }
}
