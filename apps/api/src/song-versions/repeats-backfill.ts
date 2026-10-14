import { findRepeats, readSongDocument } from "@songverse/core";
import type { PrismaService } from "../prisma/prisma.service.js";
import { SongHistoryService } from "./song-history.service.js";
import { SongRepeatsService } from "./song-repeats.service.js";

const BATCH = 200;

/** What the library's repeated sections came to (issue #231): songs with any, how many of each kind, and how many were linked. */
export interface RepeatsBackfill {
  songs: number;
  same: number;
  transposed: number;
  chords: number;
  lines: number;
  linked: number;
}

/**
 * The library's songs whose sections repeat an earlier one (issue #231),
 * counted by kind; with `apply`, those that are the same or transposed are
 * linked (each kept in its song's history) - a pass with chords or lines
 * of its own is left for the song's editors to look at. A batch at a
 * time, on the Worker's backfills queue.
 */
export async function backfillRepeats(prisma: PrismaService, apply: boolean): Promise<RepeatsBackfill> {
  const repeats = new SongRepeatsService(prisma, new SongHistoryService(prisma));
  const out: RepeatsBackfill = { songs: 0, same: 0, transposed: 0, chords: 0, lines: 0, linked: 0 };
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.client.songVersion.findMany({ select: { id: true, documentJson: true }, orderBy: { id: "asc" }, take: BATCH, ...(cursor && { cursor: { id: cursor }, skip: 1 }) });
    if (rows.length === 0) return out;
    cursor = rows.at(-1)!.id;
    for (const row of rows) {
      let found;
      try {
        found = findRepeats(readSongDocument(row.documentJson));
      } catch {
        continue; // Not a chart it can read.
      }
      if (found.length === 0) continue;
      out.songs++;
      for (const repeat of found) out[repeat.match.kind]++;
      if (apply && found.some((repeat) => repeat.match.kind === "same" || repeat.match.kind === "transposed")) {
        out.linked += (await repeats.link(row.id, null, { revision: null, kinds: ["same", "transposed"] }).catch(() => ({ linked: 0 }))).linked;
      }
    }
  }
}
