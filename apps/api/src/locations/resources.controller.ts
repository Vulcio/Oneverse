import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CreateResourceSchema, ResourcesQuerySchema, UpdateResourceSchema } from "@oneverse/core";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { ResourcesService } from "./resources.service.js";

class CreateResourceDto extends zodDto(CreateResourceSchema) {}
class UpdateResourceDto extends zodDto(UpdateResourceSchema) {}
class ResourcesQueryDto extends zodDto(ResourcesQuerySchema) {}

/** Resources (issue #564): what an organisation or a team owns that its events book besides rooms. */
@ApiTags("resources")
@ApiBearerAuth()
@Controller("resources")
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Get()
  @ApiOperation({ summary: "Resources", description: "Those a team's events can take (`teamId`: its own and its organisation's), an organisation's (`organizationId`), else every one the user can use. Each with `canEdit`: its owner's admins." })
  list(@Query() query: ResourcesQueryDto, @SignedIn() user: AuthenticatedUser): ReturnType<ResourcesService["list"]> {
    return this.resources.list(user, query);
  }

  @Post()
  @ApiOperation({ summary: "A resource", description: "A team's (`teamId`) or an organisation's (`organizationId`), by its admins; maybe kept at one of its venues." })
  create(@Body() dto: CreateResourceDto, @SignedIn() user: AuthenticatedUser): ReturnType<ResourcesService["create"]> {
    return this.resources.create(user, dto);
  }

  @Patch(":resourceId")
  @ApiOperation({ summary: "Changes a resource", description: "A field left out keeps its value; locationId null: kept nowhere in particular." })
  update(@Param("resourceId") resourceId: string, @Body() dto: UpdateResourceDto, @SignedIn() user: AuthenticatedUser): ReturnType<ResourcesService["update"]> {
    return this.resources.update(user, resourceId, dto);
  }

  @Delete(":resourceId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Removes a resource", description: "Events that took it no longer do." })
  remove(@Param("resourceId") resourceId: string, @SignedIn() user: AuthenticatedUser): Promise<void> {
    return this.resources.remove(user, resourceId);
  }
}
