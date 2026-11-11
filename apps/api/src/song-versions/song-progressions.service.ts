import { Injectable } from "@nestjs/common";
import { findProgression, parseProgressionQuery, progressionGrams, progressionSimilarity, readSongDocument, songProgressions, type SectionProgression } from "@oneverse/core";
import type { Prisma } from "@oneverse/db";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { ListItem } from "./song-version-rows.js";
import { SongVersionsService } from "./song-versions.service.js";

/** Songs by chord progression (issue #204): searched, and alike. Out of `SongVersionsService` (issue #427). */
@Injectable()
export class SongProgressionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly songs: SongVersionsService,
  ) {}

  /**
   * Songs whose chords go like `text` ("1 5 6m 4", "I V vi IV", issue #204),
   * in whatever key: those the user can see, with the sections it's in. Most
   * sections first, then by title; at most 100.
   */
  async searchProgressions(user: AuthenticatedUser, text: string): Promise<{ query: string[] | null; songs: (ListItem & { sections: SectionProgression[] })[] }> {
    const query = parseProgressionQuery(text);
    if (!query) return { query: null, songs: [] };
    const visibleWhere = await this.access.songsVisibleTo(user);
    const visible = await this.prisma.client.songVersion.findMany({ where: visibleWhere, select: { id: true } });
    const ids = visible.map((row) => row.id);
    await this.refreshProgressions(ids);
    // The runs of 3 and 4 in the query must all be in a song's runs; shorter queries are checked one by one.
    const runs = new Set<string>();
    for (const size of [4, 3]) {
      if (query.length < size) continue;
      for (let i = 0; i + size <= query.length; i++) runs.add(query.slice(i, i + size).join("-"));
      break;
    }
    const rows = await this.prisma.client.songProgression.findMany({
      // The songs seen as a condition, not a list of their IDs: a big library is more than a query's 32,767 values.
      where: { songVersion: visibleWhere, ...(runs.size > 0 && { grams: { hasEvery: [...runs] } }) },
      select: { songVersionId: true, sections: true },
    });
    const found = rows
      .map((row) => ({ id: row.songVersionId, sections: findProgression(row.sections as unknown as SectionProgression[], query) }))
      .filter((match) => match.sections.length > 0);
    // The most sections first, then by title: the titles of a short query's many songs read in parts, under the 32,767 values a query takes.
    const titles = new Map<string, string>();
    for (let i = 0; i < found.length; i += 10_000) {
      const part = await this.prisma.client.songVersion.findMany({ where: { id: { in: found.slice(i, i + 10_000).map((match) => match.id) } }, select: { id: true, title: true } });
      for (const row of part) titles.set(row.id, row.title);
    }
    const best = found
      .filter((match) => titles.has(match.id))
      .sort((a, b) => b.sections.length - a.sections.length || titles.get(a.id)!.localeCompare(titles.get(b.id)!))
      .slice(0, 100);
    const items = await this.songs.listItems(user, best.map((match) => match.id));
    const byId = new Map(items.map((item) => [item.id, item]));
    const songs = best.filter((match) => byId.has(match.id)).map((match) => ({ ...byId.get(match.id)!, sections: match.sections }));
    return { query, songs };
  }

  /**
   * A song's progressions, and the songs the user can see that move most
   * like it (issue #204): the runs of chords they share, each weighted by
   * how rare it is among those songs - 1-4-5 is everywhere, so sharing it
   * says little. At most 10, alike enough to be worth showing.
   */
  async progressionsOf(user: AuthenticatedUser, id: string) {
    await this.access.assertCanSeeSong(user, id);
    const visibleWhere = await this.access.songsVisibleTo(user);
    const visible = await this.prisma.client.songVersion.findMany({ where: visibleWhere, select: { id: true } });
    const ids = [...new Set([id, ...visible.map((row) => row.id)])];
    await this.refreshProgressions(ids);
    const rows = await this.prisma.client.songProgression.findMany({
      where: { OR: [{ songVersionId: id }, { songVersion: visibleWhere }] },
      select: { songVersionId: true, sections: true, grams: true },
    });
    const own = rows.find((row) => row.songVersionId === id);
    const sections = (own?.sections as unknown as SectionProgression[] | undefined) ?? [];
    if (!own || own.grams.length === 0) return { sections, similar: [] };
    // How many songs have each run: the rarer, the more it counts.
    const counts = new Map<string, number>();
    for (const row of rows) for (const gram of row.grams) counts.set(gram, (counts.get(gram) ?? 0) + 1);
    const weight = (gram: string) => Math.log(1 + rows.length / (counts.get(gram) ?? 1));
    const scored = rows
      .filter((row) => row.songVersionId !== id && row.grams.length > 0)
      .map((row) => ({
        id: row.songVersionId,
        score: progressionSimilarity(own.grams, row.grams, weight),
        shared: own.grams.filter((gram) => row.grams.includes(gram)),
      }))
      .filter((match) => match.score >= 0.12 && match.shared.length > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    const items = await this.songs.listItems(user, scored.map((match) => match.id));
    const byId = new Map(items.map((item) => [item.id, item]));
    const similar = scored
      .filter((match) => byId.has(match.id))
      .map((match) => ({
        ...byId.get(match.id)!,
        score: Math.round(match.score * 100) / 100,
        // The longest runs they share, the rarest first: what makes them alike.
        shared: match.shared.sort((a, b) => b.split("-").length - a.split("-").length || weight(b) - weight(a)).slice(0, 3),
      }));
    return { sections, similar };
  }

  /**
   * Works out again the progressions of those songs whose chart has moved on
   * since (or never had them): whichever way a chart was changed, the next
   * search sees it.
   */
  private async refreshProgressions(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const stale = await this.prisma.client.$queryRaw<{ id: string }[]>`
      SELECT sv.id FROM "SongVersion" sv
      LEFT JOIN "SongProgression" p ON p."songVersionId" = sv.id
      WHERE sv.id = ANY(${ids}::text[])
        AND (p."songVersionId" IS NULL OR p.revision <> COALESCE((sv."documentJson"->>'revision')::int, 0))`;
    for (let i = 0; i < stale.length; i += 200) {
      const batch = await this.prisma.client.songVersion.findMany({
        where: { id: { in: stale.slice(i, i + 200).map((row) => row.id) } },
        select: { id: true, documentJson: true },
      });
      for (const song of batch) {
        let revision = 0;
        let sections: SectionProgression[] = [];
        try {
          const doc = readSongDocument(song.documentJson);
          revision = doc.revision;
          sections = songProgressions(doc);
        } catch {
          // Not a chart it can read: no progressions.
        }
        const data = { revision, sections: sections as unknown as Prisma.InputJsonValue, grams: progressionGrams(sections) };
        await this.prisma.client.songProgression.upsert({ where: { songVersionId: song.id }, create: { songVersionId: song.id, ...data }, update: data });
      }
    }
  }
}
