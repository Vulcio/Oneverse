import { computeSectionLabel, formatSongbookReference, type SongbookSection } from "@oneverse/core";
import type { Prisma } from "@oneverse/db";
import type { PrismaService } from "../prisma/prisma.service.js";

/**
 * Where each song is in the numbered songbooks `songbooks` selects (the ones
 * the viewer can see), by song: "JEM 855 · JEM3" (issues #55, #59, #213).
 * Songbooks with an abbreviation first - the short way people call them -
 * then in order.
 */
export async function songbookReferencesOf(prisma: PrismaService, songbooks: Prisma.SongbookWhereInput, songVersionIds: string[]): Promise<Map<string, string[]>> {
  if (songVersionIds.length === 0) return new Map();
  const entries = await prisma.client.songbookEntry.findMany({
    where: { songVersionId: { in: songVersionIds }, entryCode: { not: null }, songbook: songbooks },
    select: { songVersionId: true, entryCode: true, songbook: { select: { name: true, abbreviation: true, sections: true } } },
  });
  const found = new Map<string, { text: string; short: boolean }[]>();
  for (const entry of entries) {
    const text = formatSongbookReference({
      songbookName: entry.songbook.name,
      abbreviation: entry.songbook.abbreviation,
      entryCode: entry.entryCode,
      sectionLabel: computeSectionLabel(entry.entryCode, entry.songbook.sections as SongbookSection[] | null),
    });
    found.set(entry.songVersionId, [...(found.get(entry.songVersionId) ?? []), { text, short: !!entry.songbook.abbreviation?.trim() }]);
  }
  return new Map(
    [...found].map(([id, references]) => [
      id,
      [...new Set(references.sort((a, b) => Number(b.short) - Number(a.short) || a.text.localeCompare(b.text, undefined, { numeric: true })).map((one) => one.text))],
    ]),
  );
}
