import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UnauthorizedException, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CreateScreenPartSchema, SCREEN_THEME_ASSET_KINDS, ScreenPartsQuerySchema, UpdateScreenPartSchema, type ScreenThemeAssetKind } from "@oneverse/core";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { UPLOAD_OPTIONS } from "../common/uploads.js";
import { zodDto } from "../common/zod-validation.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { SCREEN_THEME_ASSET_LIMITS } from "./screen-theme-assets.js";
import { ScreenPartsService } from "./screen-parts.service.js";

class CreateScreenPartDto extends zodDto(CreateScreenPartSchema) {}
class UpdateScreenPartDto extends zodDto(UpdateScreenPartSchema) {}
class ScreenPartsQueryDto extends zodDto(ScreenPartsQuerySchema) {}

function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new UnauthorizedException();
  return user;
}

/** Templates' parts (issue #281): content themes, background themes and effects, a person's own or a team's. */
@ApiTags("screens")
@ApiBearerAuth()
@Controller("screen-parts")
export class ScreenPartsController {
  constructor(private readonly parts: ScreenPartsService) {}

  @Get()
  @ApiOperation({ summary: "The user's screen parts and their teams'", description: "Content themes, background themes and effects (or one `kind`), each with `canEdit` and how many templates use it." })
  list(@Query() query: ScreenPartsQueryDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<ScreenPartsService["list"]> {
    return this.parts.list(requireUser(user), query.kind);
  }

  @Post()
  @ApiOperation({ summary: "A screen part", description: "A content theme (screen-content/v1), a background theme (screen-background/v1) or effects (screen-effects/v1): the user's own, or with `teamId` a team's they're an admin of." })
  create(@Body() dto: CreateScreenPartDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<ScreenPartsService["create"]> {
    return this.parts.create(requireUser(user), dto);
  }

  @Patch(":partId")
  @ApiOperation({ summary: "Changes a screen part", description: "Every template using it changes, and their screens at once." })
  update(@Param("partId") partId: string, @Body() dto: UpdateScreenPartDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<ScreenPartsService["update"]> {
    return this.parts.update(requireUser(user), partId, dto);
  }

  @RateLimit("heavy")
  @Post(":partId/assets")
  @UseInterceptors(FileInterceptor("file", { ...UPLOAD_OPTIONS, limits: { fileSize: SCREEN_THEME_ASSET_LIMITS.video } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Adds a file to a screen part",
    description: "A background theme's `kind` media: a picture (JPEG, PNG, WebP, AVIF, GIF, up to 15 MB) or looping video (MP4, WebM, up to 150 MB); a background theme's `shader`: an ISF fragment shader (.fs, .frag, .glsl or .isf, up to 64 KB, its header checked); a content theme's font: WOFF2, WOFF, TTF or OTF (up to 5 MB). The part's document then refers to it by its id.",
  })
  addAsset(
    @Param("partId") partId: string,
    @Query("kind") kind: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): ReturnType<ScreenPartsService["addAsset"]> {
    if (!file) throw new BadRequestException("A file is required");
    if (!(SCREEN_THEME_ASSET_KINDS as readonly string[]).includes(kind ?? "")) throw new BadRequestException("kind must be media, font or shader");
    return this.parts.addAsset(requireUser(user), partId, kind as ScreenThemeAssetKind, file);
  }

  @Delete(":partId/assets/:assetId")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAsset(@Param("partId") partId: string, @Param("assetId") assetId: string, @CurrentUser() user: AuthenticatedUser | undefined): Promise<void> {
    return this.parts.removeAsset(requireUser(user), partId, assetId);
  }

  @Delete(":partId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Deletes a screen part", description: "Refused while a template uses it." })
  remove(@Param("partId") partId: string, @CurrentUser() user: AuthenticatedUser | undefined): Promise<void> {
    return this.parts.remove(requireUser(user), partId);
  }
}
