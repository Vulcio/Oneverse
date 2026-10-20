import { composeBuiltInTemplate, formatScreenCode, normalizeScreenCode, SCREEN_SWITCHABLE_LAYERS, SCREEN_TEMPLATES, type ScreenOwnerRequest, type ScreenSummary, type ScreenTheme, type ScreenTier, type ScreenThemeSummary, type SetlistSummary } from "@songverse/core";
import { createFileRoute, Link, useNavigate, useRouteContext, useRouter } from "@tanstack/react-router";
import { Building2, MonitorCheck, MonitorUp, Plus, Settings2, User, Users, type LucideIcon } from "lucide-react";
import { Fragment, useState, type FormEvent } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@songverse/ui/components/tabs";
import { cn } from "@songverse/ui/lib/utils";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@songverse/ui/components/confirm-button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@songverse/ui/components/dialog";
import { TemplatesTab } from "#/components/screen-templates-tab";
import { ScreenThemePreview } from "#/components/screen-theme-preview";
import { WidgetGallery } from "#/components/screen-widget-gallery";
import { BrandsList, type BrandOwnerChoice } from "#/components/brands-list";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";
import { setlistTitle } from "#/lib/setlists";

/** Screens' tabs (issue #267): the screens, the templates they pick from, the widgets placed on templates, the brands they use (issue #279). */
const TABS = ["screens", "templates", "widgets", "brands"] as const;
type ScreensTab = (typeof TABS)[number];

export interface ScreensSearch {
  tab?: Exclude<ScreensTab, "screens">;
  /** The code a screen shows, from its QR code. */
  code?: string;
  /** The set to show, from its Live view. */
  setlistId?: string;
}

/** Whose a screen can be: the user's own, or a team's or organisation's they run. */
type ScreenOwnerChoice = { kind: "user" } | { kind: "team" | "organization"; id: string; name: string };
const ownerValue = (owner: { kind: string; id?: string }) => (owner.kind === "user" ? "user" : `${owner.kind}:${owner.id}`);
const ownerFrom = (value: string): ScreenOwnerRequest => {
  const [kind, id] = value.split(":") as ["user" | "team" | "organization", string | undefined];
  return kind === "user" ? { kind } : { kind, id };
};

export const Route = createFileRoute("/_protected/screens")({
  validateSearch: (search: Record<string, unknown>): ScreensSearch => ({
    ...(search.tab === "templates" || search.tab === "widgets" || search.tab === "brands" ? { tab: search.tab } : {}),
    ...(typeof search.code === "string" ? { code: search.code } : {}),
    ...(typeof search.setlistId === "string" ? { setlistId: search.setlistId } : {}),
  }),
  loaderDeps: ({ search }) => ({ setlistId: search.setlistId }),
  loader: async ({ deps }) => {
    const [sets, screens, themes, parts, teams, organizations, widgetDefaults, brands] = await Promise.all([
      apiClient.listSetlists(),
      apiClient.listScreens(deps.setlistId).catch(() => apiClient.listScreens()),
      apiClient.listScreenThemes(),
      apiClient.listScreenParts(),
      apiClient.listTeams().catch(() => []),
      apiClient.listMyOrganizations().catch(() => null),
      apiClient.listScreenWidgetDefaults().catch(() => []),
      apiClient.listBrands().catch(() => []),
    ]);
    // Whose a new screen can be (issue #222): theirs, a team's they run, an organisation's they run.
    const owners: ScreenOwnerChoice[] = [
      { kind: "user" },
      ...teams.filter((team) => team.currentUserRole === "ADMIN").map((team) => ({ kind: "team" as const, id: team.id, name: team.name })),
      ...(organizations?.mode === "NONE" ? [] : (organizations?.organizations ?? []))
        .filter((organization) => organization.currentUserRole === "ADMIN")
        .map((organization) => ({ kind: "organization" as const, id: organization.id, name: organization.name })),
    ];
    // Only a set they lead can be shown: its sync session is theirs to lead.
    // Whose a new brand can be (issue #279): a team's or an organisation's they run.
    const brandOwners = owners.filter((owner): owner is BrandOwnerChoice => owner.kind !== "user");
    return { sets: sets.filter((set) => set.canEdit), screens, themes, parts, owners, widgetDefaults, brands, brandOwners };
  },
  component: ScreensPage,
});

