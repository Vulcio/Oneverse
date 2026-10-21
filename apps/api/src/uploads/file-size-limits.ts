import { ATTACHMENT_TYPES, BUILT_IN_FILE_SIZE_LIMITS_MB, MAX_FILE_SIZE_LIMIT_MB, type AttachmentTypeValue } from "@oneverse/core";
import { prisma, Prisma } from "@oneverse/db";

const SINGLETON_ID = "singleton";
export const BYTES_PER_MB = 1024 * 1024;

export interface FileSizeLimits {
  /** Each type's limit, in MB: the one saved in Admin > Storage, else the built-in one. */
  limitsMb: Record<AttachmentTypeValue, number>;
  builtInMb: Record<AttachmentTypeValue, number>;
  /** The types whose limit is saved rather than built in. */
  custom: AttachmentTypeValue[];
}

/**
 * The largest song file of each type (issue #163): Admin > Storage's, over
 * the built-in ones. Resolved fresh on every upload, so a change made
 * through one API instance holds for all of them.
 */
export async function getFileSizeLimits(): Promise<FileSizeLimits> {
  const row = await prisma.storageSettings.findUnique({ where: { id: SINGLETON_ID }, select: { fileSizeLimitsMb: true } });
  const saved = (row?.fileSizeLimitsMb ?? {}) as Partial<Record<string, unknown>>;
  const limitsMb = { ...BUILT_IN_FILE_SIZE_LIMITS_MB };
  const custom: AttachmentTypeValue[] = [];
  for (const type of ATTACHMENT_TYPES) {
    const value = saved[type];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      limitsMb[type] = value;
      custom.push(type);
    }
  }
  return { limitsMb, builtInMb: BUILT_IN_FILE_SIZE_LIMITS_MB, custom };
}

/**
 * The limits someone's uploads are held to: Admin > Storage's, except for a
 * global admin (issue #183), held only to the server's own ceiling - an
 * upload is in its memory until it's stored.
 */
export async function fileSizeLimitsFor(user: { isGlobalAdmin: boolean } | undefined): Promise<Record<AttachmentTypeValue, number>> {
  if (user?.isGlobalAdmin) return Object.fromEntries(ATTACHMENT_TYPES.map((type) => [type, MAX_FILE_SIZE_LIMIT_MB])) as Record<AttachmentTypeValue, number>;
  return (await getFileSizeLimits()).limitsMb;
}

/** A type left out keeps its limit; null goes back to the built-in one. */
export async function saveFileSizeLimits(change: Partial<Record<AttachmentTypeValue, number | null>>): Promise<void> {
  const row = await prisma.storageSettings.findUnique({ where: { id: SINGLETON_ID }, select: { fileSizeLimitsMb: true } });
  const next: Record<string, number> = { ...((row?.fileSizeLimitsMb ?? {}) as Record<string, number>) };
  for (const [type, value] of Object.entries(change)) {
    if (value === null) delete next[type];
    else if (value !== undefined) next[type] = value;
  }
  const data = { fileSizeLimitsMb: Object.keys(next).length ? next : Prisma.DbNull };
  await prisma.storageSettings.upsert({ where: { id: SINGLETON_ID }, create: { id: SINGLETON_ID, ...data }, update: data });
}

/** The largest limit of all: how much of an upload is taken in before its type is known. */
export function largestBytes(limitsMb: Record<AttachmentTypeValue, number>): number {
  return Math.max(...Object.values(limitsMb)) * BYTES_PER_MB;
}
