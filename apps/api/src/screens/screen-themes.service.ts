import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { SCREEN_PART_KINDS, ScreenTemplateSchema, screenBuiltInPart, splitScreenTheme, type CreateScreenThemeRequest, type ScreenPartKind, type ScreenPartRef, type UpdateScreenThemeRequest } from "@songverse/core";
import type { Request, Response } from "express";
import type { Prisma } from "@songverse/db";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { redis } from "../jobs/redis.js";
import { sendFile } from "../files/send-file.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { isValidScreenThemeAssetSignature } from "./screen-theme-assets.js";
import { isWholeTheme, templateLayout, templateLook, templateParts, TEMPLATE_PARTS_SELECT } from "./screen-templates.js";
import { SCREEN_CHANNEL } from "./screen-channel.js";

const THEME_SELECT = {
  id: true,
  name: true,
  ownerUserId: true,
  ownerTeamId: true,
  updatedAt: true,
  team: { select: { name: true } },
  ...TEMPLATE_PARTS_SELECT,
} as const;
type ThemeRow = Prisma.ScreenThemeGetPayload<{ select: typeof THEME_SELECT }>;

/**
 * Screen templates (issues #194, #281): a person's own, or a team's - its
 * admins change it, its members pick it for their screens. A template is
 * its tags and layout and its parts - a content theme, a background theme
 * and effects, each a saved part or a built-in one. One made before parts
 * is split into parts of its own the first time it's listed.
 */
@Injectable()
export class ScreenThemesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Theirs and their teams'. */
  async list(user: AuthenticatedUser) {
    const memberships = await this.prisma.client.teamMembership.findMany({ where: { userId: user.id }, select: { teamId: true, role: true } });
    const where = { OR: [{ ownerUserId: user.id }, { ownerTeamId: { in: memberships.map((one) => one.teamId) } }] };
    let themes = await this.prisma.client.screenTheme.findMany({ where, select: THEME_SELECT, orderBy: [{ name: "asc" }] });
    if (themes.some((theme) => isWholeTheme(theme.document))) {
      for (const theme of themes.filter((one) => isWholeTheme(one.document))) await this.split(theme.id);
      themes = await this.prisma.client.screenTheme.findMany({ where, select: THEME_SELECT, orderBy: [{ name: "asc" }] });
    }
    const admin = new Set(memberships.filter((one) => one.role === "ADMIN").map((one) => one.teamId));
    return themes.map((theme) => present(theme, theme.ownerUserId === user.id || (!!theme.ownerTeamId && admin.has(theme.ownerTeamId))));
  }

  /** A template: its parts (left out, the built-in classic's), or a whole look split into parts of its own. */
  async create(user: AuthenticatedUser, data: CreateScreenThemeRequest) {
    if (data.teamId) await this.assertTeamAdmin(user, data.teamId);
    const owner = data.teamId ? { ownerTeamId: data.teamId } : { ownerUserId: user.id };
    if (data.theme) {
      const created = await this.prisma.client.screenTheme.create({ data: { name: data.name, document: data.theme as Prisma.InputJsonValue, ...owner }, select: { id: true } });
      await this.split(created.id);
      return present(await this.prisma.client.screenTheme.findUniqueOrThrow({ where: { id: created.id }, select: THEME_SELECT }), true);
    }
    const parts = await this.partColumns(user, data.teamId ?? null, { content: data.content ?? { builtIn: "classic" }, background: data.background ?? { builtIn: "classic" }, effects: data.effects ?? null });
    const theme = await this.prisma.client.screenTheme.create({
      data: { name: data.name, document: ScreenTemplateSchema.parse(data.template ?? {}) as Prisma.InputJsonValue, ...owner, ...parts },
      select: THEME_SELECT,
    });
    return present(theme, true);
  }

  /** Changed: the screens showing it change at once. */
  async update(user: AuthenticatedUser, themeId: string, data: UpdateScreenThemeRequest) {
    const current = await this.changeable(user, themeId);
    if (isWholeTheme(current.document)) await this.split(themeId);
    const parts = await this.partColumns(user, current.ownerTeamId, { content: data.content, background: data.background, effects: data.effects });
    const theme = await this.prisma.client.screenTheme.update({
      where: { id: themeId },
      data: { ...(data.name != null && { name: data.name }), ...(data.template !== undefined && { document: ScreenTemplateSchema.parse(data.template) as Prisma.InputJsonValue }), ...parts },
      select: THEME_SELECT,
    });
    await this.announce(themeId);
    return present(theme, true);
  }

  /** Deleted: its screens go back to the default look. Its parts stay, for other templates. */
  async remove(user: AuthenticatedUser, themeId: string): Promise<void> {
    await this.changeable(user, themeId);
    const screens = await this.prisma.client.screen.findMany({ where: { themeId }, select: { id: true } });
    const assets = await this.prisma.client.screenThemeAsset.findMany({ where: { themeId }, select: { storageKey: true } });
    await this.prisma.client.screenTheme.delete({ where: { id: themeId } });
    await this.storage.deleteUnreferenced(assets.map((asset) => asset.storageKey));
    for (const screen of screens) await redis().publish(SCREEN_CHANNEL, screen.id);
  }

  /** A template's or a part's file at its signed address: for a screen, which has no session. */
  async sendAsset(assetId: string, expires: string | undefined, signature: string | undefined, req: Request, res: Response): Promise<void> {
    const asset = await this.prisma.client.screenThemeAsset.findUnique({ where: { id: assetId }, select: { storageKey: true, mimeType: true, filename: true, sizeBytes: true } });
    if (!asset || !isValidScreenThemeAssetSignature(assetId, asset.storageKey, expires, signature)) throw new ForbiddenException("This address has expired");
    await sendFile(this.storage, asset, req, res, "inline");
  }

  /**
   * A template made before parts (issue #281), split: its words, background
   * and effects become parts of its own, named after it, with its fonts and
   * pictures; it keeps its layout. It looks the same.
   */
  private async split(themeId: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const theme = await tx.screenTheme.findUnique({ where: { id: themeId }, select: { name: true, document: true, ownerUserId: true, ownerTeamId: true } });
      if (!theme || !isWholeTheme(theme.document)) return;
      const parts = splitScreenTheme(theme.document);
      const owner = { ownerUserId: theme.ownerUserId, ownerTeamId: theme.ownerTeamId };
      const make = (kind: ScreenPartKind, document: unknown) => tx.screenPart.create({ data: { kind, name: theme.name, document: document as Prisma.InputJsonValue, ...owner }, select: { id: true } });
      const content = await make("content", parts.content);
      const background = await make("background", parts.background);
      const effects = parts.effects ? await make("effects", parts.effects) : null;
      await tx.screenThemeAsset.updateMany({ where: { themeId, kind: "font" }, data: { themeId: null, partId: content.id } });
      await tx.screenThemeAsset.updateMany({ where: { themeId, kind: "media" }, data: { themeId: null, partId: background.id } });
      await tx.screenTheme.update({
        where: { id: themeId },
        data: { document: parts.template as Prisma.InputJsonValue, contentPartId: content.id, backgroundPartId: background.id, effectsPartId: effects?.id ?? null, contentBuiltIn: null, backgroundBuiltIn: null, effectsBuiltIn: null },
      });
    });
  }

  /**
   * A template's parts as columns: a built-in one by id, or a saved one the
   * template's owner may use - a team's template, the team's parts; a
   * person's, theirs and their teams'. Left out: unchanged.
   */
  private async partColumns(user: AuthenticatedUser, teamId: string | null, refs: { content?: ScreenPartRef | null; background?: ScreenPartRef | null; effects?: ScreenPartRef | null }) {
    const columns: Record<string, string | null> = {};
    for (const kind of SCREEN_PART_KINDS) {
      const ref = refs[kind];
      if (ref === undefined) continue;
      if (ref === null) {
        if (kind !== "effects") continue;
        Object.assign(columns, { [`${kind}PartId`]: null, [`${kind}BuiltIn`]: null });
        continue;
      }
      if ("builtIn" in ref) {
        if (!screenBuiltInPart(kind as "content", ref.builtIn)) throw new BadRequestException([`${kind}.builtIn must name a built-in ${kind === "effects" ? "effect" : `${kind} theme`}`]);
        Object.assign(columns, { [`${kind}PartId`]: null, [`${kind}BuiltIn`]: ref.builtIn });
        continue;
      }
      const part = await this.prisma.client.screenPart.findUnique({ where: { id: ref.id }, select: { kind: true, ownerUserId: true, ownerTeamId: true } });
      const usable = !!part && part.kind === kind && (teamId ? part.ownerTeamId === teamId : part.ownerUserId === user.id || (!!part.ownerTeamId && !!(await this.member(user.id, part.ownerTeamId))));
      if (!usable) throw new NotFoundException(`${kind} part not found`);
      Object.assign(columns, { [`${kind}PartId`]: ref.id, [`${kind}BuiltIn`]: null });
    }
    return columns;
  }

