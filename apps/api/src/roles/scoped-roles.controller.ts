import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, NotFoundException, Param, Put, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AssignRolesSchema } from "@oneverse/core";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { TeamAdminGuard } from "../common/guards/team-admin.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RolesService } from "./roles.service.js";

class AssignScopedRolesDto extends zodDto(AssignRolesSchema) {}

/**
 * The roles a team's or an organisation's admins give their own members,
 * on their team or organisation only (issue #270): those Admin > Roles made
 * team-assignable, like the media operator.
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
