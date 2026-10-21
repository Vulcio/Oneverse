import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { slugify, type CreateOrganizationRequest, type TeamRoleValue } from "@oneverse/core";
import type { Prisma, PrismaClient } from "@oneverse/db";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateInviteLinkDto } from "../teams/dto/create-invite-link.dto.js";
import type { UpdateOrganizationDto } from "./dto/update-organization.dto.js";
import { getEffectiveOrganizationSettings } from "./organization-settings.js";

type Viewer = Pick<AuthenticatedUser, "id" | "isGlobalAdmin">;
type Db = PrismaClient | Prisma.TransactionClient;

/** The one organisation of a single-organisation instance: the oldest. */
export function singleOrganization(db: Db) {
  return db.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
}

/**
 * Someone joining a team that's part of an organisation (issue #241) is in
 * the organisation too: a team's members are always its organisation's.
 */
export async function joinTeamOrganization(db: Db, teamId: string, userIds: string[]): Promise<void> {
  const team = await db.team.findUnique({ where: { id: teamId }, select: { organizationId: true } });
  if (!team?.organizationId || userIds.length === 0) return;
  await db.organizationMembership.createMany({ data: userIds.map((userId) => ({ organizationId: team.organizationId!, userId })), skipDuplicates: true });
}

/**
 * Teams leaving their organisation's tree (issue #241): not under a group
 * any more, and their subgroups not under them.
 */
export function leaveTree(db: Db, teamIds: string[]) {
  return db.team.updateMany({ where: { OR: [{ id: { in: teamIds } }, { parentId: { in: teamIds } }] }, data: { parentId: null } });
}

/** Teams out of their organisation: on their own, as Songverse teams again (a group that only planned would be nowhere). */
async function leaveOrganization(db: Db, teamIds: string[]) {
  await leaveTree(db, teamIds);
  await db.team.updateMany({ where: { id: { in: teamIds } }, data: { organizationId: null, usesSongverse: true } });
  // Their parts of the organisation's events stay on their calendars, as their own.
  await db.teamEvent.updateMany({ where: { teamId: { in: teamIds }, organizationEventId: { not: null } }, data: { organizationEventId: null } });
}

