import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import { readIsf, readScreenBackgroundTheme, readScreenContentTheme, readScreenEffects, SCREEN_PART_REQUEST_SCHEMAS, type CreateScreenPartRequest, type ScreenPartKind, type ScreenThemeAssetKind, type UpdateScreenPartRequest } from "@songverse/core";
import type { Prisma } from "@songverse/db";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { redis } from "../jobs/redis.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageQuotaService } from "../storage/storage-quota.service.js";
import { StorageService } from "../storage/storage.service.js";
import { presentScreenThemeAssets, screenThemeAssetType } from "./screen-theme-assets.js";
import { ASSET_SELECT } from "./screen-templates.js";
import { SCREEN_CHANNEL } from "./screen-channel.js";

const PART_SELECT = {
  id: true,
  kind: true,
  name: true,
  document: true,
  ownerUserId: true,
  ownerTeamId: true,
  updatedAt: true,
  team: { select: { name: true } },
  assets: { select: ASSET_SELECT, orderBy: { createdAt: "asc" } },
  _count: { select: { contentTemplates: true, backgroundTemplates: true, effectsTemplates: true } },
} as const;
type PartRow = Prisma.ScreenPartGetPayload<{ select: typeof PART_SELECT }>;

/** Each kind's files: a content theme's fonts, a background theme's pictures, videos and shaders; effects have none. */
const ASSET_KINDS: Record<ScreenPartKind, ScreenThemeAssetKind[]> = { content: ["font"], background: ["media", "shader"], effects: [] };

/**
 * Templates' parts (issue #281): content themes, background themes and
 * effects, saved on their own - a person's own, or a team's (its admins
 * change them, its members use them in their templates). A change reaches
 * every template using the part, and their screens.
 */
