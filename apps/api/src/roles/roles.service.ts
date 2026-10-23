import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateRoleInput, UpdateRoleInput } from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageQuotaService } from "../storage/storage-quota.service.js";

const BYTES_PER_MB = 1024 * 1024;

/** Where a role is given (issue #270): a team, or an organisation. */
export type Scope = { teamId: string } | { organizationId: string };

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  builtIn: true,
  canReview: true,
  canSeparateStems: true,
  canKeepLosslessAudio: true,
  canUploadAudio: true,
  canOperateScreens: true,
  canCue: true,
  canRoute: true,
  canManageScreens: true,
  teamAssignable: true,
  stemSeparationMonthlyLimit: true,
  storageLimitMb: true,
  permissions: true,
  _count: { select: { assignments: { where: { userId: { not: null } } } } },
} as const;

/**
 * Admin > Roles, and the roles given in Admin > Users and Admin > Teams
 * (issue #160). What they allow is worked out in capabilities.ts.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: StorageQuotaService,
  ) {}

  async list() {
    const [roles, teamCounts] = await Promise.all([
      this.prisma.client.role.findMany({ select: ROLE_SELECT, orderBy: [{ builtIn: { sort: "asc", nulls: "last" } }, { name: "asc" }] }),
      this.prisma.client.roleAssignment.groupBy({ by: ["roleId"], where: { teamId: { not: null } }, _count: { _all: true } }),
    ]);
    const teams = new Map(teamCounts.map((row) => [row.roleId, row._count._all]));
    return roles.map(({ _count, ...role }) => ({ ...role, userCount: _count.assignments, teamCount: teams.get(role.id) ?? 0 }));
  }

  async create(input: CreateRoleInput) {
    try {
      const role = await this.prisma.client.role.create({ data: { ...input, description: input.description ?? "" }, select: { id: true } });
      return role;
    } catch (error) {
      throw this.nameTaken(error);
    }
  }

  async update(roleId: string, input: UpdateRoleInput): Promise<void> {
    await this.find(roleId);
    try {
      await this.prisma.client.role.update({ where: { id: roleId }, data: input });
    } catch (error) {
      throw this.nameTaken(error);
    }
  }

  /** The built-in ones stay: the reviewing and stem separation screens rely on there being one. */
  async remove(roleId: string): Promise<void> {
    const role = await this.find(roleId);
    if (role.builtIn) throw new BadRequestException("A built-in role can't be deleted; take it away from everyone instead");
    await this.prisma.client.role.delete({ where: { id: roleId } });
  }

  /** The roles a user has from now on (their own; their teams' come on top). */
  async setUserRoles(userId: string, roleIds: string[]): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { deletedAt: true } });
    if (!user || user.deletedAt) throw new NotFoundException("User not found");
    await this.assign({ userId }, roleIds);
  }

  async setTeamRoles(teamId: string, roleIds: string[]): Promise<void> {
    const team = await this.prisma.client.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) throw new NotFoundException("Team not found");
    await this.assign({ teamId }, roleIds);
  }

  /** Admin > Teams: each team, its members and songs, its storage pool and its roles. */
  async listTeams() {
    const [teams, usedBytes, { limitMb: defaultMb }] = await Promise.all([
      this.prisma.client.team.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          color: true,
          avatarUrl: true,
          createdAt: true,
          _count: { select: { memberships: true, ownedVersions: true } },
          roleAssignments: { select: { role: { select: { id: true, name: true, storageLimitMb: true } } } },
        },
      }),
      this.quota.usedBytesByTeam(),
      this.quota.getDefaultTeamLimitMb(),
    ]);
    return teams.map((team) => {
      const roles = team.roleAssignments.map(({ role }) => role).sort((a, b) => a.name.localeCompare(b.name));
      const tiers = roles.map((role) => role.storageLimitMb).filter((mb): mb is number => mb !== null);
      return {
        id: team.id,
        name: team.name,
        slug: team.slug,
        color: team.color,
        avatarUrl: team.avatarUrl,
        createdAt: team.createdAt,
        memberCount: team._count.memberships,
        songCount: team._count.ownedVersions,
        roles: roles.map(({ id, name }) => ({ id, name })),
        usedBytes: usedBytes.get(team.id) ?? 0,
        limitBytes: (tiers.length ? Math.max(...tiers) : defaultMb) * BYTES_PER_MB,
      };
    });
  }

  private async assign(holder: { userId: string } | { teamId: string }, roleIds: string[]): Promise<void> {
    const wanted = [...new Set(roleIds)];
    const found = await this.prisma.client.role.count({ where: { id: { in: wanted } } });
    if (found !== wanted.length) throw new BadRequestException("roleIds must be existing roles");
    await this.prisma.client.$transaction([
      // Those given everywhere; those given on a team or an organisation stay (issue #270).
      this.prisma.client.roleAssignment.deleteMany({ where: { ...holder, scopeKey: "", roleId: { notIn: wanted } } }),
      this.prisma.client.roleAssignment.createMany({ data: wanted.map((roleId) => ({ ...holder, roleId })), skipDuplicates: true }),
    ]);
  }

  /** The roles a team's or an organisation's admins give their members there (issue #270), and who has which. */
  async scopedRoles(scope: Scope) {
    const where = "teamId" in scope ? { scopeTeamId: scope.teamId } : { scopeOrganizationId: scope.organizationId };
    const [roles, assignments, members] = await Promise.all([
      this.prisma.client.role.findMany({ where: { teamAssignable: true }, select: { id: true, name: true, description: true, canOperateScreens: true, canCue: true, canRoute: true, canManageScreens: true }, orderBy: { name: "asc" } }),
      this.prisma.client.roleAssignment.findMany({ where: { ...where, userId: { not: null } }, select: { userId: true, roleId: true } }),
      this.memberIds(scope),
    ]);
    // Its members' only: one who left keeps nothing here.
    return { roles, members: members.map((userId) => ({ userId, roleIds: assignments.filter((one) => one.userId === userId).map((one) => one.roleId) })) };
  }

  /** The roles a member has on the team or the organisation from now on: only team-assignable ones, given there. */
  async setScopedRoles(scope: Scope, userId: string, roleIds: string[]): Promise<void> {
    if (!(await this.memberIds(scope)).includes(userId)) throw new NotFoundException("Member not found");
    const wanted = [...new Set(roleIds)];
    const found = await this.prisma.client.role.count({ where: { id: { in: wanted }, teamAssignable: true } });
    if (found !== wanted.length) throw new BadRequestException("roleIds must be roles a team's admins may give");
    const at = "teamId" in scope ? { scopeTeamId: scope.teamId, scopeKey: `team:${scope.teamId}` } : { scopeOrganizationId: scope.organizationId, scopeKey: `organization:${scope.organizationId}` };
    await this.prisma.client.$transaction([
      this.prisma.client.roleAssignment.deleteMany({ where: { userId, scopeKey: at.scopeKey, roleId: { notIn: wanted } } }),
      this.prisma.client.roleAssignment.createMany({ data: wanted.map((roleId) => ({ userId, roleId, ...at })), skipDuplicates: true }),
    ]);
  }

  private async memberIds(scope: Scope): Promise<string[]> {
    const rows =
      "teamId" in scope
        ? await this.prisma.client.teamMembership.findMany({ where: { teamId: scope.teamId }, select: { userId: true } })
        : await this.prisma.client.organizationMembership.findMany({ where: { organizationId: scope.organizationId }, select: { userId: true } });
    return rows.map((row) => row.userId);
  }

  private async find(roleId: string) {
    const role = await this.prisma.client.role.findUnique({ where: { id: roleId }, select: { builtIn: true } });
    if (!role) throw new NotFoundException("Role not found");
    return role;
  }

  private nameTaken(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return new ConflictException("A role with this name already exists");
    }
    return error;
  }
}
