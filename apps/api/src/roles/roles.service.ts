import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateOwnRoleInput, CreateRoleInput, UpdateOwnRoleInput, UpdateRoleInput } from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageQuotaService } from "../storage/storage-quota.service.js";
import { ownerKeyOf } from "./capabilities.js";

const BYTES_PER_MB = 1024 * 1024;

/** Where a role is given (issue #270): a team, or an organisation; also who owns one of their own (issue #206). */
export type Scope = { teamId: string } | { organizationId: string };

/** What a team's or an organisation's own role shows. */
const OWN_ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  canSeparateStems: true,
  canKeepLosslessAudio: true,
  canUploadAudio: true,
  canOperateScreens: true,
  canCue: true,
  canRoute: true,
  canManageScreens: true,
  canStoreFiles: true,
  stemSeparationMonthlyLimit: true,
  storageLimitMb: true,
} as const;

/** A team has no bucket of its own: room there and audio uploads are an organisation's roles' only. */
function assertOwnFields(owner: Scope, input: { storageLimitMb?: number | null; canUploadAudio?: boolean; canKeepLosslessAudio?: boolean; canStoreFiles?: boolean }) {
  if ("teamId" in owner && (input.storageLimitMb != null || input.canUploadAudio || input.canKeepLosslessAudio || input.canStoreFiles)) {
    throw new BadRequestException(["A team's own role can't give storage or audio uploads: those are an organisation's, for its own bucket"]);
  }
}

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
  canUseOwnStorage: true,
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
      // The server's own; teams' and organisations' are theirs (issue #206).
      this.prisma.client.role.findMany({ where: { ownerKey: "" }, select: ROLE_SELECT, orderBy: [{ builtIn: { sort: "asc", nulls: "last" } }, { name: "asc" }] }),
      this.prisma.client.roleAssignment.groupBy({ by: ["roleId"], where: { teamId: { not: null }, scopeKey: "" }, _count: { _all: true } }),
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
          roleAssignments: { where: { scopeKey: "" }, select: { role: { select: { id: true, name: true, storageLimitMb: true } } } },
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
    const found = await this.prisma.client.role.count({ where: { id: { in: wanted }, ownerKey: "" } });
    if (found !== wanted.length) throw new BadRequestException("roleIds must be existing roles");
    await this.prisma.client.$transaction([
      // Those given everywhere; those given on a team or an organisation stay (issue #270).
      this.prisma.client.roleAssignment.deleteMany({ where: { ...holder, scopeKey: "", roleId: { notIn: wanted } } }),
      this.prisma.client.roleAssignment.createMany({ data: wanted.map((roleId) => ({ ...holder, roleId })), skipDuplicates: true }),
    ]);
  }

  /**
   * The roles a team's or an organisation's admins give their members there
   * (issue #270): the server's they may give, and their own (issue #206) with
   * what each allows; who has which; and, an organisation's, which of its own
   * its teams have.
   */
  async scopedRoles(scope: Scope) {
    const key = ownerKeyOf(scope);
    const where = "teamId" in scope ? { scopeTeamId: scope.teamId } : { scopeOrganizationId: scope.organizationId };
    const [given, own, assignments, members, teams] = await Promise.all([
      this.prisma.client.role.findMany({ where: { teamAssignable: true, ownerKey: "" }, select: { id: true, name: true, description: true, canOperateScreens: true, canCue: true, canRoute: true, canManageScreens: true }, orderBy: { name: "asc" } }),
      this.prisma.client.role.findMany({ where: { ownerKey: key }, select: OWN_ROLE_SELECT, orderBy: { name: "asc" } }),
      this.prisma.client.roleAssignment.findMany({ where: { ...where, scopeKey: key }, select: { userId: true, teamId: true, roleId: true } }),
      this.memberIds(scope),
      "organizationId" in scope ? this.prisma.client.team.findMany({ where: { organizationId: scope.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    ]);
    return {
      roles: given,
      own,
      // Its members' only: one who left keeps nothing here.
      members: members.map((userId) => ({ userId, roleIds: assignments.filter((one) => one.userId === userId).map((one) => one.roleId) })),
      teams: teams.map((team) => ({ teamId: team.id, name: team.name, roleIds: assignments.filter((one) => one.teamId === team.id).map((one) => one.roleId) })),
    };
  }

  /** The roles a member has on the team or the organisation from now on: the server's team-assignable ones, or its own, given there. */
  async setScopedRoles(scope: Scope, userId: string, roleIds: string[]): Promise<void> {
    if (!(await this.memberIds(scope)).includes(userId)) throw new NotFoundException("Member not found");
    const key = ownerKeyOf(scope);
    const wanted = [...new Set(roleIds)];
    const found = await this.prisma.client.role.count({ where: { id: { in: wanted }, OR: [{ teamAssignable: true, ownerKey: "" }, { ownerKey: key }] } });
    if (found !== wanted.length) throw new BadRequestException("roleIds must be roles a team's admins may give");
    const at = "teamId" in scope ? { scopeTeamId: scope.teamId, scopeKey: key } : { scopeOrganizationId: scope.organizationId, scopeKey: key };
    await this.prisma.client.$transaction([
      this.prisma.client.roleAssignment.deleteMany({ where: { userId, scopeKey: key, roleId: { notIn: wanted } } }),
      this.prisma.client.roleAssignment.createMany({ data: wanted.map((roleId) => ({ userId, roleId, ...at })), skipDuplicates: true }),
    ]);
  }

  /** An organisation's own roles one of its teams has from now on (issue #206): a storage tier for the team's share of its bucket. */
  async setOrganizationTeamRoles(organizationId: string, teamId: string, roleIds: string[]): Promise<void> {
    const team = await this.prisma.client.team.findFirst({ where: { id: teamId, organizationId }, select: { id: true } });
    if (!team) throw new NotFoundException("Team not found in this organisation");
    const key = ownerKeyOf({ organizationId });
    const wanted = [...new Set(roleIds)];
    const found = await this.prisma.client.role.count({ where: { id: { in: wanted }, ownerKey: key } });
    if (found !== wanted.length) throw new BadRequestException("roleIds must be the organisation's own roles");
    await this.prisma.client.$transaction([
      this.prisma.client.roleAssignment.deleteMany({ where: { teamId, scopeKey: key, roleId: { notIn: wanted } } }),
      this.prisma.client.roleAssignment.createMany({ data: wanted.map((roleId) => ({ teamId, roleId, scopeOrganizationId: organizationId, scopeKey: key })), skipDuplicates: true }),
    ]);
  }

  /** A team's or an organisation's own role (issue #206): made by its admins, with what's theirs to allow. */
  async createOwn(owner: Scope, input: CreateOwnRoleInput) {
    assertOwnFields(owner, input);
    const ownerFields = "teamId" in owner ? { ownerTeamId: owner.teamId } : { ownerOrganizationId: owner.organizationId };
    try {
      return await this.prisma.client.role.create({ data: { ...input, description: input.description ?? "", ...ownerFields, ownerKey: ownerKeyOf(owner) }, select: OWN_ROLE_SELECT });
    } catch (error) {
      throw this.nameTaken(error);
    }
  }

  async updateOwn(owner: Scope, roleId: string, input: UpdateOwnRoleInput) {
    assertOwnFields(owner, input);
    await this.findOwn(owner, roleId);
    try {
      return await this.prisma.client.role.update({ where: { id: roleId }, data: input, select: OWN_ROLE_SELECT });
    } catch (error) {
      throw this.nameTaken(error);
    }
  }

  async removeOwn(owner: Scope, roleId: string): Promise<void> {
    await this.findOwn(owner, roleId);
    await this.prisma.client.role.delete({ where: { id: roleId } });
  }

  private async findOwn(owner: Scope, roleId: string) {
    const role = await this.prisma.client.role.findFirst({ where: { id: roleId, ownerKey: ownerKeyOf(owner) }, select: { id: true } });
    if (!role) throw new NotFoundException("Role not found");
    return role;
  }

  private async memberIds(scope: Scope): Promise<string[]> {
    const rows =
      "teamId" in scope
        ? await this.prisma.client.teamMembership.findMany({ where: { teamId: scope.teamId }, select: { userId: true } })
        : await this.prisma.client.organizationMembership.findMany({ where: { organizationId: scope.organizationId }, select: { userId: true } });
    return rows.map((row) => row.userId);
  }

  private async find(roleId: string) {
    const role = await this.prisma.client.role.findUnique({ where: { id: roleId }, select: { builtIn: true, ownerKey: true } });
    if (!role || role.ownerKey !== "") throw new NotFoundException("Role not found");
    return role;
  }

  private nameTaken(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return new ConflictException("A role with this name already exists");
    }
    return error;
  }
}
