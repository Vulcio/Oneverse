import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { SCREEN_PART_KINDS, SCREEN_PART_REQUEST_SCHEMAS, ScreenTemplateSchema, applyScreenTweaks, readScreenBackgroundTheme, readScreenContentTheme, readScreenEffects, readScreenTemplate, screenBuiltInPart, screenPartKept, splitScreenTheme, type CreateScreenThemeRequest, type ScreenPartKind, type ScreenPartRef, type UpdateScreenThemeRequest } from "@oneverse/core";
import type { Request, Response } from "express";
import type { Prisma } from "@oneverse/db";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { redis } from "../jobs/redis.js";
import { sendFile } from "../files/send-file.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { isValidScreenThemeAssetSignature } from "./screen-theme-assets.js";
import { isWholeTheme, templateLayout, templateLook, templatePart, templateParts, TEMPLATE_PARTS_SELECT } from "./screen-templates.js";
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
    await this.assertTweaks(data.template?.tweaks, parts);
    const theme = await this.prisma.client.screenTheme.create({
      data: { name: data.name, document: await this.kept(ScreenTemplateSchema.parse(data.template ?? {}), parts), ...owner, ...parts },
      select: THEME_SELECT,
    });
    return present(theme, true);
  }

  /** Changed: the screens showing it change at once. */
  async update(user: AuthenticatedUser, themeId: string, data: UpdateScreenThemeRequest) {
    const current = await this.changeable(user, themeId);
    if (isWholeTheme(current.document)) await this.split(themeId);
    const parts = await this.partColumns(user, current.ownerTeamId, { content: data.content, background: data.background, effects: data.effects });
    const before = isWholeTheme(current.document) ? await this.changeable(user, themeId) : current;
    const refs = { ...partRefs(before), ...parts };
    if (data.template?.tweaks) await this.assertTweaks(data.template.tweaks, refs);
    // Its document again when it or a part changes: a part picked without the template's own document starts as the part is.
    let document: Prisma.InputJsonValue | undefined;
    if (data.template !== undefined) document = await this.kept(ScreenTemplateSchema.parse(data.template), refs);
    else if (Object.keys(parts).length > 0) {
      const layout = readScreenTemplate(before.document);
      for (const kind of SCREEN_PART_KINDS) {
        if (!(`${kind}PartId` in parts)) continue;
        delete layout.look[kind];
        delete layout.tweaks[kind];
      }
      document = await this.kept(layout, refs);
    }
    const theme = await this.prisma.client.screenTheme.update({
      where: { id: themeId },
      data: { ...(data.name != null && { name: data.name }), ...(document !== undefined && { document }), ...parts },
      select: THEME_SELECT,
    });
    await this.announce(themeId);
    return present(theme, true);
  }

  /** Deleted: its screens go back to the default look. Its parts stay, for other templates. */
  async remove(user: AuthenticatedUser, themeId: string): Promise<void> {
    await this.changeable(user, themeId);
    const screens = await this.prisma.client.screen.findMany({ where: { OR: [{ themeId }, { scriptureThemeId: themeId }] }, select: { id: true } });
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

  /**
   * A template's document as it's kept (issue #428): each of its parts as it
   * is now, with the template's tweaks, unless the template came with its
   * own - so its screens draw the same whatever happens to the parts later.
   */
  private async kept(layout: ReturnType<typeof readScreenTemplate>, refs: Record<string, string | null>): Promise<Prisma.InputJsonValue> {
    const look = { ...layout.look };
    for (const kind of SCREEN_PART_KINDS) {
      const part = await this.partNow(kind, refs);
      if (!part) delete look[kind];
      else if (!look[kind]) Object.assign(look, { [kind]: screenPartKept(kind, part, layout.tweaks[kind]) });
    }
    return { ...layout, look } as Prisma.InputJsonValue;
  }

  /** A template's part as it is now: its saved one, else its built-in one (the classic; no effects). */
  private async partNow(kind: ScreenPartKind, refs: Record<string, string | null>): Promise<unknown> {
    const partId = refs[`${kind}PartId`];
    const saved = partId ? (await this.prisma.client.screenPart.findUnique({ where: { id: partId }, select: { document: true } }))?.document : undefined;
    return saved ?? screenBuiltInPart(kind as "content", refs[`${kind}BuiltIn`] ?? (kind === "effects" ? null : "classic")) ?? null;
  }

  /**
   * A template's tweaks (issue #428), checked against the parts they're over:
   * each part with its tweaks must still be one the API would take.
   */
  private async assertTweaks(tweaks: Partial<Record<ScreenPartKind, Record<string, unknown>>> | undefined, refs: Record<string, string | null>) {
    for (const kind of SCREEN_PART_KINDS) {
      const tweak = tweaks?.[kind];
      if (!tweak || Object.keys(tweak).length === 0) continue;
      const part = await this.partNow(kind, refs);
      // No effects: nothing to tweak, and nothing drawn from them.
      if (!part) continue;
      const read = kind === "content" ? readScreenContentTheme(part) : kind === "background" ? readScreenBackgroundTheme(part) : readScreenEffects(part);
      const checked = SCREEN_PART_REQUEST_SCHEMAS[kind].safeParse(applyScreenTweaks(read, tweak));
      if (!checked.success) throw new BadRequestException([`template.tweaks.${kind} doesn't fit its ${kind === "effects" ? "effects" : `${kind} theme`}: ${checked.error.issues[0]?.path.join(".") ?? ""} ${checked.error.issues[0]?.message ?? ""}`.trim()]);
    }
  }

/** A theme the user may put on a screen: theirs or one of their teams'. */
  async assertCanUse(user: AuthenticatedUser, themeId: string) {
    const theme = await this.prisma.client.screenTheme.findUnique({ where: { id: themeId }, select: { ownerUserId: true, ownerTeamId: true } });
    if (theme && (theme.ownerUserId === user.id || (theme.ownerTeamId && (await this.member(user.id, theme.ownerTeamId))))) return;
    throw new NotFoundException("Screen theme not found");
  }

  private async announce(themeId: string) {
    const screens = await this.prisma.client.screen.findMany({ where: { OR: [{ themeId }, { scriptureThemeId: themeId }] }, select: { id: true } });
    for (const screen of screens) await redis().publish(SCREEN_CHANNEL, screen.id);
  }

  private async changeable(user: AuthenticatedUser, themeId: string) {
    const theme = await this.prisma.client.screenTheme.findUnique({ where: { id: themeId }, select: { ownerUserId: true, ownerTeamId: true, document: true, contentPartId: true, contentBuiltIn: true, backgroundPartId: true, backgroundBuiltIn: true, effectsPartId: true, effectsBuiltIn: true } });
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

/** A template's parts as its columns have them. */
function partRefs(row: { contentPartId: string | null; contentBuiltIn: string | null; backgroundPartId: string | null; backgroundBuiltIn: string | null; effectsPartId: string | null; effectsBuiltIn: string | null }): Record<string, string | null> {
  return { contentPartId: row.contentPartId, contentBuiltIn: row.contentBuiltIn, backgroundPartId: row.backgroundPartId, backgroundBuiltIn: row.backgroundBuiltIn, effectsPartId: row.effectsPartId, effectsBuiltIn: row.effectsBuiltIn };
}

function present(theme: ThemeRow, canEdit: boolean) {
  const { theme: look, assets } = templateLook(theme);
  const layout = templateLayout(theme);
  // Behind its parts (issue #428): one changed since it was saved, that the template set nothing of its own on.
  const updates = SCREEN_PART_KINDS.filter((kind) => {
    const kept = layout.look[kind];
    const part = templatePart(kind, theme);
    return !!kept && !!part && Object.keys(layout.tweaks[kind] ?? {}).length === 0 && JSON.stringify(kept) !== JSON.stringify(screenPartKept(kind, part));
  });
  return {
    id: theme.id,
    name: theme.name,
    theme: look,
    template: layout,
    updates,
    parts: templateParts(theme),
    ownerUserId: theme.ownerUserId,
    ownerTeamId: theme.ownerTeamId,
    teamName: theme.team?.name ?? null,
    canEdit,
    assets,
    updatedAt: theme.updatedAt.toISOString(),
  };
}
