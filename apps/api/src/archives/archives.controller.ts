import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, Res, UnauthorizedException, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { ArchiveOwnerSchema, ArchiveScheduleSchema } from "@oneverse/core";
import type { Request, Response } from "express";
import multer from "multer";
import { tmpdir } from "node:os";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { UPLOAD_OPTIONS } from "../common/uploads.js";
import { zodDto } from "../common/zod-validation.js";
import { sendFile } from "../files/send-file.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { StorageService } from "../storage/storage.service.js";
import { ARCHIVE_IMPORT_MAX_BYTES, ArchivesService } from "./archives.service.js";

class ArchiveOwnerDto extends zodDto(ArchiveOwnerSchema) {}
class ArchiveScheduleDto extends zodDto(ArchiveScheduleSchema) {}

/**
 * People's, teams' and organisations' own backups (issue #351): GET lists the
 * archives (made and imported) and whether one's made weekly; POST makes one
 * now; PUT /schedule turns the weekly one on or off; POST /import brings one
 * back. A team's or an organisation's, its admins only.
 */
@ApiTags("archives")
@ApiBearerAuth()
@Controller("archives")
export class ArchivesController {
  constructor(
    private readonly archives: ArchivesService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser | undefined, @Query() query: ArchiveOwnerDto) {
    if (!user) throw new UnauthorizedException();
    return this.archives.list(user, query.scope, query.id);
  }

  @Post()
  @RateLimit("heavy")
  create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() body: ArchiveOwnerDto) {
    if (!user) throw new UnauthorizedException();
    return this.archives.requestExport(user, body.scope, body.id);
  }

  @Put("schedule")
  schedule(@CurrentUser() user: AuthenticatedUser | undefined, @Body() body: ArchiveScheduleDto) {
    if (!user) throw new UnauthorizedException();
    return this.archives.setSchedule(user, body.scope, body.id, body.weekly);
  }

  @Post("import")
  @RateLimit("heavy")
  @ApiConsumes("multipart/form-data")
  // Written to a temporary file as it comes, never held in memory: an archive can be big.
  @UseInterceptors(FileInterceptor("file", { ...UPLOAD_OPTIONS, storage: multer.diskStorage({ destination: tmpdir() }), limits: { fileSize: ARCHIVE_IMPORT_MAX_BYTES } }))
  import(@CurrentUser() user: AuthenticatedUser | undefined, @Body() body: ArchiveOwnerDto, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!user) throw new UnauthorizedException();
    return this.archives.requestImport(user, body.scope, body.id, file);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthenticatedUser | undefined, @Param("id") id: string) {
    if (!user) throw new UnauthorizedException();
    return this.archives.get(user, id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser | undefined, @Param("id") id: string): Promise<void> {
    if (!user) throw new UnauthorizedException();
    await this.archives.remove(user, id);
  }

  @Public()
  @RateLimit("none")
  @Get(":id/download")
  @ApiOkResponse({ description: "The archive (a zip). No Bearer token: the link, from GET /archives, is the permission." })
  async download(
    @Param("id") id: string,
    @Query("expires") expires: string | undefined,
    @Query("signature") signature: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const archive = await this.archives.forDownload(id, expires, signature);
    if (!archive) throw new ForbiddenException("This link has expired or isn't valid");
    await sendFile(this.storage, { storageKey: archive.storageKey, mimeType: "application/zip", filename: archive.filename, sizeBytes: archive.sizeBytes }, req, res, "attachment");
  }
}
