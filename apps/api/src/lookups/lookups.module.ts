import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ArtistsModule } from "../artists/artists.module.js";
import { ArtworkModule } from "../artwork/artwork.module.js";
import { MusicBrainzModule } from "../musicbrainz/musicbrainz.module.js";
import { BACKFILLS_QUEUE, LOOKUPS_QUEUE } from "../jobs/jobs.constants.js";
import { LookupsController } from "./lookups.controller.js";
import { BackfillsProcessor, LookupsProcessor } from "./lookups.processor.js";
import { LookupsService } from "./lookups.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: LOOKUPS_QUEUE }, { name: BACKFILLS_QUEUE }), ArtworkModule, ArtistsModule, MusicBrainzModule],
  controllers: [LookupsController],
  providers: [LookupsService, LookupsProcessor, BackfillsProcessor],
  exports: [LookupsService],
})
export class LookupsModule {}