/**
 * Organisations (issue #241, Planiverse): the teams an organisation plans
 * together, its members and admins. With the instance's mode at "none"
 * (Songverse alone) they're out of sight: every call here but Admin's is
 * refused.
 */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async mode() {
    const { mode } = await getEffectiveOrganizationSettings();
    if (mode === "NONE") throw new NotFoundException("Organisations are turned off");
    return mode;
  }

  /** With one organisation for the instance, everyone is in it: added the first time they look. */
  private async ensureSingleMember(userId: string) {
    const only = await singleOrganization(this.prisma.client);
    if (only) await this.prisma.client.organizationMembership.createMany({ data: [{ organizationId: only.id, userId }], skipDuplicates: true });
  }

  /** Whether `viewer` may create one: with several, global admins (or anyone, if Admin says so); with one, a global admin while there's none. */
  private async canCreate(viewer: Viewer) {
    const { mode, anyoneCreates } = await getEffectiveOrganizationSettings();
    if (mode === "MULTI") return viewer.isGlobalAdmin || anyoneCreates;
    if (mode === "SINGLE") return viewer.isGlobalAdmin && !(await singleOrganization(this.prisma.client));
    return false;
  }

  /** The viewer's role in it; a global admin counts as one of its admins. */
  async roleOf(viewer: Viewer, organizationId: string): Promise<TeamRoleValue | null> {
    const membership = await this.prisma.client.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: viewer.id } }, select: { role: true } });
    return membership?.role ?? (viewer.isGlobalAdmin ? "ADMIN" : null);
  }

  private async assertMember(viewer: Viewer, organizationId: string) {
    await this.mode();
    const role = await this.roleOf(viewer, organizationId);
    if (!role) throw new NotFoundException("Organisation not found");
    return role;
  }

  private async assertAdmin(viewer: Viewer, organizationId: string) {
    if ((await this.assertMember(viewer, organizationId)) !== "ADMIN") throw new ForbiddenException("Organisation admin role required");
  }

  private summary(organization: { id: string; name: string; slug: string; description: string | null; color: string | null; bible: boolean; _count: { memberships: number; teams: number } }, role: TeamRoleValue) {
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      description: organization.description,
      color: organization.color,
      currentUserRole: role,
      memberCount: organization._count.memberships,
      teamCount: organization._count.teams,
      bible: organization.bible,
    };
  }

  private static readonly counts = { _count: { select: { memberships: true, teams: true } } } as const;

  async mine(viewer: Viewer) {
    const { mode } = await getEffectiveOrganizationSettings();
    if (mode === "NONE") return { mode, canCreate: false, organizations: [] };
    if (mode === "SINGLE") await this.ensureSingleMember(viewer.id);
    const memberships = await this.prisma.client.organizationMembership.findMany({
      where: { userId: viewer.id },
      include: { organization: { include: OrganizationsService.counts } },
      orderBy: { organization: { name: "asc" } },
    });
    return { mode, canCreate: await this.canCreate(viewer), organizations: memberships.map((m) => this.summary(m.organization, m.role)) };
  }

  /** A free slug from its name: "grace-church", then "grace-church-2"… */
  private async slugFor(name: string) {
    const base = slugify(name) || "organisation";
    const taken = new Set((await this.prisma.client.organization.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((o) => o.slug));
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    return slug;
  }

  /** A new organisation, `adminId` its first admin. */
  async createFor(adminId: string, dto: CreateOrganizationRequest) {
    const organization = await this.prisma.client.organization.create({
      data: { name: dto.name, slug: await this.slugFor(dto.name), description: dto.description ?? null, memberships: { create: { userId: adminId, role: "ADMIN" } } },
      include: OrganizationsService.counts,
    });
    return this.summary(organization, "ADMIN");
  }

  async create(viewer: Viewer, dto: CreateOrganizationRequest) {
    await this.mode();
    if (dto.adminEmail) throw new BadRequestException(["adminEmail is for Admin > Organisations only"]);
    if (!(await this.canCreate(viewer))) throw new ForbiddenException("You can't create an organisation here");
    return this.createFor(viewer.id, dto);
  }

  async findOne(viewer: Viewer, organizationId: string) {
    const role = await this.assertMember(viewer, organizationId);
    const organization = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: {
        ...OrganizationsService.counts,
        teams: {
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            color: true,
            avatarUrl: true,
            usesSongverse: true,
            parentId: true,
            positions: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } },
            _count: { select: { memberships: true } }, memberships: { where: { userId: viewer.id }, select: { id: true } } },
        },
      },
    });
    return {
      ...this.summary(organization, role),
      teams: organization.teams.map((team) => ({
        id: team.id,
        name: team.name,
        color: team.color,
        avatarUrl: team.avatarUrl,
        memberCount: team._count.memberships,
        mine: team.memberships.length > 0,
        usesSongverse: team.usesSongverse,
        parentId: team.parentId,
        positions: team.positions,
      })),
    };
  }

  async update(viewer: Viewer, organizationId: string, dto: UpdateOrganizationDto) {
    await this.assertAdmin(viewer, organizationId);
    await this.prisma.client.organization.update({
      where: { id: organizationId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.bible !== undefined && { bible: dto.bible }),
      },
    });
    return this.findOne(viewer, organizationId);
  }

  /** Its teams stay, on their own again (onDelete: SetNull); its memberships and links go with it. */
  async remove(viewer: Viewer, organizationId: string) {
    await this.assertAdmin(viewer, organizationId);
    await this.deleteOrganization(organizationId);
  }

  async members(viewer: Viewer, organizationId: string) {
    await this.assertMember(viewer, organizationId);
    const memberships = await this.prisma.client.organizationMembership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } },
      orderBy: { joinedAt: "asc" },
    });
    return memberships.map((m) => ({ userId: m.user.id, displayName: m.user.displayName, email: m.user.email, avatarUrl: m.user.avatarUrl, role: m.role, joinedAt: m.joinedAt }));
  }

  private async assertNotLastAdmin(organizationId: string, userId: string) {
    const others = await this.prisma.client.organizationMembership.count({ where: { organizationId, role: "ADMIN", userId: { not: userId } } });
    if (others === 0) throw new ConflictException("An organisation must have at least one admin");
  }

  async setRole(viewer: Viewer, organizationId: string, userId: string, role: TeamRoleValue) {
    await this.assertAdmin(viewer, organizationId);
    const membership = await this.prisma.client.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!membership) throw new NotFoundException("Membership not found");
    if (membership.role === "ADMIN" && role !== "ADMIN") await this.assertNotLastAdmin(organizationId, userId);
    await this.prisma.client.organizationMembership.update({ where: { id: membership.id }, data: { role } });
    return (await this.members(viewer, organizationId)).find((member) => member.userId === userId)!;
  }

  /**
   * Out of the organisation, and so out of its teams - unless they're the
   * last admin of one of those (another admin first, or the team taken out).
   */
  private async removeMembership(organizationId: string, userId: string) {
    const membership = await this.prisma.client.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!membership) throw new NotFoundException("Membership not found");
    if (membership.role === "ADMIN") await this.assertNotLastAdmin(organizationId, userId);
    const teams = await this.prisma.client.teamMembership.findMany({ where: { userId, team: { organizationId } }, select: { teamId: true, role: true, team: { select: { name: true } } } });
    for (const team of teams.filter((one) => one.role === "ADMIN")) {
      const others = await this.prisma.client.teamMembership.count({ where: { teamId: team.teamId, role: "ADMIN", userId: { not: userId } } });
      if (others === 0) throw new ConflictException(`They're the only admin of ${team.team.name}: make someone else its admin first`);
    }
    await this.prisma.client.$transaction([
      this.prisma.client.teamMembership.deleteMany({ where: { userId, teamId: { in: teams.map((team) => team.teamId) } } }),
      this.prisma.client.organizationMembership.delete({ where: { id: membership.id } }),
    ]);
  }

  async removeMember(viewer: Viewer, organizationId: string, userId: string) {
    await this.assertAdmin(viewer, organizationId);
    await this.removeMembership(organizationId, userId);
  }

  async leave(viewer: Viewer, organizationId: string) {
    const { mode } = await getEffectiveOrganizationSettings();
    if (mode === "SINGLE") throw new BadRequestException(["Everyone is in this instance's organisation"]);
    await this.assertMember(viewer, organizationId);
    await this.removeMembership(organizationId, viewer.id);
  }

  async inviteLinks(viewer: Viewer, organizationId: string) {
    await this.assertAdmin(viewer, organizationId);
    return this.prisma.client.organizationInviteLink.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  }

  async createInviteLink(viewer: Viewer, organizationId: string, dto: CreateInviteLinkDto) {
    await this.assertAdmin(viewer, organizationId);
    return this.prisma.client.organizationInviteLink.create({
      data: {
        organizationId,
        role: dto.role ?? "MEMBER",
        expiresAt: dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000) : null,
        maxUses: dto.maxUses ?? null,
      },
    });
  }

  async revokeInviteLink(viewer: Viewer, organizationId: string, linkId: string) {
    await this.assertAdmin(viewer, organizationId);
    const { count } = await this.prisma.client.organizationInviteLink.deleteMany({ where: { id: linkId, organizationId } });
    if (count === 0) throw new NotFoundException("Invite link not found");
  }

  async join(viewer: Viewer, token: string) {
    await this.mode();
    const link = await this.prisma.client.organizationInviteLink.findUnique({ where: { token } });
    if (!link) throw new NotFoundException("Invite link not found or revoked");
    if (link.expiresAt && link.expiresAt < new Date()) throw new ForbiddenException("This invite link has expired");
    if (link.maxUses !== null && link.usedCount >= link.maxUses) throw new ForbiddenException("This invite link has reached its usage limit");
    const existing = await this.prisma.client.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: link.organizationId, userId: viewer.id } } });
    if (!existing) {
      await this.prisma.client.$transaction([
        this.prisma.client.organizationMembership.create({ data: { organizationId: link.organizationId, userId: viewer.id, role: link.role } }),
        this.prisma.client.organizationInviteLink.update({ where: { id: link.id }, data: { usedCount: { increment: 1 } } }),
      ]);
    }
    const organization = await this.prisma.client.organization.findUniqueOrThrow({ where: { id: link.organizationId }, include: OrganizationsService.counts });
    return this.summary(organization, existing?.role ?? link.role);
  }

  /** A team taken out by the organisation's admins: on its own again, its members and songs untouched. */
  async removeTeam(viewer: Viewer, organizationId: string, teamId: string) {
    await this.assertAdmin(viewer, organizationId);
    const count = await this.prisma.client.$transaction(async (tx) => {
      const count = await tx.team.count({ where: { id: teamId, organizationId } });
      if (count) await leaveOrganization(tx, [teamId]);
      return count;
    });
    if (count === 0) throw new NotFoundException("Team not found in this organisation");
  }

  /**
   * A team put in an organisation by its admins, who must be the
   * organisation's admins too; its members join the organisation. Null
   * takes it out.
   */
  async setTeamOrganization(viewer: Viewer, teamId: string, organizationId: string | null) {
    await this.mode();
    if (organizationId !== null) {
      if ((await this.roleOf(viewer, organizationId)) !== "ADMIN") throw new ForbiddenException("Only the organisation's admins can add a team to it");
      const members = await this.prisma.client.teamMembership.findMany({ where: { teamId }, select: { userId: true } });
      await this.prisma.client.$transaction(async (tx) => {
        const before = await tx.team.findUniqueOrThrow({ where: { id: teamId }, select: { organizationId: true } });
        if (before.organizationId !== organizationId) await leaveTree(tx, [teamId]);
        await tx.team.update({ where: { id: teamId }, data: { organizationId } });
        await joinTeamOrganization(tx, teamId, members.map((member) => member.userId));
      });
    } else {
      await this.prisma.client.$transaction((tx) => leaveOrganization(tx, [teamId]));
    }
  }

  // --- Admin > Organisations

  async adminList() {
    const organizations = await this.prisma.client.organization.findMany({
      orderBy: { name: "asc" },
      include: { ...OrganizationsService.counts, memberships: { where: { role: "ADMIN" }, select: { user: { select: { id: true, displayName: true, email: true } } } } },
    });
    return organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      memberCount: organization._count.memberships,
      teamCount: organization._count.teams,
      admins: organization.memberships.map((m) => m.user),
    }));
  }

  /** By a global admin: run by them, or by the account with `adminEmail`. With one organisation for the instance, only while there's none. */
  async adminCreate(viewer: Viewer, dto: CreateOrganizationRequest) {
    const { mode } = await getEffectiveOrganizationSettings();
    if (mode === "SINGLE" && (await singleOrganization(this.prisma.client))) throw new ConflictException("This instance already has its organisation");
    let adminId = viewer.id;
    if (dto.adminEmail) {
      const user = await this.prisma.client.user.findUnique({ where: { email: dto.adminEmail }, select: { id: true } });
      if (!user) throw new BadRequestException(["adminEmail must be someone's account"]);
      adminId = user.id;
    }
    const { id } = await this.createFor(adminId, { name: dto.name, description: dto.description });
    return (await this.adminList()).find((one) => one.id === id)!;
  }

  async adminRemove(organizationId: string) {
    if (!(await this.prisma.client.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) throw new NotFoundException("Organisation not found");
    await this.deleteOrganization(organizationId);
  }

  /** Its teams on their own again, out of its tree. */
  private async deleteOrganization(organizationId: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const teams = await tx.team.findMany({ where: { organizationId }, select: { id: true } });
      await leaveOrganization(tx, teams.map((team) => team.id));
      await tx.organization.delete({ where: { id: organizationId } });
    });
  }
}
