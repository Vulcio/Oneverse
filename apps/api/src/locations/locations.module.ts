import { Module } from "@nestjs/common";
import { LocationsController } from "./locations.controller.js";
import { LocationsService } from "./locations.service.js";
import { ResourcesController } from "./resources.controller.js";
import { ResourcesService } from "./resources.service.js";

/** Locations - venues in the app - (issue #320, #563) and resources (issue #564). */
@Module({
  controllers: [LocationsController, ResourcesController],
  providers: [LocationsService, ResourcesService],
  exports: [LocationsService, ResourcesService],
})
export class LocationsModule {}
