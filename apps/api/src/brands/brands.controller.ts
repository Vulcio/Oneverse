import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res, UnauthorizedException, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiExcludeEndpoint, ApiOperation, ApiTags } from "@nestjs/swagger";
import { BrandsQuerySchema, CreateBrandSchema, UpdateBrandSchema, UploadBrandAssetSchema } from "@oneverse/core";
import type { Request, Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { UPLOAD_OPTIONS } from "../common/uploads.js";
import { zodDto } from "../common/zod-validation.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { BRAND_ASSET_LIMITS } from "./brand-assets.js";
import { BrandsService } from "./brands.service.js";

class CreateBrandDto extends zodDto(CreateBrandSchema) {}
class UpdateBrandDto extends zodDto(UpdateBrandSchema) {}
class BrandsQueryDto extends zodDto(BrandsQuerySchema) {}
class UploadBrandAssetDto extends zodDto(UploadBrandAssetSchema) {}

function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new UnauthorizedException();
  return user;
}

/** Brand kits (issue #279): an organisation's or a team's logos, colours, fonts, backgrounds and links. */
@ApiTags("brands")
@ApiBearerAuth()
@Controller("brands")
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @ApiOperation({ summary: "Brands", description: "A team's (`teamId`) or an organisation's (`organizationId`), else every brand the user can use. Each with `canEdit`: its owner's admins." })
  list(@Query() query: BrandsQueryDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<BrandsService["list"]> {
    return this.brands.list(requireUser(user), query);
  }

  /** A brand's file at its signed address: a screen has no session. */
  @Public()
  @RateLimit("none")
  @Get("assets/:assetId")
  @ApiExcludeEndpoint()
  sendAsset(@Param("assetId") assetId: string, @Query("expires") expires: string | undefined, @Query("signature") signature: string | undefined, @Req() req: Request, @Res() res: Response): Promise<void> {
    return this.brands.sendAsset(assetId, expires, signature, req, res);
  }

  @Get(":brandId")
  get(@Param("brandId") brandId: string, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<BrandsService["get"]> {
    return this.brands.get(requireUser(user), brandId);
  }

  @Post()
  @ApiOperation({ summary: "A brand", description: "A team's (`teamId`) or an organisation's (`organizationId`), by its admins. Its owner's first is its default." })
  create(@Body() dto: CreateBrandDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<BrandsService["create"]> {
    return this.brands.create(requireUser(user), dto);
  }

  @Patch(":brandId")
  @ApiOperation({ summary: "Changes a brand", description: "A field left out keeps its value. `isDefault: true` unsets its owner's other default." })
  update(@Param("brandId") brandId: string, @Body() dto: UpdateBrandDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<BrandsService["update"]> {
    return this.brands.update(requireUser(user), brandId, dto);
  }

  @RateLimit("heavy")
  @Post(":brandId/assets")
  @UseInterceptors(FileInterceptor("file", { ...UPLOAD_OPTIONS, limits: { fileSize: BRAND_ASSET_LIMITS.video } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Adds a file to a brand",
    description:
      "`kind`: a logo slot (logo, logo-light, logo-dark, logomark - a PNG, WebP, JPEG or AVIF picture up to 15 MB, an SVG turned into a PNG first; their -animated versions - a WebM or MP4 video up to 150 MB, or an animated GIF, WebP or APNG), which replaces the one there; background (a picture or a video), or font (WOFF2, WOFF, TTF or OTF, up to 5 MB), with an optional `name`.",
  })
  addAsset(@Param("brandId") brandId: string, @Query() query: UploadBrandAssetDto, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<BrandsService["addAsset"]> {
    if (!file) throw new BadRequestException("A file is required");
    return this.brands.addAsset(requireUser(user), brandId, query.kind, query.name, file);
  }

  @Delete(":brandId/assets/:assetId")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAsset(@Param("brandId") brandId: string, @Param("assetId") assetId: string, @CurrentUser() user: AuthenticatedUser | undefined): Promise<void> {
    return this.brands.removeAsset(requireUser(user), brandId, assetId);
  }

  @Delete(":brandId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("brandId") brandId: string, @CurrentUser() user: AuthenticatedUser | undefined): Promise<void> {
    return this.brands.remove(requireUser(user), brandId);
  }
}
