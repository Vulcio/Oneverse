import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sendTeamInvitation } from "../auth/email.js";
import { oneverseUrl, songverseUrl } from "../common/utils/web-apps.js";
import { customInstrumentIds } from "../instruments/instruments.service.js";
import { orderInstruments, orderTechRoles, slugify, type TeamRoleValue } from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import { NotificationsService } from "../notifications/notifications.service.js";
import { joinTeamOrganization } from "../organizations/organizations.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { destroySong } from "../song-versions/song-bin.service.js";
import { leaveTeams } from "./leave-teams.js";
import type { CreateInviteLinkDto } from "./dto/create-invite-link.dto.js";
import type { CreateTeamDto } from "./dto/create-team.dto.js";
import type { TeamInvitationDto } from "./dto/team-invitation.dto.js";
import type { UpdateTeamDto } from "./dto/update-team.dto.js";

/** The organisation a team is part of (issue #241). */
const withOrganization = { organization: { select: { id: true, name: true, color: true, bible: true } } } as const;

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /** One's Songverse teams; with `all`, an organisation's groups that only plan too (issue #241). */
  async findMyTeams(userId: string, all = false) {
    const memberships = await this.prisma.client.teamMembership.findMany({
      where: { userId, ...(all ? {} : { team: { usesSongverse: true } }) },
      include: { team: { include: withOrganization } },
    });
    return memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      slug: m.team.slug,
      description: m.team.description,
      currentUserRole: m.role,
      color: m.team.color,
      avatarUrl: m.team.avatarUrl,
      organization: m.team.organization,
      usesSongverse: m.team.usesSongverse,
      parentId: m.team.parentId,
      bible: m.team.bible,
      repeatWeeks: m.team.repeatWeeks,
      repeatLimit: m.team.repeatLimit,
    }));
  }

  async findOne(userId: string, teamId: string) {
    const membership = await this.prisma.client.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
      include: { team: { include: withOrganization } },
    });
    if (!membership) throw new NotFoundException("Team not found");
    return {
      id: membership.team.id,
      name: membership.team.name,
      slug: membership.team.slug,
      description: membership.team.description,
      currentUserRole: membership.role,
      color: membership.team.color,
      avatarUrl: membership.team.avatarUrl,
      organization: membership.team.organization,
      usesSongverse: membership.team.usesSongverse,
      parentId: membership.team.parentId,
      bible: membership.team.bible,
      repeatWeeks: membership.team.repeatWeeks,
      repeatLimit: membership.team.repeatLimit,
    };
  }

  async create(userId: string, dto: CreateTeamDto) {
    // Under a main team (issue #550): one in no organisation, that they run.
    if (dto.parentId) await this.checkMainTeam(userId, dto.parentId, null);
    const slug = dto.slug ?? (await this.freeSlug(dto.name));
    const team = await this.prisma.client.team
      .create({
        data: {
          name: dto.name,
          slug,
          description: dto.description,
          color: dto.color ?? null,
          parentId: dto.parentId ?? null,
          memberships: {
            create: { userId, role: "ADMIN" },
          },
        },
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictException(`A team with the slug '${slug}' already exists`);
        }
        throw error;
      });
    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      description: team.description,
      currentUserRole: "ADMIN" as const,
      color: team.color,
      avatarUrl: team.avatarUrl,
      parentId: team.parentId,
    };
  }

  /** A free slug from a team's name. */
  private async freeSlug(name: string) {
    const base = slugify(name) || "team";
    const taken = new Set((await this.prisma.client.team.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((t) => t.slug));
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    return slug;
  }

  /**
   * The main team a team in no organisation goes under (issue #550): one in
   * no organisation either, that the user runs, not the team itself nor one
   * under it. Members aren't shared.
   */
  async checkMainTeam(userId: string, parentId: string, teamId: string | null) {
    const parent = await this.prisma.client.team.findUnique({ where: { id: parentId }, select: { organizationId: true, memberships: { where: { userId, role: "ADMIN" }, select: { userId: true } } } });
    if (!parent || parent.memberships.length === 0) throw new BadRequestException(["parentId must be a team you run"]);
    if (parent.organizationId) throw new BadRequestException(["parentId must be a team in no organisation: an organisation's groups go under one of its groups"]);
    for (let at: string | null = parentId; at; ) {
      if (at === teamId) throw new BadRequestException(["parentId can't be the team itself or one under it"]);
      at = (await this.prisma.client.team.findUnique({ where: { id: at }, select: { parentId: true } }))?.parentId ?? null;
    }
  }

  /**
   * An invitation by email (issue #550): a link for one use, two weeks, sent
   * to the address; it waits among the team's invite links until used. Asked
   * again for the same address, the waiting one is sent again, renewed.
   */
  async invite(teamId: string, inviterId: string, dto: TeamInvitationDto) {
    const email = dto.email.toLowerCase();
    const member = await this.prisma.client.teamMembership.findFirst({ where: { teamId, user: { email: { equals: email, mode: "insensitive" } } }, select: { userId: true } });
    if (member) throw new ConflictException("They're already in the team");
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const waiting = await this.prisma.client.teamInviteLink.findFirst({ where: { teamId, email, usedCount: 0 } });
    const link = waiting
      ? await this.prisma.client.teamInviteLink.update({ where: { id: waiting.id }, data: { expiresAt, role: dto.role ?? waiting.role } })
      : await this.prisma.client.teamInviteLink.create({ data: { teamId, email, role: dto.role ?? "MEMBER", maxUses: 1, expiresAt } });
    const [team, inviter] = await Promise.all([
      this.prisma.client.team.findUniqueOrThrow({ where: { id: teamId }, select: { name: true } }),
      this.prisma.client.user.findUnique({ where: { id: inviterId }, select: { displayName: true } }),
    ]);
    // Opened in Oneverse, where teams are managed (issue #550), or Songverse without it.
    await sendTeamInvitation(email, `${oneverseUrl() ?? songverseUrl()}/join/${link.token}`, team.name, inviter?.displayName ?? null);
    return link;
  }

  /** Its name, description and colour (issue #161), by its admins. */
  async update(userId: string, teamId: string, dto: UpdateTeamDto) {
    await this.prisma.client.team.update({
      where: { id: teamId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.bible !== undefined && { bible: dto.bible }),
        ...(dto.repeatWeeks !== undefined && { repeatWeeks: dto.repeatWeeks }),
        ...(dto.repeatLimit !== undefined && { repeatLimit: dto.repeatLimit }),
      },
    });
    return this.findOne(userId, teamId);
  }

  async listMembers(teamId: string) {
    const memberships = await this.prisma.client.teamMembership.findMany({
      where: { teamId },
      include: {
        user: { select: { id: true, displayName: true, email: true, avatarUrl: true, instruments: true, techRoles: true } },
      },
      orderBy: { joinedAt: "asc" },
    });
    const custom = await customInstrumentIds(this.prisma.client);
    return memberships.map((m) => ({
      userId: m.user.id,
      displayName: m.user.displayName,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      joinedAt: m.joinedAt,
      instruments: orderInstruments(m.user.instruments, custom),
      techRoles: orderTechRoles(m.user.techRoles),
      positionIds: m.positionIds,
    }));
  }

  /** `by`: who changed it; the member is told (issue #149), unless it's themselves. */
  async updateMemberRole(teamId: string, memberUserId: string, role: TeamRoleValue, by: string | null = null) {
    const membership = await this.prisma.client.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: memberUserId } },
    });
    if (!membership) throw new NotFoundException("Membership not found");
    if (membership.role === "ADMIN" && role !== "ADMIN") {
      await this.assertNotLastAdmin(teamId, memberUserId);
    }

    const updated = await this.prisma.client.teamMembership.update({
      where: { teamId_userId: { teamId, userId: memberUserId } },
      data: { role },
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });
    if (membership.role !== role) {
      const [team, changer] = await Promise.all([
        this.prisma.client.team.findUnique({ where: { id: teamId }, select: { name: true } }),
        by ? this.prisma.client.user.findUnique({ where: { id: by }, select: { displayName: true } }) : null,
      ]);
      await this.notifications.notify([{ userId: memberUserId, kind: "TEAM_ROLE_CHANGED", data: { team: team?.name ?? "", role, by: changer?.displayName ?? "" }, url: `/teams/${teamId}`, teamId }], by);
    }
    return {
      userId: updated.user.id,
      displayName: updated.user.displayName,
      email: updated.user.email,
      role: updated.role,
      joinedAt: updated.joinedAt,
    };
  }

  async removeMember(teamId: string, memberUserId: string) {
    const membership = await this.prisma.client.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: memberUserId } },
    });
    if (!membership) throw new NotFoundException("Membership not found");
    if (membership.role === "ADMIN") {
      await this.assertNotLastAdmin(teamId, memberUserId);
    }
    await this.prisma.client.$transaction((tx) => leaveTeams(tx, memberUserId, [teamId]));
  }

  leaveTeam(teamId: string, userId: string) {
    return this.removeMember(teamId, userId);
  }

  /**
   * Deleting a team cascades its memberships and invite links (see the
   * schema's onDelete: Cascade on those two relations) - kicking out
   * every member is an accepted, expected consequence of "this team no
   * longer exists". What's NOT acceptable is silently orphaning real
   * creative work: a Songbook, SongVersion, or Arrangement still owned by
   * this team has no onDelete behavior defined on that relation, so it
   * blocks deletion until the admin has moved or removed that content.
   */
  async remove(teamId: string): Promise<void> {
    const [songbookCount, songVersionCount, arrangementCount] = await Promise.all([
      this.prisma.client.songbook.count({ where: { ownerTeamId: teamId } }),
      this.prisma.client.songVersion.count({ where: { ownerTeamId: teamId } }),
      this.prisma.client.arrangement.count({ where: { ownerTeamId: teamId } }),
    ]);
    if (songbookCount > 0 || songVersionCount > 0 || arrangementCount > 0) {
      throw new ConflictException(
        `This team still owns content (${songbookCount} songbook(s), ${songVersionCount} song(s), ${arrangementCount} arrangement(s)) - move or delete it first.`,
      );
    }
    // Its songs in the bin (issue #340) go for good with it.
    const binned = await this.prisma.client.songVersion.findMany({ where: { ownerTeamId: teamId, deletedAt: { not: null } }, select: { id: true } });
    for (const { id } of binned) await destroySong(this.prisma, this.storage, id);

    // Its screen templates and their parts go with it (issues #194, #281, cascading), and their files with those.
    const themeFiles = await this.prisma.client.screenThemeAsset.findMany({ where: { OR: [{ theme: { ownerTeamId: teamId } }, { part: { ownerTeamId: teamId } }] }, select: { storageKey: true } });
    const { avatarStorageKey } = await this.prisma.client.team.delete({ where: { id: teamId }, select: { avatarStorageKey: true } }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ConflictException("This team still has content referencing it - move or delete it first.");
      }
      throw error;
    });
    // Its picture (issue #161), unless something else holds the same bytes.
    await this.storage.deleteUnreferenced([...(avatarStorageKey ? [avatarStorageKey] : []), ...themeFiles.map((file) => file.storageKey)]);
  }

  private async assertNotLastAdmin(teamId: string, excludingUserId: string): Promise<void> {
    const otherAdmins = await this.prisma.client.teamMembership.count({
      where: { teamId, role: "ADMIN", userId: { not: excludingUserId } },
    });
    if (otherAdmins === 0) {
      throw new ConflictException("A team must have at least one admin");
    }
  }

  listInviteLinks(teamId: string) {
    return this.prisma.client.teamInviteLink.findMany({
      where: { teamId },
      orderBy: { createdAt: "desc" },
    });
  }

  createInviteLink(teamId: string, dto: CreateInviteLinkDto): Promise<Prisma.TeamInviteLinkGetPayload<object>> {
    return this.prisma.client.teamInviteLink.create({
      data: {
        teamId,
        role: dto.role ?? "MEMBER",
        expiresAt: dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000) : null,
        maxUses: dto.maxUses ?? null,
      },
    });
  }

  async revokeInviteLink(teamId: string, linkId: string): Promise<void> {
    const link = await this.prisma.client.teamInviteLink.findUnique({ where: { id: linkId } });
    if (!link || link.teamId !== teamId) throw new NotFoundException("Invite link not found");
    await this.prisma.client.teamInviteLink.delete({ where: { id: linkId } });
  }

  async joinByToken(userId: string, token: string) {
    const link = await this.prisma.client.teamInviteLink.findUnique({
      where: { token },
      include: { team: true },
    });
    if (!link) throw new NotFoundException("Invite link not found or revoked");
    // Already in it - or joined a moment ago by the same link opened twice (a page and its sign-in): the team, not an error.
    const member = async () => {
      const existing = await this.prisma.client.teamMembership.findUnique({ where: { teamId_userId: { teamId: link.teamId, userId } } });
      return existing && {
        id: link.team.id,
        name: link.team.name,
        slug: link.team.slug,
        description: link.team.description,
        currentUserRole: existing.role,
      };
    };
    const already = await member();
    if (already) return already;

    if (link.expiresAt && link.expiresAt < new Date()) {
      throw new ForbiddenException("This invite link has expired");
    }
    if (link.maxUses !== null && link.usedCount >= link.maxUses) {
      throw new ForbiddenException("This invite link has reached its usage limit");
    }

    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.teamMembership.create({ data: { teamId: link.teamId, userId, role: link.role } });
        await tx.teamInviteLink.update({ where: { id: link.id }, data: { usedCount: { increment: 1 } } });
        // A team's members are its organisation's too (issue #241).
        await joinTeamOrganization(tx, link.teamId, [userId]);
        // Joining a team asks again what they play or do, if they haven't said (issue #109).
        await tx.user.updateMany({ where: { id: userId, instruments: { isEmpty: true }, techRoles: { isEmpty: true } }, data: { profilePromptSkippedAt: null } });
      });
    } catch (error) {
      // The same person joining by two requests at once: the other one did.
      const raced = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? await member() : null;
      if (raced) return raced;
      throw error;
    }
    // Its admins told who joined (issue #149).
    const [admins, joiner] = await Promise.all([
      this.prisma.client.teamMembership.findMany({ where: { teamId: link.teamId, role: "ADMIN" }, select: { userId: true } }),
      this.prisma.client.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
    ]);
    await this.notifications.notify(
      admins.map((admin) => ({ userId: admin.userId, kind: "TEAM_JOINED" as const, data: { team: link.team.name, by: joiner?.displayName ?? "", role: link.role }, url: `/teams/${link.teamId}`, teamId: link.teamId })),
      userId,
    );

    return {
      id: link.team.id,
      name: link.team.name,
      slug: link.team.slug,
      description: link.team.description,
      currentUserRole: link.role,
    };
  }
}
