import { ProgressionsController } from "./progressions.controller.js";
import { ChordShapesController } from "./chord-shapes.controller.js";
import { Module } from "@nestjs/common";
import { ArtworkModule } from "../artwork/artwork.module.js";
import { ArtistsModule } from "../artists/artists.module.js";
import { LookupsModule } from "../lookups/lookups.module.js";
import { MetadataModule } from "../metadata/metadata.module.js";
import { MusicBrainzModule } from "../musicbrainz/musicbrainz.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { SongVersionsController } from "./song-versions.controller.js";
import { SongRepeatsService } from "./song-repeats.service.js";
import { SongHistoryService } from "./song-history.service.js";
import { SongVersionsService } from "./song-versions.service.js";

@Module({
  imports: [MusicBrainzModule, StorageModule, ArtworkModule, MetadataModule, ArtistsModule, LookupsModule],
  controllers: [SongVersionsController, ChordShapesController, ProgressionsController],
  providers: [SongVersionsService, SongHistoryService, SongRepeatsService],
  exports: [SongVersionsService, SongHistoryService, SongRepeatsService],
})
export class SongVersionsModule {}
