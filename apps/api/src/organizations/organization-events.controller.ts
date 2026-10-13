import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { TeamEventDatesQueryDto } from "../team-events/dto/team-events.dto.js";
import { CreateOrganizationEventDto, OrganizationEventPresetDto, UpdateOrganizationEventDateDto, UpdateOrganizationEventDto } from "./dto/organization-events.dto.js";
import { OrganizationEventsService } from "./organization-events.service.js";

function signedIn(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new UnauthorizedException();
  return user;
}

/** An organisation's events, their dates and its presets (issue #241). */
@ApiTags("organizations")
@ApiBearerAuth()
@Controller("organizations/:organizationId")
export class OrganizationEventsController {
  constructor(private readonly events: OrganizationEventsService) {}

  @Get("events")
  list(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string) {
    return this.events.list(signedIn(user), organizationId);
  }

  @Post("events")
  create(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string, @Body() dto: CreateOrganizationEventDto) {
    return this.events.create(signedIn(user), organizationId, dto);
  }

  @Patch("events/:eventId")
  update(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string, @Param("eventId") eventId: string, @Body() dto: UpdateOrganizationEventDto) {
    return this.events.update(signedIn(user), organizationId, eventId, dto);
  }

  @Delete("events/:eventId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string, @Param("eventId") eventId: string) {
    return this.events.remove(signedIn(user), organizationId, eventId);
  }

  @Patch("events/:eventId/dates/:date")
  @HttpCode(HttpStatus.NO_CONTENT)
  updateDate(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("organizationId") organizationId: string,
    @Param("eventId") eventId: string,
    @Param("date") date: string,
    @Body() dto: UpdateOrganizationEventDateDto,
  ) {
    return this.events.updateDate(signedIn(user), organizationId, eventId, date, dto.cancelled);
  }

  @Get("event-dates")
  dates(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string, @Query() query: TeamEventDatesQueryDto) {
    return this.events.dates(signedIn(user), organizationId, query.from, query.to);
  }

  @Get("event-presets")
  presets(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string) {
    return this.events.presets(signedIn(user), organizationId);
  }

  @Post("event-presets")
  createPreset(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string, @Body() dto: OrganizationEventPresetDto) {
    return this.events.createPreset(signedIn(user), organizationId, dto);
  }

  @Delete("event-presets/:presetId")
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePreset(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string, @Param("presetId") presetId: string) {
    return this.events.deletePreset(signedIn(user), organizationId, presetId);
  }
}
