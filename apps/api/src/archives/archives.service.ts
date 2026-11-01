import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { ArchiveScopeName } from "@oneverse/core";
import type { Prisma } from "@oneverse/db";
import type { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { isValidAddress, signAddress } from "../common/utils/signed-address.js";
import { ARCHIVES_QUEUE } from "../jobs/jobs.constants.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SongHistoryService } from "../song-versions/song-history.service.js";
import { StorageQuotaService } from "../storage/storage-quota.service.js";
import { StorageService } from "../storage/storage.service.js";
import { exportArchive, fileName, type ArchiveOwner } from "./archive-export.js";
import { importArchiveContent, readArchiveContent } from "./archive-import.js";
import { workFolder } from "./archive-zip.js";

/** How long an archive can be downloaded. */
export const ARCHIVE_KEPT_DAYS = 14;
/** The weekly archives kept for each owner, the newest. */
export const WEEKLY_KEPT = 2;
/** The biggest archive that can be imported. */
export const ARCHIVE_IMPORT_MAX_BYTES = 8 * 1024 * 1024 * 1024;
/** How long a download link works. */
const LINK_LIFETIME_MS = 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export const EXPORT_JOB = "export";
export const IMPORT_JOB = "import";
export const ARCHIVE_TICK = "archive-tick";

type Row = Prisma.ContentArchiveGetPayload<object>;

export interface ArchiveSummary {
  id: string;
  kind: "EXPORT" | "IMPORT";
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  trigger: "MANUAL" | "WEEKLY";
  filename: string | null;
  sizeBytes: number | null;
  summary: unknown;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
  /** A download's address under the API (no Bearer token: it's signed), while it can be. */
  downloadPath: string | null;
}

/**
 * People's, teams' and organisations' own backups (issue #351): an archive of
 * everything they own, made by the Worker on demand or weekly and kept two
 * weeks, and an archive imported back. Their admins only, for a team or an
 * organisation; anyone, for their own.
 */
@Injectable()
export class ArchivesService {
  private readonly logger = new Logger(ArchivesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
    private readonly policy: AccessPolicyService,
    private readonly history: SongHistoryService,
    @InjectQueue(ARCHIVES_QUEUE) private readonly queue: Queue,
  ) {}

  /** The owner `scope`/`id` names, once `user` may manage its archives. */
  async ownerFor(user: AuthenticatedUser, scope: ArchiveScopeName, id?: string): Promise<ArchiveOwner> {
    const db = this.prisma.client;
    if (scope === "user") return { scope: "USER", userId: user.id };
    if (!id) throw new BadRequestException(["id is needed for a team's or an organisation's archives"]);
    if (scope === "team") {
      const team = await db.team.findUnique({ where: { id }, select: { usesSongverse: true } });
      if (!team) throw new NotFoundException("Team not found");
      if (!team.usesSongverse) throw new BadRequestException(["This group only plans: it owns no songs, songbooks or sets"]);
      if (!user.isGlobalAdmin && (await this.policy.teamRole(user.id, id)) !== "ADMIN") throw new ForbiddenException("Team admin role required");
      return { scope: "TEAM", teamId: id };
    }
    const organization = await db.organization.findUnique({ where: { id }, select: { id: true } });
    if (!organization) throw new NotFoundException("Organisation not found");
    if (!user.isGlobalAdmin) {
      const membership = await db.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: id, userId: user.id } }, select: { role: true } });
      if (membership?.role !== "ADMIN") throw new ForbiddenException("Organisation admin role required");
    }
    return { scope: "ORGANIZATION", organizationId: id };
  }

  async list(user: AuthenticatedUser, scope: ArchiveScopeName, id?: string): Promise<{ weekly: boolean; archives: ArchiveSummary[] }> {
    const owner = await this.ownerFor(user, scope, id);
    const [rows, schedule] = await Promise.all([
      this.prisma.client.contentArchive.findMany({ where: whereOwner(owner), orderBy: { createdAt: "desc" }, take: 20 }),
      this.prisma.client.archiveSchedule.findFirst({ where: whereOwner(owner), select: { id: true } }),
    ]);
    return { weekly: !!schedule, archives: rows.map((row) => this.summary(row)) };
  }

  async get(user: AuthenticatedUser, archiveId: string): Promise<ArchiveSummary> {
    return this.summary(await this.ownRow(user, archiveId));
  }

  /** An archive made now; the one already being made, if there's one. */
  async requestExport(user: AuthenticatedUser, scope: ArchiveScopeName, id?: string): Promise<ArchiveSummary> {
    const owner = await this.ownerFor(user, scope, id);
    const going = await this.prisma.client.contentArchive.findFirst({ where: { ...whereOwner(owner), kind: "EXPORT", status: { in: ["PENDING", "RUNNING"] } } });
    if (going) return this.summary(going);
    return this.summary(await this.queueExport(owner, "MANUAL", user.id));
  }

  async queueExport(owner: ArchiveOwner, trigger: "MANUAL" | "WEEKLY", requestedByUserId: string | null): Promise<Row> {
    const row = await this.prisma.client.contentArchive.create({ data: { kind: "EXPORT", trigger, scope: owner.scope, ...ownerColumns(owner), requestedByUserId } });
    await this.queue.add(EXPORT_JOB, { archiveId: row.id }, { removeOnComplete: 100, removeOnFail: 100 });
    return row;
  }

  async setSchedule(user: AuthenticatedUser, scope: ArchiveScopeName, id: string | undefined, weekly: boolean): Promise<{ weekly: boolean }> {
    const owner = await this.ownerFor(user, scope, id);
    const where = whereOwner(owner);
    if (!weekly) await this.prisma.client.archiveSchedule.deleteMany({ where });
    else if ((await this.prisma.client.archiveSchedule.count({ where })) === 0) {
      await this.prisma.client.archiveSchedule.create({ data: { scope: owner.scope, ...ownerColumns(owner), createdByUserId: user.id } });
    }
    return { weekly };
  }

  /** An uploaded archive (a file on disk, removed here), stored and queued to be imported. */
  async requestImport(user: AuthenticatedUser, scope: ArchiveScopeName, id: string | undefined, file: { path: string; originalname: string } | undefined): Promise<ArchiveSummary> {
    if (!file) throw new BadRequestException(["file is needed: the archive to import"]);
    try {
      const owner = await this.ownerFor(user, scope, id);
      const { size } = await stat(file.path);
      if (size === 0) throw new BadRequestException(["The file is empty"]);
      const sha256 = await hashFile(file.path);
      await this.storage.putFile(file.path, sha256, size, "application/zip");
      const row = await this.prisma.client.contentArchive.create({
        data: { kind: "IMPORT", scope: owner.scope, ...ownerColumns(owner), requestedByUserId: user.id, storageKey: sha256, sizeBytes: BigInt(size), filename: file.originalname.slice(0, 200) },
      });
      await this.queue.add(IMPORT_JOB, { archiveId: row.id }, { removeOnComplete: 100, removeOnFail: 100 });
      return this.summary(row);
    } finally {
      await rm(file.path, { force: true });
    }
  }

  /** An archive's file deleted, and the archive with it. */
  async remove(user: AuthenticatedUser, archiveId: string): Promise<void> {
    const row = await this.ownRow(user, archiveId);
    if (row.status === "RUNNING") throw new BadRequestException(["This archive is being made or imported: wait for it to finish"]);
    await this.prisma.client.contentArchive.delete({ where: { id: row.id } });
    if (row.storageKey) await this.storage.deleteUnreferenced([row.storageKey]);
  }

  /** The archive a download link is for, if it's valid and the archive's still there. */
  async forDownload(archiveId: string, expires: string | undefined, signature: string | undefined): Promise<{ storageKey: string; filename: string; sizeBytes: number } | null> {
    const row = await this.prisma.client.contentArchive.findUnique({ where: { id: archiveId } });
    if (!row?.storageKey || row.kind !== "EXPORT" || row.status !== "DONE") return null;
    if (!isValidAddress("archives", `${row.id}.${row.storageKey}`, expires, signature)) return null;
    return { storageKey: row.storageKey, filename: row.filename ?? "oneverse-archive.zip", sizeBytes: Number(row.sizeBytes ?? 0) };
  }

  // The Worker's side.

  async runExport(archiveId: string): Promise<unknown> {
    const row = await this.start(archiveId);
    if (!row) return { skipped: true };
    const folder = await workFolder();
    try {
      const archive = await exportArchive(this.prisma, this.storage, ownerOf(row), folder.path);
      await this.storage.putFile(archive.path, archive.sha256, archive.sizeBytes, "application/zip");
      const now = new Date();
      await this.prisma.client.contentArchive.update({
        where: { id: row.id },
        data: {
          status: "DONE",
          storageKey: archive.sha256,
          sizeBytes: BigInt(archive.sizeBytes),
          filename: `oneverse-${fileName(archive.name)}-${now.toISOString().slice(0, 10)}.zip`,
          summary: archive.counts,
          finishedAt: now,
          expiresAt: new Date(now.getTime() + ARCHIVE_KEPT_DAYS * DAY),
        },
      });
      if (row.trigger === "WEEKLY") await this.dropOlderWeekly(row);
      return archive.counts;
    } catch (error) {
      await this.fail(row.id, error);
      throw error;
    } finally {
      await folder.cleanUp();
    }
  }

  async runImport(archiveId: string): Promise<unknown> {
    const row = await this.start(archiveId);
    if (!row) return { skipped: true };
    const folder = await workFolder();
    const stored: string[] = [];
    try {
      if (!row.storageKey || !row.requestedByUserId) throw new Error("The archive to import is gone");
      const size = Number(row.sizeBytes ?? 0);
      const present = new Set<string>();
      const content = await readArchiveContent(await this.storage.stream(row.storageKey), folder.path, size * 4 + 256 * 1024 * 1024, async (sha256, path, bytes) => {
        await this.storage.putFile(path, sha256, bytes, "application/octet-stream");
        present.add(sha256);
        stored.push(sha256);
      });
      // Someone who can't manage the destination any more can't bring anything in.
      const importer = await this.prisma.client.user.findUnique({ where: { id: row.requestedByUserId }, select: { id: true, email: true, isGlobalAdmin: true } });
      if (!importer) throw new Error("Whoever imported it isn't here any more");
      const owner = ownerOf(row);
      await this.ownerFor({ ...importer, isReviewer: false }, owner.scope === "USER" ? "user" : owner.scope === "TEAM" ? "team" : "organization", owner.scope === "TEAM" ? owner.teamId : owner.scope === "ORGANIZATION" ? owner.organizationId : undefined);
      const summary = await importArchiveContent({ prisma: this.prisma, storage: this.storage, quota: this.quota, policy: this.policy, history: this.history }, content, owner, importer.id, present);
      await this.prisma.client.contentArchive.update({ where: { id: row.id }, data: { status: "DONE", summary: summary as object, finishedAt: new Date(), storageKey: null } });
      return summary;
    } catch (error) {
      // Most often the archive's fault (not a zip, too new, over the storage limit): said on the archive, not a failed job for Admin.
      await this.fail(row.id, error);
      return { failed: error instanceof Error ? error.message : String(error) };
    } finally {
      await folder.cleanUp();
      // The uploaded archive, and any of its files nothing came to use.
      await this.prisma.client.contentArchive.update({ where: { id: row.id }, data: { storageKey: null } }).catch(() => undefined);
      await this.storage.deleteUnreferenced([...(row.storageKey ? [row.storageKey] : []), ...stored]).catch((error: unknown) => this.logger.warn(`Clean-up after import ${row.id}: ${String(error)}`));
    }
  }

  /** Hourly: the weekly archives that are due, and the files of archives past their time deleted. */
  async tick(now = new Date()): Promise<{ queued: number; expired: number }> {
    const db = this.prisma.client;
    const due = await db.archiveSchedule.findMany({ where: { OR: [{ lastRunAt: null }, { lastRunAt: { lt: new Date(now.getTime() - 7 * DAY) } }] }, take: 200 });
    for (const schedule of due) {
      await db.archiveSchedule.update({ where: { id: schedule.id }, data: { lastRunAt: now } });
      await this.queueExport(ownerOf(schedule), "WEEKLY", schedule.createdByUserId);
    }
    const expired = await db.contentArchive.findMany({ where: { kind: "EXPORT", storageKey: { not: null }, expiresAt: { lt: now } }, select: { id: true, storageKey: true } });
    if (expired.length) {
      await db.contentArchive.updateMany({ where: { id: { in: expired.map((row) => row.id) } }, data: { storageKey: null } });
      await this.storage.deleteUnreferenced(expired.map((row) => row.storageKey!));
    }
    // What's left of old ones, after three months.
    await db.contentArchive.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * DAY) }, status: { in: ["DONE", "FAILED"] }, storageKey: null } });
    // One stuck (its process gone), failed after a day.
    await db.contentArchive.updateMany({ where: { status: { in: ["PENDING", "RUNNING"] }, createdAt: { lt: new Date(now.getTime() - DAY) } }, data: { status: "FAILED", error: "It stopped before it finished" } });
    return { queued: due.length, expired: expired.length };
  }

  private async start(archiveId: string): Promise<Row | null> {
    const claimed = await this.prisma.client.contentArchive.updateMany({ where: { id: archiveId, status: "PENDING" }, data: { status: "RUNNING", startedAt: new Date() } });
    if (claimed.count === 0) return null;
    return this.prisma.client.contentArchive.findUniqueOrThrow({ where: { id: archiveId } });
  }

  private async fail(archiveId: string, error: unknown) {
    const message = error instanceof Error ? (typeof (error as { getResponse?: () => unknown }).getResponse === "function" ? describeHttp(error) : error.message) : String(error);
    this.logger.warn(`Archive ${archiveId} failed: ${message}`);
    await this.prisma.client.contentArchive.update({ where: { id: archiveId }, data: { status: "FAILED", error: message.slice(0, 1000), finishedAt: new Date() } }).catch(() => undefined);
  }

  private async dropOlderWeekly(row: Row) {
    const older = await this.prisma.client.contentArchive.findMany({
      where: { ...whereOwner(ownerOf(row)), kind: "EXPORT", trigger: "WEEKLY", status: "DONE", storageKey: { not: null } },
      orderBy: { createdAt: "desc" },
      skip: WEEKLY_KEPT,
      select: { id: true, storageKey: true },
    });
    if (older.length === 0) return;
    await this.prisma.client.contentArchive.updateMany({ where: { id: { in: older.map((one) => one.id) } }, data: { storageKey: null } });
    await this.storage.deleteUnreferenced(older.map((one) => one.storageKey!));
  }

  private async ownRow(user: AuthenticatedUser, archiveId: string): Promise<Row> {
    const row = await this.prisma.client.contentArchive.findUnique({ where: { id: archiveId } });
    if (!row) throw new NotFoundException("Archive not found");
    const owner = ownerOf(row);
    await this.ownerFor(user, owner.scope === "USER" ? "user" : owner.scope === "TEAM" ? "team" : "organization", owner.scope === "TEAM" ? owner.teamId : owner.scope === "ORGANIZATION" ? owner.organizationId : undefined).catch(() => {
      throw new NotFoundException("Archive not found");
    });
    if (owner.scope === "USER" && owner.userId !== user.id) throw new NotFoundException("Archive not found");
    return row;
  }

  private summary(row: Row): ArchiveSummary {
    const downloadable = row.kind === "EXPORT" && row.status === "DONE" && !!row.storageKey;
    let downloadPath: string | null = null;
    if (downloadable) {
      const expires = Date.now() + LINK_LIFETIME_MS;
      const query = new URLSearchParams({ expires: String(expires), signature: signAddress("archives", `${row.id}.${row.storageKey}`, expires) });
      downloadPath = `/archives/${encodeURIComponent(row.id)}/download?${query}`;
    }
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      trigger: row.trigger,
      filename: row.filename,
      sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
      summary: row.summary,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      expiresAt: row.kind === "EXPORT" ? (row.expiresAt?.toISOString() ?? null) : null,
      downloadPath,
    };
  }
}

function ownerColumns(owner: ArchiveOwner) {
  return owner.scope === "USER" ? { userId: owner.userId } : owner.scope === "TEAM" ? { teamId: owner.teamId } : { organizationId: owner.organizationId };
}

function whereOwner(owner: ArchiveOwner) {
  return { scope: owner.scope, ...ownerColumns(owner) };
}

function ownerOf(row: { scope: "USER" | "TEAM" | "ORGANIZATION"; userId: string | null; teamId: string | null; organizationId: string | null }): ArchiveOwner {
  if (row.scope === "USER" && row.userId) return { scope: "USER", userId: row.userId };
  if (row.scope === "TEAM" && row.teamId) return { scope: "TEAM", teamId: row.teamId };
  if (row.scope === "ORGANIZATION" && row.organizationId) return { scope: "ORGANIZATION", organizationId: row.organizationId };
  throw new Error("The archive's owner is gone");
}

function describeHttp(error: Error): string {
  const response = (error as unknown as { getResponse: () => unknown }).getResponse();
  if (response && typeof response === "object" && "message" in response) {
    const message = (response as { message: unknown }).message;
    return Array.isArray(message) ? message.join("; ") : String(message);
  }
  return error.message;
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}
