import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { AvailabilityService } from "./availability.service.js";
import { CreateAwayDto, MyEventDatesQueryDto, UpdateAwayDto } from "./dto/team-events.dto.js";

/** Someone's own calendar (issue #235): the dates of all their teams, and the days they're away. */
@ApiTags("team calendar")
@ApiBearerAuth()
@Controller("users/me")
export class MyCalendarController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get("event-dates")
  dates(@SignedIn() user: AuthenticatedUser, @Query() query: MyEventDatesQueryDto) {
    return this.availability.myDates(user.id, query.from, query.to);
  }

  @Get("away")
  away(@SignedIn() user: AuthenticatedUser) {
    return this.availability.awayList(user.id);
  }

  /** Days away, across all one's teams: every date in them reads Not available unless answered. */
  @Post("away")
  addAway(@SignedIn() user: AuthenticatedUser, @Body() dto: CreateAwayDto) {
    return this.availability.addAway(user.id, dto);
  }

  @Patch("away/:id")
  updateAway(@SignedIn() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateAwayDto) {
    return this.availability.updateAway(user.id, id, dto);
  }

  @Delete("away/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAway(@SignedIn() user: AuthenticatedUser, @Param("id") id: string) {
    return this.availability.removeAway(user.id, id);
  }
}
