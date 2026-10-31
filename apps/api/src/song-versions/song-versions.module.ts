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
import { SongBinController, SongUsageController } from "./song-bin.controller.js";
import { SongBinService } from "./song-bin.service.js";
import { SongRepeatsService } from "./song-repeats.service.js";
import { SongHistoryService } from "./song-history.service.js";
import { SongVersionsService } from "./song-versions.service.js";
import { SetlistAccessService } from "../setlists/setlist-access.service.js";

@Module({
  imports: [MusicBrainzModule, StorageModule, ArtworkModule, MetadataModule, ArtistsModule, LookupsModule],
  controllers: [SongVersionsController, SongUsageController, SongBinController, ChordShapesController, ProgressionsController],
  // SetlistAccessService: the songs that can go in a set, for its Add songs (issue #328).
  providers: [SongVersionsService, SongHistoryService, SongRepeatsService, SetlistAccessService, SongBinService],
  exports: [SongVersionsService, SongHistoryService, SongRepeatsService, SetlistAccessService],
})
export class SongVersionsModule {}
