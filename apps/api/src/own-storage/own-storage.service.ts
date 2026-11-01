import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { OwnStorageLimitsRequest, SaveOwnStorageRequest } from "@oneverse/core";
import { encryptSecret, maskSecret } from "@oneverse/secret-crypto";
import type { Queue } from "bullmq";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { OWN_STORAGE_QUEUE } from "../jobs/jobs.constants.js";
import { getEffectiveOrganizationSettings } from "../organizations/organization-settings.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { capabilitiesOf } from "../roles/capabilities.js";
import { ownStorageDriver, ownStorageProblem } from "../storage/own-storage.js";
import { StorageService, type StorageLocation } from "../storage/storage.service.js";

export const RELOCATE_JOB = "relocate";
export const OWN_STORAGE_TICK = "own-storage-tick";
/** Files moved in one go; the job queues itself again while there are more. */
const BATCH = 50;

export interface OwnStorageSummary {
  /** Whether this admin may connect one: Admin > Organisations allows it, and a role of theirs does. */
  allowed: boolean;
  configured: boolean;
  provider: "R2" | "S3" | "B2" | "WASABI" | null;
  accountId: string | null;
  region: string | null;
  bucket: string | null;
  accessKeyIdMasked: string | null;
  state: "ACTIVE" | "LEAVING" | null;
  reachable: boolean;
  lastError: string | null;
  checkedAt: string | null;
  /** Files there now, and files on their way in or out. */
  files: number;
  moving: number;
  /** Its admins' limits on what goes into it, in MB (null: none), and how much is there. */
  teamLimitMb: number | null;
  memberLimitMb: number | null;
  maxFileMb: number | null;
  usedBytes: number;
}

/** A file to move, where it is and where it should be. */
interface Move {
  id: string;
  storageKey: string;
  originalStorageKey: string | null;
  mimeType: string;
  from: string | null;
  to: string | null;
}

/**
 * An organisation's own bucket for its teams' songs' files (issue #206). Its
 * admins connect it, with a role that allows it, when Admin > Organisations
 * does. Each file says where its bytes are (`Attachment.storedInOrganizationId`)
 * and is read from there; the Worker moves files to where their song's owner
 * keeps them - in when it's connected or a team joins, back out when it's
 * stopped, a team leaves or a song changes hands - checking every byte's hash.
 */
@Injectable()
export class OwnStorageService {
  private readonly logger = new Logger(OwnStorageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    @InjectQueue(OWN_STORAGE_QUEUE) private readonly queue: Queue,
  ) {}

