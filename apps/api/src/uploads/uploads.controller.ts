import { Body, Controller, Get, HttpCode, HttpStatus, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SaveFileSizeLimitsSchema } from "@oneverse/core";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { zodDto } from "../common/zod-validation.js";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { capabilitiesOf } from "../roles/capabilities.js";
import { fileSizeLimitsFor, getFileSizeLimits, saveFileSizeLimits } from "./file-size-limits.js";

class SaveFileSizeLimitsDto extends zodDto(SaveFileSizeLimitsSchema) {}

/**
 * What the viewer may upload, for the app to check a file before sending
 * it: the largest song file of each type (issue #163) - a global admin's,
 * the server's own (#183) - and whether audio files at all (#183).
 */
@ApiTags("attachments")
@ApiBearerAuth()
@Controller("uploads")
export class UploadsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("limits")
  async limits(@CurrentUser() user: AuthenticatedUser | undefined) {
    const canUploadAudio = !!user && (user.isGlobalAdmin || (await capabilitiesOf(this.prisma.client, user.id)).canUploadAudio);
    return { limitsMb: await fileSizeLimitsFor(user), canUploadAudio };
  }
}

/** Admin > Storage > File size limits. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/storage/file-size-limits")
@UseGuards(GlobalAdminGuard)
export class AdminFileSizeLimitsController {
  @Get()
  get(): ReturnType<typeof getFileSizeLimits> {
    return getFileSizeLimits();
  }

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  save(@Body() dto: SaveFileSizeLimitsDto): Promise<void> {
    return saveFileSizeLimits(dto.limitsMb);
  }
}
