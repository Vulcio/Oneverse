import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module.js";
import { ARCHIVES_QUEUE } from "../jobs/jobs.constants.js";
import { SongVersionsModule } from "../song-versions/song-versions.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { ArchivesController } from "./archives.controller.js";
import { ArchivesProcessor, ArchivesScheduler } from "./archives.processor.js";
import { ArchivesService } from "./archives.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: ARCHIVES_QUEUE }), StorageModule, AccessModule, SongVersionsModule],
  controllers: [ArchivesController],
  providers: [ArchivesService, ArchivesProcessor, ArchivesScheduler],
})
export class ArchivesModule {}
