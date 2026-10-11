import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { isCalendarDate } from "@songverse/core";
import { BadRequestException } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { TeamAdminGuard } from "../common/guards/team-admin.guard.js";
import { TeamMemberGuard } from "../common/guards/team-member.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { AnswerEventDateDto, AssignPartDto, CreateAnswerRequestDto, RequestSwapDto, RespondAssignmentDto, CreateTeamEventDto, TeamEventDatesQueryDto, UpdateTeamCalendarDto, UpdateTeamEventDateDto, UpdateTeamEventDto } from "./dto/team-events.dto.js";
import { AccessPolicyService } from "../access/access-policy.service.js";
import { AvailabilityService } from "./availability.service.js";
import { LineupService } from "./lineup.service.js";
import { RemindersService } from "./reminders.service.js";
import { TeamEventsService } from "./team-events.service.js";

function dateParam(date: string): string {
  if (!isCalendarDate(date)) throw new BadRequestException(["date must be a date, YYYY-MM-DD"]);
  return date;
}

/**
 * A team's calendar (issue #235): every member sees it; its admins manage
 * the events, change or cancel a date, and choose how far ahead the dates'
 * sets are made.
 */
@ApiTags("team calendar")
@ApiBearerAuth()
@Controller("teams/:teamId")
export class TeamEventsController {
  constructor(
    private readonly events: TeamEventsService,
    private readonly availability: AvailabilityService,
    private readonly reminders: RemindersService,
    private readonly lineup: LineupService,
    private readonly access: AccessPolicyService,
  ) {}

  @Get("events")
  @UseGuards(TeamMemberGuard)
  list(@Param("teamId") teamId: string) {
    return this.events.list(teamId);
  }

  /**
   * The team's dates in a range (at most 400 days), every event's, in time
   * order, with their sets and the viewer's answer; for its admins, the
   * counts of the members' answers too.
   */
  @Get("event-dates")
  @UseGuards(TeamMemberGuard)
  async dates(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Query() query: TeamEventDatesQueryDto) {
    if (!user) throw new UnauthorizedException();
    const isAdmin = user.isGlobalAdmin || (await this.access.teamRole(user.id, teamId)) === "ADMIN";
    return this.availability.withAnswers(teamId, user.id, isAdmin, await this.events.dates(teamId, query.from, query.to));
  }

  /** The viewer's answer for a date: Available, If needed or Not available, with a note for the team's admins. */
  @Put("events/:eventId/dates/:date/answer")
  @UseGuards(TeamMemberGuard)
  answer(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Param("eventId") eventId: string, @Param("date") date: string, @Body() dto: AnswerEventDateDto) {
    if (!user) throw new UnauthorizedException();
    return this.availability.answer(teamId, eventId, dateParam(date), user.id, dto);
  }

