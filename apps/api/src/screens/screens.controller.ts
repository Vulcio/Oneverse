import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ClaimScreenPairingSchema, ConfirmScreenPairingSchema, PickScreenSetSchema, ScreenCurrentQuerySchema, UpdateScreenSchema } from "@songverse/core";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { ScreensService } from "./screens.service.js";

class ConfirmScreenPairingDto extends zodDto(ConfirmScreenPairingSchema) {}
class ClaimScreenPairingDto extends zodDto(ClaimScreenPairingSchema) {}
class UpdateScreenDto extends zodDto(UpdateScreenSchema) {}
class ScreenCurrentQueryDto extends zodDto(ScreenCurrentQuerySchema) {}
class PickScreenSetDto extends zodDto(PickScreenSetSchema) {}

function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new UnauthorizedException();
  return user;
}

/** A screen's token, sent as `Authorization: Screen <token>`. */
function screenToken(header: string | undefined): string {
  const match = /^Screen\s+(\S+)$/.exec(header ?? "");
  if (!match) throw new UnauthorizedException("Missing screen token");
  return match[1]!;
}

/** Screens (issue #186): pairing one by its code, what it shows, and the screens of a set. */
@ApiTags("screens")
@ApiBearerAuth()
@Controller("screens")
export class ScreensController {
  constructor(private readonly screens: ScreensService) {}

  /** A screen asks for a code to show (no sign-in). */
  @Public()
  @RateLimit("heavy")
  @Post("pairings")
  startPairing(): ReturnType<ScreensService["startPairing"]> {
    return this.screens.startPairing();
  }

  /** The screen asks for its token, every couple of seconds: 202 until someone confirms its code. */
  @Public()
  @RateLimit("none")
  @Post("pairings/:pairingId/claim")
  async claim(@Param("pairingId") pairingId: string, @Body() dto: ClaimScreenPairingDto, @Res({ passthrough: true }) res: Response) {
    const claimed = await this.screens.claim(pairingId, dto.secret);
    if (!claimed) res.status(HttpStatus.ACCEPTED);
    return claimed ?? { pending: true };
  }

  /** A code someone typed or scanned, before they confirm it. */
  @Get("pairings/:code")
  checkCode(@Param("code") code: string, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<ScreensService["checkCode"]> {
    requireUser(user);
    return this.screens.checkCode(code);
  }

  @Post("pairings/:code/confirm")
  confirm(@Param("code") code: string, @Body() dto: ConfirmScreenPairingDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<ScreensService["confirm"]> {
    return this.screens.confirm(requireUser(user), code, dto);
  }

  /** What the screen signed in by its token shows: itself and its set. */
  @Public()
  @RateLimit("none")
  @Get("current")
  current(@Headers("authorization") authorization: string | undefined, @Query() query: ScreenCurrentQueryDto): ReturnType<ScreensService["current"]> {
    return this.screens.current(screenToken(authorization), query);
  }

  /** The sets the screen offers to pick from (issue #274): its owner's, upcoming first, then the archive. */
  @Public()
  @Get("current/sets")
  sets(@Headers("authorization") authorization: string | undefined, @Query() query: ScreenCurrentQueryDto): ReturnType<ScreensService["sets"]> {
    return this.screens.sets(screenToken(authorization), query.today ?? new Date().toISOString().slice(0, 10));
  }

  /** A set picked on the screen for today (issue #274); null goes back to the day's own. */
  @Public()
  @Post("current/set")
  @HttpCode(HttpStatus.OK)
  pick(@Headers("authorization") authorization: string | undefined, @Body() dto: PickScreenSetDto): ReturnType<ScreensService["pick"]> {
    return this.screens.pick(screenToken(authorization), dto.setlistId, dto.today);
  }

  /** The screens showing a set (for who leads it), or the user's own. */
  @Get()
  list(@Query("setlistId") setlistId: string | undefined, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<ScreensService["list"]> {
    return this.screens.list(requireUser(user), typeof setlistId === "string" && setlistId ? setlistId : undefined);
  }

  @Patch(":screenId")
  update(@Param("screenId") screenId: string, @Body() dto: UpdateScreenDto, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<ScreensService["update"]> {
    return this.screens.update(requireUser(user), screenId, dto);
  }

  /** Disconnects it: its token stops working, and it goes back to showing a code. */
  @Delete(":screenId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("screenId") screenId: string, @CurrentUser() user: AuthenticatedUser | undefined): Promise<void> {
    return this.screens.remove(requireUser(user), screenId);
  }
}
