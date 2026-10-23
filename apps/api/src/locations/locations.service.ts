import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateLocationRequest, UpdateLocationRequest } from "@oneverse/core";
import type { Prisma } from "@oneverse/db";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";

const LOCATION_SELECT = {
  id: true,
  name: true,
  address: true,
  timeZone: true,
  ownerTeamId: true,
  ownerOrganizationId: true,
  team: { select: { name: true } },
  organization: { select: { name: true } },
} as const;
type LocationRow = Prisma.LocationGetPayload<{ select: typeof LOCATION_SELECT }>;
type Owner = { ownerTeamId: string | null; ownerOrganizationId: string | null };

/** What a user may do with locations: the teams and organisations they're in, and those they run. */
interface Scope {
  teams: Set<string>;
  adminTeams: Set<string>;
  organizations: Set<string>;
  adminOrganizations: Set<string>;
}

/**
 * The location an event is given (issue #320): a team's event takes one of
 * the team's or its organisation's, an organisation's event one of the
 * organisation's. Refused otherwise, as if it didn't exist.
 */
export async function eventLocation(prisma: PrismaService, owner: { teamId: string } | { organizationId: string }, locationId: string) {
  const location = await prisma.client.location.findUnique({ where: { id: locationId }, select: { id: true, name: true, ownerTeamId: true, ownerOrganizationId: true } });
  let usable = false;
  if (location && "teamId" in owner) {
    const team = await prisma.client.team.findUnique({ where: { id: owner.teamId }, select: { organizationId: true } });
    usable = location.ownerTeamId === owner.teamId || (!!location.ownerOrganizationId && location.ownerOrganizationId === team?.organizationId);
  } else if (location && "organizationId" in owner) {
    usable = location.ownerOrganizationId === owner.organizationId;
  }
  if (!location || !usable) {
    throw new BadRequestException(["teamId" in owner ? "locationId must be one of the team's or its organisation's locations" : "locationId must be one of the organisation's locations"]);
  }
  return location;
}

/**
 * Locations (issue #320): where an organisation's or a team's events take
 * place - a church, a hall, a campus - with the time zone of what happens
 * there. Its owner's admins change them; its members, and an organisation's
 * groups' members, pick them for events.
 */
@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** A team's (its own and its organisation's: what its events can take), an organisation's, or every location the user can use. */
  async list(user: AuthenticatedUser, owner: { teamId?: string; organizationId?: string } = {}) {
    const scope = await this.scopeOf(user);
    let where: Prisma.LocationWhereInput;
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
    const locations = await this.prisma.client.location.findMany({ where, select: LOCATION_SELECT, orderBy: { name: "asc" } });
    return locations.map((location) => present(location, this.canEdit(user, scope, location)));
  }

  async get(user: AuthenticatedUser, locationId: string) {
    const scope = await this.scopeOf(user);
    const location = await this.prisma.client.location.findUnique({ where: { id: locationId }, select: LOCATION_SELECT });
    if (!location || !this.canSee(user, scope, location)) throw new NotFoundException("Location not found");
    return present(location, this.canEdit(user, scope, location));
  }

  async create(user: AuthenticatedUser, data: CreateLocationRequest) {
    const scope = await this.scopeOf(user);
    const owner = { ownerTeamId: data.teamId ?? null, ownerOrganizationId: data.teamId ? null : (data.organizationId ?? null) };
    if (!this.canEdit(user, scope, owner)) throw new ForbiddenException(data.teamId ? "Only the team's admins add locations for it" : "Only the organisation's admins add locations for it");
    const location = await this.prisma.client.location.create({
      data: { name: data.name, address: data.address || null, timeZone: data.timeZone, ...owner },
      select: LOCATION_SELECT,
    });
    return present(location, true);
  }

  async update(user: AuthenticatedUser, locationId: string, change: UpdateLocationRequest) {
    await this.changeable(user, locationId);
    const location = await this.prisma.client.location.update({
      where: { id: locationId },
      data: { name: change.name ?? undefined, address: change.address, timeZone: change.timeZone ?? undefined },
      select: LOCATION_SELECT,
    });
    return present(location, true);
  }

  /** Its events keep their `place`; they lose the location. */
  async remove(user: AuthenticatedUser, locationId: string): Promise<void> {
    await this.changeable(user, locationId);
    await this.prisma.client.location.delete({ where: { id: locationId } });
  }

  private async changeable(user: AuthenticatedUser, locationId: string) {
    const scope = await this.scopeOf(user);
    const location = await this.prisma.client.location.findUnique({ where: { id: locationId }, select: LOCATION_SELECT });
    if (!location || !this.canSee(user, scope, location)) throw new NotFoundException("Location not found");
    if (!this.canEdit(user, scope, location)) throw new ForbiddenException(location.ownerTeamId ? "Only the team's admins change its locations" : "Only the organisation's admins change its locations");
    return location;
  }

  private canSee(user: AuthenticatedUser, scope: Scope, location: Owner) {
    return user.isGlobalAdmin || (location.ownerTeamId ? scope.teams.has(location.ownerTeamId) : !!location.ownerOrganizationId && scope.organizations.has(location.ownerOrganizationId));
  }

  private canEdit(user: AuthenticatedUser, scope: Scope, location: Owner) {
    return user.isGlobalAdmin || (location.ownerTeamId ? scope.adminTeams.has(location.ownerTeamId) : !!location.ownerOrganizationId && scope.adminOrganizations.has(location.ownerOrganizationId));
  }

  /** Their teams and organisations - an organisation also through a team in it - and those they run. */
  private async scopeOf(user: AuthenticatedUser): Promise<Scope> {
    const [teams, organizations] = await Promise.all([
      this.prisma.client.teamMembership.findMany({ where: { userId: user.id }, select: { teamId: true, role: true, team: { select: { organizationId: true } } } }),
      this.prisma.client.organizationMembership.findMany({ where: { userId: user.id }, select: { organizationId: true, role: true } }),
    ]);
    return {
      teams: new Set(teams.map((one) => one.teamId)),
      adminTeams: new Set(teams.filter((one) => one.role === "ADMIN").map((one) => one.teamId)),
      organizations: new Set([...organizations.map((one) => one.organizationId), ...teams.flatMap((one) => (one.team.organizationId ? [one.team.organizationId] : []))]),
      adminOrganizations: new Set(organizations.filter((one) => one.role === "ADMIN").map((one) => one.organizationId)),
    };
  }
}

function present(location: LocationRow, canEdit: boolean) {
  return {
    id: location.id,
    name: location.name,
    address: location.address,
    timeZone: location.timeZone,
    owner: location.ownerTeamId
      ? { kind: "team" as const, id: location.ownerTeamId, name: location.team?.name ?? "" }
      : { kind: "organization" as const, id: location.ownerOrganizationId!, name: location.organization?.name ?? "" },
    canEdit,
  };
}
