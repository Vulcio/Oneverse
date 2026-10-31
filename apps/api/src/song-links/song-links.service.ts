import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { readReferenceLink, type AttachmentVisibilityValue, type CreateSongLinkSchema, type SongLink, type UpdateSongLinkSchema } from "@oneverse/core";
import type { z } from "zod";
import { Prisma } from "@oneverse/db";
import { AccessPolicyService, type Viewer } from "../access/access-policy.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const INCLUDE = { addedBy: { select: { id: true, displayName: true } } } satisfies Prisma.SongLinkInclude;
type Row = Prisma.SongLinkGetPayload<{ include: typeof INCLUDE }>;
type CreateSongLinkRequest = z.output<typeof CreateSongLinkSchema>;
type UpdateSongLinkRequest = z.output<typeof UpdateSongLinkSchema>;

/**
 * A song's reference recordings (issue #346): several, labelled, each its
 * adder's and shown to whom they choose, as files are (AttachmentsService).
 */
@Injectable()
export class SongLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
  ) {}

  /** Who sees a link besides its adder: as a file (AttachmentsService.visibleWhere). */
  static visibleWhere(viewer: Viewer, teamIds: string[]): Prisma.SongLinkWhereInput {
    if (viewer.isGlobalAdmin) return {};
    return {
      OR: [
        { visibility: "SONG" },
        { addedByUserId: viewer.id },
        { visibility: "TEAM", visibleToTeamId: { in: teamIds } },
        { visibility: "SHARED", songVersion: { accessGrants: { some: { OR: [{ grantedToUserId: viewer.id }, { grantedToTeamId: { in: teamIds } }] } } } },
      ],
    };
  }

  async list(viewer: Viewer, songVersionId: string): Promise<SongLink[]> {
    const [teamIds, song] = await Promise.all([this.access.teamIds(viewer.id), this.songRights(viewer, songVersionId)]);
    const rows = await this.prisma.client.songLink.findMany({
      where: { songVersionId, ...SongLinksService.visibleWhere(viewer, teamIds) },
      include: INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => present(row, viewer, song.canEditSong));
  }

  async create(viewer: Viewer, songVersionId: string, dto: CreateSongLinkRequest): Promise<SongLink> {
    const song = await this.songRights(viewer, songVersionId);
    const link = readLink(dto.url);
    const audience = await this.audience(viewer, song, dto.visibility ?? "PRIVATE", dto.teamId ?? null);
    const row = await this.prisma.client.songLink.create({
      data: { songVersionId, ...link, label: dto.label, startSeconds: dto.startSeconds ?? link.startSeconds, addedByUserId: viewer.id, ...audience },
      include: INCLUDE,
    });
    return present(row, viewer, song.canEditSong);
  }

  async update(viewer: Viewer, songVersionId: string, linkId: string, dto: UpdateSongLinkRequest): Promise<SongLink> {
    const { row, song } = await this.changeable(viewer, songVersionId, linkId);
    const link = dto.url !== undefined ? readLink(dto.url) : null;
    // Only its adder chooses who sees it; who manages the song changes its address, name and start.
    if ((dto.visibility !== undefined || dto.teamId !== undefined) && row.addedByUserId !== viewer.id && !viewer.isGlobalAdmin) {
      throw new ForbiddenException("Only who added it chooses who sees it");
    }
    const audience = dto.visibility !== undefined ? await this.audience(viewer, song, dto.visibility, dto.teamId ?? row.visibleToTeamId) : {};
    const updated = await this.prisma.client.songLink.update({
      where: { id: linkId },
      data: {
        ...(link && { url: link.url, service: link.service, value: link.value }),
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.startSeconds !== undefined ? { startSeconds: dto.startSeconds } : link?.startSeconds != null ? { startSeconds: link.startSeconds } : {}),
        ...audience,
      },
      include: INCLUDE,
    });
    return present(updated, viewer, song.canEditSong);
  }

  async remove(viewer: Viewer, songVersionId: string, linkId: string): Promise<void> {
    await this.changeable(viewer, songVersionId, linkId);
    await this.prisma.client.songLink.delete({ where: { id: linkId } });
  }

  /** A link the viewer sees and may change: theirs, or the song's when they manage it (404 when hidden). */
  private async changeable(viewer: Viewer, songVersionId: string, linkId: string) {
    const [teamIds, song] = await Promise.all([this.access.teamIds(viewer.id), this.songRights(viewer, songVersionId)]);
    const row = await this.prisma.client.songLink.findFirst({ where: { id: linkId, songVersionId, ...SongLinksService.visibleWhere(viewer, teamIds) }, include: INCLUDE });
    if (!row) throw new NotFoundException("Reference recording not found");
    if (!present(row, viewer, song.canEditSong).canChange) throw new ForbiddenException("Only who added it, or who manages the song, can change it");
    return { row, song };
  }

  private async songRights(viewer: Viewer, songVersionId: string) {
    const song = await this.prisma.client.songVersion.findUnique({ where: { id: songVersionId }, select: { ownerScope: true, ownerUserId: true, ownerTeamId: true } });
    if (!song) throw new NotFoundException("Song version not found");
    return { canEditSong: await this.access.canEdit(viewer, song), isGlobal: song.ownerScope === "GLOBAL" };
  }

  /** Who a link may be shown to, as files (AttachmentsService.audience). */
  private async audience(viewer: Viewer, { canEditSong, isGlobal }: { canEditSong: boolean; isGlobal: boolean }, visibility: AttachmentVisibilityValue, teamId: string | null) {
    if (visibility === "SONG" && !canEditSong) throw new ForbiddenException("Only who can edit the song can show a link to everyone who sees it");
    if (visibility === "SHARED") {
      if (!canEditSong) throw new ForbiddenException("Only who shares the song can show a link to the people it's shared with");
      if (isGlobal) throw new BadRequestException("A catalogue song isn't shared with anyone: everyone sees it");
    }
    if (visibility !== "TEAM") return { visibility, visibleToTeamId: null };
    if (!teamId) throw new BadRequestException("Choose the team that sees it");
    if (!viewer.isGlobalAdmin && !(await this.access.teamRole(viewer.id, teamId))) throw new ForbiddenException("Not a member of that team");
    return { visibility, visibleToTeamId: teamId };
  }
}

function readLink(url: string) {
  const link = readReferenceLink(url);
  if (!link) throw new BadRequestException(["url must be a web address"]);
  return link;
}

function present(row: Row, viewer: Viewer, canEditSong: boolean): SongLink {
  const mine = row.addedByUserId === viewer.id;
  return {
    id: row.id,
    songVersionId: row.songVersionId,
    url: row.url,
    service: row.service,
    value: row.value,
    label: row.label,
    startSeconds: row.startSeconds,
    visibility: row.visibility,
    visibleToTeamId: row.visibleToTeamId,
    addedBy: row.addedBy,
    mine,
    canChange: mine || canEditSong || viewer.isGlobalAdmin,
    createdAt: row.createdAt.toISOString(),
  };
}
