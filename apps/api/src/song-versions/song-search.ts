import { Prisma } from "@oneverse/db";
import type { PrismaService } from "../prisma/prisma.service.js";

/** The fewest letters a word takes before it's looked for misspelt too. */
const FUZZY_MIN_LETTERS = 4;
/** How close a misspelt word must be to one of the song's (pg_trgm's word_similarity). */
const FUZZY_THRESHOLD = 0.5;
/** The most songs found with a misspelling, the closest first. */
const FUZZY_LIMIT = 200;

/**
 * The library's search (issue #328), wherever songs are searched by name:
 * `q` anywhere in the title, subtitle, version name or a performer -
 * ignoring case, accents and punctuation, through the trigram-indexed
 * searchText the database keeps folded by search_fold() - or a CCLI number
 * exactly. The query is folded by the same function, so both agree.
 * Misspelt words too ("amazng grace", "eternel fai moi conaitre"): songs
 * with each word of the query, where a word of four letters or more may be
 * close to one of theirs rather than in them (pg_trgm, the same index).
 */
export async function songSearchWhere(prisma: PrismaService, q: string): Promise<Prisma.SongVersionWhereInput> {
  const [row] = await prisma.client.$queryRaw<{ folded: string }[]>`SELECT search_fold(${q}) AS folded`;
  const folded = row?.folded ?? q;
  // Only punctuation: nothing to find by name.
  if (!folded) return { ccli: q };
  const fuzzy = await misspelt(prisma, folded);
  return {
    OR: [{ searchText: { contains: folded, mode: "insensitive" as const } }, { ccli: q }, ...(fuzzy.length ? [{ id: { in: fuzzy } }] : [])],
  };
}

/** Songs with every word of `folded`, those long enough maybe misspelt; none when no word is. */
async function misspelt(prisma: PrismaService, folded: string): Promise<string[]> {
  const words = folded.split(" ");
  if (!words.some((word) => word.length >= FUZZY_MIN_LETTERS)) return [];
  // search_fold() left no % or _ in them; a short word must be there as typed.
  const each = words.map((word) =>
    word.length >= FUZZY_MIN_LETTERS
      ? Prisma.sql`("searchText" ILIKE ${`%${word}%`} OR ${word} <% "searchText")`
      : Prisma.sql`"searchText" ILIKE ${`%${word}%`}`,
  );
  const closeness = Prisma.join(words.map((word) => Prisma.sql`word_similarity(${word}, "searchText")`), " + ");
  const [, rows] = await prisma.client.$transaction([
    prisma.client.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(FUZZY_THRESHOLD)}, true)`,
    prisma.client.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SongVersion" WHERE ${Prisma.join(each, " AND ")}
      ORDER BY ${closeness} DESC LIMIT ${FUZZY_LIMIT}`,
  ]);
  return rows.map((song) => song.id);
}
