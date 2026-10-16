import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ScreenWidgetLookSchema, type ScreenWidgetKind } from "@songverse/core";
import type { Prisma } from "@songverse/db";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { PrismaService } from "../prisma/prisma.service.js";

const SELECT = { kind: true, look: true, ownerUserId: true, ownerTeamId: true, team: { select: { name: true } } } as const;

/**
 * Widgets' default looks (issue #273): a person's own, or a team's, set by
 * its admins. The template editor puts them on a widget when it's added -
 * the team's for a team's template, else the person's, else the built-in
 * look; a template keeps what it was given.
 */
@Injectable()
export class ScreenWidgetDefaultsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Theirs and their teams'. */
  async list(user: AuthenticatedUser) {
    const memberships = await this.prisma.client.teamMembership.findMany({ where: { userId: user.id }, select: { teamId: true, role: true } });
    const admin = new Set(memberships.filter((one) => one.role === "ADMIN").map((one) => one.teamId));
    const rows = await this.prisma.client.screenWidgetDefault.findMany({
      where: { OR: [{ ownerUserId: user.id }, { ownerTeamId: { in: memberships.map((one) => one.teamId) } }] },
      select: SELECT,
      orderBy: { kind: "asc" },
    });
    return rows.map((row) => present(row, !!row.ownerUserId || admin.has(row.ownerTeamId!)));
  }

  async save(user: AuthenticatedUser, kind: ScreenWidgetKind, data: { teamId?: string; look: unknown }) {
    const owner = await this.owner(user, data.teamId);
    const look = data.look as Prisma.InputJsonValue;
    const row = await this.prisma.client.screenWidgetDefault.upsert({
      where: owner.ownerTeamId ? { ownerTeamId_kind: { ownerTeamId: owner.ownerTeamId, kind } } : { ownerUserId_kind: { ownerUserId: user.id, kind } },
      create: { kind, look, ...owner },
      update: { look },
      select: SELECT,
    });
    return present(row, true);
  }

  /** Back to the built-in look. */
  async remove(user: AuthenticatedUser, kind: ScreenWidgetKind, teamId?: string): Promise<void> {
    const owner = await this.owner(user, teamId);
    const { count } = await this.prisma.client.screenWidgetDefault.deleteMany({ where: { kind, ...owner } });
    if (count === 0) throw new NotFoundException("No default look for this widget");
  }

  private async owner(user: AuthenticatedUser, teamId: string | undefined) {
    if (!teamId) return { ownerUserId: user.id };
    const membership = await this.prisma.client.teamMembership.findFirst({ where: { userId: user.id, teamId }, select: { role: true } });
    if (membership?.role !== "ADMIN") throw new ForbiddenException("Only the team's admins set its widgets' default looks");
    return { ownerTeamId: teamId };
  }
}

function present(row: { kind: string; look: unknown; ownerUserId: string | null; ownerTeamId: string | null; team: { name: string } | null }, canEdit: boolean) {
  const look = ScreenWidgetLookSchema.safeParse(row.look);
  return {
    kind: row.kind as ScreenWidgetKind,
    teamId: row.ownerTeamId,
    teamName: row.team?.name ?? null,
    look: look.success ? look.data : ScreenWidgetLookSchema.parse({}),
    canEdit,
  };
}
