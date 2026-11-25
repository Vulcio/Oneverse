import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateResourceRequest, UpdateResourceRequest } from "@oneverse/core";
import type { Prisma } from "@oneverse/db";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { canEdit, canSee, ownerScope } from "./locations.service.js";

const RESOURCE_SELECT = {
  id: true,
  name: true,
  quantity: true,
  locationId: true,
  ownerTeamId: true,
  ownerOrganizationId: true,
  location: { select: { name: true } },
  team: { select: { name: true } },
  organization: { select: { name: true } },
} as const;
type ResourceRow = Prisma.ResourceGetPayload<{ select: typeof RESOURCE_SELECT }>;

/** What an event takes, as the request gives it. */
export type ResourceUse = { resourceId: string; quantity?: number | null | undefined };

/** The resources an event or an event type takes, as it shows them. */
export const RESOURCES_TAKEN = { resources: { select: { resourceId: true, quantity: true, resource: { select: { name: true } } }, orderBy: { resource: { name: "asc" } } } } as const;
export const resourcesTaken = (rows: { resourceId: string; quantity: number; resource: { name: string } }[]) => rows.map((row) => ({ resourceId: row.resourceId, name: row.resource.name, quantity: row.quantity }));

/**
 * The resources an event (or an event type) takes (issue #564): a team's
 * own or its organisation's, an organisation's its own; never more than
 * there are. Undefined when not given.
 */
export async function eventResources(prisma: PrismaService, owner: { teamId: string } | { organizationId: string }, uses: readonly ResourceUse[] | null | undefined): Promise<{ resourceId: string; quantity: number }[] | undefined> {
  if (!uses) return undefined;
  const byId = new Map(uses.map((use) => [use.resourceId, use.quantity ?? 1]));
  if (byId.size === 0) return [];
  let owners: Prisma.ResourceWhereInput[];
  if ("teamId" in owner) {
    const team = await prisma.client.team.findUnique({ where: { id: owner.teamId }, select: { organizationId: true } });
    owners = [{ ownerTeamId: owner.teamId }, ...(team?.organizationId ? [{ ownerOrganizationId: team.organizationId }] : [])];
  } else {
    owners = [{ ownerOrganizationId: owner.organizationId }];
  }
  const found = await prisma.client.resource.findMany({ where: { id: { in: [...byId.keys()] }, OR: owners }, select: { id: true, name: true, quantity: true } });
  if (found.length !== byId.size) throw new BadRequestException(["teamId" in owner ? "resources must be the team's or its organisation's" : "resources must be the organisation's"]);
  for (const resource of found) {
    if (byId.get(resource.id)! > resource.quantity) throw new BadRequestException([`There are only ${resource.quantity} of ${resource.name}`]);
  }
  return found.map((resource) => ({ resourceId: resource.id, quantity: byId.get(resource.id)! }));
}

/** Resources as Prisma takes them: on a new event, or replacing an event's. */
export const resourcesOnCreate = (uses: { resourceId: string; quantity: number }[] | undefined) => (uses?.length ? { create: uses } : undefined);
export const resourcesOnUpdate = (uses: { resourceId: string; quantity: number }[] | undefined) => (uses ? { deleteMany: {}, create: uses } : undefined);

/**
 * Resources (issue #564): what an organisation or a team owns that its
 * events book besides rooms - the van, the portable PA, a screen on wheels -
 * how many there are, and maybe the venue they're kept at. Its owner's
 * admins change them; its members, and an organisation's groups' members,
 * pick them for events.
 */
