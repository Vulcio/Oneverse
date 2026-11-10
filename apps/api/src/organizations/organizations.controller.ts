import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { planiverseUrl } from "../common/utils/web-apps.js";
import { TeamAdminGuard } from "../common/guards/team-admin.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { CreateInviteLinkDto } from "../teams/dto/create-invite-link.dto.js";
import { UpdateMemberRoleDto } from "../teams/dto/update-member-role.dto.js";
import { TeamsService } from "../teams/teams.service.js";
import { CreateOrganizationDto } from "./dto/create-organization.dto.js";
import { DeclineOrganizationRequestDto, RequestOrganizationDto } from "./dto/organization-request.dto.js";
import { SaveOrganizationSettingsDto } from "./dto/save-organization-settings.dto.js";
import { SetTeamOrganizationDto } from "./dto/set-team-organization.dto.js";
import { UpdateOrganizationDto } from "./dto/update-organization.dto.js";
import { clearOrganizationSettings, getOrganizationSettingsSummary, saveOrganizationSettings } from "./organization-settings.js";
import { OrganizationsService } from "./organizations.service.js";

/** Organisations (issue #241): one's own, and for their admins, their members, invite links and teams. */
@ApiTags("organizations")
@ApiBearerAuth()
@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOkResponse({ description: "The instance's mode (NONE, SINGLE, MULTI), whether one may create one, and one's own." })
  mine(@SignedIn() user: AuthenticatedUser) {
    return this.organizations.mine(user);
  }

  @Post()
  create(@SignedIn() user: AuthenticatedUser, @Body() dto: CreateOrganizationDto) {
    return this.organizations.create(user, dto);
  }

  @RateLimit("heavy")
  @Post("requests")
  @RateLimit("heavy")
  @ApiOkResponse({ description: "Asked for, reviewed by a global admin (issue #364); 409 with looksLike when it looks like one already here, unless duplicateNote says why it isn't." })
  request(@SignedIn() user: AuthenticatedUser, @Body() dto: RequestOrganizationDto) {
    return this.organizations.request(user, dto);
  }

  @Delete("requests/:requestId")
  @HttpCode(HttpStatus.NO_CONTENT)
  withdrawRequest(@SignedIn() user: AuthenticatedUser, @Param("requestId") requestId: string) {
    return this.organizations.withdrawRequest(user, requestId);
  }

  @Post("join/:token")
  join(@SignedIn() user: AuthenticatedUser, @Param("token") token: string) {
    return this.organizations.join(user, token);
  }

  @Get(":organizationId")
  findOne(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.organizations.findOne(user, organizationId);
  }

  @Patch(":organizationId")
  update(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Body() dto: UpdateOrganizationDto) {
    return this.organizations.update(user, organizationId, dto);
  }

  @Delete(":organizationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.organizations.remove(user, organizationId);
  }

  @Get(":organizationId/members")
  members(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.organizations.members(user, organizationId);
  }

  @Patch(":organizationId/members/:userId")
  setRole(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("userId") userId: string, @Body() dto: UpdateMemberRoleDto) {
    return this.organizations.setRole(user, organizationId, userId, dto.role);
  }

  @Delete(":organizationId/members/:userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("userId") userId: string) {
    return this.organizations.removeMember(user, organizationId, userId);
  }

  @Post(":organizationId/leave")
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.organizations.leave(user, organizationId);
  }

  @Get(":organizationId/invite-links")
  inviteLinks(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
    return this.organizations.inviteLinks(user, organizationId);
  }

  @Post(":organizationId/invite-links")
  createInviteLink(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Body() dto: CreateInviteLinkDto) {
    return this.organizations.createInviteLink(user, organizationId, dto);
  }

  @Delete(":organizationId/invite-links/:linkId")
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInviteLink(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("linkId") linkId: string) {
    return this.organizations.revokeInviteLink(user, organizationId, linkId);
  }

  @Delete(":organizationId/teams/:teamId")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTeam(@SignedIn() user: AuthenticatedUser, @Param("organizationId") organizationId: string, @Param("teamId") teamId: string) {
    return this.organizations.removeTeam(user, organizationId, teamId);
  }
}

/** The organisation a team is part of, set by the team's admins. */
@ApiTags("teams")
@ApiBearerAuth()
@Controller("teams")
export class TeamOrganizationController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly teams: TeamsService,
  ) {}

  @Put(":teamId/organization")
  @UseGuards(TeamAdminGuard)
  async set(@SignedIn() user: AuthenticatedUser, @Param("teamId") teamId: string, @Body() dto: SetTeamOrganizationDto) {
    const viewer = user;
    await this.organizations.setTeamOrganization(viewer, teamId, dto.organizationId);
    return this.teams.findOne(viewer.id, teamId);
  }
}

/** Admin > Organisations (issue #241): whether the instance has none, one or several, and every organisation. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/organizations")
@UseGuards(GlobalAdminGuard)
export class AdminOrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  async list() {
    // Where Planiverse is (issue #241): set where it's deployed (PLANIVERSE_URL), read at boot for sign-in and CORS.
    return { ...(await getOrganizationSettingsSummary()), planiverseUrl: planiverseUrl(), organizations: await this.organizations.adminList() };
  }

  @Put("settings")
  @HttpCode(HttpStatus.NO_CONTENT)
  save(@Body() dto: SaveOrganizationSettingsDto) {
    return saveOrganizationSettings(dto);
  }

  @Delete("settings")
  @HttpCode(HttpStatus.NO_CONTENT)
  clear() {
    return clearOrganizationSettings();
  }

  @Post()
  create(@SignedIn() user: AuthenticatedUser, @Body() dto: CreateOrganizationDto) {
    return this.organizations.adminCreate(user, dto);
  }

  @Get("requests")
  requests() {
    return this.organizations.adminRequests();
  }

  @Post("requests/:requestId/approve")
  approve(@SignedIn() user: AuthenticatedUser, @Param("requestId") requestId: string) {
    return this.organizations.approveRequest(user, requestId);
  }

  @Post("requests/:requestId/decline")
  @HttpCode(HttpStatus.NO_CONTENT)
  decline(@SignedIn() user: AuthenticatedUser, @Param("requestId") requestId: string, @Body() dto: DeclineOrganizationRequestDto) {
    return this.organizations.declineRequest(user, requestId, dto);
  }

  @Delete(":organizationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("organizationId") organizationId: string) {
    return this.organizations.adminRemove(organizationId);
  }
}
