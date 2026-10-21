import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module.js";
import { BibleImportProcessor } from "./bibles.processor.js";
import { BiblesService } from "./bibles.service.js";
import { SCRIPTURES_QUEUE } from "./bibles.types.js";
import { ScripturesController } from "./scriptures.controller.js";
import { YouVersionService } from "./youversion.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: SCRIPTURES_QUEUE }), StorageModule],
  controllers: [ScripturesController],
  providers: [YouVersionService, BiblesService, BibleImportProcessor],
  exports: [YouVersionService, BiblesService],
})
export class ScripturesModule {}
