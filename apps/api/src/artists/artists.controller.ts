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
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ArtistBioSchema, ArtistQuerySchema, ArtistSettingsSchema, LookUpArtistSchema } from "@oneverse/core";
import { zodDto } from "../common/zod-validation.js";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { isValidArtistImageSignature } from "../artwork/song-image-url.js";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { ArtistsService } from "./artists.service.js";
import { UPLOAD_OPTIONS } from "../common/uploads.js";
import { RateLimit } from "../security/rate-limit.decorator.js";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// Pictures only: no SVG, which is a document rather than an image.
const UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"]);

export class ArtistQueryDto extends zodDto(ArtistQuerySchema) {}

export class LookUpArtistDto extends zodDto(LookUpArtistSchema) {}

export class ArtistBioDto extends zodDto(ArtistBioSchema) {}

export class ArtistSettingsDto extends zodDto(ArtistSettingsSchema) {}

/**
 * Artists (issue #86): an artist's page (picture, bio, how many of their
 * songs you can see), asking the providers about them, and - for global
 * admins, since an artist is the same for everyone - their own picture and
 * bio. Artists are named in the query (?name=), as names can hold slashes.
 */
@ApiTags("artists")
@ApiBearerAuth()
@Controller()
export class ArtistsController {
  constructor(private readonly artists: ArtistsService) {}

  @Get("artists/detail")
  detail(@CurrentUser() user: AuthenticatedUser | undefined, @Query() query: ArtistQueryDto) {
    if (!user) throw new UnauthorizedException();
    return this.artists.detail(user, query.name);
  }

  /** Anyone who can see a song by them may have them looked up once; asking again is for admins. */
  @RateLimit("heavy")
  @Post("artists/lookup")
  lookUp(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: LookUpArtistDto) {
    if (!user) throw new UnauthorizedException();
    if (dto.force && !user.isGlobalAdmin) throw new ForbiddenException("Global admin role required");
    return this.artists.lookUp(user, dto.name, !!dto.force);
  }

  @RateLimit("heavy")
  @Post("artists/picture")
  @UseGuards(GlobalAdminGuard)
  @UseInterceptors(FileInterceptor("file", { ...UPLOAD_OPTIONS, limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @HttpCode(HttpStatus.NO_CONTENT)
  async uploadPicture(@CurrentUser() user: AuthenticatedUser, @Query() query: ArtistQueryDto, @UploadedFile() file: Express.Multer.File | undefined): Promise<void> {
    if (!file) throw new BadRequestException("A file is required");
    if (!UPLOAD_TYPES.has(file.mimetype)) throw new BadRequestException("A JPEG, PNG, WebP, GIF, AVIF or HEIC image");
    await this.artists.uploadPicture(user, query.name, file.buffer);
  }

  @Delete("artists/picture")
  @UseGuards(GlobalAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePicture(@CurrentUser() user: AuthenticatedUser, @Query() query: ArtistQueryDto): Promise<void> {
    await this.artists.removePicture(user, query.name);
  }

  @Put("artists/bio")
  @UseGuards(GlobalAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async saveBio(@CurrentUser() user: AuthenticatedUser, @Body() dto: ArtistBioDto): Promise<void> {
    await this.artists.saveBio(user, dto.name, dto.language, dto.text);
  }

  /** The picture, at a signed address handed out with the artist (see song-image-url.ts). */
  @Public()
  @RateLimit("none")
  @Get("artists/:artistId/image/:key")
  @ApiExcludeEndpoint()
  async image(
    @Param("artistId") artistId: string,
    @Param("key") key: string,
    @Query("expires") expires: string | undefined,
    @Query("signature") signature: string | undefined,
    @Query("w") width: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!isValidArtistImageSignature(artistId, key, expires, signature)) throw new ForbiddenException("This image address has expired");
    const { body, contentType } = await this.artists.image(artistId, key, width ? Number(width) : 800);
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    return new StreamableFile(body);
  }

  @Get("admin/artists")
  @UseGuards(GlobalAdminGuard)
  settings() {
    return this.artists.settings();
  }

  @Put("admin/artists")
  @UseGuards(GlobalAdminGuard)
  save(@Body() dto: ArtistSettingsDto) {
    return this.artists.saveSettings(dto.enabled);
  }

  @Delete("admin/artists")
  @UseGuards(GlobalAdminGuard)
  reset() {
    return this.artists.resetSettings();
  }
}
