import { DEFAULT_SCREEN_THEME, formatScreenCode, normalizeScreenCode, SCREEN_MODES, SCREEN_THEME_TEMPLATES, SCREEN_WIDGET_KINDS, screenThemeTemplate, type ScreenMode, type ScreenOwnerRequest, type ScreenSummary, type ScreenThemeSummary, type ScreenWidgetKind, type SetlistSummary } from "@songverse/core";
import { createFileRoute, Link, useNavigate, useRouteContext, useRouter } from "@tanstack/react-router";
import { AlarmClock, Building2, ChevronsDown, Clock, Clock3, ListChecks, ListEnd, ListOrdered, TextQuote, Hourglass, LayoutPanelTop, MessageSquareText, MonitorCheck, MonitorUp, Music, Palette, Pencil, Plus, Presentation, Settings2, SkipForward, Timer, Type, User, Users, type LucideIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@songverse/ui/components/tabs";
import { cn } from "@songverse/ui/lib/utils";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@songverse/ui/components/confirm-button";
import { ScreenThemeEditor, type ThemeDraft } from "#/components/screen-theme-editor";
import { ScreenThemePreview } from "#/components/screen-theme-preview";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";
import { setlistTitle } from "#/lib/setlists";

/** Screens' tabs (issue #267): the screens, the templates they pick from, the widgets placed on templates. */
const TABS = ["screens", "templates", "widgets"] as const;
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
    ...(search.tab === "templates" || search.tab === "widgets" ? { tab: search.tab } : {}),
    ...(typeof search.code === "string" ? { code: search.code } : {}),
    ...(typeof search.setlistId === "string" ? { setlistId: search.setlistId } : {}),
  }),
  loaderDeps: ({ search }) => ({ setlistId: search.setlistId }),
  loader: async ({ deps }) => {
    const [sets, screens, themes, teams, organizations] = await Promise.all([
      apiClient.listSetlists(),
      apiClient.listScreens(deps.setlistId).catch(() => apiClient.listScreens()),
      apiClient.listScreenThemes(),
      apiClient.listTeams().catch(() => []),
      apiClient.listMyOrganizations().catch(() => null),
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
    return { sets: sets.filter((set) => set.canEdit), screens, themes, owners };
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
          <ThemesCard themes={Route.useLoaderData().themes} />
        </TabsContent>
        <TabsContent value="widgets" className="pt-4">
          <WidgetsCard />
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

/** What widgets there are (issue #267): placed on a template's grid (issue #268). */
const WIDGET_ICONS: Record<ScreenWidgetKind, LucideIcon> = {
  stage: LayoutPanelTop,
  "current-slide": Presentation,
  "next-slide": SkipForward,
  "current-section": TextQuote,
  "next-section": ChevronsDown,
  "song-structure": ListOrdered,
  clock: Clock,
  "analog-clock": Clock3,
  countdown: Hourglass,
  "count-up": Timer,
  message: MessageSquareText,
  song: Music,
  "next-song": AlarmClock,
  "current-item": ListChecks,
  "next-item": ListEnd,
  text: Type,
};

function WidgetsCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("screens.widgetsTitle")}</CardTitle>
        <CardDescription>{t("screens.widgetsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="widgets-list">
          {SCREEN_WIDGET_KINDS.map((kind) => {
            const Icon = WIDGET_ICONS[kind];
            return (
              <li key={kind} className="flex gap-3 rounded-lg border p-3" data-testid={`widget-${kind}`}>
                <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t(`screens.widgetKinds.${kind}.name`)}</p>
                  <p className="text-xs text-muted-foreground">{t(`screens.widgetKinds.${kind}.description`)}</p>
                </div>
              </li>
            );
          })}
        </ul>
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
        {SCREEN_THEME_TEMPLATES.filter((one) => one.id !== "classic").map((one) => (
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

/**
 * The themes (issue #194): the built-in ones, each playing on a sample song,
 * to customize; the user's own and their teams', to change (theirs, or a
 * team's they're an admin of) or delete.
 */
function ThemesCard({ themes }: { themes: ScreenThemeSummary[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const onChanged = () => router.invalidate();
  const { teams } = useRouteContext({ from: "/_protected" });
  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="size-5" />
          {t("screens.themesTitle")}
        </CardTitle>
        <CardDescription>{t("screens.themesDescription")}</CardDescription>
        <div>
          <Button type="button" size="sm" onClick={() => setDraft({ name: t("screens.newTemplateName"), theme: DEFAULT_SCREEN_THEME })} data-testid="new-theme">
            <Plus />
            {t("screens.newTemplate")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {themes.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">{t("screens.savedThemes")}</h3>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="saved-themes">
              {themes.map((theme) => (
                <li key={theme.id} className="flex flex-col gap-2" data-testid={`saved-theme-${theme.name}`}>
                  <ScreenThemePreview theme={theme.theme} assets={theme.assets} />
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{theme.name}</p>
                    {theme.teamName ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <Users className="size-3.5" aria-hidden />
                        {t("screens.teamTheme", { team: theme.teamName })}
                      </span>
                    ) : null}
                    {theme.canEdit ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setDraft({ id: theme.id, name: theme.name, theme: theme.theme, ownerTeamId: theme.ownerTeamId, assets: theme.assets })} data-testid="edit-theme">
                          <Pencil />
                          {t("screens.editTheme")}
                        </Button>
                        <ConfirmButton
                          label={t("screens.deleteTheme")}
                          confirmLabel={t("screens.confirmDeleteTheme")}
                          busyLabel={t("screens.deletingTheme")}
                          cancelLabel={t("admin.cancel")}
                          busy={false}
                          onConfirm={async () => {
                            await apiClient.deleteScreenTheme(theme.id);
                            await onChanged();
                          }}
                        />
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{t("screens.builtIn")}</h3>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="builtin-themes">
            {SCREEN_THEME_TEMPLATES.map((template) => (
              <li key={template.id} className="flex flex-col gap-2" data-testid={`builtin-theme-${template.id}`}>
                <ScreenThemePreview theme={template.theme} />
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t(`screens.templates.${template.id}.name`)}</p>
                    <p className="text-xs text-muted-foreground">{t(`screens.templates.${template.id}.description`)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDraft({ name: t(`screens.templates.${template.id}.name`), theme: template.theme })}
                    data-testid="customize-theme"
                  >
                    {t("screens.customize")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
      {draft ? (
        <ScreenThemeEditor
          draft={draft}
          teams={teams}
          onClose={() => setDraft(null)}
          onSaved={async () => {
            setDraft(null);
            await onChanged();
          }}
        />
      ) : null}
    </Card>
  );
}

function ModeSelect({ id, value, onChange }: { id: string; value: ScreenMode; onChange: (mode: ScreenMode) => void }) {
  const { t } = useTranslation();
  return (
    <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value as ScreenMode)}>
      {SCREEN_MODES.map((mode) => (
        <option key={mode} value={mode}>
          {t(`screens.modes.${mode}`)}
        </option>
      ))}
    </NativeSelect>
  );
}

function SetSelect({ id, sets, value, onChange, allowNone = false }: { id: string; sets: SetlistSummary[]; value: string; onChange: (id: string) => void; allowNone?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
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
  const [set, setSet] = useState(setlistId && sets.some((one) => one.id === setlistId) ? setlistId : (sets[0]?.id ?? ""));
  const [mode, setMode] = useState<ScreenMode>("LYRICS");
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
      await onPaired(await apiClient.confirmScreenPairing(normalized, { owner: ownerFrom(owner), name: name.trim() || t("screens.defaultName"), mode, setlistId: set }));
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
        {sets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("screens.noSets")}</p>
        ) : (
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="screen-mode">{t("screens.mode")}</Label>
              <ModeSelect id="screen-mode" value={mode} onChange={setMode} />
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
        )}
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
  const [name, setName] = useState(screen.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = !screen.setlistId || sets.some((set) => set.id === screen.setlistId);

  async function change(data: Parameters<typeof apiClient.updateScreen>[1]) {
    setError(null);
    try {
      await apiClient.updateScreen(screen.id, data);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const saved = screen.themeId ? themes.find((one) => one.id === screen.themeId) : undefined;
  const look = saved?.theme ?? screenThemeTemplate(screen.themeTemplate)?.theme ?? DEFAULT_SCREEN_THEME;
  const lookName = saved?.name ?? (screen.themeTemplate ? t(`screens.templates.${screen.themeTemplate}.name`) : t("screens.themeDefault"));
  const OwnerIcon = OWNER_ICONS[screen.owner.kind];

  return (
    <li className={cn("flex flex-col gap-3 rounded-xl border bg-card p-3", open && "sm:col-span-2 xl:col-span-3")} data-testid={`screen-${screen.name}`} data-online={String(!!screen.online)}>
      <div className={cn("flex flex-col gap-3", open && "sm:flex-row")}>
        <ScreenThemePreview theme={look} mode={screen.mode} assets={saved?.assets} playing={false} slide={0} className={cn(open && "sm:w-64 sm:shrink-0")} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={cn("size-2 shrink-0 rounded-full", screen.online ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden />
            <p className="min-w-0 flex-1 truncate font-medium">{screen.name}</p>
            <Button type="button" size="sm" variant={open ? "default" : "outline"} aria-expanded={open} onClick={() => setOpen((was) => !was)} data-testid="screen-settings">
              <Settings2 />
              {open ? t("screens.settingsDone") : t("screens.settings")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="screen-status">
            {screen.online ? t("screens.online") : screen.lastSeenAt ? t("screens.lastSeen", { when: new Date(screen.lastSeenAt).toLocaleString(i18n.language) }) : t("screens.offline")}
          </p>
          <p className="truncate text-sm">{screen.setlist ? setlistTitle(screen.setlist, t, i18n.language) : t("screens.noSet")}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t(`screens.modesShort.${screen.mode}`)} · {lookName}
          </p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <OwnerIcon className="size-3.5 shrink-0" aria-hidden />
            {screen.owner.kind === "user" ? t("screens.forMe") : screen.owner.name}
          </p>
        </div>
      </div>
      {open ? (
      <>
      <div className="grid gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`screen-name-${screen.id}`}>{t("screens.name")}</Label>
          <Input
            id={`screen-name-${screen.id}`}
            value={name}
            disabled={!screen.canManage}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => name.trim() && name.trim() !== screen.name && void change({ name: name.trim() })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`screen-set-${screen.id}`}>{t("screens.set")}</Label>
          {known ? (
            <SetSelect id={`screen-set-${screen.id}`} sets={sets} value={screen.setlistId ?? ""} allowNone onChange={(id) => void change({ setlistId: id || null })} />
          ) : (
            <p className="text-sm">{screen.setlist ? setlistTitle(screen.setlist, t, i18n.language) : t("screens.noSet")}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`screen-mode-${screen.id}`}>{t("screens.mode")}</Label>
          <fieldset disabled={!screen.canManage} className="contents">
            <ModeSelect id={`screen-mode-${screen.id}`} value={screen.mode} onChange={(mode) => void change({ mode })} />
          </fieldset>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`screen-theme-${screen.id}`}>{t("screens.theme")}</Label>
          <fieldset disabled={!screen.canManage} className="contents">
          <ThemeSelect
            id={`screen-theme-${screen.id}`}
            value={themeValue(screen)}
            themes={themes}
            onChange={(value) =>
              void change(value.startsWith("s:") ? { themeId: value.slice(2) } : value.startsWith("t:") ? { themeTemplate: value.slice(2) } : { themeId: null, themeTemplate: null })
            }
          />
          </fieldset>
        </div>
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
      {screen.canManage && owners.length > 1 ? (
        <div className="flex max-w-sm flex-col gap-1.5">
          <Label htmlFor={`screen-owner-${screen.id}`}>{t("screens.owner")}</Label>
          <OwnerSelect id={`screen-owner-${screen.id}`} owners={owners} current={screen.owner} value={ownerValue(screen.owner)} onChange={(value) => void change({ owner: ownerFrom(value) })} />
        </div>
      ) : null}
      {!screen.canManage ? <p className="text-xs text-muted-foreground">{t("screens.notYours")}</p> : null}
      </>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
