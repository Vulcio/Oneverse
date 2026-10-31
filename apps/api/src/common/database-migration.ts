import type { PrismaClient } from "@oneverse/db";

/** The newest migration applied to the database (issue #164), or null when it can't be read. */
export async function latestMigration(prisma: PrismaClient): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name DESC LIMIT 1`;
    return rows[0]?.migration_name ?? null;
  } catch {
    return null;
  }
}
