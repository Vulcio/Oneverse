import { Injectable, PayloadTooLargeException } from "@nestjs/common";
import type { Prisma } from "@oneverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import { capabilitiesOf, teamStorageLimitMb } from "../roles/capabilities.js";

/** Used when no role and no Admin > Storage setting gives a limit. */
export const BUILT_IN_DEFAULT_USER_STORAGE_LIMIT_MB = 50;
export const BUILT_IN_DEFAULT_TEAM_STORAGE_LIMIT_MB = 50;

const BYTES_PER_MB = 1024 * 1024;
const SINGLETON_ID = "singleton";

export interface StorageUsage {
  usedBytes: number;
  /** Null means unlimited (global admins). */
  limitBytes: number | null;
}

/**
 * Storage limits (issue #160). What's attached to a team's song, and its
 * brands' files (issue #279), count against the team's pool, whoever
 * uploaded them; the rest against whoever uploaded it. Counted logically: two uploads of the same file each count,
 * even though content-addressed storage keeps one copy. Avatars don't count.
 * The limits come from storage roles (the largest wins), else Admin >
 * Storage's defaults.
 *
 * Global admins aren't limited - they bulk-upload whole published
 * catalogs, which would blow through any cap - nor is what they upload to a
 * team's songs.
 */
@Injectable()
export class StorageQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolved fresh on every call, like the rest of Admin > Storage. */
  async getDefaultLimitMb(): Promise<{ limitMb: number; isBuiltIn: boolean }> {
    const configured = (await this.settings())?.defaultUserStorageLimitMb;
    return configured == null
      ? { limitMb: BUILT_IN_DEFAULT_USER_STORAGE_LIMIT_MB, isBuiltIn: true }
      : { limitMb: configured, isBuiltIn: false };
  }

  async getDefaultTeamLimitMb(): Promise<{ limitMb: number; isBuiltIn: boolean }> {
    const configured = (await this.settings())?.defaultTeamStorageLimitMb;
    return configured == null
      ? { limitMb: BUILT_IN_DEFAULT_TEAM_STORAGE_LIMIT_MB, isBuiltIn: true }
      : { limitMb: configured, isBuiltIn: false };
  }

  /** Null resets to the built-in default; undefined leaves it. */
  async setDefaultLimits(limits: { userMb?: number | null; teamMb?: number | null }): Promise<void> {
    const data = {
      ...(limits.userMb !== undefined && { defaultUserStorageLimitMb: limits.userMb }),
      ...(limits.teamMb !== undefined && { defaultTeamStorageLimitMb: limits.teamMb }),
    };
    await this.prisma.client.storageSettings.upsert({ where: { id: SINGLETON_ID }, create: { id: SINGLETON_ID, ...data }, update: data });
  }

  /** What each user stores themselves: their uploads, except to teams' songs. */
  async usedBytesByUser(): Promise<Map<string, number>> {
    const rows = await this.prisma.client.attachment.groupBy({
      by: ["uploadedByUserId"],
      where: { uploadedByUserId: { not: null }, songVersion: { ownerTeamId: null } },
      _sum: { sizeBytes: true, originalSizeBytes: true },
    });
    // A lossless original kept beside its Opus copy (issue #182) counts too.
    return new Map(rows.map((row) => [row.uploadedByUserId as string, (row._sum.sizeBytes ?? 0) + (row._sum.originalSizeBytes ?? 0)]));
  }

  /** What each team's pool holds: everything on its songs, and its brands' files (issue #279). */
  async usedBytesByTeam(): Promise<Map<string, number>> {
    const rows = await this.prisma.client.$queryRaw<{ teamId: string; bytes: bigint | null }[]>`
      SELECT "teamId", SUM(bytes) AS bytes FROM (
        SELECT sv."ownerTeamId" AS "teamId", COALESCE(a."sizeBytes", 0) + COALESCE(a."originalSizeBytes", 0) AS bytes
        FROM "Attachment" a JOIN "SongVersion" sv ON sv.id = a."songVersionId"
        WHERE sv."ownerTeamId" IS NOT NULL AND a."storedInOrganizationId" IS NULL
        UNION ALL
        SELECT b."ownerTeamId" AS "teamId", ba."sizeBytes" AS bytes
        FROM "BrandAsset" ba JOIN "Brand" b ON b.id = ba."brandId"
        WHERE b."ownerTeamId" IS NOT NULL
      ) used
      GROUP BY "teamId"`;
    return new Map(rows.map((row) => [row.teamId, Number(row.bytes ?? 0)]));
  }

  /** A user's own limit: their largest storage role's, else the default; none for global admins. */
  async userLimitBytes(userId: string, isGlobalAdmin: boolean): Promise<number | null> {
    if (isGlobalAdmin) return null;
    const [{ storageLimitMb }, { limitMb }] = await Promise.all([capabilitiesOf(this.prisma.client, userId), this.getDefaultLimitMb()]);
    return (storageLimitMb ?? limitMb) * BYTES_PER_MB;
  }

  /** A team's pool: its largest storage role's, else the teams' default. */
  async teamLimitBytes(teamId: string): Promise<number> {
    const [own, { limitMb }] = await Promise.all([teamStorageLimitMb(this.prisma.client, teamId), this.getDefaultTeamLimitMb()]);
    return (own ?? limitMb) * BYTES_PER_MB;
  }

  async getUsage(userId: string): Promise<StorageUsage> {
    const [user, aggregate] = await Promise.all([
      this.prisma.client.user.findUniqueOrThrow({ where: { id: userId }, select: { isGlobalAdmin: true } }),
      this.prisma.client.attachment.aggregate({
        where: { uploadedByUserId: userId, songVersion: { ownerTeamId: null } },
        _sum: { sizeBytes: true, originalSizeBytes: true },
      }),
    ]);
    return { usedBytes: (aggregate._sum.sizeBytes ?? 0) + (aggregate._sum.originalSizeBytes ?? 0), limitBytes: await this.userLimitBytes(userId, user.isGlobalAdmin) };
  }

  async getTeamUsage(teamId: string): Promise<StorageUsage> {
    const [aggregate, brands] = await Promise.all([
      this.prisma.client.attachment.aggregate({
        // Not what's in its organisation's own bucket (issue #206): that's theirs to pay for.
        where: { songVersion: { ownerTeamId: teamId }, storedInOrganizationId: null },
        _sum: { sizeBytes: true, originalSizeBytes: true },
      }),
      // Its brands' logos, backgrounds and fonts (issue #279).
      this.prisma.client.brandAsset.aggregate({ where: { brand: { ownerTeamId: teamId } }, _sum: { sizeBytes: true } }),
    ]);
    return { usedBytes: (aggregate._sum.sizeBytes ?? 0) + (aggregate._sum.originalSizeBytes ?? 0) + (brands._sum.sizeBytes ?? 0), limitBytes: await this.teamLimitBytes(teamId) };
  }

  /**
   * Throws 413 if storing `incomingBytes` more would go over the limit: the
   * song's team's pool when it's a team's song, else the uploader's own.
   */
  async assertCanStore(userId: string, incomingBytes: number, songVersionId?: string): Promise<void> {
    const song = songVersionId
      ? await this.prisma.client.songVersion.findUnique({ where: { id: songVersionId }, select: { ownerTeamId: true } })
      : null;
    if (song?.ownerTeamId) return this.assertCanStoreForTeam(userId, song.ownerTeamId, incomingBytes);
    const { usedBytes, limitBytes } = await this.getUsage(userId);
    if (limitBytes !== null && usedBytes + incomingBytes > limitBytes) {
      throw new PayloadTooLargeException({
        code: "STORAGE_LIMIT_EXCEEDED",
        message: `This upload would exceed your storage limit (${formatMb(usedBytes)} of ${formatMb(limitBytes)} used).`,
        usedBytes,
        limitBytes,
      });
    }
  }

  /** Throws 413 if storing `incomingBytes` more in a team's pool would go over its limit - a team's song's file, a team's brand's (issue #279). */
  async assertCanStoreForTeam(userId: string, teamId: string, incomingBytes: number): Promise<void> {
    const uploader = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { isGlobalAdmin: true } });
    if (uploader?.isGlobalAdmin) return;
    const { usedBytes, limitBytes } = await this.getTeamUsage(teamId);
    if (usedBytes + incomingBytes > (limitBytes ?? Infinity)) {
      throw new PayloadTooLargeException({
        code: "TEAM_STORAGE_LIMIT_EXCEEDED",
        message: `This upload would exceed the team's storage limit (${formatMb(usedBytes)} of ${formatMb(limitBytes ?? 0)} used).`,
        usedBytes,
        limitBytes,
      });
    }
  }

  /**
   * Throws 413 if a file going into an organisation's own bucket (issue #206)
   * is over the limits its admins set there: the largest file, what the
   * song's team keeps there, what the uploader has put there. Global admins
   * aren't held to them, as with the server's own. `wholeFile: false` when
   * `incomingBytes` is several files (stems), held to the pools only.
   */
  async assertCanStoreInOrganization(organizationId: string, userId: string, incomingBytes: number, songVersionId: string, { wholeFile = true } = {}): Promise<void> {
    const [limits, uploader, song] = await Promise.all([
      this.prisma.client.organizationStorage.findUnique({ where: { organizationId }, select: { teamLimitMb: true, memberLimitMb: true, maxFileMb: true } }),
      this.prisma.client.user.findUnique({ where: { id: userId }, select: { isGlobalAdmin: true } }),
      this.prisma.client.songVersion.findUnique({ where: { id: songVersionId }, select: { ownerTeamId: true } }),
    ]);
    if (!limits || uploader?.isGlobalAdmin) return;
    if (wholeFile && limits.maxFileMb != null && incomingBytes > limits.maxFileMb * BYTES_PER_MB) {
      throw new PayloadTooLargeException({
        code: "ORGANIZATION_FILE_TOO_LARGE",
        message: `This file is larger than your organisation allows (${limits.maxFileMb} MB).`,
        limitBytes: limits.maxFileMb * BYTES_PER_MB,
      });
    }
    const used = async (where: Prisma.AttachmentWhereInput) => {
      const sum = await this.prisma.client.attachment.aggregate({ where: { storedInOrganizationId: organizationId, ...where }, _sum: { sizeBytes: true, originalSizeBytes: true } });
      return (sum._sum.sizeBytes ?? 0) + (sum._sum.originalSizeBytes ?? 0);
    };
    if (limits.teamLimitMb != null && song?.ownerTeamId) {
      const usedBytes = await used({ songVersion: { ownerTeamId: song.ownerTeamId } });
      const limitBytes = limits.teamLimitMb * BYTES_PER_MB;
      if (usedBytes + incomingBytes > limitBytes) {
        throw new PayloadTooLargeException({
          code: "TEAM_STORAGE_LIMIT_EXCEEDED",
          message: `This upload would exceed the team's storage limit in your organisation (${formatMb(usedBytes)} of ${formatMb(limitBytes)} used).`,
          usedBytes,
          limitBytes,
        });
      }
    }
    if (limits.memberLimitMb != null) {
      const usedBytes = await used({ uploadedByUserId: userId });
      const limitBytes = limits.memberLimitMb * BYTES_PER_MB;
      if (usedBytes + incomingBytes > limitBytes) {
        throw new PayloadTooLargeException({
          code: "STORAGE_LIMIT_EXCEEDED",
          message: `This upload would exceed your storage limit in your organisation (${formatMb(usedBytes)} of ${formatMb(limitBytes)} used).`,
          usedBytes,
          limitBytes,
        });
      }
    }
  }

  private settings() {
    return this.prisma.client.storageSettings.findUnique({
      where: { id: SINGLETON_ID },
      select: { defaultUserStorageLimitMb: true, defaultTeamStorageLimitMb: true },
    });
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}
