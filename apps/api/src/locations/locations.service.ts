import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateLocationRequest, CreateRoomRequest, UpdateLocationRequest, UpdateRoomRequest } from "@oneverse/core";
import type { Prisma } from "@oneverse/db";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";

const LOCATION_SELECT = {
  id: true,
  name: true,
  address: true,
  timeZone: true,
  home: true,
  ownerTeamId: true,
  ownerOrganizationId: true,
  team: { select: { name: true } },
  organization: { select: { name: true } },
  rooms: { select: { id: true, name: true, capacity: true, setupMinutes: true, teardownMinutes: true }, orderBy: { name: "asc" } },
} as const;
type LocationRow = Prisma.LocationGetPayload<{ select: typeof LOCATION_SELECT }>;
export type Owner = { ownerTeamId: string | null; ownerOrganizationId: string | null };

/** What a user may do with locations: the teams and organisations they're in, and those they run. */
export interface Scope {
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
 * The rooms an event takes (issue #563): its location's, none without one.
 * Undefined when not given; on a change of location without rooms given,
 * none (the old location's rooms aren't the new one's).
 */
export async function eventRooms(prisma: PrismaService, locationId: string | null, roomIds: readonly string[] | undefined, locationChanged = false): Promise<string[] | undefined> {
  if (roomIds === undefined) return locationChanged ? [] : undefined;
  const ids = [...new Set(roomIds)];
  if (ids.length === 0) return [];
  if (!locationId) throw new BadRequestException(["roomIds needs a locationId: rooms are a location's"]);
  const found = await prisma.client.room.count({ where: { id: { in: ids }, locationId } });
  if (found !== ids.length) throw new BadRequestException(["roomIds must be rooms of the event's location"]);
  return ids;
}

/** Rooms as Prisma takes them: on a new event, or replacing an event's. */
export const roomsOnCreate = (ids: string[] | undefined) => (ids?.length ? { connect: ids.map((id) => ({ id })) } : undefined);
export const roomsOnUpdate = (ids: string[] | undefined) => (ids ? { set: ids.map((id) => ({ id })) } : undefined);

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
    const scope = await ownerScope(this.prisma, user);
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
    return locations.map((location) => present(location, canEdit(user, scope, location)));
  }

  async get(user: AuthenticatedUser, locationId: string) {
    const scope = await ownerScope(this.prisma, user);
    const location = await this.prisma.client.location.findUnique({ where: { id: locationId }, select: LOCATION_SELECT });
    if (!location || !canSee(user, scope, location)) throw new NotFoundException("Location not found");
    return present(location, canEdit(user, scope, location));
  }

  async create(user: AuthenticatedUser, data: CreateLocationRequest) {
    const scope = await ownerScope(this.prisma, user);
    const owner = { ownerTeamId: data.teamId ?? null, ownerOrganizationId: data.teamId ? null : (data.organizationId ?? null) };
    if (!canEdit(user, scope, owner)) throw new ForbiddenException(data.teamId ? "Only the team's admins add locations for it" : "Only the organisation's admins add locations for it");
    const location = await this.prisma.client.location.create({
      data: { name: data.name, address: data.address || null, timeZone: data.timeZone, home: data.home ?? false, ...owner },
      select: LOCATION_SELECT,
    });
    return present(location, true);
  }

  async update(user: AuthenticatedUser, locationId: string, change: UpdateLocationRequest) {
    await this.changeable(user, locationId);
    const location = await this.prisma.client.location.update({
      where: { id: locationId },
      data: { name: change.name ?? undefined, address: change.address, timeZone: change.timeZone ?? undefined, home: change.home ?? undefined },
      select: LOCATION_SELECT,
    });
    return present(location, true);
  }

  /** Its events keep their `place`; they lose the location. */
  async remove(user: AuthenticatedUser, locationId: string): Promise<void> {
    await this.changeable(user, locationId);
    await this.prisma.client.location.delete({ where: { id: locationId } });
  }

  /** A room of a venue (issue #563), by its owner's admins. */
  async addRoom(user: AuthenticatedUser, locationId: string, data: CreateRoomRequest) {
    await this.changeable(user, locationId);
    await this.prisma.client.room.create({
      data: { locationId, name: data.name, capacity: data.capacity ?? null, setupMinutes: data.setupMinutes ?? 0, teardownMinutes: data.teardownMinutes ?? 0 },
    });
    return this.get(user, locationId);
  }

  async updateRoom(user: AuthenticatedUser, locationId: string, roomId: string, change: UpdateRoomRequest) {
    await this.changeable(user, locationId);
    const { count } = await this.prisma.client.room.updateMany({
      where: { id: roomId, locationId },
      data: { name: change.name ?? undefined, capacity: change.capacity, setupMinutes: change.setupMinutes ?? undefined, teardownMinutes: change.teardownMinutes ?? undefined },
    });
    if (count === 0) throw new NotFoundException("Room not found");
    return this.get(user, locationId);
  }

  /** Its events keep the venue, without the room. */
  async removeRoom(user: AuthenticatedUser, locationId: string, roomId: string) {
    await this.changeable(user, locationId);
    const { count } = await this.prisma.client.room.deleteMany({ where: { id: roomId, locationId } });
    if (count === 0) throw new NotFoundException("Room not found");
    return this.get(user, locationId);
  }

  private async changeable(user: AuthenticatedUser, locationId: string) {
    const scope = await ownerScope(this.prisma, user);
    const location = await this.prisma.client.location.findUnique({ where: { id: locationId }, select: LOCATION_SELECT });
    if (!location || !canSee(user, scope, location)) throw new NotFoundException("Location not found");
    if (!canEdit(user, scope, location)) throw new ForbiddenException(location.ownerTeamId ? "Only the team's admins change its locations" : "Only the organisation's admins change its locations");
    return location;
  }

}

/** Whether the user sees what a team or an organisation owns (a location, a resource): its members, an organisation's through a team in it too. */
export function canSee(user: AuthenticatedUser, scope: Scope, owned: Owner) {
  return user.isGlobalAdmin || (owned.ownerTeamId ? scope.teams.has(owned.ownerTeamId) : !!owned.ownerOrganizationId && scope.organizations.has(owned.ownerOrganizationId));
}

/** Whether the user changes it: its owner's admins. */
export function canEdit(user: AuthenticatedUser, scope: Scope, owned: Owner) {
  return user.isGlobalAdmin || (owned.ownerTeamId ? scope.adminTeams.has(owned.ownerTeamId) : !!owned.ownerOrganizationId && scope.adminOrganizations.has(owned.ownerOrganizationId));
}

/** Their teams and organisations - an organisation also through a team in it - and those they run. */
export async function ownerScope(prisma: PrismaService, user: AuthenticatedUser): Promise<Scope> {
  const [teams, organizations] = await Promise.all([
    prisma.client.teamMembership.findMany({ where: { userId: user.id }, select: { teamId: true, role: true, team: { select: { organizationId: true } } } }),
    prisma.client.organizationMembership.findMany({ where: { userId: user.id }, select: { organizationId: true, role: true } }),
  ]);
  return {
    teams: new Set(teams.map((one) => one.teamId)),
    adminTeams: new Set(teams.filter((one) => one.role === "ADMIN").map((one) => one.teamId)),
    organizations: new Set([...organizations.map((one) => one.organizationId), ...teams.flatMap((one) => (one.team.organizationId ? [one.team.organizationId] : []))]),
    adminOrganizations: new Set(organizations.filter((one) => one.role === "ADMIN").map((one) => one.organizationId)),
  };
}

function present(location: LocationRow, canEdit: boolean) {
  return {
    id: location.id,
    name: location.name,
    address: location.address,
    timeZone: location.timeZone,
    home: location.home,
    rooms: location.rooms,
    owner: location.ownerTeamId
      ? { kind: "team" as const, id: location.ownerTeamId, name: location.team?.name ?? "" }
      : { kind: "organization" as const, id: location.ownerOrganizationId!, name: location.organization?.name ?? "" },
    canEdit,
  };
}
