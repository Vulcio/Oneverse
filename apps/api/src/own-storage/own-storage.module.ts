import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { OWN_STORAGE_QUEUE } from "../jobs/jobs.constants.js";
import { StorageModule } from "../storage/storage.module.js";
import { OwnStorageController } from "./own-storage.controller.js";
import { OwnStorageProcessor, OwnStorageScheduler } from "./own-storage.processor.js";
import { OwnStorageService } from "./own-storage.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: OWN_STORAGE_QUEUE }), StorageModule],
  controllers: [OwnStorageController],
  providers: [OwnStorageService, OwnStorageProcessor, OwnStorageScheduler],
  exports: [OwnStorageService],
})
export class OwnStorageModule {}
