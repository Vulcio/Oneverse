import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { eventFallsOn, type EventPart } from "@songverse/core";
import { Prisma } from "@songverse/db";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AvailabilityService } from "../team-events/availability.service.js";
import { dateText, day, partsOf, TeamEventsService } from "../team-events/team-events.service.js";
import type { CreateOrganizationEventDto, OrganizationEventPresetDto, UpdateOrganizationEventDto } from "./dto/organization-events.dto.js";
import { OrganizationsService } from "./organizations.service.js";

type Viewer = Pick<AuthenticatedUser, "id" | "isGlobalAdmin">;

const withGroups = {
  host: { select: { id: true, displayName: true } },
  teamEvents: { select: { id: true, teamId: true, parts: true, team: { select: { name: true, color: true, avatarUrl: true } } }, orderBy: { team: { name: "asc" } } },
} as const;
type Row = Prisma.OrganizationEventGetPayload<{ include: typeof withGroups }>;

/**
 * An organisation's events (issue #241, Planiverse): its admins make them,
 * with a host and the groups they need. Each group's part is one of its
 * team events (`organizationEventId`), with the parts asked of it: its
 * admins fill its line-up as for any of its events, and its timing follows
 * the organisation's event. Its admins and its host change it.
 */
@Injectable()
export class OrganizationEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly events: TeamEventsService,
    private readonly availability: AvailabilityService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The viewer's role in the organisation; not in it: not found. */
  private async role(viewer: Viewer, organizationId: string) {
    await this.organizations.mode();
    const role = await this.organizations.roleOf(viewer, organizationId);
    if (!role) throw new NotFoundException("Organisation not found");
    return role;
  }

  private async find(organizationId: string, eventId: string): Promise<Row> {
    const event = await this.prisma.client.organizationEvent.findFirst({ where: { id: eventId, organizationId }, include: withGroups });
    if (!event) throw new NotFoundException("Event not found");
    return event;
  }

  /** Its admins, or the event's host. */
  private async assertManager(viewer: Viewer, organizationId: string, event: Row | null) {
    const role = await this.role(viewer, organizationId);
    if (role !== "ADMIN" && (!event || event.hostUserId !== viewer.id)) throw new ForbiddenException("Only the organisation's admins and the event's host change it");
    return role;
  }

  private summary(event: Row, viewer: Viewer, role: string) {
    return {
      id: event.id,
      organizationId: event.organizationId,
      title: event.title,
      date: dateText(event.date),
      startTime: event.startTime,
      durationMinutes: event.durationMinutes,
      timeZone: event.timeZone,
      place: event.place,
      note: event.note,
      repeat: event.repeatEveryWeeks ? { everyWeeks: event.repeatEveryWeeks, until: event.repeatUntil ? dateText(event.repeatUntil) : null } : null,
      host: event.host,
      needs: event.teamEvents.map((one) => ({ teamId: one.teamId, teamName: one.team.name, color: one.team.color, avatarUrl: one.team.avatarUrl, teamEventId: one.id, parts: partsOf(one) })),
      canManage: role === "ADMIN" || event.hostUserId === viewer.id,
    };
  }

  /** The groups it needs: the organisation's. */
  private async checkNeeds(organizationId: string, needs: { teamId: string }[]) {
    const teams = await this.prisma.client.team.count({ where: { organizationId, id: { in: needs.map((need) => need.teamId) } } });
    if (teams !== needs.length) throw new BadRequestException(["needs must be groups of the organisation"]);
  }

  /** Its host: one of the organisation's members. */
  private async checkHost(organizationId: string, hostUserId: string) {
    const member = await this.prisma.client.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: hostUserId } }, select: { id: true } });
    if (!member) throw new BadRequestException(["hostUserId must be one of the organisation's members"]);
  }

  /** The host told (unless they made it so themselves). */
  private async tellHost(event: { title: string; date: Date; hostUserId: string | null; organizationId: string }, by: string) {
    if (!event.hostUserId || event.hostUserId === by) return;
    const [organization, who] = await Promise.all([
      this.prisma.client.organization.findUniqueOrThrow({ where: { id: event.organizationId }, select: { name: true } }),
      this.prisma.client.user.findUnique({ where: { id: by }, select: { displayName: true } }),
    ]);
    await this.notifications.notify(
      [{ userId: event.hostUserId, kind: "HOSTING", data: { event: event.title, date: dateText(event.date), team: organization.name, by: who?.displayName ?? "" }, url: `/organizations/${event.organizationId}/events`, app: "planiverse" }],
      by,
    );
  }

  async list(viewer: Viewer, organizationId: string) {
    const role = await this.role(viewer, organizationId);
    const events = await this.prisma.client.organizationEvent.findMany({ where: { organizationId }, include: withGroups, orderBy: { date: "asc" } });
    return events.map((event) => this.summary(event, viewer, role));
  }

  /** By its admins: the event, then each group's part of it. */
  async create(viewer: Viewer, organizationId: string, dto: CreateOrganizationEventDto) {
    const role = await this.assertManager(viewer, organizationId, null);
    if (dto.repeat?.until && dto.repeat.until < dto.date) throw new BadRequestException(["repeat.until must not be before date"]);
    await this.checkHost(organizationId, dto.hostUserId);
    await this.checkNeeds(organizationId, dto.needs);
    const event = await this.prisma.client.organizationEvent.create({
      data: {
        organizationId,
        title: dto.title,
        date: day(dto.date),
        startTime: dto.startTime,
        durationMinutes: dto.durationMinutes ?? 90,
        timeZone: dto.timeZone,
        place: dto.place || null,
        note: dto.note || null,
        repeatEveryWeeks: dto.repeat?.everyWeeks ?? null,
        repeatUntil: dto.repeat?.until ? day(dto.repeat.until) : null,
        hostUserId: dto.hostUserId,
        createdByUserId: viewer.id,
      },
    });
    try {
      for (const need of dto.needs) await this.events.create(need.teamId, viewer.id, { ...this.timing(event), parts: need.parts }, event.id);
    } catch (error) {
      // A group's part refused (one of its parts): none of it is kept.
      await this.prisma.client.organizationEvent.delete({ where: { id: event.id } });
      throw error;
    }
    await this.tellHost(event, viewer.id);
    return this.summary(await this.find(organizationId, event.id), viewer, role);
  }

  /** What a group's part takes from the event: all but its parts. */
  private timing(event: { title: string; date: Date; startTime: string; durationMinutes: number; timeZone: string; place: string | null; note: string | null; repeatEveryWeeks: number | null; repeatUntil: Date | null }) {
    return {
      title: event.title,
      date: dateText(event.date),
      startTime: event.startTime,
      durationMinutes: event.durationMinutes,
      timeZone: event.timeZone,
      ...(event.place ? { place: event.place } : {}),
      ...(event.note ? { note: event.note } : {}),
      ...(event.repeatEveryWeeks ? { repeat: { everyWeeks: event.repeatEveryWeeks, ...(event.repeatUntil ? { until: dateText(event.repeatUntil) } : {}) } } : {}),
    };
  }

  /**
   * By its admins or its host (who can't hand it to someone else): its
   * timing, for every group; `needs`, the groups it needs - a new one gets
   * its part, one left out loses it, the others get their parts.
   */
  async update(viewer: Viewer, organizationId: string, eventId: string, dto: UpdateOrganizationEventDto) {
    const before = await this.find(organizationId, eventId);
    const role = await this.assertManager(viewer, organizationId, before);
    if (dto.hostUserId !== undefined && dto.hostUserId !== before.hostUserId) {
      if (role !== "ADMIN") throw new ForbiddenException("Only the organisation's admins choose the host");
      await this.checkHost(organizationId, dto.hostUserId);
    }
    if (dto.needs) await this.checkNeeds(organizationId, dto.needs);
    const repeat = dto.repeat === undefined ? (before.repeatEveryWeeks ? { everyWeeks: before.repeatEveryWeeks, until: before.repeatUntil ? dateText(before.repeatUntil) : null } : null) : dto.repeat;
    if (repeat?.until && repeat.until < (dto.date ?? dateText(before.date))) throw new BadRequestException(["repeat.until must not be before date"]);
    const after = await this.prisma.client.organizationEvent.update({
      where: { id: eventId },
      data: {
        title: dto.title,
        date: dto.date ? day(dto.date) : undefined,
        startTime: dto.startTime,
        durationMinutes: dto.durationMinutes,
        timeZone: dto.timeZone,
        place: dto.place,
        note: dto.note,
        repeatEveryWeeks: dto.repeat === undefined ? undefined : (dto.repeat?.everyWeeks ?? null),
        repeatUntil: dto.repeat === undefined ? undefined : dto.repeat?.until ? day(dto.repeat.until) : null,
        hostUserId: dto.hostUserId,
      },
    });
    const timing = {
      title: dto.title,
      date: dto.date,
      startTime: dto.startTime,
      durationMinutes: dto.durationMinutes,
      timeZone: dto.timeZone,
      place: dto.place,
      note: dto.note,
      repeat: dto.repeat,
    };
    const timingChanged = Object.values(timing).some((value) => value !== undefined);
    const needed = dto.needs ? new Map(dto.needs.map((need) => [need.teamId, need.parts])) : null;
    for (const part of before.teamEvents) {
      if (needed && !needed.has(part.teamId)) {
        await this.events.remove(part.teamId, part.id, viewer.id, true);
        continue;
      }
      const parts = needed?.get(part.teamId);
      if (timingChanged || parts) await this.events.update(part.teamId, part.id, { ...timing, ...(parts ? { parts } : {}) }, viewer.id, true);
    }
    for (const [teamId, parts] of needed ?? []) {
      if (!before.teamEvents.some((part) => part.teamId === teamId)) await this.events.create(teamId, viewer.id, { ...this.timing(after), parts }, eventId);
    }
    if (after.hostUserId !== before.hostUserId) await this.tellHost(after, viewer.id);
    return this.summary(await this.find(organizationId, eventId), viewer, role);
  }

  /** By its admins: each group's part goes (those signed up told), then the event. */
  async remove(viewer: Viewer, organizationId: string, eventId: string) {
    const event = await this.find(organizationId, eventId);
    if ((await this.role(viewer, organizationId)) !== "ADMIN") throw new ForbiddenException("Only the organisation's admins delete its events");
    for (const part of event.teamEvents) await this.events.remove(part.teamId, part.id, viewer.id, true);
    await this.prisma.client.organizationEvent.delete({ where: { id: eventId } });
  }

  /** A date cancelled, or back, for every group (by its admins or its host). */
  async updateDate(viewer: Viewer, organizationId: string, eventId: string, date: string, cancelled: boolean) {
    const event = await this.find(organizationId, eventId);
    await this.assertManager(viewer, organizationId, event);
    const timing = { date: dateText(event.date), startTime: event.startTime, durationMinutes: event.durationMinutes, timeZone: event.timeZone, repeat: event.repeatEveryWeeks ? { everyWeeks: event.repeatEveryWeeks, until: event.repeatUntil ? dateText(event.repeatUntil) : null } : null };
    if (!eventFallsOn(timing, date)) throw new NotFoundException("The event isn't on that date");
    for (const part of event.teamEvents) await this.events.updateDate(part.teamId, part.id, date, { cancelled }, viewer.id, true);
  }

  /**
   * Its dates from `from` to `to`, each with every group's part: its set,
   * who's on its line-up, and - for its admins and the event's host - how
   * its parts are covered.
   */
  async dates(viewer: Viewer, organizationId: string, from: string, to: string) {
    const role = await this.role(viewer, organizationId);
    const events = await this.prisma.client.organizationEvent.findMany({ where: { organizationId }, include: withGroups });
    const mine = new Set((await this.prisma.client.teamMembership.findMany({ where: { userId: viewer.id }, select: { teamId: true } })).map((m) => m.teamId));
    const byTeam = new Map<string, Awaited<ReturnType<TeamEventsService["dates"]>>>();
    const out = new Map<string, { eventId: string; date: string; startsAt: string; endsAt: string; title: string; place: string | null; timeZone: string; host: Row["host"]; canManage: boolean; groups: unknown[]; cancelled: boolean }>();
    for (const event of events) {
      const canManage = role === "ADMIN" || event.hostUserId === viewer.id;
      for (const part of event.teamEvents) {
        if (!byTeam.has(part.teamId)) byTeam.set(part.teamId, await this.events.dates(part.teamId, from, to));
        const dates = byTeam.get(part.teamId)!.filter((one) => one.eventId === part.id);
        const shown = await this.availability.withAnswers(part.teamId, viewer.id, canManage, dates);
        for (const date of shown) {
          const key = `${event.id}|${date.date}`;
          const entry = out.get(key) ?? { eventId: event.id, date: date.date, startsAt: date.startsAt, endsAt: date.endsAt, title: date.title, place: event.place, timeZone: event.timeZone, host: event.host, canManage, groups: [], cancelled: true };
          entry.cancelled &&= date.cancelled;
          entry.groups.push({
            teamId: part.teamId,
            teamName: part.team.name,
            color: part.team.color,
            avatarUrl: part.team.avatarUrl,
            teamEventId: part.id,
            mine: mine.has(part.teamId),
            cancelled: date.cancelled,
            setlistId: date.setlistId,
            songCount: date.songCount,
            parts: date.parts,
            coverage: date.coverage,
            lineup: date.lineup.map((place) => ({ displayName: place.displayName, partKey: place.partKey, status: place.status })),
          });
          out.set(key, entry);
        }
      }
    }
    return [...out.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  // --- presets

  async presets(viewer: Viewer, organizationId: string) {
    await this.role(viewer, organizationId);
    const rows = await this.prisma.client.organizationEventPreset.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
    return rows.map((row) => ({ id: row.id, name: row.name, title: row.title, startTime: row.startTime, durationMinutes: row.durationMinutes, place: row.place, needs: row.needs as unknown as { teamId: string; parts?: EventPart[] }[] }));
  }

  /** By its admins: what an event usually needs, under a name of its own. */
  async createPreset(viewer: Viewer, organizationId: string, dto: OrganizationEventPresetDto) {
    if ((await this.role(viewer, organizationId)) !== "ADMIN") throw new ForbiddenException("Only the organisation's admins make presets");
    await this.checkNeeds(organizationId, dto.needs);
    try {
      const row = await this.prisma.client.organizationEventPreset.create({
        data: { organizationId, name: dto.name, title: dto.title, startTime: dto.startTime, durationMinutes: dto.durationMinutes ?? 90, place: dto.place || null, needs: dto.needs as unknown as Prisma.InputJsonValue },
      });
      return (await this.presets(viewer, organizationId)).find((one) => one.id === row.id)!;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("A preset already has that name");
      throw error;
    }
  }

  async deletePreset(viewer: Viewer, organizationId: string, presetId: string) {
    if ((await this.role(viewer, organizationId)) !== "ADMIN") throw new ForbiddenException("Only the organisation's admins remove presets");
    const { count } = await this.prisma.client.organizationEventPreset.deleteMany({ where: { id: presetId, organizationId } });
    if (count === 0) throw new NotFoundException("Preset not found");
  }
}
