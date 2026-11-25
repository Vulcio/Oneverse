import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SetlistAccessService } from "./setlist-access.service.js";

const REQUEST_SELECT = {
  id: true,
  userId: true,
  status: true,
  createdAt: true,
  user: { select: { displayName: true, avatarUrl: true } },
  decidedBy: { select: { displayName: true } },
} as const;

/**
 * Asking to edit a date's set (issue #578): someone who only views it -
 * their team doesn't edit it, or they aren't on the date's line-up - asks,
 * and those who edit it through the date's teams (their admins and their
 * people on its line-up) are told and grant or decline it. A set is one
 * date's, so a grant is for that date. Suggesting a change instead is #570.
 */
@Injectable()
export class SetEditRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sets: SetlistAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  /** What a set is called in a notification: its name, else its date. */
  private setName(set: { name: string | null; eventDate: Date | null }) {
    return set.name || (set.eventDate ? set.eventDate.toISOString().slice(0, 10) : "");
  }

  async ask(user: AuthenticatedUser, setlistId: string) {
    const { set, access } = await this.sets.findViewable(user, setlistId);
    if (access.canEdit) throw new BadRequestException(["You can edit this set already"]);
    if (access.isGuest || (await this.sets.datesOf(setlistId)).length === 0) throw new ForbiddenException("Only a date's set can be asked for, by the people of its teams");
    const before = await this.prisma.client.setEditRequest.findUnique({ where: { setlistId_userId: { setlistId, userId: user.id } }, select: { status: true } });
    const request = await this.prisma.client.setEditRequest.upsert({
      where: { setlistId_userId: { setlistId, userId: user.id } },
      create: { setlistId, userId: user.id },
      // Declined, asked again.
      update: { status: "PENDING", decidedByUserId: null, decidedAt: null },
      select: { id: true, status: true },
    });
    if (before?.status !== "PENDING") {
      const [who, row] = await Promise.all([
        this.prisma.client.user.findUnique({ where: { id: user.id }, select: { displayName: true } }),
        this.prisma.client.setlist.findUniqueOrThrow({ where: { id: set.id }, select: { name: true, eventDate: true } }),
      ]);
      const editors = (await this.sets.editorsOf(setlistId)).filter((id) => id !== user.id);
      await this.notifications.notify(
        editors.map((userId) => ({ userId, kind: "SET_EDIT_REQUESTED" as const, data: { by: who?.displayName ?? "", set: this.setName(row) }, url: `/sets/${setlistId}` })),
        user.id,
      );
    }
    return request;
  }

  /** Those who edit it through its date (or own it) see the asks and decide them; someone granted doesn't grant others. */
  private async assertDecider(user: AuthenticatedUser, setlistId: string) {
    const { access } = await this.sets.findViewable(user, setlistId);
    if (access.canManage) return;
    if (!access.canEdit || !(await this.sets.editorsOf(setlistId)).includes(user.id)) throw new ForbiddenException("Only those who edit the set decide who else may");
  }

  async list(user: AuthenticatedUser, setlistId: string) {
    await this.assertDecider(user, setlistId);
    const rows = await this.prisma.client.setEditRequest.findMany({ where: { setlistId }, select: REQUEST_SELECT, orderBy: { createdAt: "asc" } });
    // Waiting ones first.
    return rows.sort((a, b) => Number(a.status !== "PENDING") - Number(b.status !== "PENDING")).map((row) => this.shown(row));
  }

  async decide(user: AuthenticatedUser, setlistId: string, requestId: string, grant: boolean) {
    await this.assertDecider(user, setlistId);
    const before = await this.prisma.client.setEditRequest.findFirst({ where: { id: requestId, setlistId }, select: { id: true } });
    if (!before) throw new NotFoundException("No such ask to edit this set");
    const row = await this.prisma.client.setEditRequest.update({
      where: { id: requestId },
      data: { status: grant ? "GRANTED" : "DECLINED", decidedByUserId: user.id, decidedAt: new Date() },
      select: REQUEST_SELECT,
    });
    const [who, set] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { id: user.id }, select: { displayName: true } }),
      this.prisma.client.setlist.findUniqueOrThrow({ where: { id: setlistId }, select: { name: true, eventDate: true } }),
    ]);
    await this.notifications.notify(
      [{ userId: row.userId, kind: grant ? ("SET_EDIT_GRANTED" as const) : ("SET_EDIT_DECLINED" as const), data: { by: who?.displayName ?? "", set: this.setName(set) }, url: `/sets/${setlistId}` }],
      user.id,
    );
    return this.shown(row);
  }

  /** The viewer's own ask, for the set's page. */
  async mine(userId: string, setlistId: string) {
    return this.prisma.client.setEditRequest.findUnique({ where: { setlistId_userId: { setlistId, userId } }, select: { id: true, status: true } });
  }

  private shown(row: { id: string; userId: string; status: "PENDING" | "GRANTED" | "DECLINED"; createdAt: Date; user: { displayName: string; avatarUrl: string | null }; decidedBy: { displayName: string } | null }) {
    return {
      id: row.id,
      userId: row.userId,
      displayName: row.user.displayName,
      avatarUrl: row.user.avatarUrl,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      decidedBy: row.decidedBy?.displayName ?? null,
    };
  }
}
