import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { eventFallsOn } from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { eventLocation, eventRooms, roomsOnCreate, roomsOnUpdate } from "../locations/locations.service.js";
import { eventResources, RESOURCES_TAKEN, resourcesOnCreate, resourcesOnUpdate, resourcesTaken } from "../locations/resources.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AvailabilityService } from "../team-events/availability.service.js";
import { CalendarFeedService } from "../team-events/calendar-feed.service.js";
import { EventTypesService } from "../team-events/event-types.service.js";
import { dateText, day, partsOf, TeamEventsService } from "../team-events/team-events.service.js";
import type { CreateTeamEventTypeDto, UpdateTeamEventTypeDto } from "../team-events/dto/team-events.dto.js";
import type { CreateOrganizationEventDto, UpdateOrganizationEventDto } from "./dto/organization-events.dto.js";
import { OrganizationsService } from "./organizations.service.js";

type Viewer = Pick<AuthenticatedUser, "id" | "isGlobalAdmin">;

const withGroups = {
  host: { select: { id: true, displayName: true } },
  rooms: { select: { id: true, name: true }, orderBy: { name: "asc" } },
  ...RESOURCES_TAKEN,
  teamEvents: { select: { id: true, teamId: true, parts: true, callMinutes: true, withSet: true, editsSet: true, team: { select: { name: true, color: true, avatarUrl: true, usesSongverse: true } } }, orderBy: { team: { name: "asc" } } },
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
    private readonly types: EventTypesService,
    private readonly feeds: CalendarFeedService,
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
      locationId: event.locationId,
      // The rooms of its location it takes (issue #563).
      rooms: event.rooms,
      // The resources it takes, and how many (issue #564): the organisation's, booked once for all its groups.
      resources: resourcesTaken(event.resources),
      note: event.note,
      repeat: event.repeatEveryWeeks ? { everyWeeks: event.repeatEveryWeeks, until: event.repeatUntil ? dateText(event.repeatUntil) : null } : null,
      host: event.host,
      // One set per date, for all its groups (issue #578); the groups that edit it.
      withSet: event.withSet,
      needs: event.teamEvents.map((one) => ({ teamId: one.teamId, teamName: one.team.name, color: one.team.color, avatarUrl: one.team.avatarUrl, teamEventId: one.id, parts: partsOf(one), callMinutes: one.callMinutes, editsSet: one.editsSet })),
      canManage: role === "ADMIN" || event.hostUserId === viewer.id,
    };
  }

  /** The groups it needs: the organisation's. */
  private async checkNeeds(organizationId: string, needs: { teamId: string }[]) {
    const teams = await this.prisma.client.team.count({ where: { organizationId, id: { in: needs.map((need) => need.teamId) } } });
    if (teams !== needs.length) throw new BadRequestException(["needs must be groups of the organisation"]);
  }

  /**
   * The groups it needs, each with whether it edits the dates' sets (left
   * out: a group that uses Songverse does) - the first that edits them first,
   * as it owns the sets (issue #578).
   */
  private async withEditors<T extends { teamId: string; editsSet?: boolean }>(needs: T[]) {
    const teams = await this.prisma.client.team.findMany({ where: { id: { in: needs.map((need) => need.teamId) } }, select: { id: true, usesSongverse: true } });
    const songverse = new Map(teams.map((team) => [team.id, team.usesSongverse]));
    const out = needs.map((need) => ({ ...need, editsSet: need.editsSet ?? songverse.get(need.teamId) ?? true, usesSongverse: songverse.get(need.teamId) ?? true }));
    const rank = (need: (typeof out)[number]) => (need.editsSet && need.usesSongverse ? 0 : need.usesSongverse ? 1 : 2);
    return out.sort((a, b) => rank(a) - rank(b));
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

  /** Its groups' events waiting to become the organisation's (issue #549), for its admins. */
  async transfers(viewer: Viewer, organizationId: string) {
    await this.assertManager(viewer, organizationId, null);
    const rows = await this.prisma.client.teamEvent.findMany({
      where: { team: { organizationId }, transferRequestedAt: { not: null }, organizationEventId: null },
      include: { team: { select: { name: true, color: true, avatarUrl: true } }, transferRequestedBy: { select: { displayName: true } } },
      orderBy: { transferRequestedAt: "asc" },
    });
    return rows.map((row) => ({
      teamEventId: row.id,
      teamId: row.teamId,
      teamName: row.team.name,
      color: row.team.color,
      avatarUrl: row.team.avatarUrl,
      title: row.title,
      date: dateText(row.date),
      startTime: row.startTime,
      timeZone: row.timeZone,
      repeat: row.repeatEveryWeeks ? { everyWeeks: row.repeatEveryWeeks, until: row.repeatUntil ? dateText(row.repeatUntil) : null } : null,
      requestedBy: row.transferRequestedBy?.displayName ?? null,
      requestedAt: row.transferRequestedAt!.toISOString(),
    }));
  }

  /**
   * A group's event made the organisation's (issue #549), by its admins: a
   * new organisation event with the same timing, the group's event its part
   * of it - its dates, answers, line-ups and sets kept. Its host: who asked,
   * while they're in the organisation, else the admin accepting. `accept`
   * false declines it: it stays the team's.
   */
  async decideTransfer(viewer: Viewer, organizationId: string, teamEventId: string, accept: boolean) {
    const role = await this.assertManager(viewer, organizationId, null);
    const row = await this.prisma.client.teamEvent.findFirst({ where: { id: teamEventId, team: { organizationId }, transferRequestedAt: { not: null }, organizationEventId: null }, include: { team: { select: { name: true } } } });
    if (!row) throw new NotFoundException("No such event waiting for the organisation");
    const who = await this.prisma.client.user.findUnique({ where: { id: viewer.id }, select: { displayName: true } });
    const tell = async (kind: "EVENT_TRANSFER_ACCEPTED" | "EVENT_TRANSFER_DECLINED") => {
      if (row.transferRequestedByUserId)
        await this.notifications.notify([{ userId: row.transferRequestedByUserId, kind, data: { event: row.title, team: row.team.name, by: who?.displayName ?? "" }, url: `/teams/${row.teamId}`, teamId: row.teamId }], viewer.id);
    };
    if (!accept) {
      await this.prisma.client.teamEvent.update({ where: { id: row.id }, data: { transferRequestedAt: null, transferRequestedByUserId: null } });
      await tell("EVENT_TRANSFER_DECLINED");
      return null;
    }
    const asker = row.transferRequestedByUserId ? await this.organizations.roleOf({ id: row.transferRequestedByUserId, isGlobalAdmin: false }, organizationId) : null;
    // A location of the organisation's stays; the team's own becomes the place's words.
    const location = row.locationId ? await this.prisma.client.location.findFirst({ where: { id: row.locationId, ownerOrganizationId: organizationId }, select: { id: true } }) : null;
    const event = await this.prisma.client.$transaction(async (tx) => {
      const made = await tx.organizationEvent.create({
        data: {
          organizationId,
          title: row.title,
          date: row.date,
          startTime: row.startTime,
          durationMinutes: row.durationMinutes,
          timeZone: row.timeZone,
          place: row.place,
          locationId: location?.id ?? null,
          note: row.note,
          repeatEveryWeeks: row.repeatEveryWeeks,
          repeatUntil: row.repeatUntil,
          hostUserId: asker ? row.transferRequestedByUserId : viewer.id,
          withSet: row.withSet,
          createdByUserId: viewer.id,
        },
      });
      await tx.teamEvent.update({ where: { id: row.id }, data: { organizationEventId: made.id, transferRequestedAt: null, transferRequestedByUserId: null } });
      return made;
    });
    await tell("EVENT_TRANSFER_ACCEPTED");
    return this.summary(await this.find(organizationId, event.id), viewer, role);
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
    // Where it takes place (issue #320): its place is the location's name unless given.
    const location = dto.locationId ? await eventLocation(this.prisma, { organizationId }, dto.locationId) : null;
    const event = await this.prisma.client.organizationEvent.create({
      data: {
        organizationId,
        title: dto.title,
        date: day(dto.date),
        startTime: dto.startTime,
        durationMinutes: dto.durationMinutes ?? 90,
        timeZone: dto.timeZone,
        place: dto.place || location?.name || null,
        locationId: location?.id ?? null,
        rooms: roomsOnCreate(await eventRooms(this.prisma, location?.id ?? null, dto.roomIds)),
        resources: resourcesOnCreate(await eventResources(this.prisma, { organizationId }, dto.resources)),
        note: dto.note || null,
        repeatEveryWeeks: dto.repeat?.everyWeeks ?? null,
        repeatUntil: dto.repeat?.until ? day(dto.repeat.until) : null,
        hostUserId: dto.hostUserId,
        withSet: dto.withSet ?? true,
        createdByUserId: viewer.id,
      },
    });
    try {
      for (const need of await this.withEditors(dto.needs))
        await this.events.create(need.teamId, viewer.id, { ...this.timing(event), ...(dto.roomIds?.length ? { roomIds: dto.roomIds } : {}), parts: need.parts, callMinutes: need.callMinutes, withSet: event.withSet, editsSet: need.editsSet }, event.id);
    } catch (error) {
      // A group's part refused (one of its parts): none of it is kept.
      await this.prisma.client.organizationEvent.delete({ where: { id: event.id } });
      throw error;
    }
    await this.tellHost(event, viewer.id);
    return this.summary(await this.find(organizationId, event.id), viewer, role);
  }

  /** What a group's part takes from the event: all but its parts. */
  private timing(event: { title: string; date: Date; startTime: string; durationMinutes: number; timeZone: string; place: string | null; locationId: string | null; note: string | null; repeatEveryWeeks: number | null; repeatUntil: Date | null }) {
    return {
      title: event.title,
      date: dateText(event.date),
      startTime: event.startTime,
      durationMinutes: event.durationMinutes,
      timeZone: event.timeZone,
      ...(event.place ? { place: event.place } : {}),
      ...(event.locationId ? { locationId: event.locationId } : {}),
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
    const location = dto.locationId ? await eventLocation(this.prisma, { organizationId }, dto.locationId) : null;
    // Another location, no place given: the location's name.
    const place = dto.place === undefined && location && location.id !== before.locationId ? location.name : dto.place;
    // Its rooms (issue #563), and every group's part's the same.
    const roomIds = await eventRooms(this.prisma, dto.locationId === undefined ? before.locationId : dto.locationId, dto.roomIds, dto.locationId !== undefined && dto.locationId !== before.locationId);
    const after = await this.prisma.client.organizationEvent.update({
      where: { id: eventId },
      data: {
        title: dto.title,
        date: dto.date ? day(dto.date) : undefined,
        startTime: dto.startTime,
        durationMinutes: dto.durationMinutes,
        timeZone: dto.timeZone,
        place,
        locationId: dto.locationId,
        rooms: roomsOnUpdate(roomIds),
        resources: resourcesOnUpdate(await eventResources(this.prisma, { organizationId }, dto.resources)),
        note: dto.note,
        repeatEveryWeeks: dto.repeat === undefined ? undefined : (dto.repeat?.everyWeeks ?? null),
        repeatUntil: dto.repeat === undefined ? undefined : dto.repeat?.until ? day(dto.repeat.until) : null,
        hostUserId: dto.hostUserId,
        withSet: dto.withSet,
      },
    });
    const timing = {
      title: dto.title,
      date: dto.date,
      startTime: dto.startTime,
      durationMinutes: dto.durationMinutes,
      timeZone: dto.timeZone,
      place,
      locationId: dto.locationId,
      roomIds,
      note: dto.note,
      repeat: dto.repeat,
    };
    const timingChanged = Object.values(timing).some((value) => value !== undefined) || (dto.withSet !== undefined && dto.withSet !== before.withSet);
    const needed = dto.needs ? new Map((await this.withEditors(dto.needs)).map((need) => [need.teamId, need])) : null;
    for (const part of before.teamEvents) {
      if (needed && !needed.has(part.teamId)) {
        await this.events.remove(part.teamId, part.id, viewer.id, true);
        continue;
      }
      const need = needed?.get(part.teamId);
      // A need's call time replaces the group's (none: no call time).
      const asked = need ? { ...(need.parts ? { parts: need.parts } : {}), callMinutes: need.callMinutes ?? null, editsSet: need.editsSet } : {};
      if (timingChanged || need) await this.events.update(part.teamId, part.id, { ...timing, ...asked, withSet: after.withSet }, viewer.id, true);
    }
    for (const need of needed?.values() ?? []) {
      if (!before.teamEvents.some((part) => part.teamId === need.teamId))
        await this.events.create(need.teamId, viewer.id, { ...this.timing(after), roomIds: (await this.find(organizationId, eventId)).rooms.map((room) => room.id), parts: need.parts, callMinutes: need.callMinutes, withSet: after.withSet, editsSet: need.editsSet }, eventId);
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
   * Whether a group edits one date's set, against its usual choice (issue
   * #578): an exception for that date, by the organisation's admins or the
   * event's organiser. null goes back to the group's choice.
   */
  async setDateEditors(viewer: Viewer, organizationId: string, eventId: string, date: string, teamId: string, editsSet: boolean | null) {
    const event = await this.find(organizationId, eventId);
    await this.assertManager(viewer, organizationId, event);
    const part = event.teamEvents.find((one) => one.teamId === teamId);
    if (!part) throw new BadRequestException(["teamId must be one of the groups the event needs"]);
    const timing = { date: dateText(event.date), startTime: event.startTime, durationMinutes: event.durationMinutes, timeZone: event.timeZone, repeat: event.repeatEveryWeeks ? { everyWeeks: event.repeatEveryWeeks, until: event.repeatUntil ? dateText(event.repeatUntil) : null } : null };
    if (!eventFallsOn(timing, date)) throw new NotFoundException("The event isn't on that date");
    await this.prisma.client.teamEventDate.upsert({
      where: { eventId_date: { eventId: part.id, date: day(date) } },
      create: { eventId: part.id, date: day(date), editsSet },
      update: { editsSet },
    });
  }

  /**
   * A date moved to another day for every group (issue #576), by its admins
   * or its organiser: each group's date goes, with its answers, line-up and
   * set. The first group checks the day is free; the others follow.
   */
  async moveDate(viewer: Viewer, organizationId: string, eventId: string, date: string, to: string) {
    const event = await this.find(organizationId, eventId);
    await this.assertManager(viewer, organizationId, event);
    if (event.teamEvents.length === 0) throw new BadRequestException(["This event needs a team before its dates can move"]);
    for (const part of event.teamEvents) await this.events.moveDate(part.teamId, part.id, date, to, viewer.id, true);
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
    const out = new Map<string, { eventId: string; date: string; startsAt: string; endsAt: string; title: string; place: string | null; locationId: string | null; timeZone: string; host: Row["host"]; canManage: boolean; groups: unknown[]; cancelled: boolean }>();
    for (const event of events) {
      const canManage = role === "ADMIN" || event.hostUserId === viewer.id;
      for (const part of event.teamEvents) {
        if (!byTeam.has(part.teamId)) byTeam.set(part.teamId, await this.events.dates(part.teamId, from, to));
        const dates = byTeam.get(part.teamId)!.filter((one) => one.eventId === part.id);
        const shown = await this.availability.withAnswers(part.teamId, viewer.id, canManage, dates);
        for (const date of shown) {
          const key = `${event.id}|${date.date}`;
          const entry = out.get(key) ?? { eventId: event.id, date: date.date, startsAt: date.startsAt, endsAt: date.endsAt, title: date.title, place: event.place, locationId: event.locationId, timeZone: event.timeZone, host: event.host, canManage, groups: [], cancelled: true };
          entry.cancelled &&= date.cancelled;
          entry.groups.push({
            teamId: part.teamId,
            teamName: part.team.name,
            color: part.team.color,
            avatarUrl: part.team.avatarUrl,
            teamEventId: part.id,
            mine: mine.has(part.teamId),
            cancelled: date.cancelled,
            callAt: date.callAt,
            setlistId: date.setlistId,
            songCount: date.songCount,
            editsSet: date.editsSet,
            dateEditsSet: date.dateEditsSet,
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

  /** Its calendar link (issue #551): its events' dates, for its members; null when it's off. */
  async feed(viewer: Viewer, organizationId: string) {
    await this.role(viewer, organizationId);
    return this.feeds.organization(organizationId);
  }

  /** Its admins make or reset it (the old link stops), or turn it off. */
  async resetFeed(viewer: Viewer, organizationId: string) {
    await this.assertFeedAdmin(viewer, organizationId);
    return this.feeds.resetOrganization(organizationId, viewer.id);
  }

  async turnOffFeed(viewer: Viewer, organizationId: string) {
    await this.assertFeedAdmin(viewer, organizationId);
    await this.feeds.turnOffOrganization(organizationId);
  }

  private async assertFeedAdmin(viewer: Viewer, organizationId: string) {
    if ((await this.role(viewer, organizationId)) !== "ADMIN") throw new ForbiddenException("Only the organisation's admins make its calendar link");
  }

  /** The organisation's event types (issue #528): its members see them, its groups pick from them. */
  async eventTypes(viewer: Viewer, organizationId: string) {
    await this.role(viewer, organizationId);
    return this.types.listOf(organizationId);
  }

  /** Only its admins make, change and remove them. */
  private async assertTypesAdmin(viewer: Viewer, organizationId: string) {
    if ((await this.role(viewer, organizationId)) !== "ADMIN") throw new ForbiddenException("Only the organisation's admins keep its event types");
  }

  async createEventType(viewer: Viewer, organizationId: string, dto: CreateTeamEventTypeDto) {
    await this.assertTypesAdmin(viewer, organizationId);
    return this.types.create({ organizationId }, dto);
  }

  async updateEventType(viewer: Viewer, organizationId: string, typeId: string, dto: UpdateTeamEventTypeDto) {
    await this.assertTypesAdmin(viewer, organizationId);
    return this.types.update({ organizationId }, typeId, dto);
  }

  async deleteEventType(viewer: Viewer, organizationId: string, typeId: string) {
    await this.assertTypesAdmin(viewer, organizationId);
    await this.types.remove({ organizationId }, typeId);
  }
}
