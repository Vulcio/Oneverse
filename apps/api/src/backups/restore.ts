/**
 * Restores a backup (issue #119; Deploy.md, "Restoring from a backup"):
 *
 *   node dist/backups/restore.js --list
 *   node dist/backups/restore.js [--at 2026-10-31] [--database-url <url>] [--skip-database] [--skip-files]
 *
 * Reads the backup's destination from the environment (BACKUP_S3_* or
 * BACKUP_DIR: with the server's database gone, Admin's settings are too), and
 * SETTINGS_ENCRYPTION_KEY, the dump's passphrase. It restores the newest dump
 * made on or before --at (else the newest) into an EMPTY database (--database-url,
 * else DATABASE_URL) with pg_restore, then puts back into the main storage -
 * the restored database's Admin > Storage settings, else R2_*, else the local
 * disk - every file that database references and the storage lacks.
 */
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { decryptStream, dumpPassphrase } from "./backup-crypto.js";
import { destinationFromEnv, targetFor } from "./backup-settings.js";
import { readAll, type BackupTarget } from "./backup-target.js";
import { libpqUrl, run } from "./pg-tools.js";
import { dumpTime } from "./rotation.js";

const { values } = parseArgs({
  options: {
    list: { type: "boolean", default: false },
    at: { type: "string" },
    "database-url": { type: "string" },
    "skip-database": { type: "boolean", default: false },
    "skip-files": { type: "boolean", default: false },
  },
});

const say = (line: string) => process.stdout.write(`${line}\n`);

async function dumps(target: BackupTarget) {
  return (await target.list("db/"))
    .flatMap(({ key, size }) => {
      const at = dumpTime(key);
      return at ? [{ key, at, size }] : [];
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

async function restoreDatabase(target: BackupTarget, databaseUrl: string) {
  const all = await dumps(target);
  // --at a day: that day's newest; a time: the newest at or before it.
  const until = values.at ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(values.at) ? `${values.at}T23:59:59.999Z` : values.at) : null;
  if (until && Number.isNaN(until.getTime())) throw new Error(`--at isn't a date: ${values.at}`);
  const dump = all.find((candidate) => !until || candidate.at <= until);
  if (!dump) throw new Error(until ? `No dump made on or before ${values.at}` : "The backup holds no database dump");
  say(`Restoring the database from ${dump.key} (${dump.at.toISOString()}, ${dump.size} bytes)`);

  const tables = await countTables(databaseUrl);
  if (tables > 0) throw new Error(`The database already has ${tables} table(s): restore into an empty one (create it, then point --database-url at it)`);

  const dir = await mkdtemp(join(tmpdir(), "oneverse-restore-"));
  try {
    const file = join(dir, "dump");
    const body = await target.get(dump.key);
    if (!body) throw new Error(`${dump.key} can't be read`);
    await pipeline(body, decryptStream(dumpPassphrase()), createWriteStream(file));
    await run("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", `--dbname=${libpqUrl(databaseUrl)}`, file]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  say("Database restored.");
}

async function countTables(databaseUrl: string): Promise<number> {
  const { PrismaClient } = await import("@oneverse/db");
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const rows = await client.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM information_schema.tables WHERE table_schema = 'public'`;
    return Number(rows[0]?.count ?? 0);
  } finally {
    await client.$disconnect();
  }
}

async function restoreFiles(target: BackupTarget, databaseUrl: string) {
  // Its own client on the restored database (the shared one is on DATABASE_URL).
  const [{ PrismaClient }, { StorageService }] = await Promise.all([import("@oneverse/db"), import("../storage/storage.service.js")]);
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const config = { get: (name: string) => process.env[name] };
  const storage = new StorageService(config as never, { client: prisma } as never);
  const where = await storage.describe();
  const keys = await storage.storedKeys();
  say(`Putting back the files the database references (${keys.length}) into the ${where.driver === "s3" ? `bucket (from ${where.source === "database" ? "Admin > Storage" : "R2_*"})` : "local disk"}`);
  let restored = 0;
  let present = 0;
  const missing: string[] = [];
  for (const key of keys) {
    const there = await storage.size(key).then(() => true, () => false);
    if (there) {
      present++;
      continue;
    }
    const body = await readAll(await target.get(`files/${key}`));
    if (!body) {
      missing.push(key);
      continue;
    }
    await storage.restoreObject(key, body);
    restored++;
  }
  await prisma.$disconnect();
  say(`Files: ${restored} put back, ${present} already there, ${missing.length} not in the backup${missing.length ? ` (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""})` : ""}.`);
}

async function main() {
  const destination = destinationFromEnv();
  const target = targetFor(destination);
  if (!target) throw new Error("Say where the backup is: BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY (and BACKUP_S3_ENDPOINT, BACKUP_S3_PREFIX), or BACKUP_DIR");
  if (values.list) {
    const latest = await readAll(await target.get("latest.json"));
    if (latest) say(`Newest backup: ${latest.toString()}`);
    for (const dump of await dumps(target)) say(`${dump.at.toISOString()}  ${dump.key}  ${dump.size} bytes`);
    return;
  }
  const databaseUrl = values["database-url"] ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Say which database to restore into: --database-url, or DATABASE_URL");
  if (!values["skip-database"]) await restoreDatabase(target, databaseUrl);
  if (!values["skip-files"]) await restoreFiles(target, databaseUrl);
  say("Done. Start the API with the same SETTINGS_ENCRYPTION_KEY, pointed at this database; it applies any newer migrations as it starts.");
}

main().catch((error: unknown) => {
  process.stderr.write(`Restore failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
