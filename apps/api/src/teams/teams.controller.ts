import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { WhileAwaitingApproval } from "../common/decorators/while-awaiting-approval.decorator.js";
import { letInByInvitation } from "../organizations/organization-signup.js";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import { TeamAdminGuard } from "../common/guards/team-admin.guard.js";
import { TeamMemberGuard } from "../common/guards/team-member.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { CreateInviteLinkDto } from "./dto/create-invite-link.dto.js";
import { CreateTeamDto } from "./dto/create-team.dto.js";
import { ListTeamsQueryDto } from "./dto/list-teams-query.dto.js";
import { InviteLinkResponseDto } from "./dto/invite-link-response.dto.js";
import { TeamMemberResponseDto } from "./dto/team-member-response.dto.js";
import { TeamInvitationDto } from "./dto/team-invitation.dto.js";
import { TeamResponseDto } from "./dto/team-response.dto.js";
import { UpdateMemberRoleDto } from "./dto/update-member-role.dto.js";
import { UpdateTeamDto } from "./dto/update-team.dto.js";
import { TeamsService } from "./teams.service.js";
import { RateLimit } from "../security/rate-limit.decorator.js";

@ApiTags("teams")
@ApiBearerAuth()
@Controller("teams")
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  @ApiOkResponse({ type: TeamResponseDto, isArray: true })
  findMyTeams(@SignedIn() user: AuthenticatedUser, @Query() query: ListTeamsQueryDto): ReturnType<TeamsService["findMyTeams"]> {
    return this.teamsService.findMyTeams(user.id, query.all ?? false);
  }

  @Post()
  @ApiCreatedResponse({ type: TeamResponseDto })
  create(
    @SignedIn() user: AuthenticatedUser,
    @Body() dto: CreateTeamDto,
  ): ReturnType<TeamsService["create"]> {
    return this.teamsService.create(user.id, dto);
  }

  @RateLimit("heavy")
  @Post("join/:token")
  @WhileAwaitingApproval()
  @ApiCreatedResponse({ type: TeamResponseDto })
  async joinByToken(
    @SignedIn() user: AuthenticatedUser,
    @Param("token") token: string,
  ): Promise<Awaited<ReturnType<TeamsService["joinByToken"]>>> {
    const team = await this.teamsService.joinByToken(user.id, token);
    // Invitations always work (issue #533): waiting for an organisation's approval or not.
    if (user.awaitingApproval) await letInByInvitation(user.id);
    return team;
  }

  @Get(":teamId")
  @UseGuards(TeamMemberGuard)
  @ApiOkResponse({ type: TeamResponseDto })
  findOne(
    @SignedIn() user: AuthenticatedUser,
    @Param("teamId") teamId: string,
  ): ReturnType<TeamsService["findOne"]> {
    return this.teamsService.findOne(user.id, teamId);
  }

  /** Its name, description and colour (issue #161); its picture is PUT /teams/:id/avatar. */
  @Patch(":teamId")
  @UseGuards(TeamAdminGuard)
  @ApiOkResponse({ type: TeamResponseDto })
  update(
    @SignedIn() user: AuthenticatedUser,
    @Param("teamId") teamId: string,
    @Body() dto: UpdateTeamDto,
  ): ReturnType<TeamsService["update"]> {
    return this.teamsService.update(user.id, teamId, dto);
  }

  @Get(":teamId/members")
  @UseGuards(TeamMemberGuard)
  @ApiOkResponse({ type: TeamMemberResponseDto, isArray: true })
  listMembers(@Param("teamId") teamId: string): ReturnType<TeamsService["listMembers"]> {
    return this.teamsService.listMembers(teamId);
  }

  @Patch(":teamId/members/:memberUserId")
  @UseGuards(TeamAdminGuard)
  @ApiOkResponse({ type: TeamMemberResponseDto })
  updateMemberRole(
    @Param("teamId") teamId: string,
    @Param("memberUserId") memberUserId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): ReturnType<TeamsService["updateMemberRole"]> {
    return this.teamsService.updateMemberRole(teamId, memberUserId, dto.role, user?.id ?? null);
  }

  @Delete(":teamId/members/:memberUserId")
  @UseGuards(TeamAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(@Param("teamId") teamId: string, @Param("memberUserId") memberUserId: string): Promise<void> {
    return this.teamsService.removeMember(teamId, memberUserId);
  }

  @Delete(":teamId")
  @UseGuards(TeamAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("teamId") teamId: string): Promise<void> {
    return this.teamsService.remove(teamId);
  }

  @Post(":teamId/leave")
  @UseGuards(TeamMemberGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@SignedIn() user: AuthenticatedUser, @Param("teamId") teamId: string): Promise<void> {
    return this.teamsService.leaveTeam(teamId, user.id);
  }

  @Get(":teamId/invite-links")
  @UseGuards(TeamAdminGuard)
  @ApiOkResponse({ type: InviteLinkResponseDto, isArray: true })
  listInviteLinks(@Param("teamId") teamId: string): ReturnType<TeamsService["listInviteLinks"]> {
    return this.teamsService.listInviteLinks(teamId);
  }

  @Post(":teamId/invite-links")
  @UseGuards(TeamAdminGuard)
  @ApiCreatedResponse({ type: InviteLinkResponseDto })
  createInviteLink(
    @Param("teamId") teamId: string,
    @Body() dto: CreateInviteLinkDto,
  ): ReturnType<TeamsService["createInviteLink"]> {
    return this.teamsService.createInviteLink(teamId, dto);
  }

  @Post(":teamId/invitations")
  @UseGuards(TeamAdminGuard)
  @RateLimit("heavy")
  @ApiOperation({ summary: "Invites someone by email", description: "Issue #550: an email with a link to join, for one use, two weeks; it waits among the invite links (with its `email`) until used. Again for the same address: sent again, renewed." })
  @ApiCreatedResponse({ type: InviteLinkResponseDto })
  invite(@Param("teamId") teamId: string, @Body() dto: TeamInvitationDto, @SignedIn() user: AuthenticatedUser): ReturnType<TeamsService["invite"]> {
    return this.teamsService.invite(teamId, user.id, dto);
  }

  @Delete(":teamId/invite-links/:linkId")
  @UseGuards(TeamAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInviteLink(@Param("teamId") teamId: string, @Param("linkId") linkId: string): Promise<void> {
    return this.teamsService.revokeInviteLink(teamId, linkId);
  }
}
