import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EVENT_TYPES_LIMIT, type CreateTeamEventTypeRequest, type UpdateTeamEventTypeRequest } from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import { eventLocation, eventRooms, roomsOnCreate, roomsOnUpdate } from "../locations/locations.service.js";
import { eventResources, RESOURCES_TAKEN, resourcesOnCreate, resourcesOnUpdate, resourcesTaken } from "../locations/resources.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { partsOf, TeamEventsService } from "./team-events.service.js";

const withCount = { _count: { select: { events: true } }, organization: { select: { name: true } }, rooms: { select: { id: true }, orderBy: { name: "asc" } }, ...RESOURCES_TAKEN } as const;

type TypeRow = Prisma.TeamEventTypeGetPayload<{ include: typeof withCount }>;

/** Whose types: a team's own, or (issue #528) an organisation's, offered to all its groups. */
export type EventTypeOwner = { teamId: string } | { organizationId: string };

/**
 * Event types (issue #523): "Service" asks for a Host and a Music leader
 * and gets a set, "Meeting" gets none. A team's admins keep its own; an
 * organisation's admins keep types all its groups pick from too (issue
 * #528). A new event picked from one starts as a copy (the web app fills
 * the form), remembering its type, and can ask for more. Changing or
 * deleting a type leaves its events as they are.
 */
@Injectable()
export class EventTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: TeamEventsService,
  ) {}

  private summary(type: TypeRow) {
    return {
      id: type.id,
      teamId: type.teamId,
      organizationId: type.organizationId,
      organizationName: type.organization?.name ?? null,
      name: type.name,
      startTime: type.startTime,
      durationMinutes: type.durationMinutes,
      callMinutes: type.callMinutes,
      parts: partsOf(type),
      withSet: type.withSet,
      editingTeamIds: type.editingTeamIds,
      locationId: type.locationId,
      // Its usual rooms (issue #563), its location's.
      roomIds: type.rooms.map((room) => room.id),
      // Its usual resources (issue #564).
      resources: resourcesTaken(type.resources),
      eventCount: type._count.events,
    };
  }

  /** A team's types: its organisation's first, then its own. */
  async list(teamId: string) {
    const organizationId = (await this.prisma.client.team.findUnique({ where: { id: teamId }, select: { organizationId: true } }))?.organizationId;
    const types = await this.prisma.client.teamEventType.findMany({ where: { OR: [{ teamId }, ...(organizationId ? [{ organizationId }] : [])] }, include: withCount, orderBy: { name: "asc" } });
    return types.sort((a, b) => Number(!!a.teamId) - Number(!!b.teamId)).map((type) => this.summary(type));
  }

  /** An organisation's own types (issue #528). */
  async listOf(organizationId: string) {
    const types = await this.prisma.client.teamEventType.findMany({ where: { organizationId }, include: withCount, orderBy: { name: "asc" } });
    return types.map((type) => this.summary(type));
  }

  private async find(owner: EventTypeOwner, typeId: string) {
    const type = await this.prisma.client.teamEventType.findFirst({ where: { id: typeId, ...owner }, include: withCount });
    if (!type) throw new NotFoundException("Event type not found");
    return type;
  }

  /** The name's taken: one type of each name per team, and per organisation. */
  private async saving<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ConflictException("There's already an event type of that name");
      throw err;
    }
  }

  /** An organisation's type: the groups that edit its sets are its groups (issue #578). A team's own type has none. */
  private async editingTeams(owner: EventTypeOwner, teamIds: string[] | undefined) {
    if (teamIds === undefined) return undefined;
    if ("teamId" in owner || teamIds.length === 0) return [];
    const ids = [...new Set(teamIds)];
    if ((await this.prisma.client.team.count({ where: { organizationId: owner.organizationId, id: { in: ids } } })) !== ids.length) throw new BadRequestException(["editingTeamIds must be groups of the organisation"]);
    return ids;
  }

  private partsOwner = (owner: EventTypeOwner) => ("teamId" in owner ? owner.teamId : owner);

  async create(owner: EventTypeOwner, dto: CreateTeamEventTypeRequest) {
    if ((await this.prisma.client.teamEventType.count({ where: owner })) >= EVENT_TYPES_LIMIT) throw new BadRequestException([`At most ${EVENT_TYPES_LIMIT} event types are kept`]);
    const parts = (await this.events.checkParts(dto.parts ?? undefined, this.partsOwner(owner))) ?? [];
    const location = dto.locationId ? await eventLocation(this.prisma, owner, dto.locationId) : null;
    const editingTeamIds = (await this.editingTeams(owner, dto.editingTeamIds ?? undefined)) ?? [];
    const rooms = roomsOnCreate(await eventRooms(this.prisma, location?.id ?? null, dto.roomIds ?? undefined));
    const resources = resourcesOnCreate(await eventResources(this.prisma, owner, dto.resources));
    const type = await this.saving(() =>
      this.prisma.client.teamEventType.create({
        data: { ...owner, name: dto.name, startTime: dto.startTime ?? null, durationMinutes: dto.durationMinutes ?? null, callMinutes: dto.callMinutes ?? null, parts, withSet: dto.withSet ?? true, editingTeamIds, locationId: location?.id ?? null, rooms, resources },
        include: withCount,
      }),
    );
    return this.summary(type);
  }

  async update(owner: EventTypeOwner, typeId: string, dto: UpdateTeamEventTypeRequest) {
    const before = await this.find(owner, typeId);
    const parts = await this.events.checkParts(dto.parts, this.partsOwner(owner));
    const location = dto.locationId ? await eventLocation(this.prisma, owner, dto.locationId) : null;
    const editingTeamIds = await this.editingTeams(owner, dto.editingTeamIds);
    const rooms = roomsOnUpdate(await eventRooms(this.prisma, dto.locationId === undefined ? before.locationId : dto.locationId, dto.roomIds ?? undefined, dto.locationId !== undefined && dto.locationId !== before.locationId));
    const resources = resourcesOnUpdate(await eventResources(this.prisma, owner, dto.resources));
    const type = await this.saving(() =>
      this.prisma.client.teamEventType.update({
        where: { id: typeId },
        data: { name: dto.name, startTime: dto.startTime, durationMinutes: dto.durationMinutes, callMinutes: dto.callMinutes, parts, withSet: dto.withSet, editingTeamIds, locationId: dto.locationId === undefined ? undefined : (location?.id ?? null), rooms, resources },
        include: withCount,
      }),
    );
    return this.summary(type);
  }

  /** Its events stay, with no type. */
  async remove(owner: EventTypeOwner, typeId: string) {
    await this.find(owner, typeId);
    await this.prisma.client.teamEventType.delete({ where: { id: typeId } });
  }
}
