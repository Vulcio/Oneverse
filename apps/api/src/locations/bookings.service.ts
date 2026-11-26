import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { eventDatePath, type AskBookingRequest } from "@oneverse/core";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { NotificationsService, type NotificationInput } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { managersOf, type Managed } from "./booking-approvals.js";
import { canSee, ownerScope } from "./locations.service.js";

const APPROVAL = {
  id: true,
  status: true,
  createdAt: true,
  roomId: true,
  resourceId: true,
  requestedByUserId: true,
  requestedBy: { select: { displayName: true } },
  room: { select: { name: true, managerTeamId: true, location: { select: { name: true, ownerTeamId: true, ownerOrganizationId: true } } } },
  resource: { select: { name: true, managerTeamId: true, ownerTeamId: true, ownerOrganizationId: true } },
  teamEvent: { select: { id: true, teamId: true, title: true, date: true, repeatEveryWeeks: true, team: { select: { name: true } } } },
  organizationEvent: { select: { id: true, organizationId: true, title: true, date: true, repeatEveryWeeks: true, organization: { select: { name: true } } } },
} as const;

type ApprovalRow = Awaited<ReturnType<BookingsService["findApproval"]>>;

const dateText = (date: Date) => date.toISOString().slice(0, 10);

/** Its room's or resource's name and whose approval it waits for. */
function managedOf(row: NonNullable<ApprovalRow>): { what: string; managed: Managed } {
  if (row.room) return { what: row.room.name, managed: { managerTeamId: row.room.managerTeamId, ownerTeamId: row.room.location.ownerTeamId, ownerOrganizationId: row.room.location.ownerOrganizationId } };
  const resource = row.resource!;
  return { what: resource.name, managed: { managerTeamId: resource.managerTeamId, ownerTeamId: resource.ownerTeamId, ownerOrganizationId: resource.ownerOrganizationId } };
}

/** The event a booking is for, as its notifications and lists name it. */
function eventOf(row: NonNullable<ApprovalRow>) {
  const team = row.teamEvent;
  if (team) return { eventId: team.id, eventKind: "team" as const, title: team.title, date: dateText(team.date), repeats: !!team.repeatEveryWeeks, owner: team.team.name, url: eventDatePath(team.id, dateText(team.date)), teamId: team.teamId };
  const org = row.organizationEvent!;
  return { eventId: org.id, eventKind: "organization" as const, title: org.title, date: dateText(org.date), repeats: !!org.repeatEveryWeeks, owner: org.organization.name, url: `/organizations/${org.organizationId}/events`, teamId: undefined };
}

