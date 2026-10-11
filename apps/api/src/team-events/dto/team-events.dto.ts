import { AnswerEventDateSchema, AssignPartSchema, CreateAnswerRequestSchema, RespondAssignmentSchema, CreateAwaySchema, UpdateAwaySchema, MyEventDatesQuerySchema, CreateTeamEventSchema, TeamEventDatesQuerySchema, UpdateTeamCalendarSchema, UpdateTeamEventDateSchema, UpdateTeamEventSchema } from "@songverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class CreateTeamEventDto extends zodDto(CreateTeamEventSchema) {}
export class UpdateTeamEventDto extends zodDto(UpdateTeamEventSchema) {}
export class UpdateTeamEventDateDto extends zodDto(UpdateTeamEventDateSchema) {}
export class TeamEventDatesQueryDto extends zodDto(TeamEventDatesQuerySchema) {}
export class UpdateTeamCalendarDto extends zodDto(UpdateTeamCalendarSchema) {}
export class AnswerEventDateDto extends zodDto(AnswerEventDateSchema) {}
export class CreateAwayDto extends zodDto(CreateAwaySchema) {}
export class UpdateAwayDto extends zodDto(UpdateAwaySchema) {}
export class MyEventDatesQueryDto extends zodDto(MyEventDatesQuerySchema) {}
export class CreateAnswerRequestDto extends zodDto(CreateAnswerRequestSchema) {}
export class AssignPartDto extends zodDto(AssignPartSchema) {}
export class RespondAssignmentDto extends zodDto(RespondAssignmentSchema) {}
