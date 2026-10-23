import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CreateLocationSchema, LocationsQuerySchema, UpdateLocationSchema } from "@oneverse/core";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { LocationsService } from "./locations.service.js";

class CreateLocationDto extends zodDto(CreateLocationSchema) {}
class UpdateLocationDto extends zodDto(UpdateLocationSchema) {}
class LocationsQueryDto extends zodDto(LocationsQuerySchema) {}

function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new UnauthorizedException();
  return user;
}

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
  list(@Query() query: LocationsQueryDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<LocationsService["list"]> {
    return this.locations.list(requireUser(user), query);
  }

  @Get(":locationId")
  get(@Param("locationId") locationId: string, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<LocationsService["get"]> {
    return this.locations.get(requireUser(user), locationId);
  }

  @Post()
  @ApiOperation({ summary: "A location", description: "A team's (`teamId`) or an organisation's (`organizationId`), by its admins." })
  create(@Body() dto: CreateLocationDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<LocationsService["create"]> {
    return this.locations.create(requireUser(user), dto);
  }

  @Patch(":locationId")
  @ApiOperation({ summary: "Changes a location", description: "A field left out keeps its value." })
  update(@Param("locationId") locationId: string, @Body() dto: UpdateLocationDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<LocationsService["update"]> {
    return this.locations.update(requireUser(user), locationId, dto);
  }

  @Delete(":locationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Removes a location", description: "Its events keep their place, without the location." })
  remove(@Param("locationId") locationId: string, @CurrentUser() user: AuthenticatedUser | undefined): Promise<void> {
    return this.locations.remove(requireUser(user), locationId);
  }
}
