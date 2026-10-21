import { BadRequestException, ForbiddenException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { orderScreenSets, pickDaySet, SCREEN_CODE_ALPHABET, SCREEN_CODE_LENGTH, SCREEN_SWITCHABLE_LAYERS, composeBuiltInTemplate, normalizeScreenCode, type ScreenTheme, type SetItemPassage, readScreenReport, screenTier, type ScreenMode, type ScreenReport, type ScreenTier, type ScreenOwnerRequest } from "@oneverse/core";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { redis } from "../jobs/redis.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { capabilitiesOf } from "../roles/capabilities.js";
import { SetlistAccessService } from "../setlists/setlist-access.service.js";
import { SetlistsService } from "../setlists/setlists.service.js";

/** How long a pairing code waits to be confirmed. */
export const PAIRING_TTL_S = 10 * 60;
import { SCREEN_CHANNEL, screenOnlineKey, screenReportKey } from "./screen-channel.js";
import { templateLayout, templateLook, TEMPLATE_PARTS_SELECT, type TemplateParts } from "./screen-templates.js";
import { ScreenThemesService } from "./screen-themes.service.js";

export { SCREEN_CHANNEL };
const codeKey = (code: string) => `songverse:screen:code:${code}`;
const pairingKey = (id: string) => `songverse:screen:pairing:${id}`;

interface Pairing {
  code: string;
  secretHash: string;
  /** Set once someone's confirmed it, until the screen claims it. */
  token?: string;
  screenId?: string;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

const SCREEN_SELECT = {
  id: true,
  name: true,
  mode: true,
  setlistId: true,
  themeId: true,
  themeTemplate: true,
  hiddenLayers: true,
  effects: true,
  ownerUserId: true,
  ownerTeamId: true,
  ownerOrganizationId: true,
  setByUserId: true,
  setMode: true,
  setlistPickedOn: true,
  owner: { select: { displayName: true } },
  ownerTeam: { select: { name: true } },
  ownerOrganization: { select: { name: true } },
  lastSeenAt: true,
  createdAt: true,
  setlist: { select: { id: true, name: true, eventDate: true, eventDateOf: { select: { id: true } } } },
} as const;

/**
 * A screen's look (issues #194, #281), worked out: its template, else its
 * built-in one, else the default - its effects on or off - and the files
 * its parts refer to. A screen paired to show the chart before templates
 * were built for one use (mode CHART) keeps showing it.
 */
function screenLook(screen: { themeTemplate: string | null; mode: ScreenMode; effects: boolean; theme: TemplateParts | null }) {
  const options = { effects: screen.effects };
  const look = screen.theme ? templateLook(screen.theme, options) : { theme: composeBuiltInTemplate(screen.themeTemplate, options) ?? composeBuiltInTemplate("classic", options)!, assets: [] };
  return screen.mode === "CHART" ? { ...look, theme: { ...look.theme, shows: "chart" as const } } : look;
}

/**
 * A screen's template as asked for: one or the other (picking one clears
 * the other); left out, as it was. A template picked is built for its use:
 * the screen shows what it shows, not the chart it was paired to show.
 */
function lookChange(change: { themeId?: string | null; themeTemplate?: string | null; mode?: ScreenMode }) {
  const picked = change.themeId !== undefined || change.themeTemplate !== undefined;
  const mode = change.mode === undefined && picked ? { mode: "LYRICS" as const } : {};
  if (change.themeId) return { themeId: change.themeId, themeTemplate: null, ...mode };
  if (change.themeTemplate) return { themeId: null, themeTemplate: change.themeTemplate, ...mode };
  return { ...(change.themeId === null && { themeId: null }), ...(change.themeTemplate === null && { themeTemplate: null }), ...mode };
}

/**
 * Screens (issue #186). A screen asks for a pairing code (no sign-in); someone
 * who leads a set confirms it from their phone, choosing the set and what's
 * shown; the screen, asking meanwhile, gets its own token: it reads that set
 * as the person who paired it would, and joins its sync session to follow
 * what's presented. Only a hash of the token is kept.
 */
@Injectable()
export class ScreensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SetlistAccessService,
    private readonly setlists: SetlistsService,
    private readonly themes: ScreenThemesService,
  ) {}

  /** A new code for a screen to show, and the secret it claims its token with. */
  async startPairing(): Promise<{ pairingId: string; code: string; secret: string; expiresAt: string }> {
    const pairingId = randomUUID();
    const secret = randomBytes(24).toString("base64url");
    for (let tries = 0; tries < 10; tries++) {
      const code = Array.from({ length: SCREEN_CODE_LENGTH }, () => SCREEN_CODE_ALPHABET[randomInt(SCREEN_CODE_ALPHABET.length)]).join("");
      // A code is someone else's until it expires.
      const taken = await redis().set(codeKey(code), pairingId, "EX", PAIRING_TTL_S, "NX");
      if (!taken) continue;
      const pairing: Pairing = { code, secretHash: hash(secret) };
      await redis().set(pairingKey(pairingId), JSON.stringify(pairing), "EX", PAIRING_TTL_S);
      return { pairingId, code, secret, expiresAt: new Date(Date.now() + PAIRING_TTL_S * 1000).toISOString() };
    }
    throw new Error("No pairing code free");
  }

  /** A code waiting to be confirmed, for the phone's page; 404 when it isn't (mistyped, expired, used). */
  async checkCode(input: string): Promise<{ code: string; expiresAt: string }> {
    const { code } = await this.waiting(input);
    const ttl = await redis().ttl(codeKey(code));
    return { code, expiresAt: new Date(Date.now() + Math.max(0, ttl) * 1000).toISOString() };
  }

  /**
   * Confirmed by someone who leads `setlistId`: the screen's made - theirs,
   * or (issue #222) a team's or an organisation's they run - its token
   * waiting for it to claim.
   */
  async confirm(user: AuthenticatedUser, input: string, change: { owner?: ScreenOwnerRequest; name: string; mode?: ScreenMode; setMode?: "FIXED" | "DAY"; setlistId?: string; themeId?: string | null; themeTemplate?: string | null }) {
    const { code, pairingId, pairing } = await this.waiting(input);
    if (change.setlistId) await this.assertCanPresent(user, change.setlistId);
    if (change.themeId) await this.themes.assertCanUse(user, change.themeId);
    const owner = await this.ownerFor(user, change.owner);
    const token = `scr_${randomBytes(32).toString("base64url")}`;
    const screen = await this.prisma.client.screen.create({
      data: { name: change.name, mode: change.mode ?? "LYRICS", setMode: change.setMode ?? "FIXED", setlistId: change.setlistId ?? null, setByUserId: user.id, ...owner, tokenHash: hash(token), ...lookChange(change) },
      select: SCREEN_SELECT,
    });
    const ttl = Math.max(30, await redis().ttl(pairingKey(pairingId)));
    await redis().set(pairingKey(pairingId), JSON.stringify({ ...pairing, token, screenId: screen.id } satisfies Pairing), "EX", ttl);
    // The code's done with: nobody else confirms it.
    await redis().del(codeKey(code));
    return present(screen, true);
  }

  /** The screen asking for its token: null until it's confirmed; 410 once it expired (or was claimed). */
  async claim(pairingId: string, secret: string): Promise<{ token: string; screen: ReturnType<typeof present> } | null> {
    const raw = typeof pairingId === "string" && pairingId.length <= 64 ? await redis().get(pairingKey(pairingId)) : null;
    if (!raw) throw new GoneException("This code has expired: show a new one");
    const pairing = JSON.parse(raw) as Pairing;
    const given = Buffer.from(hash(String(secret)));
    if (!timingSafeEqual(given, Buffer.from(pairing.secretHash))) throw new ForbiddenException("Not this screen's code");
    if (!pairing.token || !pairing.screenId) return null;
    await redis().del(pairingKey(pairingId));
    const screen = await this.prisma.client.screen.findUnique({ where: { id: pairing.screenId }, select: SCREEN_SELECT });
    if (!screen) throw new GoneException("This screen was disconnected");
    return { token: pairing.token, screen: present(screen) };
  }

  /** The screen a token signs in, or null. */
  async byToken(token: string) {
    if (typeof token !== "string" || !token.startsWith("scr_") || token.length > 100) return null;
    return this.prisma.client.screen.findUnique({ where: { tokenHash: hash(token) }, select: SCREEN_SELECT });
  }

  /** What a screen shows: itself, and its set as the person who paired it reads it (null without one, or when they no longer can). */
  async current(token: string, day: { today?: string; time?: string } = {}) {
    let screen = await this.byToken(token);
    if (!screen) throw new NotFoundException("This screen was disconnected");
    // Its owner's set of the day (issue #274): worked out now, from the screen's own day and time.
    if (screen.setMode === "DAY" && day.today) screen = await this.followDay(screen, day.today, day.time ?? "12:00");
    const shown = await this.prisma.client.screen.update({
      where: { id: screen.id },
      data: { lastSeenAt: new Date() },
      select: { mode: true, effects: true, theme: { select: TEMPLATE_PARTS_SELECT } },
    });
    let set = null;
    if (screen.setlistId) {
      for (const reader of await this.readersFor(screen, screen.setlistId)) {
        try {
          const copy = await this.setlists.offlineCopy(reader, screen.setlistId, { withNotes: false, passages: "screen" });
          set = { ...copy, credits: await this.credits(copy.songs.flatMap((song) => (song.song ? [song.song.id] : []))) };
          break;
        } catch {
          // Not theirs to read: the next one; nobody, and the screen waits for another set.
        }
      }
    }
    // Its template's pictures, videos and fonts (issues #194, #281), at addresses a screen can load without a session.
    const look = screenLook({ themeTemplate: screen.themeTemplate, ...shown });
    // Its passages' own templates (issue #310), by item: what it shows while one of them is presented.
    const items = await this.itemLooks(set?.songs ?? [], { effects: shown.effects });
    const assets = [...look.assets, ...items.assets.filter((asset) => !look.assets.some((one) => one.id === asset.id))];
    return { screen: present(screen), theme: look.theme, assets, itemThemes: items.themes, set };
  }

  /** The looks of a set's items that have a template of their own (issue #310), and the files they refer to. */
  private async itemLooks(views: { item: { id: string }; passage: SetItemPassage | null }[], options: { effects: boolean }) {
    const themes: Record<string, ScreenTheme> = {};
    const assets: ReturnType<typeof templateLook>["assets"] = [];
    const saved = new Map<string, ReturnType<typeof templateLook> | null>();
    for (const view of views) {
      const template = view.passage?.template;
      if (template?.builtIn) {
        const theme = composeBuiltInTemplate(template.builtIn, options);
        if (theme) themes[view.item.id] = theme;
      } else if (template?.id) {
        if (!saved.has(template.id)) {
          const row = await this.prisma.client.screenTheme.findUnique({ where: { id: template.id }, select: TEMPLATE_PARTS_SELECT });
          const look = row ? templateLook(row, options) : null;
          saved.set(template.id, look);
          for (const asset of look?.assets ?? []) if (!assets.some((one) => one.id === asset.id)) assets.push(asset);
        }
        const look = saved.get(template.id);
        if (look) themes[view.item.id] = look.theme;
      }
    }
    return { themes, assets };
  }

  /**
   * The sets a screen offers to pick from (issue #274): its owner's -
   * upcoming by date, then undated, then past ones - with the one it shows.
   */
  async sets(token: string, today: string) {
    const screen = await this.byToken(token);
    if (!screen) throw new NotFoundException("This screen was disconnected");
    const { upcoming, undated, archive } = orderScreenSets(await this.ownerSets(screen), today);
    const strip = ({ startTime: _startTime, ...set }: Awaited<ReturnType<ScreensService["ownerSets"]>>[number]) => set;
    return {
      setMode: screen.setMode,
      setlistId: screen.setlistId,
      picked: screen.setlistPickedOn === today,
      upcoming: upcoming.slice(0, 60).map(strip),
      undated: undated.slice(0, 30).map(strip),
      archive: archive.slice(0, 60).map(strip),
    };
  }

  /** A set picked on the screen (issue #274): its owner's, for the rest of the day; null goes back to the day's own. */
  async pick(token: string, setlistId: string | null, today: string) {
    const screen = await this.byToken(token);
    if (!screen) throw new NotFoundException("This screen was disconnected");
    if (screen.setMode !== "DAY") throw new ForbiddenException("This screen shows the set put on it: change it from Screens");
    if (setlistId && !(await this.ownerSets(screen)).some((set) => set.id === setlistId)) throw new NotFoundException("Set not found");
    const updated = await this.prisma.client.screen.update({
      where: { id: screen.id },
      data: setlistId ? { setlistId, setlistPickedOn: today } : { setlistPickedOn: null },
      select: SCREEN_SELECT,
    });
    const followed = setlistId ? updated : await this.followDay(updated, today, new Date().toTimeString().slice(0, 5));
    await redis().publish(SCREEN_CHANNEL, screen.id);
    return present(followed);
  }

  /** The themes a screen offers (issue #276): its owner's saved ones - a person's, a team's, its organisation's teams' - and the one it has. */
  async themeOptions(token: string) {
    const screen = await this.byToken(token);
    if (!screen) throw new NotFoundException("This screen was disconnected");
    const themes = await this.ownerThemes(screen);
    return { themeId: screen.themeId, themeTemplate: screen.themeTemplate, themes: themes.map((one) => ({ id: one.id, name: one.name, teamName: one.team?.name ?? null, tags: templateLayout(one).tags })) };
  }

  /** A theme picked on the screen (issue #276): kept on it, as if set from Screens. */
  async pickTheme(token: string, pick: { themeId: string | null; themeTemplate: string | null }) {
    const screen = await this.byToken(token);
    if (!screen) throw new NotFoundException("This screen was disconnected");
    if (pick.themeId && !(await this.ownerThemes(screen)).some((one) => one.id === pick.themeId)) throw new NotFoundException("Theme not found");
    const updated = await this.prisma.client.screen.update({
      where: { id: screen.id },
      data: lookChange(pick.themeId ? { themeId: pick.themeId } : { themeId: null, themeTemplate: pick.themeTemplate }),
      select: SCREEN_SELECT,
    });
    await redis().publish(SCREEN_CHANNEL, screen.id);
    return present(updated);
  }

  private async ownerThemes(screen: { themeId: string | null } & Owned) {
    const owners = screen.ownerTeamId
      ? [{ ownerTeamId: screen.ownerTeamId }]
      : screen.ownerOrganizationId
        ? [{ team: { organizationId: screen.ownerOrganizationId } }]
        : [{ ownerUserId: screen.ownerUserId ?? "-" }];
    return this.prisma.client.screenTheme.findMany({
      where: { OR: [...owners, ...(screen.themeId ? [{ id: screen.themeId }] : [])] },
      select: { id: true, name: true, document: true, team: { select: { name: true } } },
      orderBy: { name: "asc" },
      take: 100,
    });
  }

  /** A screen on its owner's set of the day: picked on it today, else pickDaySet's; moved there (and told) when it changed. */
  private async followDay<T extends { id: string; setlistId: string | null; setlistPickedOn: string | null } & Owned>(screen: T, today: string, time: string): Promise<T> {
    if (screen.setlistPickedOn === today && screen.setlistId) return screen;
    const target = pickDaySet(await this.ownerSets(screen), today, time);
    if (target === screen.setlistId && !screen.setlistPickedOn) return screen;
    const updated = await this.prisma.client.screen.update({ where: { id: screen.id }, data: { setlistId: target, setlistPickedOn: null }, select: SCREEN_SELECT });
    if (target !== screen.setlistId) await redis().publish(SCREEN_CHANNEL, screen.id);
    return { ...screen, setlistId: updated.setlistId, setlistPickedOn: null, setlist: updated.setlist };
  }

  /** Its owner's sets (issue #274): a team's, its organisation's teams', its person's own - with their dates and start times. */
  private async ownerSets(screen: Owned) {
    const where = screen.ownerTeamId
      ? { ownerTeamId: screen.ownerTeamId }
      : screen.ownerOrganizationId
        ? { ownerTeam: { organizationId: screen.ownerOrganizationId } }
        : { ownerUserId: screen.ownerUserId ?? "-" };
    const sets = await this.prisma.client.setlist.findMany({
      where,
      select: { id: true, name: true, eventDate: true, ownerTeam: { select: { name: true } }, eventDateOf: { select: { startTime: true, event: { select: { startTime: true } } } } },
      orderBy: { eventDate: "desc" },
      take: 300,
    });
    return sets.map((set) => ({
      id: set.id,
      name: set.name,
      eventDate: set.eventDate ? set.eventDate.toISOString().slice(0, 10) : null,
      startTime: set.eventDateOf?.startTime ?? set.eventDateOf?.event.startTime ?? null,
      fromEvent: !!set.eventDateOf,
      teamName: set.ownerTeam?.name ?? null,
    }));
  }

  /**
   * Who a screen reads its set as: whoever put it on (issue #222), its
   * person, then the admins of the set's team and of the screen's team or
   * organisation - for a set of the day nobody put on it (issue #274).
   */
  private async readersFor(screen: { setByUserId: string | null } & Owned, setlistId: string): Promise<AuthenticatedUser[]> {
    const set = await this.prisma.client.setlist.findUnique({ where: { id: setlistId }, select: { ownerTeamId: true } });
    const teams = [set?.ownerTeamId, screen.ownerTeamId].filter((one): one is string => !!one);
    const [teamAdmins, organizationAdmins] = await Promise.all([
      teams.length ? this.prisma.client.teamMembership.findMany({ where: { teamId: { in: teams }, role: "ADMIN" }, select: { userId: true }, take: 5 }) : [],
      screen.ownerOrganizationId ? this.prisma.client.organizationMembership.findMany({ where: { organizationId: screen.ownerOrganizationId, role: "ADMIN" }, select: { userId: true }, take: 5 }) : [],
    ]);
    const ids = [...new Set([screen.setByUserId, screen.ownerUserId, ...teamAdmins.map((one) => one.userId), ...organizationAdmins.map((one) => one.userId)].filter((one): one is string => !!one))];
    const readers = await Promise.all(ids.map((id) => this.ownerOf(id)));
    return readers.filter((one): one is AuthenticatedUser => !!one);
  }

  /** The screens of a set its leaders see, or those the user may use: their own, their teams', their organisations' (issue #222). */
  async list(user: AuthenticatedUser, setlistId?: string) {
    const scope = await this.scopeOf(user);
    if (setlistId) {
      await this.assertCanPresent(user, setlistId);
      const screens = await this.prisma.client.screen.findMany({ where: { setlistId }, select: SCREEN_SELECT, orderBy: { createdAt: "asc" } });
      return withOnline(screens.map((screen) => present(screen, true)));
    }
    const screens = await this.prisma.client.screen.findMany({
      where: { OR: [{ ownerUserId: user.id }, { ownerTeamId: { in: [...scope.teams] } }, { ownerOrganizationId: { in: [...scope.organizations] } }] },
      select: SCREEN_SELECT,
      orderBy: { createdAt: "asc" },
    });
    return withOnline(screens.map((screen) => present(screen, manages(user, scope, screen))));
  }

  /**
   * A screen changed. Its managers change anything; whoever may use it, or
   * leads the set it shows, gives it another set (one they can edit) - it
   * then reads that set as them.
   */
  async update(user: AuthenticatedUser, screenId: string, change: { owner?: ScreenOwnerRequest; name?: string; mode?: ScreenMode; setMode?: "FIXED" | "DAY"; setlistId?: string | null; themeId?: string | null; themeTemplate?: string | null; hiddenLayers?: string[]; effects?: boolean }) {
    const { screen, canManage } = await this.changeable(user, screenId);
    const onlySet = Object.entries(change).every(([key, value]) => value === undefined || key === "setlistId" || key === "setMode");
    if (!canManage && !onlySet) throw new ForbiddenException("Only whoever manages this screen changes more than its set");
    if (change.setlistId) await this.assertCanPresent(user, change.setlistId);
    if (change.themeId) await this.themes.assertCanUse(user, change.themeId);
    const owner = change.owner ? await this.ownerFor(user, change.owner) : null;
    const updated = await this.prisma.client.screen.update({
      where: { id: screen.id },
      data: {
        ...(owner ?? {}),
        ...(change.name !== undefined && { name: change.name }),
        ...(change.mode !== undefined && { mode: change.mode }),
        ...(change.hiddenLayers !== undefined && { hiddenLayers: [...new Set(change.hiddenLayers)] }),
        ...(change.effects !== undefined && { effects: change.effects }),
        ...(change.setlistId !== undefined && { setlistId: change.setlistId, setByUserId: change.setlistId ? user.id : null, setlistPickedOn: null }),
        // A set put on it is fixed; the day's set is worked out when it next loads (issue #274).
        ...(change.setMode !== undefined ? { setMode: change.setMode, ...(change.setMode === "DAY" && change.setlistId === undefined && { setlistPickedOn: null }) } : change.setlistId ? { setMode: "FIXED" as const } : {}),
        ...lookChange(change),
      },
      select: SCREEN_SELECT,
    });
    await redis().publish(SCREEN_CHANNEL, screen.id);
    return present(updated, canManage);
  }

  async remove(user: AuthenticatedUser, screenId: string): Promise<void> {
    const { screen, canManage } = await this.changeable(user, screenId);
    if (!canManage) throw new ForbiddenException("Only whoever manages this screen disconnects it");
    await this.prisma.client.screen.delete({ where: { id: screen.id } });
    await redis().publish(SCREEN_CHANNEL, screen.id);
  }

  /** The teams and organisations the user is in, and those they run. */
  private async scopeOf(user: AuthenticatedUser): Promise<Scope> {
    const [teams, organizations] = await Promise.all([
      this.prisma.client.teamMembership.findMany({ where: { userId: user.id }, select: { teamId: true, role: true } }),
      this.prisma.client.organizationMembership.findMany({ where: { userId: user.id }, select: { organizationId: true, role: true } }),
    ]);
    return {
      teams: new Set(teams.map((one) => one.teamId)),
      adminTeams: new Set(teams.filter((one) => one.role === "ADMIN").map((one) => one.teamId)),
      organizations: new Set(organizations.map((one) => one.organizationId)),
      adminOrganizations: new Set(organizations.filter((one) => one.role === "ADMIN").map((one) => one.organizationId)),
    };
  }

  /** The owner a screen is given: the user, or a team or organisation they run. */
  private async ownerFor(user: AuthenticatedUser, owner: ScreenOwnerRequest | undefined) {
    if (!owner || owner.kind === "user") return { ownerUserId: user.id, ownerTeamId: null, ownerOrganizationId: null };
    const scope = await this.scopeOf(user);
    if (owner.kind === "team") {
      if (!user.isGlobalAdmin && !scope.adminTeams.has(owner.id!)) throw new ForbiddenException("Only a team's admins give it a screen");
      return { ownerUserId: null, ownerTeamId: owner.id!, ownerOrganizationId: null };
    }
    if (!user.isGlobalAdmin && !scope.adminOrganizations.has(owner.id!)) throw new ForbiddenException("Only an organisation's admins give it a screen");
    return { ownerUserId: null, ownerTeamId: null, ownerOrganizationId: owner.id! };
  }

  /** A screen the user may change: one they may use (its managers, its team's or organisation's members), or that shows a set they lead. */
  private async changeable(user: AuthenticatedUser, screenId: string) {
    const screen = await this.prisma.client.screen.findUnique({ where: { id: screenId }, select: SCREEN_SELECT });
    if (!screen) throw new NotFoundException("Screen not found");
    const scope = await this.scopeOf(user);
    const canManage = manages(user, scope, screen);
    if (canManage || uses(user, scope, screen)) return { screen, canManage };
    if (screen.setlistId && (await this.canPresent(user, screen.setlistId))) return { screen, canManage: false };
    throw new NotFoundException("Screen not found");
  }

  private async canPresent(user: AuthenticatedUser, setlistId: string): Promise<boolean> {
    const set = await this.prisma.client.setlist.findUnique({ where: { id: setlistId }, select: { id: true, ownerUserId: true, ownerTeamId: true } });
    return !!set && (await this.access.access(user, set)).canEdit;
  }

  /** Who leads the set - can edit it - shows it on screens (they lead its sync session too). */
  private async assertCanPresent(user: AuthenticatedUser, setlistId: string) {
    if (!(await this.canPresent(user, setlistId))) throw new ForbiddenException("Only someone who can edit the set shows it on a screen");
  }

  private async waiting(input: string): Promise<{ code: string; pairingId: string; pairing: Pairing }> {
    const code = normalizeScreenCode(String(input ?? ""));
    if (!code) throw new BadRequestException("code must be 6 letters and digits, as the screen shows it");
    const pairingId = await redis().get(codeKey(code));
    const raw = pairingId ? await redis().get(pairingKey(pairingId)) : null;
    if (!pairingId || !raw) throw new NotFoundException("No screen is showing this code: check it, or show a new one");
    return { code, pairingId, pairing: JSON.parse(raw) as Pairing };
  }

  private async ownerOf(userId: string | null): Promise<AuthenticatedUser | null> {
    if (!userId) return null;
    const user = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isGlobalAdmin: true, bannedAt: true, deletedAt: true } });
    if (!user || user.bannedAt || user.deletedAt) return null;
    const { canReview } = await capabilitiesOf(this.prisma.client, user.id);
    return { id: user.id, email: user.email, isGlobalAdmin: user.isGlobalAdmin, isReviewer: canReview };
  }

  /** Each song's credits, for its first and last slides: who wrote it, its copyright and CCLI number. */
  private async credits(songVersionIds: string[]) {
    const songs = await this.prisma.client.songVersion.findMany({
      where: { id: { in: songVersionIds } },
      select: {
        id: true,
        copyright: true,
        copyrightYear: true,
        ccli: true,
        contributors: { where: { roles: { hasSome: ["AUTHOR", "COMPOSER", "LYRICIST", "TRANSLATOR", "ADAPTOR"] } }, orderBy: { displayOrder: "asc" }, select: { source: true, user: { select: { displayName: true } } } },
      },
    });
    return Object.fromEntries(
      songs.map((song) => [
        song.id,
        {
          writers: song.contributors.map((contributor) => contributor.source ?? contributor.user?.displayName ?? "").filter(Boolean),
          copyright: song.copyright ? `© ${song.copyrightYear ? `${song.copyrightYear} ` : ""}${song.copyright}` : null,
          ccli: song.ccli ?? null,
        },
      ]),
    );
  }
}

