import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { slugify } from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { partsOf } from "../team-events/team-events.service.js";
import { TeamsService } from "../teams/teams.service.js";
import type { CreateGroupDto } from "./dto/create-group.dto.js";
import type { UpdateGroupDto } from "./dto/update-group.dto.js";
import { joinTeamOrganization, OrganizationsService } from "./organizations.service.js";

type Viewer = Pick<AuthenticatedUser, "id" | "isGlobalAdmin">;

/**
 * An organisation's groups (issue #241): teams that use Songverse or only
 * plan, under one another, each with positions of its own that its members
 * say they cover.
 */
@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly teams: TeamsService,
  ) {}

  /** A free team slug from its name. */
  private async slugFor(name: string) {
    const base = slugify(name) || "group";
    const taken = new Set((await this.prisma.client.team.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((t) => t.slug));
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    return slug;
  }

  /** The group a team goes under: one of the same organisation, not itself nor one under it. */
  private async checkParent(organizationId: string, parentId: string, teamId: string | null) {
    const parent = await this.prisma.client.team.findUnique({ where: { id: parentId }, select: { organizationId: true } });
    if (!parent || parent.organizationId !== organizationId) throw new BadRequestException(["parentId must be a group of the same organisation"]);
    // Up from the parent: never back to the team itself.
    for (let at: string | null = parentId; at; ) {
      if (at === teamId) throw new BadRequestException(["parentId can't be the group itself or one under it"]);
      at = (await this.prisma.client.team.findUnique({ where: { id: at }, select: { parentId: true } }))?.parentId ?? null;
    }
  }

  /**
   * A group of the organisation, run by whoever makes it: by its admins,
   * anywhere; by a group's admins, under their group (issue #245).
   */
  async create(viewer: Viewer, organizationId: string, dto: CreateGroupDto) {
    await this.organizations.mode();
    const role = await this.organizations.roleOf(viewer, organizationId);
    if (!role) throw new NotFoundException("Organisation not found");
    const runsParent =
      !!dto.parentId &&
      (await this.prisma.client.teamMembership.count({ where: { teamId: dto.parentId, userId: viewer.id, role: "ADMIN", team: { organizationId } } })) > 0;
    if (role !== "ADMIN" && !runsParent) throw new ForbiddenException("Only the organisation's admins, or a group's admins under their group, create its groups");
    if (dto.parentId) await this.checkParent(organizationId, dto.parentId, null);
    const team = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.team.create({
        data: {
          name: dto.name,
          slug: await this.slugFor(dto.name),
          description: dto.description ?? null,
          organizationId,
          usesSongverse: dto.usesSongverse ?? false,
          parentId: dto.parentId ?? null,
          memberships: { create: { userId: viewer.id, role: "ADMIN" } },
        },
      });
      await joinTeamOrganization(tx, created.id, [viewer.id]);
      return created;
    });
    return this.teams.findOne(viewer.id, team.id);
  }

  /** By the team's admins: whether it uses Songverse, and the group it's under. */
  async update(viewer: Viewer, teamId: string, dto: UpdateGroupDto) {
    const team = await this.prisma.client.team.findUniqueOrThrow({ where: { id: teamId }, select: { organizationId: true } });
    if (dto.parentId) {
      if (!team.organizationId) throw new BadRequestException(["parentId needs the team to be part of an organisation"]);
      await this.checkParent(team.organizationId, dto.parentId, teamId);
    }
    if (dto.usesSongverse === false) {
      // Songs, songbooks, sets and arrangements belong to Songverse's teams: moved or deleted first.
      const [songs, songbooks, sets, arrangements] = await Promise.all([
        this.prisma.client.songVersion.count({ where: { ownerTeamId: teamId } }),
        this.prisma.client.songbook.count({ where: { ownerTeamId: teamId } }),
        this.prisma.client.setlist.count({ where: { ownerTeamId: teamId } }),
        this.prisma.client.arrangement.count({ where: { ownerTeamId: teamId } }),
      ]);
      if (songs + songbooks + sets + arrangements > 0) {
        throw new ConflictException(`This team still has ${songs} song(s), ${songbooks} songbook(s), ${sets} set(s) and ${arrangements} arrangement(s) - move or delete them first.`);
      }
    }
    await this.prisma.client.team.update({
      where: { id: teamId },
      data: { ...(dto.usesSongverse !== undefined && { usesSongverse: dto.usesSongverse }), ...(dto.parentId !== undefined && { parentId: dto.parentId }) },
    });
    return this.teams.findOne(viewer.id, teamId);
  }

  positions(teamId: string) {
    return this.prisma.client.teamPosition.findMany({ where: { teamId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  }

  private async named<T>(write: () => Promise<T>) {
    return write().catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("The group already has a position with that name");
      throw error;
    });
  }

  createPosition(teamId: string, name: string) {
    return this.named(() => this.prisma.client.teamPosition.create({ data: { teamId, name }, select: { id: true, name: true } }));
  }

  async renamePosition(teamId: string, positionId: string, name: string) {
    await this.position(teamId, positionId);
    const renamed = await this.named(() => this.prisma.client.teamPosition.update({ where: { id: positionId }, data: { name }, select: { id: true, name: true } }));
    // …and where events ask for it.
    for (const event of await this.eventsNeeding(teamId, positionId)) {
      await this.prisma.client.teamEvent.update({ where: { id: event.id }, data: { parts: event.parts.map((part) => (part.position === positionId ? { ...part, name } : part)) as unknown as Prisma.InputJsonValue } });
    }
    return renamed;
  }

  /** The team's events that ask for a position. */
  private async eventsNeeding(teamId: string, positionId: string) {
    const events = await this.prisma.client.teamEvent.findMany({ where: { teamId }, select: { id: true, title: true, parts: true } });
    return events.map((event) => ({ ...event, parts: partsOf(event) })).filter((event) => event.parts.some((part) => part.position === positionId));
  }

  /** Gone, and from the members who covered it. */
  async deletePosition(teamId: string, positionId: string) {
    await this.position(teamId, positionId);
    const needing = await this.eventsNeeding(teamId, positionId);
    if (needing.length > 0) throw new ConflictException(`${needing.map((event) => event.title).join(", ")} still asks for it: take it out of the event first`);
    await this.prisma.client.$transaction([
      this.prisma.client.$executeRaw`update "TeamMembership" set "positionIds" = array_remove("positionIds", ${positionId}) where "teamId" = ${teamId}`,
      this.prisma.client.teamPosition.delete({ where: { id: positionId } }),
    ]);
  }

  private async position(teamId: string, positionId: string) {
    const position = await this.prisma.client.teamPosition.findUnique({ where: { id: positionId }, select: { teamId: true } });
    if (!position || position.teamId !== teamId) throw new NotFoundException("Position not found");
  }

  /** The group's positions someone covers: set by themselves, or by its admins. */
  async setMemberPositions(viewer: Viewer, teamId: string, userId: string, positionIds: string[]) {
    if (userId !== viewer.id && !viewer.isGlobalAdmin) {
      const own = await this.prisma.client.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: viewer.id } }, select: { role: true } });
      if (own?.role !== "ADMIN") throw new ForbiddenException("Only the team's admins set someone else's positions");
    }
    const membership = await this.prisma.client.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId } }, select: { id: true } });
    if (!membership) throw new NotFoundException("Membership not found");
    const ids = [...new Set(positionIds)];
    const known = await this.prisma.client.teamPosition.count({ where: { teamId, id: { in: ids } } });
    if (known !== ids.length) throw new BadRequestException(["positionIds must be the group's positions"]);
    const updated = await this.prisma.client.teamMembership.update({ where: { id: membership.id }, data: { positionIds: ids }, select: { positionIds: true } });
    return { positionIds: updated.positionIds };
  }
}
