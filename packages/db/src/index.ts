import { PrismaClient } from "@prisma/client";

declare global {
  var __songversePrisma: PrismaClient | undefined;
}

/** SongVersion reads a binned song is left out of, unless the query names `deletedAt` (issue #340). */
const SONG_READS = new Set(["findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy"]);

/**
 * The client every process shares: a song in the bin (`SongVersion.deletedAt`,
 * issue #340) is left out of every SongVersion read, as if it were gone,
 * unless the query's `where` names `deletedAt` itself - the bin's own
 * queries, and the clean-ups that must see everything (`deletedAt: undefined`).
 * Relations loaded from another model (a set item's song) aren't filtered:
 * those check `deletedAt` where they show a song (AccessPolicyService).
 */
function createClient(): PrismaClient {
  return new PrismaClient().$extends({
    query: {
      songVersion: {
        $allOperations({ operation, args, query }) {
          if (SONG_READS.has(operation)) {
            const withWhere = args as { where?: Record<string, unknown> };
            if (!withWhere.where || !("deletedAt" in withWhere.where)) withWhere.where = { ...withWhere.where, deletedAt: null };
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

/**
 * Shared Prisma client singleton. Reused across hot reloads in dev (NestJS
 * watch mode, TanStack Start dev server) to avoid exhausting Postgres
 * connections.
 */
export const prisma = globalThis.__songversePrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__songversePrisma = prisma;
}

/** In a SongVersion `where`: binned songs too (issue #340), for clean-ups that must see every song. */
export const BINNED_TOO = { deletedAt: undefined } as const;

export * from "@prisma/client";
export * from "./seed.js";
