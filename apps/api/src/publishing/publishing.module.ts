import { Module } from "@nestjs/common";
import { SongVersionsModule } from "../song-versions/song-versions.module.js";
import { PublishingService } from "./publishing.service.js";
import { SongFoldService } from "./song-fold.service.js";
import { SongPublishingController, SubmissionsController } from "./publishing.controller.js";

@Module({
  imports: [SongVersionsModule],
  controllers: [SongPublishingController, SubmissionsController],
  providers: [PublishingService, SongFoldService],
})
export class PublishingModule {}
