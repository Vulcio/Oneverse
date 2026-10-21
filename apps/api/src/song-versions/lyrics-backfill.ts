import { lyricsSearchText, readSongDocument } from "@oneverse/core";
import type { PrismaService } from "../prisma/prisma.service.js";

const BATCH = 200;

/**
 * Works out the words of songs saved before lyrics search (issue #221), a
 * batch at a time, on the Worker's backfills queue. A song saved meanwhile
 * has had its own written with the save, and is left as it is; one whose
 * chart can't be read gets an empty text, so it isn't tried again.
 */
export async function backfillLyrics(prisma: PrismaService): Promise<{ songs: number }> {
  let songs = 0;
  for (;;) {
    const rows = await prisma.client.songVersion.findMany({ where: { lyricsText: null }, select: { id: true, documentJson: true }, take: BATCH });
    if (rows.length === 0) return { songs };
    for (const row of rows) {
      let text = "";
      try {
        text = lyricsSearchText(readSongDocument(row.documentJson));
      } catch {
        // Not a chart it can read: nothing to find it by.
      }
      const { count } = await prisma.client.songVersion.updateMany({ where: { id: row.id, lyricsText: null }, data: { lyricsText: text } });
      songs += count;
    }
  }
}
