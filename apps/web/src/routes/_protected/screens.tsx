import { formatScreenCode, normalizeScreenCode, SCREEN_MODES, SCREEN_THEME_TEMPLATES, type ScreenMode, type ScreenSummary, type ScreenThemeSummary, type SetlistSummary } from "@songverse/core";
import { createFileRoute, useRouteContext, useRouter } from "@tanstack/react-router";
import { MonitorCheck, MonitorUp, Palette, Pencil, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "#/components/confirm-button";
import { ScreenThemeEditor, type ThemeDraft } from "#/components/screen-theme-editor";
import { ScreenThemePreview } from "#/components/screen-theme-preview";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";
import { setlistTitle } from "#/lib/setlists";

export interface ScreensSearch {
  /** The code a screen shows, from its QR code. */
  code?: string;
  /** The set to show, from its Live view. */
  setlistId?: string;
}

export const Route = createFileRoute("/_protected/screens")({
  validateSearch: (search: Record<string, unknown>): ScreensSearch => ({
    ...(typeof search.code === "string" ? { code: search.code } : {}),
    ...(typeof search.setlistId === "string" ? { setlistId: search.setlistId } : {}),
  }),
  loaderDeps: ({ search }) => ({ setlistId: search.setlistId }),
  loader: async ({ deps }) => {
    const [sets, screens, themes] = await Promise.all([
      apiClient.listSetlists(),
      apiClient.listScreens(deps.setlistId).catch(() => apiClient.listScreens()),
      apiClient.listScreenThemes(),
    ]);
    // Only a set they lead can be shown: its sync session is theirs to lead.
    return { sets: sets.filter((set) => set.canEdit), screens, themes };
  },
  component: ScreensPage,
});

/**
 * Screens (issue #186): a big screen paired by the code it shows - typed,
 * or scanned from its QR code, which opens this page with it - and the
 * screens showing a set, to rename, change what they show and how they look
 * (issue #194), or disconnect - and the themes to pick from.
 */
function ScreensPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const search = Route.useSearch();
  const { sets, screens, themes } = Route.useLoaderData();
  const [paired, setPaired] = useState<ScreenSummary | null>(null);
  const setName = (id: string | null) => {
    const set = sets.find((one) => one.id === id);
    return set ? setlistTitle(set, t, i18n.language) : t("screens.noSet");
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("screens.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("screens.description")}</p>
      </div>

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
      ) : (
        <PairForm
          sets={sets}
          code={search.code ?? ""}
          setlistId={search.setlistId}
          onPaired={async (screen) => {
            setPaired(screen);
            await router.invalidate();
          }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{search.setlistId ? t("screens.ofSet", { set: setName(search.setlistId) }) : t("screens.yours")}</CardTitle>
        </CardHeader>
        <CardContent>
          {screens.length === 0 ? <p className="text-sm text-muted-foreground">{t("screens.none")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="screens-list">
            {screens.map((screen) => (
              <ScreenRow key={screen.id} screen={screen} sets={sets} themes={themes} onChanged={() => router.invalidate()} />
            ))}
          </ul>
        </CardContent>
      </Card>

      <ThemesCard themes={themes} onChanged={() => router.invalidate()} />
    </div>
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
function ThemesCard({ themes, onChanged }: { themes: ScreenThemeSummary[]; onChanged: () => Promise<void> }) {
  const { t } = useTranslation();
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
function PairForm({ sets, code: initialCode, setlistId, onPaired }: { sets: SetlistSummary[]; code: string; setlistId?: string; onPaired: (screen: ScreenSummary) => Promise<void> }) {
  const { t } = useTranslation();
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
      await onPaired(await apiClient.confirmScreenPairing(normalized, { name: name.trim() || t("screens.defaultName"), mode, setlistId: set }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
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
            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending || !set}>
                {pending ? t("screens.pairing") : t("screens.pair")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** A screen: its name, the set it shows and how, changed as they're picked; or disconnected. */
function ScreenRow({ screen, sets, themes, onChanged }: { screen: ScreenSummary; sets: SetlistSummary[]; themes: ScreenThemeSummary[]; onChanged: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
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

  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0" data-testid={`screen-${screen.name}`}>
      <div className="grid gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`screen-name-${screen.id}`}>{t("screens.name")}</Label>
          <Input
            id={`screen-name-${screen.id}`}
            value={name}
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
          <ModeSelect id={`screen-mode-${screen.id}`} value={screen.mode} onChange={(mode) => void change({ mode })} />
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
      </div>
      {screen.lastSeenAt ? <p className="text-xs text-muted-foreground">{t("screens.lastSeen", { when: new Date(screen.lastSeenAt).toLocaleString(i18n.language) })}</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
