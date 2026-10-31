import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module.js";
import { BackupService } from "./backup.service.js";
import { BackupsController } from "./backups.controller.js";
import { BACKUPS_QUEUE } from "../jobs/jobs.constants.js";
import { BackupsProcessor, BackupsScheduler } from "./backups.processor.js";

@Module({
  imports: [BullModule.registerQueue({ name: BACKUPS_QUEUE }), StorageModule],
  controllers: [BackupsController],
  providers: [BackupService, BackupsProcessor, BackupsScheduler],
})
export class BackupsModule {}
