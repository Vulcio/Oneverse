import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { BookingsQuerySchema, CreateLocationSchema, CreateRoomSchema, LocationsQuerySchema, UpdateLocationSchema, UpdateRoomSchema } from "@oneverse/core";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { LocationsService } from "./locations.service.js";

class CreateLocationDto extends zodDto(CreateLocationSchema) {}
class UpdateLocationDto extends zodDto(UpdateLocationSchema) {}
class LocationsQueryDto extends zodDto(LocationsQuerySchema) {}
class CreateRoomDto extends zodDto(CreateRoomSchema) {}
class UpdateRoomDto extends zodDto(UpdateRoomSchema) {}
class BookingsQueryDto extends zodDto(BookingsQuerySchema) {}

/** Locations (issue #320): where an organisation's or a team's events take place. */
@ApiTags("locations")
@ApiBearerAuth()
@Controller("locations")
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @ApiOperation({
    summary: "Locations",
    description: "Those a team's events can take (`teamId`: its own and its organisation's), an organisation's (`organizationId`), else every location the user can use. Each with `canEdit`: its owner's admins.",
  })
  list(@Query() query: LocationsQueryDto, @SignedIn() user: AuthenticatedUser): ReturnType<LocationsService["list"]> {
    return this.locations.list(user, query);
  }

  @Get(":locationId")
  get(@Param("locationId") locationId: string, @SignedIn() user: AuthenticatedUser): ReturnType<LocationsService["get"]> {
    return this.locations.get(user, locationId);
  }

  @Get(":locationId/bookings")
  @ApiOperation({
    summary: "A venue's room bookings (issue #565)",
    description: "Every booking of its rooms from `from` to `to`: the room, the date, when the event holds it (setup and teardown included), and the event and its team or organisation. For whoever sees the venue.",
  })
  bookings(@Param("locationId") locationId: string, @Query() query: BookingsQueryDto, @SignedIn() user: AuthenticatedUser): ReturnType<LocationsService["bookings"]> {
    return this.locations.bookings(user, locationId, query.from, query.to);
  }

  @Post()
  @ApiOperation({ summary: "A location", description: "A team's (`teamId`) or an organisation's (`organizationId`), by its admins." })
  create(@Body() dto: CreateLocationDto, @SignedIn() user: AuthenticatedUser): ReturnType<LocationsService["create"]> {
    return this.locations.create(user, dto);
  }

  @Patch(":locationId")
  @ApiOperation({ summary: "Changes a location", description: "A field left out keeps its value." })
  update(@Param("locationId") locationId: string, @Body() dto: UpdateLocationDto, @SignedIn() user: AuthenticatedUser): ReturnType<LocationsService["update"]> {
    return this.locations.update(user, locationId, dto);
  }

  @Delete(":locationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Removes a location", description: "Its events keep their place, without the location." })
  remove(@Param("locationId") locationId: string, @SignedIn() user: AuthenticatedUser): Promise<void> {
    return this.locations.remove(user, locationId);
  }

  @Post(":locationId/rooms")
  @ApiOperation({ summary: "Adds a room to a venue (issue #563)", description: "By its owner's admins. Answers the venue with its rooms." })
  addRoom(@Param("locationId") locationId: string, @Body() dto: CreateRoomDto, @SignedIn() user: AuthenticatedUser): ReturnType<LocationsService["addRoom"]> {
    return this.locations.addRoom(user, locationId, dto);
  }

  @Patch(":locationId/rooms/:roomId")
  @ApiOperation({ summary: "Changes a room", description: "A field left out keeps its value; capacity null clears it." })
  updateRoom(@Param("locationId") locationId: string, @Param("roomId") roomId: string, @Body() dto: UpdateRoomDto, @SignedIn() user: AuthenticatedUser): ReturnType<LocationsService["updateRoom"]> {
    return this.locations.updateRoom(user, locationId, roomId, dto);
  }

  @Delete(":locationId/rooms/:roomId")
  @ApiOperation({ summary: "Removes a room", description: "Its events keep the venue, without the room. Answers the venue." })
  removeRoom(@Param("locationId") locationId: string, @Param("roomId") roomId: string, @SignedIn() user: AuthenticatedUser): ReturnType<LocationsService["removeRoom"]> {
    return this.locations.removeRoom(user, locationId, roomId);
  }
}
