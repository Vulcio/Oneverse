import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EVENT_TYPES_LIMIT, type CreateTeamEventTypeRequest, type UpdateTeamEventTypeRequest } from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import { partsOf, TeamEventsService } from "./team-events.service.js";

type TypeRow = Prisma.TeamEventTypeGetPayload<{ include: { _count: { select: { events: true } } } }>;

const withCount = { _count: { select: { events: true } } } as const;

/**
 * A team's event types (issue #523): "Service" asks for a Host and a Music
 * leader and gets a set, "Meeting" gets none. Its admins keep them; a
 * new event picked from one starts as a copy (the web app fills the form),
 * remembering its type. Changing or deleting a type leaves its events as they are.
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
      name: type.name,
      startTime: type.startTime,
      durationMinutes: type.durationMinutes,
      callMinutes: type.callMinutes,
      parts: partsOf(type),
      withSet: type.withSet,
      eventCount: type._count.events,
    };
  }

  async list(teamId: string) {
    const types = await this.prisma.client.teamEventType.findMany({ where: { teamId }, include: withCount, orderBy: { name: "asc" } });
    return types.map((type) => this.summary(type));
  }

  private async find(teamId: string, typeId: string) {
    const type = await this.prisma.client.teamEventType.findFirst({ where: { id: typeId, teamId }, include: withCount });
    if (!type) throw new NotFoundException("Event type not found");
    return type;
  }

  /** The name's taken: one type of each name per team. */
  private async saving<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ConflictException("The team already has an event type of that name");
      throw err;
    }
  }

  async create(teamId: string, dto: CreateTeamEventTypeRequest) {
    if ((await this.prisma.client.teamEventType.count({ where: { teamId } })) >= EVENT_TYPES_LIMIT) throw new BadRequestException([`A team keeps at most ${EVENT_TYPES_LIMIT} event types`]);
    const parts = (await this.events.checkParts(dto.parts ?? undefined, teamId)) ?? [];
    const type = await this.saving(() =>
      this.prisma.client.teamEventType.create({
        data: { teamId, name: dto.name, startTime: dto.startTime ?? null, durationMinutes: dto.durationMinutes ?? null, callMinutes: dto.callMinutes ?? null, parts, withSet: dto.withSet ?? true },
        include: withCount,
      }),
    );
    return this.summary(type);
  }

  async update(teamId: string, typeId: string, dto: UpdateTeamEventTypeRequest) {
    await this.find(teamId, typeId);
    const parts = await this.events.checkParts(dto.parts, teamId);
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
  async remove(teamId: string, typeId: string) {
    await this.find(teamId, typeId);
    await this.prisma.client.teamEventType.delete({ where: { id: typeId } });
  }
}