@Injectable()
export class ResourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser, owner: { teamId?: string | undefined; organizationId?: string | undefined } = {}) {
    const scope = await ownerScope(this.prisma, user);
    let where: Prisma.ResourceWhereInput;
    if (owner.teamId) {
      if (!scope.teams.has(owner.teamId) && !user.isGlobalAdmin) throw new NotFoundException("Team not found");
      const team = await this.prisma.client.team.findUnique({ where: { id: owner.teamId }, select: { organizationId: true } });
      if (!team) throw new NotFoundException("Team not found");
      where = { OR: [{ ownerTeamId: owner.teamId }, ...(team.organizationId ? [{ ownerOrganizationId: team.organizationId }] : [])] };
    } else if (owner.organizationId) {
      if (!scope.organizations.has(owner.organizationId) && !user.isGlobalAdmin) throw new NotFoundException("Organisation not found");
      where = { ownerOrganizationId: owner.organizationId };
    } else {
      where = { OR: [{ ownerTeamId: { in: [...scope.teams] } }, { ownerOrganizationId: { in: [...scope.organizations] } }] };
    }
    const rows = await this.prisma.client.resource.findMany({ where, select: RESOURCE_SELECT, orderBy: { name: "asc" } });
    return rows.map((row) => present(row, canEdit(user, scope, row)));
  }

  async create(user: AuthenticatedUser, data: CreateResourceRequest) {
    const scope = await ownerScope(this.prisma, user);
    const owner = { ownerTeamId: data.teamId ?? null, ownerOrganizationId: data.teamId ? null : (data.organizationId ?? null) };
    if (!canEdit(user, scope, owner)) throw new ForbiddenException(data.teamId ? "Only the team's admins add resources for it" : "Only the organisation's admins add resources for it");
    const locationId = data.locationId ? await this.venueOf(owner, data.locationId) : null;
    const row = await this.prisma.client.resource.create({ data: { name: data.name, quantity: data.quantity ?? 1, locationId, ...owner }, select: RESOURCE_SELECT });
    return present(row, true);
  }

  async update(user: AuthenticatedUser, resourceId: string, change: UpdateResourceRequest) {
    const before = await this.changeable(user, resourceId);
    const locationId = change.locationId ? await this.venueOf(before, change.locationId) : change.locationId;
    const row = await this.prisma.client.resource.update({
      where: { id: resourceId },
      data: { name: change.name ?? undefined, quantity: change.quantity ?? undefined, locationId },
      select: RESOURCE_SELECT,
    });
    return present(row, true);
  }

  /** Events that took it no longer do. */
  async remove(user: AuthenticatedUser, resourceId: string): Promise<void> {
    await this.changeable(user, resourceId);
    await this.prisma.client.resource.delete({ where: { id: resourceId } });
  }

  /** Kept at one of its owner's venues. */
  private async venueOf(owner: { ownerTeamId: string | null; ownerOrganizationId: string | null }, locationId: string) {
    const location = await this.prisma.client.location.findFirst({ where: { id: locationId, ownerTeamId: owner.ownerTeamId, ownerOrganizationId: owner.ownerOrganizationId }, select: { id: true } });
    if (!location) throw new BadRequestException(["locationId must be one of its owner's venues"]);
    return location.id;
  }

  private async changeable(user: AuthenticatedUser, resourceId: string) {
    const scope = await ownerScope(this.prisma, user);
    const row = await this.prisma.client.resource.findUnique({ where: { id: resourceId }, select: RESOURCE_SELECT });
    if (!row || !canSee(user, scope, row)) throw new NotFoundException("Resource not found");
    if (!canEdit(user, scope, row)) throw new ForbiddenException(row.ownerTeamId ? "Only the team's admins change its resources" : "Only the organisation's admins change its resources");
    return row;
  }
}

function present(row: ResourceRow, canEditIt: boolean) {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    location: row.locationId ? { id: row.locationId, name: row.location?.name ?? "" } : null,
    owner: row.ownerTeamId ? { kind: "team" as const, id: row.ownerTeamId, name: row.team?.name ?? "" } : { kind: "organization" as const, id: row.ownerOrganizationId!, name: row.organization?.name ?? "" },
    canEdit: canEditIt,
  };
}