  @Delete("events/:eventId/dates/:date/answer")
  @UseGuards(TeamMemberGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  clearAnswer(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Param("eventId") eventId: string, @Param("date") date: string) {
    if (!user) throw new UnauthorizedException();
    return this.availability.clear(teamId, eventId, dateParam(date), user.id);
  }

  /** Every member's answer for a date, with their notes: for the team's admins. */
  @Get("events/:eventId/dates/:date/answers")
  @UseGuards(TeamAdminGuard)
  answers(@Param("teamId") teamId: string, @Param("eventId") eventId: string, @Param("date") date: string) {
    return this.availability.answersFor(teamId, eventId, dateParam(date));
  }

  /** An admin answering for a member (who doesn't use the app, say): marked as answered by them. */
  @Put("events/:eventId/dates/:date/answers/:userId")
  @UseGuards(TeamAdminGuard)
  answerFor(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("teamId") teamId: string,
    @Param("eventId") eventId: string,
    @Param("date") date: string,
    @Param("userId") memberId: string,
    @Body() dto: AnswerEventDateDto,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.availability.answer(teamId, eventId, dateParam(date), memberId, dto, user.id);
  }

  @Delete("events/:eventId/dates/:date/answers/:userId")
  @UseGuards(TeamAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  clearFor(@Param("teamId") teamId: string, @Param("eventId") eventId: string, @Param("date") date: string, @Param("userId") memberId: string) {
    return this.availability.clear(teamId, eventId, dateParam(date), memberId);
  }

  @Post("events")
  @UseGuards(TeamAdminGuard)
  create(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Body() dto: CreateTeamEventDto) {
    if (!user) throw new UnauthorizedException();
    return this.events.create(teamId, user.id, dto);
  }

  @Get("events/:eventId")
  @UseGuards(TeamMemberGuard)
  get(@Param("teamId") teamId: string, @Param("eventId") eventId: string) {
    return this.events.get(teamId, eventId);
  }

  @Patch("events/:eventId")
  @UseGuards(TeamAdminGuard)
  update(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Param("eventId") eventId: string, @Body() dto: UpdateTeamEventDto) {
    return this.events.update(teamId, eventId, dto, user?.id ?? null);
  }

  /** Coming dates' sets still empty go with it; the others stay as the team's sets. */
  @Delete("events/:eventId")
  @UseGuards(TeamAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Param("eventId") eventId: string) {
    return this.events.remove(teamId, eventId, user?.id ?? null);
  }

  @Patch("events/:eventId/dates/:date")
  @UseGuards(TeamAdminGuard)
  updateDate(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Param("eventId") eventId: string, @Param("date") date: string, @Body() dto: UpdateTeamEventDateDto) {
    return this.events.updateDate(teamId, eventId, dateParam(date), dto, user?.id ?? null);
  }

  /** A date's set now, however far ahead: to plan it. */
  /** A member put on a part for a date (issue #235, phase 7): they're asked, and told. */
  @Post("events/:eventId/dates/:date/lineup")
  @UseGuards(TeamAdminGuard)
  assign(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Param("eventId") eventId: string, @Param("date") date: string, @Body() dto: AssignPartDto) {
    if (!user) throw new UnauthorizedException();
    return this.lineup.assign(teamId, eventId, dateParam(date), dto, user.id);
  }

  @Delete("events/:eventId/dates/:date/lineup/:assignmentId")
  @UseGuards(TeamAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  unassign(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Param("eventId") eventId: string, @Param("date") date: string, @Param("assignmentId") assignmentId: string) {
    if (!user) throw new UnauthorizedException();
    return this.lineup.unassign(teamId, eventId, dateParam(date), assignmentId, user.id);
  }

  /** The person scheduled accepts or declines their place. */
  @Put("events/:eventId/dates/:date/lineup/:assignmentId/response")
  // Not only members: a guest answers for their own place (the service checks it is theirs).
  respond(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("teamId") teamId: string,
    @Param("eventId") eventId: string,
    @Param("date") date: string,
    @Param("assignmentId") assignmentId: string,
    @Body() dto: RespondAssignmentDto,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.lineup.respond(teamId, eventId, dateParam(date), assignmentId, user.id, dto);
  }

  /** One asks for a replacement on their place: those who play the part are offered it. */
  @Post("events/:eventId/dates/:date/lineup/:assignmentId/swap")
  // Not only members: a guest answers for their own place (the service checks it is theirs).
  requestSwap(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param("teamId") teamId: string,
    @Param("eventId") eventId: string,
    @Param("date") date: string,
    @Param("assignmentId") assignmentId: string,
    @Body() dto: RequestSwapDto,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.lineup.requestSwap(teamId, eventId, dateParam(date), assignmentId, user.id, dto);
  }

  @Delete("events/:eventId/dates/:date/lineup/:assignmentId/swap")
  // Not only members: a guest answers for their own place (the service checks it is theirs).
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelSwap(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Param("eventId") eventId: string, @Param("date") date: string, @Param("assignmentId") assignmentId: string) {
    if (!user) throw new UnauthorizedException();
    return this.lineup.cancelSwap(teamId, eventId, dateParam(date), assignmentId, user.id);
  }

  /** A member takes the place offered: the first one gets it. */
  @Post("events/:eventId/dates/:date/lineup/:assignmentId/take")
  @UseGuards(TeamMemberGuard)
  takeSwap(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Param("eventId") eventId: string, @Param("date") date: string, @Param("assignmentId") assignmentId: string) {
    if (!user) throw new UnauthorizedException();
    return this.lineup.takeSwap(teamId, eventId, dateParam(date), assignmentId, user.id);
  }

  /** The set for a date is ready: the people signed up for it are told (issue #235). */
  @Post("events/:eventId/dates/:date/set-ready")
  @UseGuards(TeamAdminGuard)
  setReady(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Param("eventId") eventId: string, @Param("date") date: string) {
    if (!user) throw new UnauthorizedException();
    return this.reminders.setReady(teamId, eventId, dateParam(date), user.id);
  }

  /** The team's open requests for answers: for everyone, so members see what's asked by when. */
  @Get("answer-requests")
  @UseGuards(TeamMemberGuard)
  answerRequests(@Param("teamId") teamId: string) {
    return this.reminders.listRequests(teamId);
  }

  /** Answers asked for, by a deadline: members missing some are told now, and reminded the day before it. */
  @Post("answer-requests")
  @UseGuards(TeamAdminGuard)
  askForAnswers(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Body() dto: CreateAnswerRequestDto) {
    if (!user) throw new UnauthorizedException();
    return this.reminders.createRequest(teamId, user.id, dto);
  }

  @Delete("answer-requests/:requestId")
  @UseGuards(TeamAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAnswerRequest(@Param("teamId") teamId: string, @Param("requestId") requestId: string) {
    return this.reminders.removeRequest(teamId, requestId);
  }

  @Post("events/:eventId/dates/:date/set")
  @UseGuards(TeamAdminGuard)
  ensureSet(@Param("teamId") teamId: string, @Param("eventId") eventId: string, @Param("date") date: string) {
    return this.events.ensureDateSet(teamId, eventId, dateParam(date));
  }

  @Get("calendar-settings")
  @UseGuards(TeamMemberGuard)
  settings(@Param("teamId") teamId: string) {
    return this.events.calendarSettings(teamId);
  }

  @Put("calendar-settings")
  @UseGuards(TeamAdminGuard)
  updateSettings(@Param("teamId") teamId: string, @Body() dto: UpdateTeamCalendarDto) {
    return this.events.updateCalendarSettings(teamId, dto);
  }
}
