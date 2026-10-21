import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { BadRequestException, Injectable } from "@nestjs/common";
import { runSeed } from "@oneverse/db";
import { MissingEncryptionKeyError } from "@oneverse/secret-crypto";
import {
  clearEmailAuthConfig as clearEmailAuthConfigSetting,
  clearGoogleAuthConfig as clearGoogleAuthConfigSetting,
  getAuthConfigSummary,
  saveAuthConfig as saveAuthConfigSetting,
  type AuthConfigSummary,
  type SaveAuthConfigInput,
} from "../auth/auth-settings.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { BUILT_IN_DEFAULT_TEAM_STORAGE_LIMIT_MB, BUILT_IN_DEFAULT_USER_STORAGE_LIMIT_MB, StorageQuotaService } from "../storage/storage-quota.service.js";
import { StorageService, type SaveStorageConfigInput } from "../storage/storage.service.js";

// packages/db is always a sibling two levels up from wherever the API
// process's cwd is - true both in local dev (pnpm runs each package's
// scripts from that package's own directory) and in the deployed
// container (Dockerfile.api sets WORKDIR /repo/apps/api and copies
// packages/ alongside it). Only used here to read the migrations folder
// on disk - nothing in this service shells out to a subprocess.
const MIGRATIONS_DIR = resolve(process.cwd(), "../../packages/db/prisma/migrations");

export interface AdminCommandResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
}

interface AppliedMigration {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
  ) {}

  async storageStats() {
    const [{ driver, source }, aggregate, grouped] = await Promise.all([
      this.storage.describe(),
      this.prisma.client.attachment.aggregate({
        _count: { _all: true },
        _sum: { sizeBytes: true, originalSizeBytes: true },
      }),
      this.prisma.client.attachment.groupBy({ by: ["type"], _count: { _all: true } }),
    ]);

    return {
      driver,
      source,
      attachmentCount: aggregate._count._all,
      totalBytes: (aggregate._sum.sizeBytes ?? 0) + (aggregate._sum.originalSizeBytes ?? 0),
      byType: Object.fromEntries(grouped.map((g) => [g.type, g._count._all])),
    };
  }

  async getStorageLimits() {
    const [user, team] = await Promise.all([this.quota.getDefaultLimitMb(), this.quota.getDefaultTeamLimitMb()]);
    return {
      defaultLimitMb: user.limitMb,
      isBuiltIn: user.isBuiltIn,
      builtInDefaultMb: BUILT_IN_DEFAULT_USER_STORAGE_LIMIT_MB,
      defaultTeamLimitMb: team.limitMb,
      teamIsBuiltIn: team.isBuiltIn,
      builtInTeamDefaultMb: BUILT_IN_DEFAULT_TEAM_STORAGE_LIMIT_MB,
    };
  }

  saveStorageLimits(limits: { defaultLimitMb?: number | null; defaultTeamLimitMb?: number | null }): Promise<void> {
    return this.quota.setDefaultLimits({ userMb: limits.defaultLimitMb, teamMb: limits.defaultTeamLimitMb });
  }

  getStorageConfig(): ReturnType<StorageService["getConfigSummary"]> {
    return this.storage.getConfigSummary();
  }

  async saveStorageConfig(input: SaveStorageConfigInput): Promise<void> {
    try {
      await this.storage.saveConfig(input);
    } catch (error) {
      if (error instanceof MissingEncryptionKeyError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  clearStorageConfig(): Promise<void> {
    return this.storage.clearConfig();
  }

  getAuthConfig(): Promise<AuthConfigSummary> {
    return getAuthConfigSummary();
  }

  async saveAuthConfig(input: SaveAuthConfigInput): Promise<void> {
    try {
      await saveAuthConfigSetting(input);
    } catch (error) {
      if (error instanceof MissingEncryptionKeyError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  clearEmailAuthConfig(): Promise<void> {
    return clearEmailAuthConfigSetting();
  }

  clearGoogleAuthConfig(): Promise<void> {
    return clearGoogleAuthConfigSetting();
  }

  /**
   * Read-only: compares the migration folders shipped with this
   * deployment against Prisma's own `_prisma_migrations` bookkeeping
   * table. There's no supported way to run `prisma migrate deploy`
   * in-process (it's CLI-only), so applying migrations stays a manual
   * step - this just tells you whether one is needed.
   */
  async migrationStatus(): Promise<AdminCommandResult> {
    try {
      const onDisk = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

      const applied = await this.prisma.client.$queryRawUnsafe<AppliedMigration[]>(
        `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at ASC`,
      );
      const appliedNames = new Set(
        applied.filter((m) => m.finished_at !== null && m.rolled_back_at === null).map((m) => m.migration_name),
      );
      const pending = onDisk.filter((name) => !appliedNames.has(name));

      const stdout =
        pending.length === 0
          ? `Up to date - all ${onDisk.length} migration(s) applied.`
          : `${pending.length} pending migration(s):\n${pending.map((name) => `  - ${name}`).join("\n")}\n\nApply with: prisma migrate deploy (from packages/db, in the API container)`;

      return { ok: true, command: "Check migration status", stdout, stderr: "" };
    } catch (error) {
      return {
        ok: false,
        command: "Check migration status",
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Runs the seed script in-process (no subprocess) - see packages/db/src/seed.ts. */
  async runSeed(): Promise<AdminCommandResult> {
    try {
      const lines = await runSeed(() => {});
      return { ok: true, command: "Run seed script", stdout: lines.join("\n"), stderr: "" };
    } catch (error) {
      return {
        ok: false,
        command: "Run seed script",
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
