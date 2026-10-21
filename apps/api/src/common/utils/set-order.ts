import { Prisma } from "@oneverse/db";

// The tables whose rows carry a sort order, and that column.
const ORDERED = {
  SetlistItem: { column: "position", updatedAt: true },
  VersionContributor: { column: "displayOrder", updatedAt: false },
} as const;

/**
 * Sets the sort order of many rows in one statement rather than one
 * UPDATE per row: `rows[i]` gets order `i`, or the order given with it.
 * Rows already in place are left alone.
 */
export async function setOrder(
  db: Pick<Prisma.TransactionClient, "$executeRaw">,
  table: keyof typeof ORDERED,
  rows: string[] | { id: string; order: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  const pairs = rows.map((row, index) => (typeof row === "string" ? { id: row, order: index } : row));
  const { column, updatedAt } = ORDERED[table];
  await db.$executeRaw`
    UPDATE ${Prisma.raw(`"${table}"`)} AS t
    SET ${Prisma.raw(`"${column}"`)} = o.ord${Prisma.raw(updatedAt ? `, "updatedAt" = now()` : "")}
    FROM unnest(${pairs.map((p) => p.id)}::text[], ${pairs.map((p) => p.order)}::int[]) AS o(id, ord)
    WHERE t.id = o.id AND t.${Prisma.raw(`"${column}"`)} <> o.ord`;
}
