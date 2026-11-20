import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import type { AnnouncementTexts, CreateAnnouncementRequest, SaveOrganizationAnnouncementRequest, SaveTeamAnnouncementRequest, UpdateAnnouncementRequest } from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import type { Queue } from "bullmq";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { planiverseUrl, songverseUrl } from "../common/utils/web-apps.js";
import { serverVersion } from "../common/version.js";
import { NOTIFICATIONS_QUEUE } from "../jobs/jobs.constants.js";
import { announceNotifications } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { announcementFrom, announcementRecipients } from "./announcement-recipients.js";

type Viewer = Pick<AuthenticatedUser, "id" | "isGlobalAdmin">;
/** Whose page an announcement is managed from: an organisation's, or a team's. */
type Owner = { organizationId: string } | { teamId: string };

/** Sends an announcement's notifications, in the Worker (NotificationsProcessor's "announce"). */
export interface AnnounceJob {
  announcementId: string;
  webUrl: string;
  planiverseUrl?: string | null;
}

/** The docs' What's new page, where a release's draft leads (issue #536). */
const WHATS_NEW = { en: "https://docs.oneverse.top/whats-new/", fr: "https://docs.oneverse.top/fr/whats-new/" };

/** A release's draft: its words, for an admin to make their own before sending. */
export function releaseDraftTexts(version: string): AnnouncementTexts {
  return {
    en: { title: `What's new in version ${version}`, body: "A new version is installed. See what changed and what you can do now.", url: WHATS_NEW.en },
    fr: { title: `Les nouveautés de la version ${version}`, body: "Une nouvelle version est installée. Découvrez ce qui a changé et ce que vous pouvez faire maintenant.", url: WHATS_NEW.fr },
  };
}

const INCLUDE = { organization: { select: { name: true } }, team: { select: { name: true } }, createdBy: { select: { id: true, displayName: true } } } as const;
type Row = Prisma.AnnouncementGetPayload<{ include: typeof INCLUDE }>;

/**
 * Announcements (issue #536): news for people, through their notifications.
 * Global admins write them for everyone, Songverse's or Planiverse's people,
 * or an organisation (Admin > Announcements); an organisation's admins for
 * its members. Each is a draft until sent; sending is the Worker's job,
 * which makes one notification each (they carry its words, and follow its
 * changes); taking it back takes them away. A release drafts one for its
 * version, linking to the docs' What's new.
 */
