import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ArtworkSettingsSchema, SetArtworkSchema } from "@oneverse/core";
import { zodDto } from "../common/zod-validation.js";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../common/decorators/public.decorator.js";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { SongVersionEditorGuard } from "../common/guards/song-version-editor.guard.js";
import { ArtworkService } from "./artwork.service.js";
import { isValidSongImageSignature } from "./song-image-url.js";
import { UPLOAD_OPTIONS } from "../common/uploads.js";
import { RateLimit } from "../security/rate-limit.decorator.js";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// Pictures only: no SVG, which is a document rather than an image.
const UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"]);

export class SetArtworkDto extends zodDto(SetArtworkSchema) {}

export class ArtworkSettingsDto extends zodDto(ArtworkSettingsSchema) {}

/** Song images (issue #85): the image itself, choosing a song's artwork, and the admin's settings. */
@ApiTags("artwork")
@ApiBearerAuth()
@Controller()
export class ArtworkController {
  constructor(private readonly artwork: ArtworkService) {}

  /** The image, at a signed address handed out with the song (see song-image-url.ts); `w` snaps to a set of widths. */
  @Public()
  @RateLimit("none")
  @Get("song-versions/:songVersionId/image/:key")
  @ApiExcludeEndpoint()
  async image(
    @Param("songVersionId") songVersionId: string,
    @Param("key") key: string,
    @Query("expires") expires: string | undefined,
    @Query("signature") signature: string | undefined,
    @Query("w") width: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!isValidSongImageSignature(songVersionId, key, expires, signature)) throw new ForbiddenException("This image address has expired");
    const { body, contentType } = await this.artwork.image(songVersionId, key, width ? Number(width) : 800);
    res.set({
      "Content-Type": contentType,
      // Its key is its content: the same address always has the same image.
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      // Shown as an <img> by the web app, on another origin.
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    return new StreamableFile(body);
  }

  /** Apple Music's matches for the song, to choose its artwork from. */
  @RateLimit("heavy")
  @Get("song-versions/:songVersionId/artwork/candidates")
  @UseGuards(SongVersionEditorGuard)
  candidates(@Param("songVersionId") songVersionId: string) {
    return this.artwork.candidatesFor(songVersionId);
  }

  @RateLimit("heavy")
  @Put("song-versions/:songVersionId/artwork")
  @UseGuards(SongVersionEditorGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async set(@Param("songVersionId") songVersionId: string, @Body() dto: SetArtworkDto): Promise<void> {
    await this.artwork.setFromUrl(songVersionId, dto.url);
  }

  /** An image of the editor's own (issue #88): made a square WebP like the rest. */
  @RateLimit("heavy")
  @Post("song-versions/:songVersionId/artwork/upload")
  @UseGuards(SongVersionEditorGuard)
  @UseInterceptors(FileInterceptor("file", { ...UPLOAD_OPTIONS, limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @HttpCode(HttpStatus.NO_CONTENT)
  async upload(@Param("songVersionId") songVersionId: string, @UploadedFile() file: Express.Multer.File | undefined): Promise<void> {
    if (!file) throw new BadRequestException("A file is required");
    if (!UPLOAD_TYPES.has(file.mimetype)) throw new BadRequestException("A JPEG, PNG, WebP, GIF, AVIF or HEIC image");
    await this.artwork.setFromUpload(songVersionId, file.buffer);
  }

  @Delete("song-versions/:songVersionId/artwork")
  @UseGuards(SongVersionEditorGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async clear(@Param("songVersionId") songVersionId: string): Promise<void> {
    await this.artwork.clear(songVersionId);
  }

  @Get("admin/artwork")
  @UseGuards(GlobalAdminGuard)
  settings() {
    return this.artwork.settings();
  }

  @Put("admin/artwork")
  @UseGuards(GlobalAdminGuard)
  save(@Body() dto: ArtworkSettingsDto) {
    return this.artwork.saveSettings(dto);
  }

  @Delete("admin/artwork")
  @UseGuards(GlobalAdminGuard)
  reset() {
    return this.artwork.resetSettings();
  }
}
