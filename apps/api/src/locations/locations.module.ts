import { Module } from "@nestjs/common";
import { BookingsController } from "./bookings.controller.js";
import { BookingsService } from "./bookings.service.js";
import { LocationsController } from "./locations.controller.js";
import { LocationsService } from "./locations.service.js";
import { ResourcesController } from "./resources.controller.js";
import { ResourcesService } from "./resources.service.js";

/** Locations - venues in the app - (issue #320, #563) resources (issue #564) and bookings (issue #565). */
@Module({
  controllers: [LocationsController, ResourcesController, BookingsController],
  providers: [LocationsService, ResourcesService, BookingsService],
  exports: [LocationsService, ResourcesService, BookingsService],
})
export class LocationsModule {}
