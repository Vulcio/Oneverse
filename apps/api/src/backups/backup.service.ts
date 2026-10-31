import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { latestMigration } from "../common/database-migration.js";
import { serverVersion } from "../common/version.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { dumpPassphrase, encryptStream } from "./backup-crypto.js";
import { getEffectiveBackupSettings, targetFor, type BackupSchedule } from "./backup-settings.js";
import { bufferStream, readAll, type BackupTarget } from "./backup-target.js";
import { libpqUrl, majorOf, pgToolFor, run } from "./pg-tools.js";
import { dumpKey, dumpsToKeep, dumpTime } from "./rotation.js";

/** A file deleted from the main storage, kept in the backup since this date until its retention ends. */
export const DELETED_MANIFEST = "files-deleted.json";
/** What the newest backup holds: when, which version and migration, which dump. */
export const LATEST = "latest.json";
const HASH = /^files\/([0-9a-f]{64})$/;
/** A backup still "running" after this long died with its process: it no longer blocks the next. */
const STALE_MS = 6 * 60 * 60 * 1000;
const COPY_CONCURRENCY = 4;

export type BackupTrigger = "schedule" | "manual";

/** Runs `work` on each item, a few at a time. */
async function eachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  }));
}

/**
 * The server's backup (issue #119), run by the Worker: the database dumped
 * (pg_dump, custom format), encrypted with SETTINGS_ENCRYPTION_KEY and uploaded
 * as `db/<time>.dump.enc`, then every stored file the database references
 * copied to `files/<hash>` once - keys are hashes of the bytes, so a file is
 * never copied twice. A file gone from the main storage stays for
 * `fileRetentionDays`; dumps are kept 7 daily, 4 weekly, 12 monthly by
 * default. Each run is a BackupRun row, for Admin > Backups.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** The run going on, if one is (and isn't a leftover from a process that died). */
  async running() {
    return this.prisma.client.backupRun.findFirst({ where: { status: "running", startedAt: { gt: new Date(Date.now() - STALE_MS) } }, orderBy: { startedAt: "desc" } });
  }

  /**
   * Hourly (BackupsProcessor): runs the nightly backup at its hour, or as soon
   * as possible when the last one that worked is over a day old (the Worker was
   * down at the hour). A run, even a failed one, in the last 12 hours waits.
   */
  async tick(now = new Date()): Promise<"ran" | "not-due"> {
    const { destination, schedule } = await getEffectiveBackupSettings();
    if (!schedule.enabled || destination.kind === "none") return "not-due";
    const [recent, lastOk] = await Promise.all([
      this.prisma.client.backupRun.findFirst({ where: { startedAt: { gt: new Date(now.getTime() - 12 * 3600_000) } } }),
      this.prisma.client.backupRun.findFirst({ where: { status: "ok" }, orderBy: { startedAt: "desc" } }),
    ]);
    if (recent) return "not-due";
    const overdue = !lastOk || now.getTime() - lastOk.startedAt.getTime() > 25 * 3600_000;
    if (now.getUTCHours() !== schedule.hourUtc && !overdue) return "not-due";
    await this.run("schedule");
    return "ran";
  }

  async run(trigger: BackupTrigger): Promise<{ id: string; status: string }> {
    if (await this.running()) {
      if (trigger === "manual") throw new ConflictException("A backup is already running");
      return { id: "", status: "skipped" };
    }
    const record = await this.prisma.client.backupRun.create({ data: { trigger, status: "running" } });
    const update = (data: Parameters<typeof this.prisma.client.backupRun.update>[0]["data"]) => this.prisma.client.backupRun.update({ where: { id: record.id }, data });
    try {
      const { destination, schedule } = await getEffectiveBackupSettings();
      const target = targetFor(destination);
      if (!target) throw new Error("No backup destination: set a bucket in Admin > Backups, or BACKUP_S3_* / BACKUP_DIR");
      this.logger.log(`Backing up to ${target.description} (${trigger})`);

      const before = await this.storage.storedKeys();
      const startedAt = new Date();
      const dump = await this.dumpDatabase(target, startedAt);
      await update({ databaseKey: dump.key, databaseBytes: BigInt(dump.bytes) });
      // Files referenced when the dump started, or since: everything it points to.
      const keys = [...new Set([...before, ...(await this.storage.storedKeys())])];
      const files = await this.copyFiles(target, keys, schedule);
      await update(files);
      const dumpsRemoved = await this.rotateDumps(target, schedule);
      const latest = Buffer.from(JSON.stringify({ at: startedAt.toISOString(), ...serverVersion(), migration: await latestMigration(this.prisma.client), database: dump.key, files: keys.length }, null, 2));
      await target.put(LATEST, bufferStream(latest), latest.length, "application/json");
      const done = await update({ status: "ok", finishedAt: new Date(), dumpsRemoved });
      this.logger.log(`Backup done: ${dump.key} (${dump.bytes} bytes), ${files.filesCopied} file(s) copied, ${files.filesKept} already there`);
      return { id: done.id, status: done.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Backup failed: ${message}`);
      await update({ status: "failed", finishedAt: new Date(), error: message.slice(0, 2000) });
      return { id: record.id, status: "failed" };
    }
  }

  /** pg_dump to a temporary file, encrypted on the way, then uploaded: its size must be known before. */
  private async dumpDatabase(target: BackupTarget, at: Date): Promise<{ key: string; bytes: number }> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is not set");
    const passphrase = dumpPassphrase();
    const dir = await mkdtemp(join(tmpdir(), "oneverse-backup-"));
    try {
      const file = join(dir, "dump.enc");
      const out = new PassThrough();
      const written = pipeline(out, encryptStream(passphrase), createWriteStream(file));
      await Promise.all([run(pgToolFor("pg_dump", await this.serverMajor()), ["--format=custom", "--compress=6", "--no-owner", "--no-acl", `--dbname=${libpqUrl(databaseUrl)}`], { stdout: out }), written]);
      const bytes = (await stat(file)).size;
      const key = dumpKey(at);
      await target.put(key, createReadStream(file), bytes);
      return { key, bytes };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** The database server's major version, for the pg_dump that fits it. */
  private async serverMajor(): Promise<number | null> {
    const rows = await this.prisma.client.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`.catch(() => []);
    return majorOf(rows[0]?.server_version_num);
  }

  private async copyFiles(target: BackupTarget, keys: string[], schedule: BackupSchedule) {
    const there = new Set<string>();
    for (const { key } of await target.list("files/")) {
      const match = HASH.exec(key);
      if (match) there.add(match[1]!);
    }
    const wanted = new Set(keys);
    let filesCopied = 0;
    let filesBytes = 0n;
    let filesMissing = 0;
    const toCopy = keys.filter((key) => !there.has(key));
    await eachLimited(toCopy, COPY_CONCURRENCY, async (key) => {
      try {
        const size = await this.storage.size(key);
        await target.put(`files/${key}`, await this.storage.stream(key), size);
        filesCopied++;
        filesBytes += BigInt(size);
      } catch (error) {
        // A file the database names but the storage lacks: nothing to copy, and said in Admin.
        if (error instanceof NotFoundException) filesMissing++;
        else throw error;
      }
    });

    // Gone from the main storage: kept for the retention, then removed.
    const manifest = JSON.parse((await readAll(await target.get(DELETED_MANIFEST)))?.toString() ?? "{}") as Record<string, string>;
    const now = Date.now();
    let filesRemoved = 0;
    for (const key of Object.keys(manifest)) if (wanted.has(key)) delete manifest[key];
    for (const key of there) {
      if (wanted.has(key)) continue;
      const since = manifest[key] ? Date.parse(manifest[key]) : now;
      manifest[key] ??= new Date(now).toISOString();
      if (now - since >= schedule.fileRetentionDays * 86_400_000) {
        await target.delete(`files/${key}`);
        delete manifest[key];
        filesRemoved++;
      }
    }
    for (const key of Object.keys(manifest)) if (!there.has(key)) delete manifest[key];
    const body = Buffer.from(JSON.stringify(manifest));
    await target.put(DELETED_MANIFEST, bufferStream(body), body.length, "application/json");
    return { filesCopied, filesBytes, filesKept: keys.length - toCopy.length, filesMissing, filesRemoved };
  }

  private async rotateDumps(target: BackupTarget, schedule: BackupSchedule): Promise<number> {
    const dumps = (await target.list("db/")).flatMap(({ key }) => {
      const at = dumpTime(key);
      return at ? [{ key, at }] : [];
    });
    const keep = dumpsToKeep(dumps, { daily: schedule.keepDaily, weekly: schedule.keepWeekly, monthly: schedule.keepMonthly });
    let removed = 0;
    for (const dump of dumps) {
      if (keep.has(dump.key)) continue;
      await target.delete(dump.key);
      removed++;
    }
    return removed;
  }
}
