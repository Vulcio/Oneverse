import { Module } from "@nestjs/common";
import { AdminPluginsController, PluginsController } from "./plugins.controller.js";
import { PluginsService } from "./plugins.service.js";
import { SongProviderService } from "./song-provider/song-provider.service.js";

/** Plugins (issue #157): for 1.0, the built-in Song provider plugin. */
@Module({
  controllers: [AdminPluginsController, PluginsController],
  providers: [PluginsService, SongProviderService],
  exports: [SongProviderService],
})
export class PluginsModule {}