@Injectable()
export class ScreenPartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
  ) {}

  /** Theirs and their teams', of a kind or all. */
  async list(user: AuthenticatedUser, kind?: ScreenPartKind) {
    const memberships = await this.prisma.client.teamMembership.findMany({ where: { userId: user.id }, select: { teamId: true, role: true } });
    const parts = await this.prisma.client.screenPart.findMany({
      where: { ...(kind && { kind }), OR: [{ ownerUserId: user.id }, { ownerTeamId: { in: memberships.map((one) => one.teamId) } }] },
      select: PART_SELECT,
      orderBy: [{ name: "asc" }],
    });
    const admin = new Set(memberships.filter((one) => one.role === "ADMIN").map((one) => one.teamId));
    return parts.map((part) => present(part, part.ownerUserId === user.id || (!!part.ownerTeamId && admin.has(part.ownerTeamId))));
  }

  async create(user: AuthenticatedUser, data: CreateScreenPartRequest) {
    if (data.teamId && (await this.member(user.id, data.teamId)) !== "ADMIN") throw new ForbiddenException("Only the team's admins add screen parts for it");
    const part = await this.prisma.client.screenPart.create({
      data: { kind: data.kind, name: data.name, document: documentOf(data.kind, data.document), ...(data.teamId ? { ownerTeamId: data.teamId } : { ownerUserId: user.id }) },
      select: PART_SELECT,
    });
    return present(part, true);
  }

  /** Changed: every template using it changes, and their screens at once. */
  async update(user: AuthenticatedUser, partId: string, data: UpdateScreenPartRequest) {
    const current = await this.changeable(user, partId);
    const part = await this.prisma.client.screenPart.update({
      where: { id: partId },
      data: { ...(data.name != null && { name: data.name }), ...(data.document != null && { document: documentOf(current.kind as ScreenPartKind, data.document) }) },
      select: PART_SELECT,
    });
    await this.announce(partId);
    return present(part, true);
  }

  /** Deleted, unless a template still uses it: change those first. */
  async remove(user: AuthenticatedUser, partId: string): Promise<void> {
    await this.changeable(user, partId);
    const templates = await this.prisma.client.screenTheme.count({ where: { OR: [{ contentPartId: partId }, { backgroundPartId: partId }, { effectsPartId: partId }] } });
    if (templates > 0) throw new ConflictException(`This part is used by ${templates} template(s): give them another one first`);
    const assets = await this.prisma.client.screenThemeAsset.findMany({ where: { partId }, select: { storageKey: true } });
    await this.prisma.client.screenPart.delete({ where: { id: partId } });
    await this.storage.deleteUnreferenced(assets.map((asset) => asset.storageKey));
  }

  /**
   * A part's own file: a content theme's font, a background theme's picture,
   * looping video or ISF shader. Counts against the uploader's storage; the part's
   * document then refers to it by id (text.customFont, background.media, background.shader.asset).
   */
  async addAsset(user: AuthenticatedUser, partId: string, kind: ScreenThemeAssetKind, file: { buffer: Buffer; mimetype: string; originalname: string; size: number }) {
    const part = await this.changeable(user, partId);
    if (!ASSET_KINDS[part.kind as ScreenPartKind].includes(kind)) throw new BadRequestException(part.kind === "content" ? "A content theme takes fonts" : part.kind === "background" ? "A background theme takes pictures, videos and shaders" : "Effects take no files");
    const type = screenThemeAssetType(kind, file.mimetype, file.originalname);
    if (!type) throw new BadRequestException(kind === "font" ? "A font is a WOFF2, WOFF, TTF or OTF file" : kind === "shader" ? "A shader is an ISF file (.fs, .frag, .glsl or .isf)" : "A picture (JPEG, PNG, WebP, AVIF, GIF) or a video (MP4, WebM)");
    if (file.size > type.limit) throw new PayloadTooLargeException(type.limit < 1024 * 1024 ? `This file is over ${Math.round(type.limit / 1024)} KB` : `This file is over ${Math.round(type.limit / 1024 / 1024)} MB`);
    if (kind === "shader") {
      // Checked as every screen will read it: a shader without a usable ISF header isn't kept.
      const shader = readIsf(file.buffer.toString("utf8"));
      if ("error" in shader) throw new BadRequestException(shader.error);
    }
    await this.quota.assertCanStore(user.id, file.size);
    const stored = await this.storage.put(file.buffer, type.mimeType);
    const asset = await this.prisma.client.screenThemeAsset.create({
      data: { partId, kind, storageKey: stored.hash, mimeType: type.mimeType, filename: file.originalname.slice(0, 200), sizeBytes: stored.sizeBytes },
      select: ASSET_SELECT,
    });
    return presentScreenThemeAssets([asset])[0]!;
  }

  /** Removed: a part still pointing at it shows its colours (or the built-in font) instead. */
  async removeAsset(user: AuthenticatedUser, partId: string, assetId: string): Promise<void> {
    await this.changeable(user, partId);
    const asset = await this.prisma.client.screenThemeAsset.findFirst({ where: { id: assetId, partId }, select: { storageKey: true } });
    if (!asset) throw new NotFoundException("File not found");
    await this.prisma.client.screenThemeAsset.delete({ where: { id: assetId } });
    await this.storage.deleteUnreferenced([asset.storageKey]);
    await this.announce(partId);
  }

  /** The screens showing a template that uses it: told to load their look again. */
  private async announce(partId: string) {
    const screens = await this.prisma.client.screen.findMany({
      where: { theme: { OR: [{ contentPartId: partId }, { backgroundPartId: partId }, { effectsPartId: partId }] } },
      select: { id: true },
    });
    for (const screen of screens) await redis().publish(SCREEN_CHANNEL, screen.id);
  }

  private async changeable(user: AuthenticatedUser, partId: string) {
    const part = await this.prisma.client.screenPart.findUnique({ where: { id: partId }, select: { kind: true, ownerUserId: true, ownerTeamId: true } });
    if (!part) throw new NotFoundException("Screen part not found");
    if (part.ownerUserId === user.id || user.isGlobalAdmin) return part;
    const role = part.ownerTeamId ? await this.member(user.id, part.ownerTeamId) : null;
    if (role === "ADMIN") return part;
    if (role) throw new ForbiddenException("Only the team's admins change its screen parts");
    throw new NotFoundException("Screen part not found");
  }

  private async member(userId: string, teamId: string): Promise<"ADMIN" | "MEMBER" | null> {
    const membership = await this.prisma.client.teamMembership.findFirst({ where: { userId, teamId }, select: { role: true } });
    return membership?.role ?? null;
  }
}

/** A part's document, checked against its kind (the request only knew it was one of the three). */
function documentOf(kind: ScreenPartKind, document: unknown): Prisma.InputJsonValue {
  const checked = SCREEN_PART_REQUEST_SCHEMAS[kind].safeParse(document);
  if (!checked.success) throw new BadRequestException([`document is not a ${kind === "effects" ? "screen-effects" : `screen-${kind}`}/v1 document: ${checked.error.issues[0]?.message ?? ""}`]);
  return checked.data as Prisma.InputJsonValue;
}

function present(part: PartRow, canEdit: boolean) {
  const kind = part.kind as ScreenPartKind;
  return {
    id: part.id,
    kind,
    name: part.name,
    document: kind === "content" ? readScreenContentTheme(part.document) : kind === "background" ? readScreenBackgroundTheme(part.document) : readScreenEffects(part.document),
    ownerUserId: part.ownerUserId,
    ownerTeamId: part.ownerTeamId,
    teamName: part.team?.name ?? null,
    canEdit,
    templates: part._count.contentTemplates + part._count.backgroundTemplates + part._count.effectsTemplates,
    assets: presentScreenThemeAssets(part.assets),
    updatedAt: part.updatedAt.toISOString(),
  };
}
