import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { AttachmentsModule } from "../attachments/attachments.module.js";
import { STEM_SEPARATION_QUEUE } from "../jobs/jobs.constants.js";
import { StorageModule } from "../storage/storage.module.js";
import { AdminStemSeparationController, SonicServersController, StemSeparationController } from "./stem-separation.controller.js";
import { StemSeparationProcessor, StemSeparationScheduler } from "./stem-separation.processor.js";
import { StemSeparationService } from "./stem-separation.service.js";

/** Splitting recordings into stems with our Demucs API (issue #63). */
@Module({
  imports: [BullModule.registerQueue({ name: STEM_SEPARATION_QUEUE }), AttachmentsModule, StorageModule],
  controllers: [StemSeparationController, SonicServersController, AdminStemSeparationController],
  providers: [StemSeparationService, StemSeparationProcessor, StemSeparationScheduler],
})
export class StemSeparationModule {}
