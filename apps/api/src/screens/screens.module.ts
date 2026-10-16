import { Module } from "@nestjs/common";
import { SetlistsModule } from "../setlists/setlists.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { ScreenThemesController } from "./screen-themes.controller.js";
import { ScreenThemesService } from "./screen-themes.service.js";
import { ScreenWidgetDefaultsController } from "./screen-widget-defaults.controller.js";
import { ScreenWidgetDefaultsService } from "./screen-widget-defaults.service.js";
import { ScreensController } from "./screens.controller.js";
import { ScreensService } from "./screens.service.js";

/** Screens (issue #186): pairing, what a screen shows, their themes (#194); the sync server signs them in. */
@Module({
  imports: [SetlistsModule, StorageModule],
  controllers: [ScreensController, ScreenThemesController, ScreenWidgetDefaultsController],
  providers: [ScreensService, ScreenThemesService, ScreenWidgetDefaultsService],
  exports: [ScreensService],
})
export class ScreensModule {}
