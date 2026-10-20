import { Module } from "@nestjs/common";
import { SetlistsModule } from "../setlists/setlists.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { ScreenPartsController } from "./screen-parts.controller.js";
import { ScreenPartsService } from "./screen-parts.service.js";
import { ScreenThemesController } from "./screen-themes.controller.js";
import { ScreenThemesService } from "./screen-themes.service.js";
import { ScreenWidgetDefaultsController } from "./screen-widget-defaults.controller.js";
import { ScreenWidgetDefaultsService } from "./screen-widget-defaults.service.js";
import { ScreensController } from "./screens.controller.js";
import { ScreensService } from "./screens.service.js";

/** Screens (issue #186): pairing, what a screen shows, their templates (#194) and their parts (#281); the sync server signs them in. */
@Module({
  imports: [SetlistsModule, StorageModule],
  controllers: [ScreensController, ScreenThemesController, ScreenPartsController, ScreenWidgetDefaultsController],
  providers: [ScreensService, ScreenThemesService, ScreenPartsService, ScreenWidgetDefaultsService],
  exports: [ScreensService],
})
export class ScreensModule {}
