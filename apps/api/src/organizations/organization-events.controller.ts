import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { CreateTeamEventTypeDto, TeamEventDatesQueryDto, UpdateTeamEventTypeDto } from "../team-events/dto/team-events.dto.js";
import { CreateOrganizationEventDto, OrganizationEventPresetDto, UpdateOrganizationEventDateDto, UpdateOrganizationEventDto } from "./dto/organization-events.dto.js";
import { OrganizationEventsService } from "./organization-events.service.js";

/** An organisation's events, their dates and its presets (issue #241). */
@ApiTags("organizations")
@ApiBearerAuth()
@Controller("organizations/:organizationId")
export class OrganizationEventsController {
  constructor(private readonly events: OrganizationEventsService) {}

  @Get("events")
  list(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.events.list(user, organizationId);
  }

  @Post("events")
  create(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Body() dto: CreateOrganizationEventDto) {
    return this.events.create(user, organizationId, dto);
  }

  @Patch("events/:eventId")
  update(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("eventId") eventId: string, @Body() dto: UpdateOrganizationEventDto) {
    return this.events.update(user, organizationId, eventId, dto);
  }

  @Delete("events/:eventId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("eventId") eventId: string) {
    return this.events.remove(user, organizationId, eventId);
  }

  @Patch("events/:eventId/dates/:date")
  @HttpCode(HttpStatus.NO_CONTENT)
  updateDate(
    @SignedIn() user: AuthenticatedUser,
    @Param("organizationId") organizationId: string,
    @Param("eventId") eventId: string,
    @Param("date") date: string,
    @Body() dto: UpdateOrganizationEventDateDto,
  ) {
    return this.events.updateDate(user, organizationId, eventId, date, dto.cancelled);
  }

  /** Its groups' events asking to become the organisation's (issue #549): its admins accept or decline them. */
  @Get("event-transfers")
  transfers(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.events.transfers(user, organizationId);
  }

  @Post("event-transfers/:teamEventId/accept")
  acceptTransfer(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("teamEventId") teamEventId: string) {
    return this.events.decideTransfer(user, organizationId, teamEventId, true);
  }

  @Post("event-transfers/:teamEventId/decline")
  @HttpCode(HttpStatus.NO_CONTENT)
  async declineTransfer(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("teamEventId") teamEventId: string) {
    await this.events.decideTransfer(user, organizationId, teamEventId, false);
  }

  @Get("event-dates")
  dates(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Query() query: TeamEventDatesQueryDto) {
    return this.events.dates(user, organizationId, query.from, query.to);
  }

  @Get("event-presets")
  presets(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.events.presets(user, organizationId);
  }

  @Post("event-presets")
  createPreset(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Body() dto: OrganizationEventPresetDto) {
    return this.events.createPreset(user, organizationId, dto);
  }

  @Delete("event-presets/:presetId")
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePreset(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("presetId") presetId: string) {
    return this.events.deletePreset(user, organizationId, presetId);
  }

  /** Event types its groups pick from (issue #528). */
  @Get("event-types")
  eventTypes(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.events.eventTypes(user, organizationId);
  }

  @Post("event-types")
  createEventType(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Body() dto: CreateTeamEventTypeDto) {
    return this.events.createEventType(user, organizationId, dto);
  }

  @Patch("event-types/:typeId")
  updateEventType(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("typeId") typeId: string, @Body() dto: UpdateTeamEventTypeDto) {
    return this.events.updateEventType(user, organizationId, typeId, dto);
  }

  @Delete("event-types/:typeId")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteEventType(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("typeId") typeId: string) {
    return this.events.deleteEventType(user, organizationId, typeId);
  }
}