/**
 * Screens (issue #186), in three tabs (issue #267). Screens: a big screen
 * paired by the code it shows - typed, or scanned from its QR code, which
 * opens this page with it - and the screens one may use as tiles, filtered by
 * whose they are, each opening to rename it, change what it shows and how
 * (issue #194), or disconnect it. Templates: how screens look. Widgets: what
 * else a template can put on a screen (issue #268).
 */
function ScreensPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const tab: ScreensTab = search.tab ?? "screens";
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("screens.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("screens.description")}</p>
      </div>
      <Tabs value={tab} onValueChange={(value) => void navigate({ search: (prev) => ({ ...prev, tab: value === "screens" ? undefined : (value as ScreensSearch["tab"]) }) })}>
        <TabsList data-testid="screens-tabs">
          {TABS.map((one) => (
            <TabsTrigger key={one} value={one} data-testid={`screens-tab-${one}`}>
              {t(`screens.tabs.${one}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="screens" className="pt-4">
          {/* Opened again from a QR code or a set (or Screens in the menu): starts afresh. */}
          <ScreensTabPanel key={`${search.code ?? ""}|${search.setlistId ?? ""}`} />
        </TabsContent>
        <TabsContent value="templates" className="pt-4">
          <TemplatesTab themes={Route.useLoaderData().themes} parts={Route.useLoaderData().parts} widgetDefaults={Route.useLoaderData().widgetDefaults} />
        </TabsContent>
        <TabsContent value="widgets" className="pt-4">
          <WidgetsCard />
        </TabsContent>
        <TabsContent value="brands" className="pt-4">
          <BrandsCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Whose screens a filter shows: all, one's own, a team's or an organisation's (`team:<id>`). */
type ScreenFilter = "all" | "user" | `${"team" | "organization"}:${string}`;

/** Add screen, then the screens as tiles, filtered by whose they are. */
function ScreensTabPanel() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const search = Route.useSearch();
  const { sets, screens, themes, owners } = Route.useLoaderData();
  const [paired, setPaired] = useState<ScreenSummary | null>(null);
  // Open from a screen's QR code, or from a set's Live view.
  const [adding, setAdding] = useState(!!search.code || !!search.setlistId);
  const [filter, setFilter] = useState<ScreenFilter>("all");
  const setName = (id: string | null) => {
    const set = sets.find((one) => one.id === id);
    return set ? setlistTitle(set, t, i18n.language) : t("screens.noSet");
  };
  const filters = screenFilters(screens, t);
  const shown = screens.filter((screen) => filter === "all" || ownerFilter(screen.owner) === filter);

  return (
    <div className="flex flex-col gap-6">
      {paired ? (
        <Card data-testid="screen-paired">
          <CardContent className="flex items-center gap-3">
            <MonitorCheck className="size-6 shrink-0 text-primary" />
            <p className="text-sm">{t("screens.paired", { name: paired.name, set: setName(paired.setlistId) })}</p>
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setPaired(null)}>
              {t("screens.pairAnother")}
            </Button>
          </CardContent>
        </Card>
      ) : adding ? (
        <PairForm
          owners={owners}
          sets={sets}
          code={search.code ?? ""}
          setlistId={search.setlistId}
          onClose={() => setAdding(false)}
          onPaired={async (screen) => {
            setPaired(screen);
            await router.invalidate();
          }}
        />
      ) : (
        <div>
          <Button type="button" onClick={() => setAdding(true)} data-testid="screen-add">
            <Plus />
            {t("screens.add")}
          </Button>
        </div>
      )}

      <section className="flex flex-col gap-3" data-testid="screens-list">
        {search.setlistId ? (
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold">{t("screens.ofSet", { set: setName(search.setlistId) })}</h2>
            <Link to="/screens" className="text-xs text-muted-foreground hover:underline">
              {t("screens.showAll")}
            </Link>
          </div>
        ) : filters.length > 2 ? (
          // Whose they are (issue #222): all, one's own, each team's and organisation's.
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("screens.owner")} data-testid="screens-filters">
            {filters.map((one) => (
              <Button key={one.value} type="button" size="sm" variant={filter === one.value ? "default" : "outline"} aria-pressed={filter === one.value} onClick={() => setFilter(one.value)} data-testid={`screens-filter-${one.value}`}>
                {one.icon ? <one.icon /> : null}
                {one.label}
              </Button>
            ))}
          </div>
        ) : null}
        {shown.length === 0 ? <p className="text-sm text-muted-foreground">{screens.length === 0 ? t("screens.none") : t("screens.noneHere")}</p> : null}
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((screen) => (
            <ScreenTile key={screen.id} screen={screen} sets={sets} themes={themes} owners={owners} onChanged={() => router.invalidate()} />
          ))}
        </ul>
      </section>
    </div>
  );
}

const ownerFilter = (owner: ScreenSummary["owner"]): ScreenFilter => (owner.kind === "user" ? "user" : `${owner.kind}:${owner.id}`);
const OWNER_ICONS: Record<ScreenSummary["owner"]["kind"], LucideIcon> = { user: User, team: Users, organization: Building2 };

/** The filters the screens call for: all, one's own, then each team's and organisation's that has some. */
function screenFilters(screens: ScreenSummary[], t: (key: string, values?: Record<string, unknown>) => string) {
  const filters = new Map<ScreenFilter, { value: ScreenFilter; label: string; icon?: LucideIcon }>([
    ["all", { value: "all", label: t("screens.filterAll") }],
    ["user", { value: "user", label: t("screens.filterMine"), icon: User }],
  ]);
  for (const screen of screens) {
    const value = ownerFilter(screen.owner);
    if (!filters.has(value)) filters.set(value, { value, label: screen.owner.name, icon: OWNER_ICONS[screen.owner.kind] });
  }
  return [...filters.values()];
}

/** What a screen can show besides the words (issue #267), each live, with its default look (issue #273). */
function WidgetsCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const { widgetDefaults } = Route.useLoaderData();
  const { teams } = useRouteContext({ from: "/_protected" });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("screens.widgetsTitle")}</CardTitle>
        <CardDescription>{t("screens.widgetsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <WidgetGallery defaults={widgetDefaults} teams={teams} onChanged={() => router.invalidate()} />
      </CardContent>
    </Card>
  );
}

function BrandsCard() {
  const { t } = useTranslation();
  const { brands, brandOwners } = Route.useLoaderData();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("brands.title")}</CardTitle>
        <CardDescription>{t("brands.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <BrandsList brands={brands} owners={brandOwners} />
      </CardContent>
    </Card>
  );
}

/** Whose a screen is, as a select: the user's own, the teams and organisations they run. */
function OwnerSelect({ id, owners, value, onChange, current }: { id: string; owners: ScreenOwnerChoice[]; value: string; onChange: (value: string) => void; current?: ScreenSummary["owner"] }) {
  const { t } = useTranslation();
  const choices = [...owners];
  // Its owner now, even if not one the user runs (a global admin's view).
  if (current && current.kind !== "user" && !choices.some((one) => ownerValue(one) === ownerValue(current))) choices.push({ kind: current.kind, id: current.id, name: current.name });
  return (
    <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)} data-testid={id}>
      {choices.map((owner) => (
        <option key={ownerValue(owner)} value={ownerValue(owner)}>
          {owner.kind === "user" ? t("screens.forMe") : t(owner.kind === "team" ? "screens.forTeam" : "screens.forOrganization", { name: owner.name })}
        </option>
      ))}
    </NativeSelect>
  );
}

/**
 * How a screen looks (issues #194, #281): its saved template, else its
 * built-in one, else the default - its effects off if they're off on it; a
 * screen paired to show the chart before templates were built for one use
 * still shows it.
 */
function screenLook(screen: ScreenSummary, saved: ScreenThemeSummary | undefined): ScreenTheme {
  const look = saved?.theme ?? composeBuiltInTemplate(screen.themeTemplate ?? "classic", { effects: screen.effects !== false })!;
  const effects = screen.effects === false ? { ...look, effects: null, background: { ...look.background, reactive: false } } : look;
  return screen.mode === "CHART" ? { ...effects, shows: "chart" } : effects;
}

/** A screen's look as a select value: "" the default, "t:concert" a built-in theme, "s:<id>" a saved one. */
function themeValue(screen: Pick<ScreenSummary, "themeId" | "themeTemplate">): string {
  return screen.themeId ? `s:${screen.themeId}` : screen.themeTemplate ? `t:${screen.themeTemplate}` : "";
}

function ThemeSelect({ id, value, themes, onChange }: { id: string; value: string; themes: ScreenThemeSummary[]; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{t("screens.themeDefault")}</option>
      <optgroup label={t("screens.builtIn")}>
        {SCREEN_TEMPLATES.filter((one) => one.id !== "classic").map((one) => (
          <option key={one.id} value={`t:${one.id}`}>
            {t(`screens.templates.${one.id}.name`)}
          </option>
        ))}
      </optgroup>
      {themes.length > 0 ? (
        <optgroup label={t("screens.savedThemes")}>
          {themes.map((theme) => (
            <option key={theme.id} value={`s:${theme.id}`}>
              {theme.teamName ? `${theme.name} · ${theme.teamName}` : theme.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </NativeSelect>
  );
}

/** The set select's value for "The day's set" (issue #274). */
const DAY_SET = "__day__";

function SetSelect({ id, sets, value, onChange, allowNone = false }: { id: string; sets: SetlistSummary[]; value: string; onChange: (id: string) => void; allowNone?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      {/* Its owner's set of the day (issue #274). */}
      <option value={DAY_SET}>{t("screens.daySet")}</option>
      {allowNone || !value ? <option value="">{t("screens.noSet")}</option> : null}
      {sets.map((set) => (
        <option key={set.id} value={set.id}>
          {setlistTitle(set, t, i18n.language)}
        </option>
      ))}
    </NativeSelect>
  );
}

/** The code the screen shows, the set it's to show and how: confirmed, the screen shows it at once. */
function PairForm({ owners, sets, code: initialCode, setlistId, onPaired, onClose }: { owners: ScreenOwnerChoice[]; sets: SetlistSummary[]; code: string; setlistId?: string; onPaired: (screen: ScreenSummary) => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation();
  const [owner, setOwner] = useState("user");
  const [code, setCode] = useState(initialCode ? formatScreenCode(normalizeScreenCode(initialCode) ?? initialCode) : "");
  // A set from Live, else the owner's set of the day (issue #274).
  const [set, setSet] = useState(setlistId && sets.some((one) => one.id === setlistId) ? setlistId : DAY_SET);
  const [name, setName] = useState(t("screens.defaultName"));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeScreenCode(code);
    if (!normalized) return setError(t("screens.badCode"));
    setPending(true);
    setError(null);
    try {
      await onPaired(await apiClient.confirmScreenPairing(normalized, { owner: ownerFrom(owner), name: name.trim() || t("screens.defaultName"), ...(set === DAY_SET ? { setMode: "DAY" as const } : { setlistId: set }) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card data-testid="screen-add-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MonitorUp className="size-5" />
          {t("screens.pairTitle")}
        </CardTitle>
        <CardDescription>{t("screens.pairDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* No set of one's own to put on it: it can still follow its owner's set of the day (issue #274). */}
        {sets.length === 0 ? <p className="mb-4 text-sm text-muted-foreground">{t("screens.noSets")}</p> : null}
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit} data-testid="screen-pair-form">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="screen-code">{t("screens.code")}</Label>
              <Input
                id="screen-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="K7Q-M3X"
                autoComplete="off"
                autoCapitalize="characters"
                className="font-mono text-lg tracking-widest"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="screen-name">{t("screens.name")}</Label>
              <Input id="screen-name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
            </div>
            {owners.length > 1 ? (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="screen-owner">{t("screens.for")}</Label>
                <OwnerSelect id="screen-owner" owners={owners} value={owner} onChange={setOwner} />
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="screen-set">{t("screens.set")}</Label>
              <SetSelect id="screen-set" sets={sets} value={set} onChange={setSet} />
            </div>
            {error ? (
              <p className="text-sm text-destructive sm:col-span-2" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={pending || !set}>
                {pending ? t("screens.pairing") : t("screens.pair")}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose}>
                {t("admin.cancel")}
              </Button>
            </div>
          </form>
      </CardContent>
    </Card>
  );
}

/**
 * A screen as a tile (issue #267): how it looks, whether it's connected,
 * whose it is, what it shows; its settings open under it - its name, the set
 * it shows and how, changed as they're picked - or it's disconnected.
 */
function ScreenTile({ screen, sets, themes, owners, onChanged }: { screen: ScreenSummary; sets: SetlistSummary[]; themes: ScreenThemeSummary[]; owners: ScreenOwnerChoice[]; onChanged: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = screen.themeId ? themes.find((one) => one.id === screen.themeId) : undefined;
  const look = screenLook(screen, saved);
  const lookName = saved?.name ?? (screen.themeTemplate ? t(`screens.templates.${screen.themeTemplate}.name`) : t("screens.themeDefault"));
  const OwnerIcon = OWNER_ICONS[screen.owner.kind];

  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-3" data-testid={`screen-${screen.name}`} data-online={String(!!screen.online)}>
      <ScreenThemePreview theme={look} assets={saved?.assets} playing={false} slide={0} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", screen.online ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden />
          <p className="min-w-0 flex-1 truncate font-medium">{screen.name}</p>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="screen-status">
          {screen.online ? t("screens.online") : screen.lastSeenAt ? t("screens.lastSeen", { when: new Date(screen.lastSeenAt).toLocaleString(i18n.language) }) : t("screens.offline")}
          {screen.report ? (
            <span data-testid="screen-tier" data-tier={screen.report.tier} title={t(`screens.device.tierHints.${screen.report.tier}`)}>
              {" · "}
              <span className={cn("inline-block size-1.5 rounded-full align-middle", TIER_COLORS[screen.report.tier])} aria-hidden /> {t(`screens.device.tiers.${screen.report.tier}`)}
            </span>
          ) : null}
        </p>
        <p className="truncate text-sm" data-testid="screen-set">
          {screen.setMode === "DAY"
            ? screen.setlist
              ? t("screens.daySetNow", { set: setlistTitle(screen.setlist, t, i18n.language) })
              : t("screens.daySetNone")
            : screen.setlist
              ? setlistTitle(screen.setlist, t, i18n.language)
              : t("screens.noSet")}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {lookName}
          {screen.effects === false ? ` · ${t("screens.effectsOff")}` : ""}
        </p>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <OwnerIcon className="size-3.5 shrink-0" aria-hidden />
          {screen.owner.kind === "user" ? t("screens.forMe") : screen.owner.name}
        </p>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="screen-settings">
          <Settings2 />
          {t("screens.settings")}
        </Button>
        {screen.canManage ? (
          <ConfirmButton
            label={t("screens.disconnect")}
            confirmLabel={t("screens.confirmDisconnect")}
            busyLabel={t("screens.disconnecting")}
            cancelLabel={t("admin.cancel")}
            busy={busy}
            onConfirm={async () => {
              setBusy(true);
              try {
                await apiClient.deleteScreen(screen.id);
                await onChanged();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {open ? <ScreenSettingsDialog screen={screen} sets={sets} themes={themes} owners={owners} onChanged={onChanged} onClose={() => setOpen(false)} /> : null}
    </li>
  );
}

/**
 * A screen's settings (issue #288), in a dialog: its name, set, what it
 * shows, its template and whose it is on the left, the screen as it looks
 * on the right. Each change goes to the screen at once.
 */
function ScreenSettingsDialog({ screen, sets, themes, owners, onChanged, onClose }: { screen: ScreenSummary; sets: SetlistSummary[]; themes: ScreenThemeSummary[]; owners: ScreenOwnerChoice[]; onChanged: () => Promise<void>; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState(screen.name);
  const [error, setError] = useState<string | null>(null);
  const known = screen.setMode === "DAY" || !screen.setlistId || sets.some((set) => set.id === screen.setlistId);
  const saved = screen.themeId ? themes.find((one) => one.id === screen.themeId) : undefined;
  const look = screenLook(screen, saved);

  async function change(data: Parameters<typeof apiClient.updateScreen>[1]) {
    setError(null);
    try {
      await apiClient.updateScreen(screen.id, data);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  const rename = () => name.trim() && name.trim() !== screen.name && void change({ name: name.trim() });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        rename();
        onClose();
      }}
    >
      <DialogContent className="flex max-h-[94dvh] w-[min(96vw,52rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" data-testid="screen-dialog">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>{t("screens.settingsOf", { name: screen.name })}</DialogTitle>
          <DialogDescription>{t("screens.settingsDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <fieldset disabled={!screen.canManage} className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`screen-name-${screen.id}`}>{t("screens.name")}</Label>
              <Input id={`screen-name-${screen.id}`} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} onBlur={rename} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`screen-set-${screen.id}`}>{t("screens.set")}</Label>
              {known ? (
                <SetSelect
                  id={`screen-set-${screen.id}`}
                  sets={sets}
                  value={screen.setMode === "DAY" ? DAY_SET : (screen.setlistId ?? "")}
                  allowNone
                  onChange={(id) => void change(id === DAY_SET ? { setMode: "DAY" } : { setMode: "FIXED", setlistId: id || null })}
                />
              ) : (
                <p className="text-sm">{screen.setlist ? setlistTitle(screen.setlist, t, i18n.language) : t("screens.noSet")}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`screen-theme-${screen.id}`}>{t("screens.theme")}</Label>
              <ThemeSelect
                id={`screen-theme-${screen.id}`}
                value={themeValue(screen)}
                themes={themes}
                onChange={(value) =>
                  void change(value.startsWith("s:") ? { themeId: value.slice(2) } : value.startsWith("t:") ? { themeTemplate: value.slice(2) } : { themeId: null, themeTemplate: null })
                }
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 size-4 accent-primary" checked={screen.effects !== false} onChange={(event) => void change({ effects: event.target.checked })} data-testid="screen-effects" />
              <span>
                {t("screens.effects")}
                <span className="block text-xs text-muted-foreground">{t("screens.effectsHint")}</span>
              </span>
            </label>
            <fieldset className="flex flex-col gap-1.5" data-testid="screen-layers">
              <legend className="mb-1.5 text-sm font-medium">{t("screens.layersShown")}</legend>
              <p className="text-xs text-muted-foreground">{t("screens.layersShownHint")}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {SCREEN_SWITCHABLE_LAYERS.map((layer) => {
                  const hidden = screen.hiddenLayers ?? [];
                  const on = !hidden.includes(layer);
                  return (
                    <label key={layer} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={on}
                        onChange={() => void change({ hiddenLayers: on ? [...hidden, layer] : hidden.filter((one) => one !== layer) })}
                        data-testid={`screen-layer-${layer}`}
                      />
                      {t(`screens.layers.${layer}`)}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {screen.canManage && owners.length > 1 ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`screen-owner-${screen.id}`}>{t("screens.owner")}</Label>
                <OwnerSelect id={`screen-owner-${screen.id}`} owners={owners} current={screen.owner} value={ownerValue(screen.owner)} onChange={(value) => void change({ owner: ownerFrom(value) })} />
              </div>
            ) : null}
            {!screen.canManage ? <p className="text-xs text-muted-foreground">{t("screens.notYours")}</p> : null}
          </fieldset>
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-sm font-medium">{t("screens.preview")}</span>
            <ScreenThemePreview theme={look} assets={saved?.assets} slide={0} hiddenLayers={screen.hiddenLayers} />
            {screen.canManage ? <ScreenDevice report={screen.report ?? null} /> : null}
          </div>
        </div>
        <DialogFooter className="flex-row items-center border-t px-4 py-3">
          {error ? (
            <p className="mr-auto text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogClose render={<Button className="ml-auto" />} data-testid="screen-dialog-done">
            {t("screens.settingsDone")}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TIER_COLORS: Record<ScreenTier, string> = { smooth: "bg-emerald-500", limited: "bg-amber-500", minimal: "bg-red-500" };

/**
 * What the screen said about itself last (issue #286): its device and how
 * it's drawing, with what it can run - for its owner to pick a template it
 * keeps up with, or turn its effects off.
 */
function ScreenDevice({ report }: { report: NonNullable<ScreenSummary["report"]> | null }) {
  const { t, i18n } = useTranslation();
  if (!report) {
    return (
      <section className="flex flex-col gap-1 rounded-lg border p-3" data-testid="screen-device">
        <span className="text-sm font-medium">{t("screens.device.title")}</span>
        <p className="text-xs text-muted-foreground">{t("screens.device.none")}</p>
      </section>
    );
  }
  const { device, drawing } = report;
  const rows: [string, string | null][] = [
    [t("screens.device.browser"), device.browser],
    [t("screens.device.model"), device.model],
    [t("screens.device.gpu"), device.gpu ? `${device.gpu} · WebGL ${device.webgl}` : device.webgl ? `WebGL ${device.webgl}` : t("screens.device.noWebgl")],
    [t("screens.device.hardware"), [device.cores ? t("screens.device.cores", { count: device.cores }) : null, device.memoryGb ? t("screens.device.memory", { gb: device.memoryGb }) : null].filter(Boolean).join(" · ") || null],
    [
      t("screens.device.display"),
      device.width && device.height ? `${Math.round(device.width * (device.pixelRatio ?? 1))} × ${Math.round(device.height * (device.pixelRatio ?? 1))}` : null,
    ],
    [
      t("screens.device.drawing"),
      [
        t(`screens.device.drawers.${drawing.drawer}`),
        drawing.fps !== null ? t("screens.device.fps", { fps: Math.round(drawing.fps), worst: Math.round(drawing.worstMs ?? 0) }) : null,
        drawing.scale !== null && drawing.scale < 1 ? t("screens.device.scale", { percent: Math.round(drawing.scale * 100) }) : null,
        drawing.effects ? t("screens.device.effectsOn") : null,
      ]
        .filter(Boolean)
        .join(" · "),
    ],
    [t("screens.device.problem"), drawing.error],
  ];
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-3" data-testid="screen-device" data-tier={report.tier}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t("screens.device.title")}</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs font-medium" data-testid="screen-device-tier">
          <span className={cn("size-2 rounded-full", TIER_COLORS[report.tier])} aria-hidden />
          {t(`screens.device.tiers.${report.tier}`)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t(`screens.device.tierHints.${report.tier}`)}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </Fragment>
          ))}
      </dl>
      <p className="text-xs text-muted-foreground">{t("screens.device.reportedAt", { when: new Date(report.at).toLocaleString(i18n.language) })}</p>
    </section>
  );
}
