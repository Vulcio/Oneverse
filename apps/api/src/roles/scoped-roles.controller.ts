import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, NotFoundException, Param, Patch, Post, Put, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AssignRolesSchema, CreateOwnRoleSchema, UpdateOwnRoleSchema } from "@oneverse/core";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { TeamAdminGuard } from "../common/guards/team-admin.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RolesService } from "./roles.service.js";

class AssignScopedRolesDto extends zodDto(AssignRolesSchema) {}
class CreateOwnRoleDto extends zodDto(CreateOwnRoleSchema) {}
class UpdateOwnRoleDto extends zodDto(UpdateOwnRoleSchema) {}

/**
 * The roles a team's or an organisation's admins give their own members,
 * on their team or organisation only (issue #270): those Admin > Roles made
 * team-assignable, like the media operator - and their own roles (issue
 * #206), made, changed and removed here, which count only there: their own
 * bucket, their own Sonic server, their sets' screens.
 */
@ApiTags("roles")
@ApiBearerAuth()
@Controller()
export class ScopedRolesController {
  constructor(
    private readonly roles: RolesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("teams/:teamId/roles")
  @UseGuards(TeamAdminGuard)
  teamRoles(@Param("teamId") teamId: string): ReturnType<RolesService["scopedRoles"]> {
    return this.roles.scopedRoles({ teamId });
  }

  @Put("teams/:teamId/members/:userId/roles")
  @UseGuards(TeamAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  setTeamMemberRoles(@Param("teamId") teamId: string, @Param("userId") userId: string, @Body() dto: AssignScopedRolesDto): Promise<void> {
    return this.roles.setScopedRoles({ teamId }, userId, dto.roleIds);
  }

  @Get("organizations/:organizationId/roles")
  async organizationRoles(@Param("organizationId") organizationId: string, @CurrentUser() user: AuthenticatedUser | undefined): ReturnType<RolesService["scopedRoles"]> {
    await this.assertOrganizationAdmin(user, organizationId);
    return this.roles.scopedRoles({ organizationId });
  }

  @Put("organizations/:organizationId/members/:userId/roles")
  @HttpCode(HttpStatus.NO_CONTENT)
  async setOrganizationMemberRoles(
    @Param("organizationId") organizationId: string,
    @Param("userId") userId: string,
    @Body() dto: AssignScopedRolesDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<void> {
    await this.assertOrganizationAdmin(user, organizationId);
    return this.roles.setScopedRoles({ organizationId }, userId, dto.roleIds);
  }

  @Post("teams/:teamId/roles")
  @UseGuards(TeamAdminGuard)
  createTeamRole(@Param("teamId") teamId: string, @Body() dto: CreateOwnRoleDto) {
    return this.roles.createOwn({ teamId }, dto);
  }

  @Patch("teams/:teamId/roles/:roleId")
  @UseGuards(TeamAdminGuard)
  updateTeamRole(@Param("teamId") teamId: string, @Param("roleId") roleId: string, @Body() dto: UpdateOwnRoleDto) {
    return this.roles.updateOwn({ teamId }, roleId, dto);
  }

  @Delete("teams/:teamId/roles/:roleId")
  @UseGuards(TeamAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTeamRole(@Param("teamId") teamId: string, @Param("roleId") roleId: string): Promise<void> {
    return this.roles.removeOwn({ teamId }, roleId);
  }

  @Post("organizations/:organizationId/roles")
  async createOrganizationRole(@Param("organizationId") organizationId: string, @Body() dto: CreateOwnRoleDto, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.assertOrganizationAdmin(user, organizationId);
    return this.roles.createOwn({ organizationId }, dto);
  }

  @Patch("organizations/:organizationId/roles/:roleId")
  async updateOrganizationRole(@Param("organizationId") organizationId: string, @Param("roleId") roleId: string, @Body() dto: UpdateOwnRoleDto, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.assertOrganizationAdmin(user, organizationId);
    return this.roles.updateOwn({ organizationId }, roleId, dto);
  }

  @Delete("organizations/:organizationId/roles/:roleId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeOrganizationRole(@Param("organizationId") organizationId: string, @Param("roleId") roleId: string, @CurrentUser() user: AuthenticatedUser | undefined): Promise<void> {
    await this.assertOrganizationAdmin(user, organizationId);
    return this.roles.removeOwn({ organizationId }, roleId);
  }

  /** An organisation's own roles one of its teams has (issue #206): a storage tier for its share of the bucket. */
  @Put("organizations/:organizationId/teams/:teamId/roles")
  @HttpCode(HttpStatus.NO_CONTENT)
  async setOrganizationTeamRoles(@Param("organizationId") organizationId: string, @Param("teamId") teamId: string, @Body() dto: AssignScopedRolesDto, @CurrentUser() user: AuthenticatedUser | undefined): Promise<void> {
    await this.assertOrganizationAdmin(user, organizationId);
    return this.roles.setOrganizationTeamRoles(organizationId, teamId, dto.roleIds);
  }

  private async assertOrganizationAdmin(user: AuthenticatedUser | undefined, organizationId: string) {
    if (!user) throw new UnauthorizedException();
    const [organization, membership] = await Promise.all([
      this.prisma.client.organization.findUnique({ where: { id: organizationId }, select: { id: true } }),
      this.prisma.client.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: user.id } }, select: { role: true } }),
    ]);
    if (!organization || (!membership && !user.isGlobalAdmin)) throw new NotFoundException("Organisation not found");
    if (membership?.role !== "ADMIN" && !user.isGlobalAdmin) throw new ForbiddenException("Organisation admin role required");
  }
}
