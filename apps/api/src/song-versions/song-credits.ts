/**
 * A song's credits as they're written (issue #427, out of
 * `song-versions.service.ts`): one row per person with all their roles.
 */

import type { SongFields } from "@oneverse/core";
import type { ContributorRole, Prisma } from "@oneverse/db";
import { setOrder } from "../common/utils/set-order.js";

/** One credit per person (ignoring case), with all their roles. */
export function mergeCredits(entries: readonly (readonly [string, ContributorRole])[]): { source: string; roles: ContributorRole[] }[] {
  const credits: { source: string; roles: ContributorRole[] }[] = [];
  for (const [name, role] of entries) {
    const existing = credits.find((credit) => credit.source.toLowerCase() === name.toLowerCase());
    if (!existing) credits.push({ source: name, roles: [role] });
    else if (!existing.roles.includes(role)) existing.roles.push(role);
  }
  return credits;
}

/**
 * Swaps the artist a MusicBrainz link added (isAutoAttached) for `artist`
 * - or removes it, for null. A previous link's row is replaced so
 * re-linking doesn't leave the old artist alongside the new one, and rows
 * added by hand (a composer, say) aren't touched. Two rules on top: no
 * second copy of an artist the song already credits, and a song never
 * ends up with no artist - the old one is then kept, as an ordinary one.
 */
export async function replaceAutoAttachedArtist(tx: Prisma.TransactionClient, songVersionId: string, artist: string | null): Promise<void> {
  const performers = await tx.versionContributor.findMany({
    where: { songVersionId, roles: { has: "PERFORMER" } },
    select: { id: true, source: true, isAutoAttached: true },
  });
  const manual = performers.filter((p) => !p.isAutoAttached);
  const auto = performers.filter((p) => p.isAutoAttached);
  const same = (a: string | null, b: string) => a?.toLowerCase() === b.toLowerCase();

  if (artist && !manual.some((p) => same(p.source, artist))) {
    if (auto.length === 1 && same(auto[0]!.source, artist)) return;
    await tx.versionContributor.deleteMany({ where: { songVersionId, isAutoAttached: true } });
    await tx.versionContributor.create({ data: { songVersionId, userId: null, source: artist, roles: ["PERFORMER"], isAutoAttached: true } });
    return;
  }
  if (manual.length > 0 || auto.length === 0) {
    await tx.versionContributor.deleteMany({ where: { songVersionId, isAutoAttached: true } });
    return;
  }
  // The link's artist is the only one: keep it, now as the song's own.
  await tx.versionContributor.updateMany({ where: { songVersionId, isAutoAttached: true }, data: { isAutoAttached: false } });
}

/** The credits a DTO lists, by role; roles it leaves out aren't there. */
export function creditListsFrom(dto: SongFields & { artists?: string[] }): Partial<Record<ContributorRole, string[]>> {
  return {
    ...(dto.artists && { PERFORMER: dto.artists }),
    ...(dto.composers && { COMPOSER: dto.composers }),
    ...(dto.lyricists && { LYRICIST: dto.lyricists }),
    ...(dto.writers && { AUTHOR: dto.writers }),
    ...(dto.arrangers && { ARRANGER: dto.arrangers }),
    ...(dto.translators && { TRANSLATOR: dto.translators }),
    ...(dto.adaptors && { ADAPTOR: dto.adaptors }),
  };
}

/**
 * Makes `lists[role]` exactly who the song credits in each listed role,
 * leaving other roles alone: a person keeps one row with all their roles
 * (a composer who's also the lyricist), rows left with no role go, and
 * artists come first, in the order given.
 */
export async function replaceCredits(
  tx: Prisma.TransactionClient,
  songVersionId: string,
  lists: Partial<Record<ContributorRole, string[]>>,
): Promise<void> {
  const roles = Object.keys(lists) as ContributorRole[];
  if (roles.length === 0) return;
  const wanted = new Map<string, { name: string; roles: ContributorRole[] }>();
  for (const role of roles) {
    for (const name of lists[role] ?? []) {
      const entry = wanted.get(name.toLowerCase()) ?? { name, roles: [] };
      if (!entry.roles.includes(role)) entry.roles.push(role);
      wanted.set(name.toLowerCase(), entry);
    }
  }

  const rows = await tx.versionContributor.findMany({
    where: { songVersionId },
    select: { id: true, source: true, roles: true },
    orderBy: { displayOrder: "asc" },
  });
  // `id` is null for the people added now.
  const kept: { id: string | null; source: string | null; roles: ContributorRole[] }[] = [];
  const removed: string[] = [];
  for (const row of rows) {
    const nextRoles = row.roles.filter((role) => !roles.includes(role));
    const match = row.source ? wanted.get(row.source.toLowerCase()) : undefined;
    if (match) {
      nextRoles.push(...match.roles.filter((role) => !nextRoles.includes(role)));
      wanted.delete(row.source!.toLowerCase());
    }
    if (nextRoles.length === 0) {
      removed.push(row.id);
      continue;
    }
    if (nextRoles.length !== row.roles.length || nextRoles.some((role) => !row.roles.includes(role))) {
      await tx.versionContributor.update({ where: { id: row.id }, data: { roles: nextRoles } });
    }
    kept.push({ id: row.id, source: row.source, roles: nextRoles });
  }
  for (const entry of wanted.values()) kept.push({ id: null, source: entry.name, roles: entry.roles });

  const artistOrder = (lists.PERFORMER ?? []).map((name) => name.toLowerCase());
  const rank = (row: (typeof kept)[number]) => {
    const index = row.source ? artistOrder.indexOf(row.source.toLowerCase()) : -1;
    return row.roles.includes("PERFORMER") ? (index === -1 ? artistOrder.length : index) : artistOrder.length + 1;
  };
  const ordered = kept
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
    .map(({ row }, order) => ({ ...row, order }));

  if (removed.length > 0) await tx.versionContributor.deleteMany({ where: { id: { in: removed } } });
  await tx.versionContributor.createMany({
    data: ordered
      .filter((row) => row.id === null)
      .map((row) => ({ songVersionId, userId: null, source: row.source, roles: row.roles, displayOrder: row.order })),
  });
  await setOrder(
    tx,
    "VersionContributor",
    ordered.flatMap(({ id, order }) => (id ? [{ id, order }] : [])),
  );
}
