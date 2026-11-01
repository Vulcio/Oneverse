import { Module } from "@nestjs/common";
import { MusicBrainzModule } from "../musicbrainz/musicbrainz.module.js";
import { PluginsModule } from "../plugins/plugins.module.js";
import { MetadataController } from "./metadata.controller.js";
import { MetadataService } from "./metadata.service.js";

@Module({
  imports: [MusicBrainzModule, PluginsModule],
  controllers: [MetadataController],
  providers: [MetadataService],
  exports: [MetadataService],
})
export class MetadataModule {}
