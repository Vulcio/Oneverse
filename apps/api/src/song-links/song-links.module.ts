import { Module } from "@nestjs/common";
import { SongLinksController } from "./song-links.controller.js";
import { SongLinksService } from "./song-links.service.js";

@Module({
  controllers: [SongLinksController],
  providers: [SongLinksService],
  exports: [SongLinksService],
})
export class SongLinksModule {}
