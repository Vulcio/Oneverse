import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { AvailabilityService } from "./availability.service.js";
import { CreateAwayDto, MyEventDatesQueryDto, UpdateAwayDto, VolunteerDto } from "./dto/team-events.dto.js";
import { LineupService } from "./lineup.service.js";

/** Someone's own calendar (issue #235): the dates of all their teams, and the days they're away. */
@ApiTags("team calendar")
@ApiBearerAuth()
@Controller("users/me")
export class MyCalendarController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly lineup: LineupService,
  ) {}

  /** Open places one may take (issue #528): parts open to one of one's teams, with places left. */
  @Get("open-places")
  openPlaces(@SignedIn() user: AuthenticatedUser, @Query() query: MyEventDatesQueryDto) {
    return this.lineup.openPlaces(user.id, query.from, query.to);
  }

  /** One takes an open place: on the line-up, accepted. */
  @Post("open-places")
  volunteer(@SignedIn() user: AuthenticatedUser, @Body() dto: VolunteerDto) {
    return this.lineup.volunteer(user.id, dto);
  }

  /** One gives up an open place one took. */
  @Delete("open-places/:assignmentId")
  @HttpCode(HttpStatus.NO_CONTENT)
  withdraw(@SignedIn() user: AuthenticatedUser, @Param("assignmentId") assignmentId: string) {
    return this.lineup.withdraw(user.id, assignmentId);
  }

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