interface Scope {
  teams: Set<string>;
  adminTeams: Set<string>;
  organizations: Set<string>;
  adminOrganizations: Set<string>;
}
type Owned = { ownerUserId: string | null; ownerTeamId: string | null; ownerOrganizationId: string | null };

/** Its person, its team's admins, its organisation's admins, global admins. */
const manages = (user: AuthenticatedUser, scope: Scope, screen: Owned) =>
  user.isGlobalAdmin ||
  screen.ownerUserId === user.id ||
  (!!screen.ownerTeamId && scope.adminTeams.has(screen.ownerTeamId)) ||
  (!!screen.ownerOrganizationId && scope.adminOrganizations.has(screen.ownerOrganizationId));

/** Its team's or organisation's members put their sets on it. */
const uses = (user: AuthenticatedUser, scope: Scope, screen: Owned) =>
  (!!screen.ownerTeamId && scope.teams.has(screen.ownerTeamId)) || (!!screen.ownerOrganizationId && scope.organizations.has(screen.ownerOrganizationId));

/**
 * Which of the screens are connected now (issue #267), and, for who manages
 * them, each one's latest report about itself with its tier (issue #286).
 */
async function withOnline<T extends { id: string; canManage: boolean }>(screens: T[]): Promise<(T & { online: boolean; report: (ScreenReport & { at: string; tier: ScreenTier }) | null })[]> {
  if (screens.length === 0) return [];
  const keys = [...screens.map((screen) => screenOnlineKey(screen.id)), ...screens.map((screen) => screenReportKey(screen.id))];
  const values = await redis()
    .mget(keys)
    .catch(() => [] as (string | null)[]);
  return screens.map((screen, i) => ({ ...screen, online: values[i] === "1", report: screen.canManage ? storedReport(values[screens.length + i]) : null }));
}

