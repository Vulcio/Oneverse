import { Module } from "@nestjs/common";
import { LocationsController } from "./locations.controller.js";
import { LocationsService } from "./locations.service.js";

/** Locations (issue #320). */
@Module({
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