  private async assertAdmin(user: AuthenticatedUser, organizationId: string): Promise<void> {
    const organization = await this.prisma.client.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!organization) throw new NotFoundException("Organisation not found");
    if (user.isGlobalAdmin) return;
    const membership = await this.prisma.client.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: user.id } }, select: { role: true } });
    if (membership?.role !== "ADMIN") throw new ForbiddenException("Organisation admin role required");
  }

  private async allowed(user: AuthenticatedUser): Promise<boolean> {
    if (!(await getEffectiveOrganizationSettings()).ownStorage) return false;
    return user.isGlobalAdmin || (await capabilitiesOf(this.prisma.client, user.id)).canUseOwnStorage;
  }

  async summary(user: AuthenticatedUser, organizationId: string): Promise<OwnStorageSummary> {
    await this.assertAdmin(user, organizationId);
    const [row, allowed, stored, moving] = await Promise.all([
      this.prisma.client.organizationStorage.findUnique({ where: { organizationId } }),
      this.allowed(user),
      this.prisma.client.attachment.aggregate({ where: { storedInOrganizationId: organizationId }, _count: true, _sum: { sizeBytes: true, originalSizeBytes: true } }),
      this.movingCount(organizationId),
    ]);
    return {
      allowed,
      configured: !!row,
      provider: row?.provider ?? null,
      accountId: row?.accountId ?? null,
      region: row?.region ?? null,
      bucket: row?.bucket ?? null,
      accessKeyIdMasked: row ? maskSecret(row.accessKeyId) : null,
      state: row?.state ?? null,
      reachable: row?.reachable ?? true,
      lastError: row?.lastError ?? null,
      checkedAt: row?.checkedAt?.toISOString() ?? null,
      files: stored._count,
      moving,
      teamLimitMb: row?.teamLimitMb ?? null,
      memberLimitMb: row?.memberLimitMb ?? null,
      maxFileMb: row?.maxFileMb ?? null,
      usedBytes: (stored._sum.sizeBytes ?? 0) + (stored._sum.originalSizeBytes ?? 0),
    };
  }

  /** Connects it, or changes its key; tried first (written, read back, deleted), and refused with why if it doesn't work. */
  async save(user: AuthenticatedUser, organizationId: string, input: SaveOwnStorageRequest): Promise<OwnStorageSummary> {
    await this.assertAdmin(user, organizationId);
    if (!(await this.allowed(user))) throw new ForbiddenException("Using an organisation's own storage needs Admin > Organisations to allow it, and a role that allows it");
    const accountId = input.provider === "R2" ? (input.accountId ?? null) : null;
    const region = input.provider === "R2" ? null : (input.region ?? null);
    const problem = ownStorageProblem(input.provider, accountId, region, input.bucket);
    if (problem) throw new BadRequestException([problem]);
    const current = await this.prisma.client.organizationStorage.findUnique({ where: { organizationId } });
    if (current?.state === "LEAVING") throw new ConflictException("Its files are being moved back: wait until it's disconnected, then connect it again");
    const moved = !!current && (current.provider !== input.provider || current.accountId !== accountId || current.region !== region || current.bucket !== input.bucket);
    // Its files would be left behind in the old bucket.
    if (moved && (await this.prisma.client.attachment.count({ where: { storedInOrganizationId: organizationId } })) > 0) {
      throw new ConflictException("Files are kept in the current bucket: stop using it first (they're moved back), then connect another");
    }
    if (!current && !input.accessKeyId) throw new BadRequestException(["accessKeyId is needed to connect a bucket"]);
    if (!current && !input.secretAccessKey) throw new BadRequestException(["secretAccessKey is needed to connect a bucket"]);
    const accessKeyId = input.accessKeyId ?? current!.accessKeyId;
    const key = this.config.get<string>("SETTINGS_ENCRYPTION_KEY");
    const secretAccessKeyEnc = input.secretAccessKey ? encryptSecret(input.secretAccessKey, key) : current!.secretAccessKeyEnc;
    const settings = { provider: input.provider, accountId, region, bucket: input.bucket, accessKeyId, secretAccessKeyEnc };
    try {
      await this.storage.tryOwnStorage(ownStorageDriver(settings, key));
    } catch (error) {
      throw new BadRequestException([`The bucket can't be used: ${error instanceof Error ? error.message : String(error)}`]);
    }
    await this.prisma.client.organizationStorage.upsert({
      where: { organizationId },
      create: { organizationId, ...settings, createdByUserId: user.id, checkedAt: new Date() },
      update: { ...settings, state: "ACTIVE", reachable: true, lastError: null, checkedAt: new Date() },
    });
    await this.kick();
    return this.summary(user, organizationId);
  }

  /** Its admins' limits on what goes into it: null clears one, left out keeps it. */
  async setLimits(user: AuthenticatedUser, organizationId: string, input: OwnStorageLimitsRequest): Promise<OwnStorageSummary> {
    await this.assertAdmin(user, organizationId);
    const data = {
      ...(input.teamLimitMb !== undefined && { teamLimitMb: input.teamLimitMb }),
      ...(input.memberLimitMb !== undefined && { memberLimitMb: input.memberLimitMb }),
      ...(input.maxFileMb !== undefined && { maxFileMb: input.maxFileMb }),
    };
    const updated = await this.prisma.client.organizationStorage.updateMany({ where: { organizationId }, data });
    if (updated.count === 0) throw new NotFoundException("This organisation doesn't use its own storage");
    return this.summary(user, organizationId);
  }

  /** Stops using it: its files are moved back to the server's storage, then it's disconnected. */
  async stop(user: AuthenticatedUser, organizationId: string): Promise<OwnStorageSummary> {
    await this.assertAdmin(user, organizationId);
    const updated = await this.prisma.client.organizationStorage.updateMany({ where: { organizationId }, data: { state: "LEAVING" } });
    if (updated.count === 0) throw new NotFoundException("This organisation doesn't use its own storage");
    await this.finishLeaving();
    await this.kick();
    return this.summary(user, organizationId);
  }

  async kick(): Promise<void> {
    await this.queue.add(RELOCATE_JOB, {}, { jobId: `${RELOCATE_JOB}-${Date.now()}`, removeOnComplete: 100, removeOnFail: 100 });
  }

  // The Worker's side.

  /**
   * Files not where their song's owner keeps them: the server's storage, or
   * its team's organisation's own bucket while that's in use and answering.
   * Not one being processed (the Worker writes beside it), nor one whose
   * bucket isn't answering (tried again later).
   */
  private async misplaced(limit: number, organizationId?: string): Promise<Move[]> {
    const rows = await this.prisma.client.$queryRaw<Move[]>`
      SELECT a.id, a."storageKey", a."originalStorageKey", a."mimeType", a."storedInOrganizationId" AS "from", os."organizationId" AS "to"
      FROM "Attachment" a
      JOIN "SongVersion" sv ON sv.id = a."songVersionId"
      LEFT JOIN "Team" t ON t.id = sv."ownerTeamId"
      LEFT JOIN "OrganizationStorage" os ON os."organizationId" = t."organizationId" AND os.state = 'ACTIVE' AND os.reachable
      WHERE a.processing IS NULL
        AND a."storedInOrganizationId" IS DISTINCT FROM os."organizationId"
        AND (a."storedInOrganizationId" IS NULL OR EXISTS (SELECT 1 FROM "OrganizationStorage" src WHERE src."organizationId" = a."storedInOrganizationId" AND src.reachable))
      ORDER BY a."createdAt"
      LIMIT ${limit}`;
    return organizationId ? rows.filter((row) => row.from === organizationId || row.to === organizationId) : rows;
  }

  private async movingCount(organizationId: string): Promise<number> {
    const [row] = await this.prisma.client.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count
      FROM "Attachment" a
      JOIN "SongVersion" sv ON sv.id = a."songVersionId"
      LEFT JOIN "Team" t ON t.id = sv."ownerTeamId"
      LEFT JOIN "OrganizationStorage" os ON os."organizationId" = t."organizationId" AND os.state = 'ACTIVE' AND os.reachable
      WHERE a."storedInOrganizationId" IS DISTINCT FROM os."organizationId"
        AND (a."storedInOrganizationId" = ${organizationId} OR os."organizationId" = ${organizationId})`;
    return Number(row?.count ?? 0);
  }

  /** Moves a batch of files where they belong; queues itself again while more are left. */
  async relocate(): Promise<{ moved: number; failed: number }> {
    const moves = await this.misplaced(BATCH);
    let moved = 0;
    let failed = 0;
    for (const move of moves) {
      try {
        if (await this.move(move)) moved += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`Couldn't move file ${move.id} (${move.from ?? "server"} to ${move.to ?? "server"}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await this.finishLeaving();
    // More to do, and this batch got somewhere: on with the next.
    if (moves.length === BATCH && moved > 0) await this.kick();
    return { moved, failed };
  }

  /** One file (and its kept original) copied, checked, pointed at its new place, and removed from the old one. */
  private async move(move: Move): Promise<boolean> {
    const folder = await mkdtemp(join(tmpdir(), "oneverse-move-"));
    try {
      for (const key of [move.storageKey, ...(move.originalStorageKey ? [move.originalStorageKey] : [])]) {
        const path = join(folder, randomUUID());
        const { sha256, sizeBytes } = await copyToDisk(await this.storage.stream(key, undefined, move.from), path);
        // Stored under its hash: bytes that aren't what the hash says aren't moved (someone's bucket may hand back anything).
        if (sha256 !== key) throw new Error(`its bytes don't match their hash (${sha256})`);
        await this.storage.putFile(path, sha256, sizeBytes, key === move.storageKey ? move.mimeType : "application/octet-stream", move.to);
      }
      const updated = await this.prisma.client.attachment.updateMany({ where: { id: move.id, storedInOrganizationId: move.from }, data: { storedInOrganizationId: move.to } });
      // Changed meanwhile (deleted, or moved by another run): the copy goes if nothing uses it.
      const keys = [move.storageKey, ...(move.originalStorageKey ? [move.originalStorageKey] : [])];
      if (updated.count === 0) {
        await this.storage.deleteUnreferenced(keys, move.to);
        return false;
      }
      await this.storage.deleteUnreferenced(keys, move.from);
      return true;
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  /** A stopped bucket with nothing left in it is disconnected. */
  private async finishLeaving(): Promise<void> {
    const leaving = await this.prisma.client.organizationStorage.findMany({ where: { state: "LEAVING" }, select: { organizationId: true } });
    for (const { organizationId } of leaving) {
      if ((await this.prisma.client.attachment.count({ where: { storedInOrganizationId: organizationId } })) === 0) {
        await this.prisma.client.organizationStorage.delete({ where: { organizationId } });
        this.logger.log(`Organisation ${organizationId}'s own storage disconnected: its files are back`);
      }
    }
  }

  /** Every ten minutes: buckets that stopped answering tried again, and files moved. */
  async tick(): Promise<{ retried: number }> {
    const down = await this.prisma.client.organizationStorage.findMany({ where: { reachable: false } });
    const key = this.config.get<string>("SETTINGS_ENCRYPTION_KEY");
    for (const row of down) {
      try {
        await this.storage.tryOwnStorage(ownStorageDriver(row, key));
        await this.prisma.client.organizationStorage.update({ where: { id: row.id }, data: { reachable: true, lastError: null, checkedAt: new Date() } });
      } catch (error) {
        await this.storage.markUnreachable(row.organizationId, error);
      }
    }
    await this.relocate();
    return { retried: down.length };
  }
}

async function copyToDisk(body: Readable, path: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  body.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    sizeBytes += chunk.length;
  });
  await pipeline(body, createWriteStream(path));
  return { sha256: hash.digest("hex"), sizeBytes };
}

export type { StorageLocation };