@Injectable()
export class AnnouncementsService implements OnModuleInit {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  /** A release (an image built for a tag) drafts its announcement, once - whichever process gets there first. */
  async onModuleInit(): Promise<void> {
    const { version } = serverVersion();
    if (version.endsWith("-dev") || version === "0.0.0") return;
    try {
      await this.prisma.client.announcement.create({ data: { release: version, texts: releaseDraftTexts(version) as unknown as Prisma.InputJsonValue } });
      this.logger.log(`Drafted the announcement for version ${version}: Admin > Announcements`);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) this.logger.warn(`The announcement for version ${version} wasn't drafted: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async count(row: Row): Promise<number> {
    return this.prisma.client.user.count({ where: await announcementRecipients(this.prisma.client, row) });
  }

  private async summary(row: Row) {
    const recipients = row.sentAt ? (row.recipients ?? 0) : await this.count(row);
    const teams = row.teamIds.length > 0 ? await this.prisma.client.team.findMany({ where: { id: { in: row.teamIds } }, select: { id: true, name: true } }) : [];
    return {
      id: row.id,
      texts: row.texts as AnnouncementTexts,
      audience: row.audience,
      organizationId: row.organizationId,
      organizationName: row.organization?.name ?? null,
      teamId: row.teamId,
      teamName: row.team?.name ?? null,
      teams: row.teamIds.map((id) => ({ id, name: teams.find((team) => team.id === id)?.name ?? null })),
      withSubgroups: row.withSubgroups,
      release: row.release,
      createdBy: row.createdBy,
      sentAt: row.sentAt?.toISOString() ?? null,
      recipients,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** One, from Admin (any), or from an organisation's or a team's page (theirs only). */
  private async find(id: string, owner?: Owner): Promise<Row> {
    const row = await this.prisma.client.announcement.findUnique({ where: { id }, include: INCLUDE });
    const mismatch = owner && ("teamId" in owner ? row?.teamId !== owner.teamId : row?.organizationId !== owner.organizationId || row?.teamId !== null);
    if (!row || mismatch) throw new NotFoundException("Announcement not found");
    return row;
  }

  /** Teams that are there (and, for an organisation, its own groups): else refused. */
  private async assertTeams(teamIds: string[], organizationId?: string): Promise<void> {
    const found = await this.prisma.client.team.count({ where: { id: { in: teamIds }, ...(organizationId ? { organizationId } : {}) } });
    if (found !== new Set(teamIds).size) throw new BadRequestException([organizationId ? "teamIds must be the organisation's own groups" : "teamIds must be teams of this server"]);
  }

  private async assertOrganization(organizationId: string | undefined): Promise<void> {
    if (!organizationId) return;
    if (!(await this.prisma.client.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) throw new BadRequestException(["organizationId must be an organisation of this server"]);
  }

  // Global admins (Admin > Announcements).

  async list() {
    const rows = await this.prisma.client.announcement.findMany({ include: INCLUDE, orderBy: { createdAt: "desc" }, take: 100 });
    return Promise.all(rows.map((row) => this.summary(row)));
  }

  async create(viewer: Viewer, dto: CreateAnnouncementRequest, owner?: { teamId: string }) {
    const audience = dto.audience ?? "EVERYONE";
    const organizationId = audience === "ORGANIZATION" || (audience === "TEAMS" && dto.organizationId) ? (dto.organizationId ?? null) : null;
    const teamIds = audience === "TEAMS" ? [...new Set(dto.teamIds ?? [])] : [];
    await this.assertOrganization(organizationId ?? undefined);
    if (audience === "TEAMS") await this.assertTeams(teamIds, organizationId ?? undefined);
    const row = await this.prisma.client.announcement.create({
      data: { texts: dto.texts as Prisma.InputJsonValue, audience, organizationId, teamIds, withSubgroups: audience === "TEAMS" && !!dto.withSubgroups, teamId: owner?.teamId ?? null, createdById: viewer.id },
      include: INCLUDE,
    });
    return this.summary(row);
  }

  /** A draft changed; a sent one's words only - fixed in everyone's notifications. */
  async update(id: string, dto: UpdateAnnouncementRequest, owner?: Owner) {
    const row = await this.find(id, owner);
    const audience = dto.audience ?? row.audience;
    // An organisation's or a team's stays theirs.
    const organizationId = owner ? row.organizationId : audience === "ORGANIZATION" || audience === "TEAMS" ? (dto.organizationId !== undefined ? dto.organizationId : row.organizationId) : null;
    const teamIds = audience === "TEAMS" ? [...new Set(dto.teamIds ?? row.teamIds)] : [];
    const withSubgroups = audience === "TEAMS" && (dto.withSubgroups ?? row.withSubgroups);
    const same = audience === row.audience && organizationId === row.organizationId && teamIds.join() === row.teamIds.join() && withSubgroups === row.withSubgroups;
    if (row.sentAt && !same) throw new ConflictException("It's sent: only its words can change");
    if (audience === "ORGANIZATION" && !organizationId) throw new BadRequestException(["organizationId must be given for an organisation's members"]);
    if (audience === "TEAMS" && teamIds.length === 0) throw new BadRequestException(["teamIds must name one team at least"]);
    if (!same) {
      await this.assertOrganization(organizationId ?? undefined);
      if (audience === "TEAMS" && !row.teamId) await this.assertTeams(teamIds, organizationId ?? undefined);
    }
    const texts = (dto.texts ?? row.texts) as Prisma.InputJsonValue;
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const saved = await tx.announcement.update({ where: { id }, data: { texts, audience, organizationId, teamIds, withSubgroups }, include: INCLUDE });
      if (row.sentAt && dto.texts) {
        await tx.notification.updateMany({ where: { announcementId: id }, data: { data: { texts, ...announcementFrom(saved) } } });
      }
      return saved;
    });
    return this.summary(updated);
  }

  /** Sent: marked now, its notifications made by the Worker. Sending twice does nothing more. */
  async send(id: string, owner?: Owner) {
    const row = await this.find(id, owner);
    if (!row.sentAt) {
      const recipients = await this.count(row);
      if (recipients === 0) throw new BadRequestException(["Nobody would get it: no one is in its audience"]);
      // Only the first send wins, even two at once.
      const { count } = await this.prisma.client.announcement.updateMany({ where: { id, sentAt: null }, data: { sentAt: new Date(), recipients } });
      if (count === 1) {
        await this.queue.add("announce", { announcementId: id, webUrl: songverseUrl(), planiverseUrl: planiverseUrl() } satisfies AnnounceJob, { removeOnComplete: 100, removeOnFail: 100, attempts: 3, backoff: { type: "exponential", delay: 10_000 } });
      }
    }
    return this.summary(await this.find(id));
  }

  /** Deleted: a draft, or a sent one taken back from everyone's notifications. */
  async remove(id: string, owner?: Owner): Promise<void> {
    const row = await this.find(id, owner);
    const users = row.sentAt ? await this.prisma.client.notification.findMany({ where: { announcementId: id, readAt: null }, select: { userId: true }, take: 5000 }) : [];
    await this.prisma.client.announcement.delete({ where: { id } });
    // Their bells' counts, at once where they're open.
    await announceNotifications([...new Set(users.map((one) => one.userId))]);
  }

  // An organisation's admins.

  /** Its admins, or a global admin. */
  async assertOrganizationAdmin(viewer: Viewer, organizationId: string): Promise<void> {
    const membership = await this.prisma.client.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: viewer.id } }, select: { role: true } });
    if (membership?.role === "ADMIN") return;
    if (viewer.isGlobalAdmin && (await this.prisma.client.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) return;
    if (!membership) throw new NotFoundException("Organisation not found");
    throw new ForbiddenException("Organisation admin role required");
  }

  async listForOrganization(viewer: Viewer, organizationId: string) {
    await this.assertOrganizationAdmin(viewer, organizationId);
    const rows = await this.prisma.client.announcement.findMany({ where: { organizationId, teamId: null }, include: INCLUDE, orderBy: { createdAt: "desc" }, take: 50 });
    return Promise.all(rows.map((row) => this.summary(row)));
  }

  /** To all its members, or to some of its groups' (and the groups under them). */
  private static organizationScope(organizationId: string, dto: SaveOrganizationAnnouncementRequest) {
    const groups = dto.teamIds ?? [];
    return groups.length > 0 ? { audience: "TEAMS" as const, organizationId, teamIds: groups, withSubgroups: !!dto.withSubgroups } : { audience: "ORGANIZATION" as const, organizationId, teamIds: [], withSubgroups: false };
  }

  async createForOrganization(viewer: Viewer, organizationId: string, dto: SaveOrganizationAnnouncementRequest) {
    await this.assertOrganizationAdmin(viewer, organizationId);
    return this.create(viewer, { texts: dto.texts, ...AnnouncementsService.organizationScope(organizationId, dto) });
  }

  async updateForOrganization(viewer: Viewer, organizationId: string, id: string, dto: SaveOrganizationAnnouncementRequest) {
    await this.assertOrganizationAdmin(viewer, organizationId);
    // Its groups checked as its own by update() (assertTeams with the organisation).
    const scope = dto.teamIds === undefined ? {} : AnnouncementsService.organizationScope(organizationId, dto);
    return this.update(id, { texts: dto.texts, ...scope }, { organizationId });
  }

  async sendForOrganization(viewer: Viewer, organizationId: string, id: string) {
    await this.assertOrganizationAdmin(viewer, organizationId);
    return this.send(id, { organizationId });
  }

  async removeForOrganization(viewer: Viewer, organizationId: string, id: string) {
    await this.assertOrganizationAdmin(viewer, organizationId);
    await this.remove(id, { organizationId });
  }

  // A team's admins, to its members.

  /** Its admins, or a global admin. */
  async assertTeamAdmin(viewer: Viewer, teamId: string): Promise<void> {
    const membership = await this.prisma.client.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: viewer.id } }, select: { role: true } });
    if (membership?.role === "ADMIN") return;
    if (viewer.isGlobalAdmin && (await this.prisma.client.team.findUnique({ where: { id: teamId }, select: { id: true } }))) return;
    if (!membership) throw new NotFoundException("Team not found");
    throw new ForbiddenException("Team admin role required");
  }

  async listForTeam(viewer: Viewer, teamId: string) {
    await this.assertTeamAdmin(viewer, teamId);
    const rows = await this.prisma.client.announcement.findMany({ where: { teamId }, include: INCLUDE, orderBy: { createdAt: "desc" }, take: 50 });
    return Promise.all(rows.map((row) => this.summary(row)));
  }

  async createForTeam(viewer: Viewer, teamId: string, dto: SaveTeamAnnouncementRequest) {
    await this.assertTeamAdmin(viewer, teamId);
    return this.create(viewer, { texts: dto.texts, audience: "TEAMS", teamIds: [teamId] }, { teamId });
  }

  async updateForTeam(viewer: Viewer, teamId: string, id: string, dto: SaveTeamAnnouncementRequest) {
    await this.assertTeamAdmin(viewer, teamId);
    return this.update(id, { texts: dto.texts }, { teamId });
  }

  async sendForTeam(viewer: Viewer, teamId: string, id: string) {
    await this.assertTeamAdmin(viewer, teamId);
    return this.send(id, { teamId });
  }

  async removeForTeam(viewer: Viewer, teamId: string, id: string) {
    await this.assertTeamAdmin(viewer, teamId);
    await this.remove(id, { teamId });
  }
}
