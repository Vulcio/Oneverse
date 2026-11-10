import { Controller, Delete, Get, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { CalendarFeedService } from "./calendar-feed.service.js";

/** Someone's calendar link (issue #235): theirs to make, reset or turn off. */
@ApiTags("team calendar")
@ApiBearerAuth()
@Controller("users/me/calendar-feed")
export class MyCalendarFeedController {
  constructor(private readonly feeds: CalendarFeedService) {}

  @Get()
  mine(@SignedIn() user: AuthenticatedUser) {
    return this.feeds.mine(user.id);
  }

  /** A new link (made, or reset: the old one stops working). */
  @Post()
  reset(@SignedIn() user: AuthenticatedUser) {
    return this.feeds.reset(user.id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  turnOff(@SignedIn() user: AuthenticatedUser) {
    return this.feeds.turnOff(user.id);
  }
}

/**
 * The feed itself, for calendar apps: no sign-in, the token in the address
 * is the key. Answers conditional requests (ETag) with 304.
 */
@Controller("calendar")
export class CalendarFeedController {
  constructor(private readonly feeds: CalendarFeedService) {}

  @Public()
  @Get(":file")
  @ApiExcludeEndpoint()
  async feed(@Param("file") file: string, @Headers("if-none-match") ifNoneMatch: string | undefined, @Res() res: Response): Promise<void> {
    const token = /^([A-Za-z0-9_-]{20,100})\.ics$/.exec(file)?.[1];
    if (!token) throw new NotFoundException("This calendar link doesn't work any more.");
    const { body, etag } = await this.feeds.feed(token);
    res.set({ ETag: etag, "Cache-Control": "private, max-age=900", "X-Content-Type-Options": "nosniff" });
    if (ifNoneMatch === etag) {
      res.status(304).end();
      return;
    }
    res.type("text/calendar; charset=utf-8").set("Content-Disposition", 'inline; filename="songverse.ics"').send(body);
  }
}
