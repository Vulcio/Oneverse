import { Module } from "@nestjs/common";
import { MusicBrainzModule } from "../musicbrainz/musicbrainz.module.js";
import { RelatedSongsController } from "./related-songs.controller.js";
import { WorksController } from "./works.controller.js";
import { WorksService } from "./works.service.js";

@Module({
  imports: [MusicBrainzModule],
  controllers: [WorksController, RelatedSongsController],
  providers: [WorksService],
})
export class WorksModule {}
