import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { OwnStorageLimitsSchema, SaveOwnStorageSchema } from "@oneverse/core";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { OwnStorageService } from "./own-storage.service.js";

class SaveOwnStorageDto extends zodDto(SaveOwnStorageSchema) {}
class OwnStorageLimitsDto extends zodDto(OwnStorageLimitsSchema) {}

/**
 * An organisation's own bucket for its teams' files (issue #206), for its
 * admins: GET says how it's set and how its files are; PUT connects it (tried
 * first) or changes its key; PUT /limits sets what may go into it; POST /stop
 * moves the files back and disconnects it.
 */
@ApiTags("organizations")
@ApiBearerAuth()
@Controller("organizations/:organizationId/storage")
export class OwnStorageController {
  constructor(private readonly ownStorage: OwnStorageService) {}

  @Get()
  get(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.ownStorage.summary(user, organizationId);
  }

  @Put()
  @RateLimit("heavy")
  save(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Body() body: SaveOwnStorageDto) {
    return this.ownStorage.save(user, organizationId, body);
  }

  @Put("limits")
  limits(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Body() body: OwnStorageLimitsDto) {
    return this.ownStorage.setLimits(user, organizationId, body);
  }

  @Post("stop")
  stop(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.ownStorage.stop(user, organizationId);
  }
}
