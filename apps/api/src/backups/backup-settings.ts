import type { SaveBackupConfigSchema } from "@oneverse/core";
import type { z } from "zod";
import { prisma, type BackupSettings } from "@oneverse/db";
import { decryptSecret, encryptSecret, maskSecret } from "@oneverse/secret-crypto";
import { DirBackupTarget, S3BackupTarget, type BackupTarget } from "./backup-target.js";

const SINGLETON_ID = "singleton";

export type BackupSettingSource = "database" | "env" | "default";

/** The schedule and how long things are kept: each from the database, else its env var, else the default. */
export interface BackupSchedule {
  enabled: boolean;
  hourUtc: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  fileRetentionDays: number;
}
type ScheduleKey = keyof BackupSchedule;

const FIELDS: { [K in ScheduleKey]: { env: string; parse: (raw: string) => BackupSchedule[K] | undefined; fallback: BackupSchedule[K] | null } } = {
  // Without a saved or env value: on once there's somewhere to write to.
  enabled: { env: "BACKUP_ENABLED", parse: bool, fallback: null },
  hourUtc: { env: "BACKUP_HOUR_UTC", parse: (raw) => int(raw, 0, 23), fallback: 3 },
  keepDaily: { env: "BACKUP_KEEP_DAILY", parse: (raw) => int(raw, 1, 365), fallback: 7 },
  keepWeekly: { env: "BACKUP_KEEP_WEEKLY", parse: (raw) => int(raw, 0, 520), fallback: 4 },
  keepMonthly: { env: "BACKUP_KEEP_MONTHLY", parse: (raw) => int(raw, 0, 240), fallback: 12 },
  fileRetentionDays: { env: "BACKUP_FILE_RETENTION_DAYS", parse: (raw) => int(raw, 0, 3650), fallback: 30 },
};

