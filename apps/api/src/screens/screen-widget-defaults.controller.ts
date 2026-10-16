import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Query, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SaveScreenWidgetDefaultSchema, SCREEN_WIDGET_KINDS, ScreenWidgetDefaultQuerySchema, type ScreenWidgetKind } from "@songverse/core";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { ScreenWidgetDefaultsService } from "./screen-widget-defaults.service.js";

class SaveScreenWidgetDefaultDto extends zodDto(SaveScreenWidgetDefaultSchema) {}
class ScreenWidgetDefaultQueryDto extends zodDto(ScreenWidgetDefaultQuerySchema) {}

function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new UnauthorizedException();
  return user;
}

function widgetKind(kind: string): ScreenWidgetKind {
  if (!(SCREEN_WIDGET_KINDS as readonly string[]).includes(kind)) throw new BadRequestException([`kind must be one of the following values: ${SCREEN_WIDGET_KINDS.join(", ")}`]);
  return kind as ScreenWidgetKind;
}

/** Widgets' default looks (issue #273): a person's own or a team's, put on a widget when it's added to a template. */
@ApiTags("screens")
@ApiBearerAuth()
@Controller("screen-widget-defaults")
export class ScreenWidgetDefaultsController {
  constructor(private readonly defaults: ScreenWidgetDefaultsService) {}

  @Get()
  @ApiOperation({ summary: "The user's widget default looks and their teams'", description: "Each with `canEdit`: theirs, or a team's they're an admin of." })
  list(@CurrentUser() user: AuthenticatedUser | undefined): ReturnType<ScreenWidgetDefaultsService["list"]> {
    return this.defaults.list(requireUser(user));
  }

  @Put(":kind")
  @ApiOperation({ summary: "Sets a widget's default look", description: "The user's own, or with `teamId` a team's they're an admin of. `look` is a widget's `options` and `style` (docs/screen-theme-v1.md)." })
  save(@Param("kind") kind: string, @Body() dto: SaveScreenWidgetDefaultDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<ScreenWidgetDefaultsService["save"]> {
    return this.defaults.save(requireUser(user), widgetKind(kind), dto);
  }

  @Delete(":kind")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "A widget back to the built-in look", description: "The user's own default, or with `teamId` a team's." })
  async remove(@Param("kind") kind: string, @Query() query: ScreenWidgetDefaultQueryDto, @CurrentUser() user: AuthenticatedUser | undefined): Promise<void> {
    await this.defaults.remove(requireUser(user), widgetKind(kind), query.teamId);
  }
}
