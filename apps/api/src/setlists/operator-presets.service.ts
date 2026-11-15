import { ForbiddenException, Injectable } from "@nestjs/common";
import { readOperatorPresets, type OperatorPresets, type OperatorPresetsRequest } from "@oneverse/core";
import type { Prisma } from "@oneverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { capabilitiesIn } from "../roles/capabilities.js";
import { SetlistAccessService } from "./setlist-access.service.js";

/**
 * What the operator's console keeps at hand for a set (issue #358): named
 * timers to start in one press and quick messages to the stage. They're the
 * set's owner's - a team's for its sets, a person's for their own - so every
 * set of a team has the same ones. Whoever can view the set reads them; who
 * can edit it, or runs its screens by a role, changes them.
 */
@Injectable()
export class OperatorPresetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SetlistAccessService,
  ) {}

  async get(user: AuthenticatedUser, setlistId: string): Promise<OperatorPresets> {
    const { set, access } = await this.access.findViewable(user, setlistId);
    const canEdit = access.canEdit || (await this.runsScreens(user, set.ownerTeamId));
    return this.read(set, canEdit);
  }

  async save(user: AuthenticatedUser, setlistId: string, data: OperatorPresetsRequest): Promise<OperatorPresets> {
    const { set, access } = await this.access.findViewable(user, setlistId);
    if (!access.canEdit && !(await this.runsScreens(user, set.ownerTeamId))) throw new ForbiddenException("Only someone who can edit the set, or runs its screens, changes what the operator keeps at hand");
    const now = await this.read(set, true);
    // Each left out keeps what's saved; null goes back to the built-in list.
    const next = {
      ...(now.timers ? { timers: now.timers } : {}),
      ...(now.messages ? { messages: now.messages } : {}),
    } as { timers?: unknown; messages?: unknown };
    if (data.timers !== undefined) {
      if (data.timers === null) delete next.timers;
      else next.timers = data.timers;
    }
    if (data.messages !== undefined) {
      if (data.messages === null) delete next.messages;
      else next.messages = data.messages;
    }
    const value = next as Prisma.InputJsonValue;
    if (set.ownerTeamId) await this.prisma.client.team.update({ where: { id: set.ownerTeamId }, data: { operatorPresets: value } });
    else if (set.ownerUserId) await this.prisma.client.user.update({ where: { id: set.ownerUserId }, data: { operatorPresets: value } });
    return this.read(set, true);
  }

  private async read(set: { ownerUserId: string | null; ownerTeamId: string | null }, canEdit: boolean): Promise<OperatorPresets> {
    if (set.ownerTeamId) {
      const team = await this.prisma.client.team.findUnique({ where: { id: set.ownerTeamId }, select: { name: true, operatorPresets: true } });
      return { ...readOperatorPresets(team?.operatorPresets), owner: { kind: "team", name: team?.name ?? "" }, canEdit };
    }
    const owner = set.ownerUserId ? await this.prisma.client.user.findUnique({ where: { id: set.ownerUserId }, select: { displayName: true, operatorPresets: true } }) : null;
    return { ...readOperatorPresets(owner?.operatorPresets), owner: { kind: "user", name: owner?.displayName ?? "" }, canEdit };
  }

  /** Runs screens on the set's team, or everywhere, by a role (issue #270). */
  private async runsScreens(user: AuthenticatedUser, teamId: string | null): Promise<boolean> {
    return (await capabilitiesIn(this.prisma.client, user.id, teamId)).canOperateScreens;
  }
}
