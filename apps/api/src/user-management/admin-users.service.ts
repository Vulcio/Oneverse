import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageQuotaService } from "../storage/storage-quota.service.js";
import { ContentTransfersService } from "./content-transfers.service.js";
import { UserDeletionService } from "./user-deletion.service.js";

export interface UpdateUserInput {
  banned?: boolean;
  banReason?: string;
}

const BYTES_PER_MB = 1024 * 1024;

export type DeleteContentAction = "delete" | "transfer";

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: StorageQuotaService,
    private readonly transfers: ContentTransfersService,
    private readonly userDeletion: UserDeletionService,
  ) {}

  async list() {
    const [users, usedBytes, { limitMb: defaultLimitMb }, assignments, memberships] = await Promise.all([
      this.prisma.client.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          displayName: true,
          avatarUrl: true,
          emailVerified: true,
          isGlobalAdmin: true,
          createdAt: true,
          bannedAt: true,
          banReason: true,
          deletedAt: true,
          contentTransfer: { select: { fromEmail: true, expiresAt: true } },
          _count: { select: { teamMemberships: true, ownedVersions: true } },
        },
      }),
      this.quota.usedBytesByUser(),
      this.quota.getDefaultLimitMb(),
      // Every role given (issue #160), to users and to teams, and who's on which team: worked out here in one go.
      this.prisma.client.roleAssignment.findMany({
        // Given everywhere; those given on a team or an organisation only (issue #270) are theirs to show.
        where: { scopeKey: "" },
        select: { userId: true, teamId: true, team: { select: { name: true } }, role: { select: { id: true, name: true, canReview: true, storageLimitMb: true } } },
        orderBy: { role: { name: "asc" } },
      }),
      this.prisma.client.teamMembership.findMany({ select: { userId: true, teamId: true } }),
    ]);
    type Role = (typeof assignments)[number]["role"];
    const ownRoles = new Map<string, Role[]>();
    const teamRoles = new Map<string, { role: Role; teamName: string }[]>();
    for (const { userId, teamId, team, role } of assignments) {
      if (userId) ownRoles.set(userId, [...(ownRoles.get(userId) ?? []), role]);
      if (teamId) teamRoles.set(teamId, [...(teamRoles.get(teamId) ?? []), { role, teamName: team?.name ?? "" }]);
    }
    const viaTeams = new Map<string, { role: Role; teamName: string }[]>();
    for (const { userId, teamId } of memberships) {
      const roles = teamRoles.get(teamId);
      if (roles) viaTeams.set(userId, [...(viaTeams.get(userId) ?? []), ...roles]);
    }

    return users.map((user) => {
      const own = ownRoles.get(user.id) ?? [];
      const inherited = viaTeams.get(user.id) ?? [];
      const all = [...own, ...inherited.map(({ role }) => role)];
      const tiers = all.map((role) => role.storageLimitMb).filter((mb): mb is number => mb !== null);
      return {
      id: user.id,
      // A deleted account's email was released; show the one it had.
      email: user.contentTransfer?.fromEmail ?? user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerified,
      isGlobalAdmin: user.isGlobalAdmin,
      isReviewer: all.some((role) => role.canReview),
      roles: own.map(({ id, name }) => ({ id, name })),
      teamRoles: inherited.map(({ role, teamName }) => ({ id: role.id, name: role.name, teamName })),
      createdAt: user.createdAt,
      bannedAt: user.bannedAt,
      banReason: user.banReason,
      deletedAt: user.deletedAt,
      transferExpiresAt: user.contentTransfer?.expiresAt ?? null,
      usedBytes: usedBytes.get(user.id) ?? 0,
      limitBytes: user.isGlobalAdmin ? null : (tiers.length ? Math.max(...tiers) : defaultLimitMb) * BYTES_PER_MB,
      teamCount: user._count.teamMemberships,
      songCount: user._count.ownedVersions,
      };
    });
  }

  async update(adminId: string, userId: string, input: UpdateUserInput): Promise<void> {
    const user = await this.findActive(userId);
    if (input.banned !== undefined && userId === adminId) {
      throw new ForbiddenException("You can't ban yourself");
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          ...(input.banned === true && { bannedAt: new Date(), banReason: input.banReason?.trim() || null }),
          ...(input.banned === false && { bannedAt: null, banReason: null }),
        },
      });
      if (input.banned === true) {
        await tx.session.deleteMany({ where: { userId } });
      }
    });
  }

  async remove(adminId: string, userId: string, action: DeleteContentAction, retentionDays: number) {
    if (userId === adminId) throw new ForbiddenException("You can't delete your own account here");

    const user = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { deletedAt: true } });
    if (!user) throw new NotFoundException("User not found");

    // An account already awaiting transfer can only be finished off.
    if (user.deletedAt && action === "transfer") {
      throw new BadRequestException("This account already has a pending transfer link");
    }

    if (action === "transfer") {
      return this.transfers.deleteAccountKeepingContent(userId, adminId, retentionDays);
    }
    await this.userDeletion.deleteAccountAndContent(userId);
    return null;
  }

  regenerateTransferLink(userId: string) {
    return this.transfers.regenerateLink(userId);
  }

  private async findActive(userId: string) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { id: true, deletedAt: true } });
    if (!user || user.deletedAt) throw new NotFoundException("User not found");
    return user;
  }
}