function bool(raw: string): boolean | undefined {
  const value = raw.trim().toLowerCase();
  return ["true", "1", "yes", "on"].includes(value) ? true : ["false", "0", "no", "off"].includes(value) ? false : undefined;
}
function int(raw: string, min: number, max: number): number | undefined {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

/** Where the backups go: the database's bucket, else the env's (BACKUP_S3_*), else a folder (BACKUP_DIR), else nowhere. */
export interface BackupDestination {
  kind: "s3" | "dir" | "none";
  source: "database" | "env" | "none";
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  prefix: string;
  accessKeyId: string | null;
  /** Only resolved for a backup or a restore, never for a summary. */
  secretAccessKey: string | null;
  dir: string | null;
}

const env = (name: string) => process.env[name]?.trim() || null;
const cleanPrefix = (prefix: string | null | undefined) => (prefix ?? "").replace(/^\/+|\/+$/g, "");

function hasDatabaseBucket(row: BackupSettings | null): row is BackupSettings & { bucket: string; accessKeyId: string; secretAccessKeyEnc: string } {
  return !!(row?.bucket && row.accessKeyId && row.secretAccessKeyEnc);
}

/** The destination from the environment only: what a restore uses, with the server's database gone. */
export function destinationFromEnv(): BackupDestination {
  const bucket = env("BACKUP_S3_BUCKET");
  const accessKeyId = env("BACKUP_S3_ACCESS_KEY_ID");
  const secretAccessKey = env("BACKUP_S3_SECRET_ACCESS_KEY");
  if (bucket && accessKeyId && secretAccessKey) {
    return { kind: "s3", source: "env", endpoint: env("BACKUP_S3_ENDPOINT"), region: env("BACKUP_S3_REGION"), bucket, prefix: cleanPrefix(env("BACKUP_S3_PREFIX")), accessKeyId, secretAccessKey, dir: null };
  }
  const dir = env("BACKUP_DIR");
  if (dir) return { kind: "dir", source: "env", endpoint: null, region: null, bucket: null, prefix: "", accessKeyId: null, secretAccessKey: null, dir };
  return { kind: "none", source: "none", endpoint: null, region: null, bucket: null, prefix: "", accessKeyId: null, secretAccessKey: null, dir: null };
}

function destinationOf(row: BackupSettings | null, withSecret: boolean): BackupDestination {
  if (hasDatabaseBucket(row)) {
    return {
      kind: "s3",
      source: "database",
      endpoint: row.endpoint,
      region: row.region,
      bucket: row.bucket,
      prefix: cleanPrefix(row.prefix),
      accessKeyId: row.accessKeyId,
      secretAccessKey: withSecret ? decryptSecret(row.secretAccessKeyEnc, process.env.SETTINGS_ENCRYPTION_KEY) : null,
      dir: null,
    };
  }
  const fromEnv = destinationFromEnv();
  return withSecret ? fromEnv : { ...fromEnv, secretAccessKey: null };
}

export function targetFor(destination: BackupDestination): BackupTarget | null {
  if (destination.kind === "s3" && destination.bucket && destination.accessKeyId && destination.secretAccessKey) {
    return new S3BackupTarget({ endpoint: destination.endpoint, region: destination.region, bucket: destination.bucket, prefix: destination.prefix, accessKeyId: destination.accessKeyId, secretAccessKey: destination.secretAccessKey });
  }
  if (destination.kind === "dir" && destination.dir) return new DirBackupTarget(destination.dir);
  return null;
}

function resolveField<K extends ScheduleKey>(key: K, stored: BackupSchedule[K] | null | undefined, hasDestination: boolean): { value: BackupSchedule[K]; source: BackupSettingSource } {
  if (stored !== null && stored !== undefined) return { value: stored, source: "database" };
  const raw = process.env[FIELDS[key].env];
  const parsed = raw === undefined ? undefined : FIELDS[key].parse(raw);
  if (parsed !== undefined) return { value: parsed, source: "env" };
  return { value: (FIELDS[key].fallback ?? hasDestination) as BackupSchedule[K], source: "default" };
}

function row() {
  return prisma.backupSettings.findUnique({ where: { id: SINGLETON_ID } });
}

/** What a backup runs with, resolved fresh each time (CLAUDE.md): the API saves, the Worker reads. */
export async function getEffectiveBackupSettings(): Promise<{ destination: BackupDestination; schedule: BackupSchedule }> {
  const stored = await row();
  const destination = destinationOf(stored, true);
  const schedule = {} as Record<ScheduleKey, unknown>;
  for (const key of Object.keys(FIELDS) as ScheduleKey[]) schedule[key] = resolveField(key, stored?.[key] ?? null, destination.kind !== "none").value;
  return { destination, schedule: schedule as unknown as BackupSchedule };
}

/** For Admin > Backups: never the secret, only whether the database holds one. */
export async function getBackupSettingsSummary() {
  const stored = await row();
  const destination = destinationOf(stored, false);
  const settings = {} as Record<ScheduleKey, { value: unknown; source: BackupSettingSource; env: string }>;
  for (const key of Object.keys(FIELDS) as ScheduleKey[]) settings[key] = { ...resolveField(key, stored?.[key] ?? null, destination.kind !== "none"), env: FIELDS[key].env };
  return {
    destination: {
      kind: destination.kind,
      source: destination.source,
      endpoint: destination.endpoint,
      region: destination.region,
      bucket: destination.bucket,
      prefix: destination.prefix,
      accessKeyIdMasked: destination.accessKeyId ? maskSecret(destination.accessKeyId) : null,
      dir: destination.dir,
    },
    // What's saved in the database, to fill the form (the secret only as "there is one").
    saved: {
      endpoint: stored?.endpoint ?? null,
      region: stored?.region ?? null,
      bucket: stored?.bucket ?? null,
      prefix: stored?.prefix ?? null,
      accessKeyIdMasked: stored?.accessKeyId ? maskSecret(stored.accessKeyId) : null,
      hasDatabaseSecret: !!stored?.secretAccessKeyEnc,
    },
    hasDatabaseConfig: !!stored,
    settings: settings as { [K in ScheduleKey]: { value: BackupSchedule[K]; source: BackupSettingSource; env: string } },
  };
}

/** Saves what's given (issue #119): left out keeps its value, "" or null clears it. */
export async function saveBackupSettings(input: z.output<typeof SaveBackupConfigSchema>): Promise<void> {
  const text = (value: string | undefined): string | null | undefined => (value === undefined ? undefined : value.trim() || null);
  const data = {
    ...(input.enabled !== undefined && { enabled: input.enabled }),
    ...(input.endpoint !== undefined && { endpoint: text(input.endpoint) }),
    ...(input.region !== undefined && { region: text(input.region) }),
    ...(input.bucket !== undefined && { bucket: text(input.bucket) }),
    ...(input.prefix !== undefined && { prefix: cleanPrefix(input.prefix) || null }),
    ...(input.accessKeyId !== undefined && { accessKeyId: text(input.accessKeyId) }),
    ...(input.secretAccessKey !== undefined && { secretAccessKeyEnc: input.secretAccessKey ? encryptSecret(input.secretAccessKey, process.env.SETTINGS_ENCRYPTION_KEY) : null }),
    ...(input.hourUtc !== undefined && { hourUtc: input.hourUtc }),
    ...(input.keepDaily !== undefined && { keepDaily: input.keepDaily }),
    ...(input.keepWeekly !== undefined && { keepWeekly: input.keepWeekly }),
    ...(input.keepMonthly !== undefined && { keepMonthly: input.keepMonthly }),
    ...(input.fileRetentionDays !== undefined && { fileRetentionDays: input.fileRetentionDays }),
  };
  await prisma.backupSettings.upsert({ where: { id: SINGLETON_ID }, create: { id: SINGLETON_ID, ...data }, update: data });
}

/** Back to the environment variables. */
export async function clearBackupSettings(): Promise<void> {
  await prisma.backupSettings.deleteMany({ where: { id: SINGLETON_ID } });
}
