import { Body, ConflictException, Controller, Delete, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Queue } from "bullmq";
import { SaveBackupConfigSchema } from "@oneverse/core";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { zodDto } from "../common/zod-validation.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { clearBackupSettings, getBackupSettingsSummary, saveBackupSettings } from "./backup-settings.js";
import { BackupService } from "./backup.service.js";
import { BACKUPS_QUEUE } from "../jobs/jobs.constants.js";
import { BACKUP_NOW } from "./backups.processor.js";

class SaveBackupConfigDto extends zodDto(SaveBackupConfigSchema) {}

/** Admin > Backups (issue #119): where the server's backups go, when, and how the last ones went. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/backups")
@UseGuards(GlobalAdminGuard)
export class BackupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupService,
    @InjectQueue(BACKUPS_QUEUE) private readonly queue: Queue,
  ) {}

  @Get()
  async summary() {
    const [config, runs] = await Promise.all([getBackupSettingsSummary(), this.prisma.client.backupRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 })]);
    return {
      ...config,
      runs: runs.map((run) => ({ ...run, databaseBytes: run.databaseBytes === null ? null : Number(run.databaseBytes), filesBytes: Number(run.filesBytes) })),
    };
  }

  @Put("config")
  @HttpCode(HttpStatus.NO_CONTENT)
  save(@Body() dto: SaveBackupConfigDto): Promise<void> {
    return saveBackupSettings(dto);
  }

  @Delete("config")
  @HttpCode(HttpStatus.NO_CONTENT)
  clear(): Promise<void> {
    return clearBackupSettings();
  }

  /** "Back up now": queued for the Worker, like the nightly one; refused while one is running. */
  @Post("run")
  @HttpCode(HttpStatus.ACCEPTED)
  async runNow(): Promise<{ queued: true }> {
    if (await this.backups.running()) {
      throw new ConflictException("A backup is already running");
    }
    await this.queue.add(BACKUP_NOW, { trigger: "manual" }, { removeOnComplete: 50, removeOnFail: 50 });
    return { queued: true };
  }
}
