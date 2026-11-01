import { Module } from "@nestjs/common";
import { MusicBrainzModule } from "../musicbrainz/musicbrainz.module.js";
import { PluginsModule } from "../plugins/plugins.module.js";
import { FindChordsController } from "./find-chords.controller.js";
import { FindChordsService } from "./find-chords.service.js";
import { MetadataController } from "./metadata.controller.js";
import { MetadataService } from "./metadata.service.js";

@Module({
  imports: [MusicBrainzModule, PluginsModule],
  controllers: [MetadataController, FindChordsController],
  providers: [MetadataService, FindChordsService],
  exports: [MetadataService],
})
export class MetadataModule {}
