import { Body, Controller, Get, HttpCode, HttpStatus, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SaveFileSizeLimitsSchema } from "@oneverse/core";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { zodDto } from "../common/zod-validation.js";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { audioRights } from "../roles/audio-rights.js";
import { StorageService } from "../storage/storage.service.js";
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** `songVersionId`: for that song, whose organisation's own roles may allow audio uploads too (issue #206). */
  @Get("limits")
  async limits(@CurrentUser() user: AuthenticatedUser | undefined, @Query("songVersionId") songVersionId?: string) {
    const canUploadAudio = !!user && (user.isGlobalAdmin || (await audioRights(this.prisma.client, this.storage, user.id, typeof songVersionId === "string" && songVersionId ? songVersionId : null)).canUploadAudio);
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
