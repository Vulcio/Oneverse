import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { TeamAdminGuard } from "../common/guards/team-admin.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { CreateInviteLinkDto } from "../teams/dto/create-invite-link.dto.js";
import { UpdateMemberRoleDto } from "../teams/dto/update-member-role.dto.js";
import { TeamsService } from "../teams/teams.service.js";
import { CreateOrganizationDto } from "./dto/create-organization.dto.js";
import { SaveOrganizationSettingsDto } from "./dto/save-organization-settings.dto.js";
import { SetTeamOrganizationDto } from "./dto/set-team-organization.dto.js";
import { UpdateOrganizationDto } from "./dto/update-organization.dto.js";
import { clearOrganizationSettings, getOrganizationSettingsSummary, saveOrganizationSettings } from "./organization-settings.js";
import { OrganizationsService } from "./organizations.service.js";

function signedIn(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new UnauthorizedException();
  return user;
}

/** Organisations (issue #241): one's own, and for their admins, their members, invite links and teams. */
@ApiTags("organizations")
@ApiBearerAuth()
@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOkResponse({ description: "The instance's mode (NONE, SINGLE, MULTI), whether one may create one, and one's own." })
  mine(@CurrentUser() user?: AuthenticatedUser) {
    return this.organizations.mine(signedIn(user));
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateOrganizationDto) {
    return this.organizations.create(signedIn(user), dto);
  }

  @RateLimit("heavy")
  @Post("join/:token")
  join(@CurrentUser() user: AuthenticatedUser | undefined, @Param("token") token: string) {
    return this.organizations.join(signedIn(user), token);
  }

  @Get(":organizationId")
  findOne(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string) {
    return this.organizations.findOne(signedIn(user), organizationId);
  }

  @Patch(":organizationId")
  update(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string, @Body() dto: UpdateOrganizationDto) {
    return this.organizations.update(signedIn(user), organizationId, dto);
  }

  @Delete(":organizationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string) {
    return this.organizations.remove(signedIn(user), organizationId);
  }

  @Get(":organizationId/members")
  members(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string) {
    return this.organizations.members(signedIn(user), organizationId);
  }

  @Patch(":organizationId/members/:userId")
  setRole(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string, @Param("userId") userId: string, @Body() dto: UpdateMemberRoleDto) {
    return this.organizations.setRole(signedIn(user), organizationId, userId, dto.role);
  }

  @Delete(":organizationId/members/:userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string, @Param("userId") userId: string) {
    return this.organizations.removeMember(signedIn(user), organizationId, userId);
  }

  @Post(":organizationId/leave")
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string) {
    return this.organizations.leave(signedIn(user), organizationId);
  }

  @Get(":organizationId/invite-links")
  inviteLinks(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string) {
    return this.organizations.inviteLinks(signedIn(user), organizationId);
  }

  @Post(":organizationId/invite-links")
  createInviteLink(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string, @Body() dto: CreateInviteLinkDto) {
    return this.organizations.createInviteLink(signedIn(user), organizationId, dto);
  }

  @Delete(":organizationId/invite-links/:linkId")
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInviteLink(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string, @Param("linkId") linkId: string) {
    return this.organizations.revokeInviteLink(signedIn(user), organizationId, linkId);
  }

  @Delete(":organizationId/teams/:teamId")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTeam(@CurrentUser() user: AuthenticatedUser | undefined, @Param("organizationId") organizationId: string, @Param("teamId") teamId: string) {
    return this.organizations.removeTeam(signedIn(user), organizationId, teamId);
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
  async set(@CurrentUser() user: AuthenticatedUser | undefined, @Param("teamId") teamId: string, @Body() dto: SetTeamOrganizationDto) {
    const viewer = signedIn(user);
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
    return { ...(await getOrganizationSettingsSummary()), organizations: await this.organizations.adminList() };
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
  create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateOrganizationDto) {
    return this.organizations.adminCreate(signedIn(user), dto);
  }

  @Delete(":organizationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("organizationId") organizationId: string) {
    return this.organizations.adminRemove(organizationId);
  }
}
