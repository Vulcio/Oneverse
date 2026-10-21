import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CreateScreenThemeSchema, UpdateScreenThemeSchema } from "@oneverse/core";
import type { Request, Response } from "express";
import { Public } from "../common/decorators/public.decorator.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { ScreenThemesService } from "./screen-themes.service.js";

class CreateScreenThemeDto extends zodDto(CreateScreenThemeSchema) {}
class UpdateScreenThemeDto extends zodDto(UpdateScreenThemeSchema) {}

function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new UnauthorizedException();
  return user;
}

/** Screen templates (issues #194, #281): saved looks for screens - their parts, tags and layout - a person's own or a team's. */
@ApiTags("screens")
@ApiBearerAuth()
@Controller("screen-themes")
export class ScreenThemesController {
  constructor(private readonly themes: ScreenThemesService) {}

  @Get()
  @ApiOperation({ summary: "The user's screen themes and their teams'", description: "Each with `canEdit`: theirs, or a team's they're an admin of." })
  list(@CurrentUser() user: AuthenticatedUser | undefined): ReturnType<ScreenThemesService["list"]> {
    return this.themes.list(requireUser(user));
  }

  @Post()
  @ApiOperation({
    summary: "A screen template",
    description:
      "The user's own, or with `teamId` a team's they're an admin of: its `template` (tags, widgets, masks: screen-template/v1) and its parts - `content`, `background`, `effects` (or null), each `{builtIn}` or a saved part's `{id}` - or a whole `theme` (screen-theme/v1, docs/screen-theme-v1.md), split into parts of its own.",
  })
  create(@Body() dto: CreateScreenThemeDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<ScreenThemesService["create"]> {
    return this.themes.create(requireUser(user), dto);
  }

  @Patch(":themeId")
  @ApiOperation({ summary: "Changes a screen template", description: "Its name, layout or parts; the screens showing it change at once." })
  update(@Param("themeId") themeId: string, @Body() dto: UpdateScreenThemeDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<ScreenThemesService["update"]> {
    return this.themes.update(requireUser(user), themeId, dto);
  }

  /** A template's or a part's file at its signed address (issues #194, #281): a screen has no session. */
  @Public()
  @RateLimit("none")
  @Get("assets/:assetId")
  @ApiExcludeEndpoint()
  sendAsset(
    @Param("assetId") assetId: string,
    @Query("expires") expires: string | undefined,
    @Query("signature") signature: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.themes.sendAsset(assetId, expires, signature, req, res);
  }

  @Delete(":themeId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Deletes a screen theme", description: "Its screens go back to the default look." })
  remove(@Param("themeId") themeId: string, @CurrentUser() user: AuthenticatedUser | undefined): Promise<void> {
    return this.themes.remove(requireUser(user), themeId);
  }
}