/** A theme the user may put on a screen: theirs or one of their teams'. */
  async assertCanUse(user: AuthenticatedUser, themeId: string) {
    const theme = await this.prisma.client.screenTheme.findUnique({ where: { id: themeId }, select: { ownerUserId: true, ownerTeamId: true } });
    if (theme && (theme.ownerUserId === user.id || (theme.ownerTeamId && (await this.member(user.id, theme.ownerTeamId))))) return;
    throw new NotFoundException("Screen theme not found");
  }

  private async announce(themeId: string) {
    const screens = await this.prisma.client.screen.findMany({ where: { themeId }, select: { id: true } });
    for (const screen of screens) await redis().publish(SCREEN_CHANNEL, screen.id);
  }

  private async changeable(user: AuthenticatedUser, themeId: string) {
    const theme = await this.prisma.client.screenTheme.findUnique({ where: { id: themeId }, select: { ownerUserId: true, ownerTeamId: true, document: true } });
    if (!theme) throw new NotFoundException("Screen theme not found");
    if (theme.ownerUserId === user.id || user.isGlobalAdmin) return theme;
    if (theme.ownerTeamId && (await this.member(user.id, theme.ownerTeamId)) === "ADMIN") return theme;
    // A team's members see it, but only its admins change it.
    if (theme.ownerTeamId && (await this.member(user.id, theme.ownerTeamId))) throw new ForbiddenException("Only the team's admins change its screen themes");
    throw new NotFoundException("Screen theme not found");
  }

  private async assertTeamAdmin(user: AuthenticatedUser, teamId: string) {
    if ((await this.member(user.id, teamId)) !== "ADMIN") throw new ForbiddenException("Only the team's admins add screen themes for it");
  }

  private async member(userId: string, teamId: string): Promise<"ADMIN" | "MEMBER" | null> {
    const membership = await this.prisma.client.teamMembership.findFirst({ where: { userId, teamId }, select: { role: true } });
    return membership?.role ?? null;
  }
}

function present(theme: ThemeRow, canEdit: boolean) {
  const { theme: look, assets } = templateLook(theme);
  return {
    id: theme.id,
    name: theme.name,
    theme: look,
    template: templateLayout(theme),
    parts: templateParts(theme),
    ownerUserId: theme.ownerUserId,
    ownerTeamId: theme.ownerTeamId,
    teamName: theme.team?.name ?? null,
    canEdit,
    assets,
    updatedAt: theme.updatedAt.toISOString(),
  };
}
