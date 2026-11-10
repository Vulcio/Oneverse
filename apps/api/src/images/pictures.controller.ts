import { BadRequestException, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Query, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../common/decorators/public.decorator.js";
import { SongbookOwnerGuard } from "../common/guards/songbook-owner.guard.js";
import { TeamAdminGuard } from "../common/guards/team-admin.guard.js";
import { UPLOAD_OPTIONS } from "../common/uploads.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { PictureService, type PictureOwner } from "./picture.service.js";

const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

/**
 * A team's and a songbook's picture (issue #161): set by the team's admins,
 * or whoever manages the songbook; served to anyone who has its address.
 */
@ApiTags("teams")
@ApiBearerAuth()
@Controller()
export class PicturesController {
  constructor(private readonly pictures: PictureService) {}

  @Put("teams/:teamId/avatar")
  @UseGuards(TeamAdminGuard)
  @UseInterceptors(FileInterceptor("file", { ...UPLOAD_OPTIONS, limits: { fileSize: MAX_PICTURE_BYTES } }))
  @ApiConsumes("multipart/form-data")
  setTeam(@Param("teamId") teamId: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException("A file is required");
    return this.pictures.set("teams", teamId, file.buffer);
  }

  @Delete("teams/:teamId/avatar")
  @UseGuards(TeamAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTeam(@Param("teamId") teamId: string): Promise<void> {
    return this.pictures.remove("teams", teamId);
  }

  @Put("songbooks/:songbookId/avatar")
  @UseGuards(SongbookOwnerGuard)
  @UseInterceptors(FileInterceptor("file", { ...UPLOAD_OPTIONS, limits: { fileSize: MAX_PICTURE_BYTES } }))
  @ApiConsumes("multipart/form-data")
  setSongbook(@Param("songbookId") songbookId: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException("A file is required");
    return this.pictures.set("songbooks", songbookId, file.buffer);
  }

  @Delete("songbooks/:songbookId/avatar")
  @UseGuards(SongbookOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeSongbook(@Param("songbookId") songbookId: string): Promise<void> {
    return this.pictures.remove("songbooks", songbookId);
  }

  @Public()
  @RateLimit("none")
  @Get("teams/:id/avatar/:key")
  @ApiExcludeEndpoint()
  serveTeam(
    @Param("id") id: string,
    @Param("key") key: string,
    @Query("size") size: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.serve("teams", id, key, size, res);
  }

  @Public()
  @RateLimit("none")
  @Get("songbooks/:id/avatar/:key")
  @ApiExcludeEndpoint()
  serveSongbook(
    @Param("id") id: string,
    @Param("key") key: string,
    @Query("size") size: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.serve("songbooks", id, key, size, res);
  }

  // One route each: Express 5 takes no pattern in a parameter (":owner(teams|songbooks)", issue #420).
  private async serve(owner: PictureOwner, id: string, key: string, size: string | undefined, res: Response): Promise<StreamableFile> {
    const { body, contentType } = await this.pictures.get(owner, id, key, size === undefined ? undefined : Number(size));
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    return new StreamableFile(body);
  }
}