function storedReport(json: string | null | undefined): (ScreenReport & { at: string; tier: ScreenTier }) | null {
  if (!json) return null;
  try {
    const stored = JSON.parse(json) as { at?: unknown };
    const report = readScreenReport(stored);
    return report && typeof stored.at === "string" ? { ...report, at: stored.at, tier: screenTier(report) } : null;
  } catch {
    return null;
  }
}

function present(
  screen: Owned & {
    id: string;
    name: string;
    mode: ScreenMode;
    setlistId: string | null;
    themeId: string | null;
    themeTemplate: string | null;
    hiddenLayers: string[];
    effects: boolean;
    lastSeenAt: Date | null;
    setMode: "FIXED" | "DAY";
    createdAt: Date;
    owner: { displayName: string } | null;
    ownerTeam: { name: string } | null;
    ownerOrganization: { name: string } | null;
    setlist: { id: string; name: string | null; eventDate: Date | null; eventDateOf?: { id: string } | null } | null;
  },
  canManage = false,
) {
  const owner = screen.ownerTeamId
    ? { kind: "team" as const, id: screen.ownerTeamId, name: screen.ownerTeam?.name ?? "" }
    : screen.ownerOrganizationId
      ? { kind: "organization" as const, id: screen.ownerOrganizationId, name: screen.ownerOrganization?.name ?? "" }
      : { kind: "user" as const, id: screen.ownerUserId ?? "", name: screen.owner?.displayName ?? "" };
  return {
    id: screen.id,
    owner,
    canManage,
    name: screen.name,
    mode: screen.mode,
    setlistId: screen.setlistId,
    setlist: screen.setlist ? { id: screen.setlist.id, name: screen.setlist.name, eventDate: screen.setlist.eventDate ? screen.setlist.eventDate.toISOString().slice(0, 10) : null, fromEvent: !!screen.setlist.eventDateOf } : null,
    lastSeenAt: screen.lastSeenAt?.toISOString() ?? null,
    setMode: screen.setMode,
    createdAt: screen.createdAt.toISOString(),
    themeId: screen.themeId,
    themeTemplate: screen.themeTemplate,
    hiddenLayers: SCREEN_SWITCHABLE_LAYERS.filter((layer) => screen.hiddenLayers.includes(layer)),
    effects: screen.effects,
  };
}
