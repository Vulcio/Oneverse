import { Module } from "@nestjs/common";
import { ScripturesController } from "./scriptures.controller.js";
import { YouVersionService } from "./youversion.service.js";

@Module({
  controllers: [ScripturesController],
  providers: [YouVersionService],
  exports: [YouVersionService],
})
export class ScripturesModule {}