/**
 * Bookings between people (issue #565): asking an event that holds a room
 * or resource to free it, and the approvals a room's or resource's managers
 * give or refuse.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  findApproval(id: string) {
    return this.prisma.client.bookingApproval.findUnique({ where: { id }, select: APPROVAL });
  }

  /** A new request's managers are told (after the change that made it is saved). */
  async tellManagers(approvalIds: readonly string[], by: string | null) {
    const who = by ? await this.prisma.client.user.findUnique({ where: { id: by }, select: { displayName: true } }) : null;
    for (const id of approvalIds) {
      const row = await this.findApproval(id);
      if (!row) continue;
      const { what, managed } = managedOf(row);
      const event = eventOf(row);
      const managers = await managersOf(this.prisma.client, managed);
      const url = managed.ownerOrganizationId && !managed.managerTeamId ? `/organizations/${managed.ownerOrganizationId}` : `/teams/${managed.managerTeamId ?? managed.ownerTeamId}`;
      await this.notifications.notify(
        managers.map((userId) => ({ userId, kind: "BOOKING_REQUESTED" as const, data: { by: who?.displayName ?? "", what, event: event.title, date: event.date }, url, app: "planiverse" as const })),
        by,
      );
    }
  }

  /**
   * The bookings waiting for the user's approval: those of the rooms and
   * resources they manage, maybe only a team's or an organisation's (owned
   * by it, or managed by the team).
   */
  async requests(user: AuthenticatedUser, owner: { teamId?: string | undefined; organizationId?: string | undefined } = {}) {
    const [teams, organizations] = await Promise.all([
      this.prisma.client.teamMembership.findMany({ where: { userId: user.id, role: "ADMIN" }, select: { teamId: true } }),
      this.prisma.client.organizationMembership.findMany({ where: { userId: user.id, role: "ADMIN" }, select: { organizationId: true } }),
    ]);
    let adminTeams = teams.map((one) => one.teamId);
    let adminOrganizations = organizations.map((one) => one.organizationId);
    if (owner.teamId) {
      adminTeams = adminTeams.filter((id) => id === owner.teamId);
      adminOrganizations = [];
    } else if (owner.organizationId) {
      adminTeams = [];
      adminOrganizations = adminOrganizations.filter((id) => id === owner.organizationId);
    }
    // Managed: by one of their teams, or owned by one of theirs (team or organisation) with no manager team.
    const managed = (ownerOf: (teams: string[], organizations: string[]) => object) => ({
      OR: [{ managerTeamId: { in: adminTeams } }, { managerTeamId: null, ...ownerOf(adminTeams, adminOrganizations) }],
    });
    const rows = await this.prisma.client.bookingApproval.findMany({
      where: {
        status: "REQUESTED",
        OR: [
          { room: managed((t, o) => ({ location: { OR: [{ ownerTeamId: { in: t } }, { ownerOrganizationId: { in: o } }] } })) },
          { resource: managed((t, o) => ({ OR: [{ ownerTeamId: { in: t } }, { ownerOrganizationId: { in: o } }] })) },
        ],
      },
      select: APPROVAL,
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => {
      const event = eventOf(row);
      return {
        id: row.id,
        kind: row.room ? ("room" as const) : ("resource" as const),
        what: managedOf(row).what,
        venue: row.room?.location.name ?? null,
        eventId: event.eventId,
        eventKind: event.eventKind,
        event: event.title,
        owner: event.owner,
        date: event.date,
        repeats: event.repeats,
        requestedBy: row.requestedBy?.displayName ?? null,
        requestedAt: row.createdAt.toISOString(),
      };
    });
  }

  private async decidable(user: AuthenticatedUser, id: string) {
    const row = await this.findApproval(id);
    if (!row) throw new NotFoundException("Booking request not found");
    if (!(await managersOf(this.prisma.client, managedOf(row).managed)).includes(user.id)) throw new ForbiddenException("Only its managers approve or decline this booking");
    if (row.status !== "REQUESTED") throw new BadRequestException(["This booking is approved already"]);
    return row;
  }

  /** By one of its managers: the event keeps it. Whoever asked is told. */
  async approve(user: AuthenticatedUser, id: string): Promise<void> {
    const row = await this.decidable(user, id);
    await this.prisma.client.bookingApproval.update({ where: { id }, data: { status: "APPROVED", decidedByUserId: user.id, decidedAt: new Date() } });
    await this.tellRequester(row, "BOOKING_APPROVED", user);
  }

  /** By one of its managers: the event gives the room or resource up (an organisation's event, for every group). Whoever asked is told. */
  async decline(user: AuthenticatedUser, id: string): Promise<void> {
    const row = await this.decidable(user, id);
    await this.prisma.client.$transaction(async (tx) => {
      if (row.teamEvent) {
        if (row.roomId) await tx.teamEvent.update({ where: { id: row.teamEvent.id }, data: { rooms: { disconnect: { id: row.roomId } } } });
        else await tx.eventResource.deleteMany({ where: { teamEventId: row.teamEvent.id, resourceId: row.resourceId! } });
      } else if (row.organizationEvent) {
        const eventId = row.organizationEvent.id;
        if (row.roomId) {
          await tx.organizationEvent.update({ where: { id: eventId }, data: { rooms: { disconnect: { id: row.roomId } } } });
          // Its groups' parts carry its rooms.
          for (const part of await tx.teamEvent.findMany({ where: { organizationEventId: eventId, rooms: { some: { id: row.roomId } } }, select: { id: true } }))
            await tx.teamEvent.update({ where: { id: part.id }, data: { rooms: { disconnect: { id: row.roomId } } } });
        } else {
          await tx.eventResource.deleteMany({ where: { organizationEventId: eventId, resourceId: row.resourceId! } });
        }
      }
      await tx.bookingApproval.delete({ where: { id } });
    });
    await this.tellRequester(row, "BOOKING_DECLINED", user);
  }

  private async tellRequester(row: NonNullable<ApprovalRow>, kind: "BOOKING_APPROVED" | "BOOKING_DECLINED", by: AuthenticatedUser) {
    if (!row.requestedByUserId) return;
    const event = eventOf(row);
    const who = await this.prisma.client.user.findUnique({ where: { id: by.id }, select: { displayName: true } });
    await this.notifications.notify([{ userId: row.requestedByUserId, kind, data: { by: who?.displayName ?? "", what: managedOf(row).what, event: event.title }, url: event.url, ...(event.teamId ? { teamId: event.teamId } : { app: "planiverse" as const }) }], by.id);
  }

  /**
   * Someone whose event clashes asks the event holding a room or resource
   * to free it on a date: its organisers are told - a team's event's admins
   * and whoever made it, an organisation's event's organiser and admins.
   * Only who sees the room or resource asks, and only of an event taking it.
   */
  async ask(user: AuthenticatedUser, dto: AskBookingRequest): Promise<{ told: number }> {
    const scope = await ownerScope(this.prisma, user);
    const owned =
      dto.kind === "room"
        ? await this.prisma.client.room.findUnique({ where: { id: dto.id }, select: { name: true, location: { select: { ownerTeamId: true, ownerOrganizationId: true } } } }).then((room) => room && { name: room.name, ...room.location })
        : await this.prisma.client.resource.findUnique({ where: { id: dto.id }, select: { name: true, ownerTeamId: true, ownerOrganizationId: true } });
    if (!owned || !canSee(user, scope, owned)) throw new NotFoundException(dto.kind === "room" ? "Room not found" : "Resource not found");
    const taking = dto.kind === "room" ? { rooms: { some: { id: dto.id } } } : { resources: { some: { resourceId: dto.id } } };
    let recipients: string[];
    let event: string;
    let url: string;
    let target: Pick<NotificationInput, "teamId" | "app">;
    if (dto.eventKind === "team") {
      const row = await this.prisma.client.teamEvent.findFirst({ where: { id: dto.eventId, ...taking }, select: { id: true, teamId: true, title: true, createdByUserId: true } });
      if (!row) throw new NotFoundException("Event not found");
      const admins = await this.prisma.client.teamMembership.findMany({ where: { teamId: row.teamId, role: "ADMIN" }, select: { userId: true } });
      recipients = [...admins.map((one) => one.userId), ...(row.createdByUserId ? [row.createdByUserId] : [])];
      event = row.title;
      url = eventDatePath(row.id, dto.date);
      target = { teamId: row.teamId };
    } else {
      const row = await this.prisma.client.organizationEvent.findFirst({ where: { id: dto.eventId, ...taking }, select: { organizationId: true, title: true, hostUserId: true } });
      if (!row) throw new NotFoundException("Event not found");
      const admins = await this.prisma.client.organizationMembership.findMany({ where: { organizationId: row.organizationId, role: "ADMIN" }, select: { userId: true } });
      recipients = [...admins.map((one) => one.userId), ...(row.hostUserId ? [row.hostUserId] : [])];
      event = row.title;
      url = `/organizations/${row.organizationId}/events`;
      target = { app: "planiverse" };
    }
    const who = await this.prisma.client.user.findUnique({ where: { id: user.id }, select: { displayName: true } });
    const told = await this.notifications.notify(
      [...new Set(recipients)].map((userId) => ({ userId, kind: "BOOKING_ASKED" as const, data: { by: who?.displayName ?? "", what: owned.name, date: dto.date, event, ...(dto.message ? { note: dto.message } : {}) }, url, ...target })),
      user.id,
    );
    return { told };
  }
}
