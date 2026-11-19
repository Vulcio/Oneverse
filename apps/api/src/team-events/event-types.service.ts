import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EVENT_TYPES_LIMIT, type CreateTeamEventTypeRequest, type UpdateTeamEventTypeRequest } from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import { partsOf, TeamEventsService } from "./team-events.service.js";

const withCount = { _count: { select: { events: true } }, organization: { select: { name: true } } } as const;

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

  private partsOwner = (owner: EventTypeOwner) => ("teamId" in owner ? owner.teamId : owner);

  async create(owner: EventTypeOwner, dto: CreateTeamEventTypeRequest) {
    if ((await this.prisma.client.teamEventType.count({ where: owner })) >= EVENT_TYPES_LIMIT) throw new BadRequestException([`At most ${EVENT_TYPES_LIMIT} event types are kept`]);
    const parts = (await this.events.checkParts(dto.parts ?? undefined, this.partsOwner(owner))) ?? [];
    const type = await this.saving(() =>
      this.prisma.client.teamEventType.create({
        data: { ...owner, name: dto.name, startTime: dto.startTime ?? null, durationMinutes: dto.durationMinutes ?? null, callMinutes: dto.callMinutes ?? null, parts, withSet: dto.withSet ?? true },
        include: withCount,
      }),
    );
    return this.summary(type);
  }

  async update(owner: EventTypeOwner, typeId: string, dto: UpdateTeamEventTypeRequest) {
    await this.find(owner, typeId);
    const parts = await this.events.checkParts(dto.parts, this.partsOwner(owner));
    const type = await this.saving(() =>
      this.prisma.client.teamEventType.update({
        where: { id: typeId },
        data: { name: dto.name, startTime: dto.startTime, durationMinutes: dto.durationMinutes, callMinutes: dto.callMinutes, parts, withSet: dto.withSet },
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
