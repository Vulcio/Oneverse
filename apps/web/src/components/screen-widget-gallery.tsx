import {
  DEFAULT_SCREEN_THEME,
  newScreenWidget,
  SCREEN_WIDGET_KINDS,
  ScreenThemeSchema,
  type ScreenTheme,
  type ScreenWidget,
  type ScreenWidgetDefault,
  type ScreenWidgetKind,
  type TeamSummary,
} from "@oneverse/core";
import { Palette, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@oneverse/ui/components/dialog";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { WidgetSettings } from "#/components/screen-layout-editor";
import { ScreenThemePreview } from "#/components/screen-theme-preview";
import { apiClient } from "#/lib/api-client";

/** A widget's shape in its preview (columns × rows of a 16:9 screen): wide ones wide, a dial square. */
const PREVIEW_SHAPE: Partial<Record<ScreenWidgetKind, [number, number]>> = {
  "analog-clock": [4, 8],
  clock: [10, 5],
  countdown: [8, 6],
  "count-up": [8, 6],
  message: [12, 4],
  "song-structure": [10, 4],
  song: [10, 4],
  "next-song": [10, 3],
  "current-item": [10, 4],
  "next-item": [10, 3],
  text: [10, 3],
  date: [10, 4],
  "slide-count": [8, 4],
  "qr-code": [6, 9],
};

/** A widget alone on a screen, with the sample song, a ticking clock and a running countdown (issue #273). */
export function WidgetPreview({ widget, className }: { widget: ScreenWidget; className?: string }) {
  const theme = useMemo<ScreenTheme>(() => {
    const [w, h] = PREVIEW_SHAPE[widget.kind] ?? [12, 12];
    const columns = 12;
    const rows = 12;
    // Centred, in its own shape.
    const x = Math.floor((columns - w) / 2);
    const y = Math.floor((rows - h) / 2);
    return ScreenThemeSchema.parse({ ...DEFAULT_SCREEN_THEME, title: { show: false }, credits: { show: false }, layout: { margin: 4 }, grid: { columns, rows, gap: 0, black: "all", widgets: [{ ...widget, x, y, w, h }] } });
  }, [widget]);
  return <ScreenThemePreview theme={theme} slide={1} className={className} />;
}

/**
 * Screens > Widgets (issue #273): each widget live, with sample content, in
 * the look it gets when it's added to a template - one's own default, or the
 * built-in one - and Customize to set that default, for oneself or for a team
 * one's an admin of.
 */
export function WidgetGallery({ defaults, teams, onChanged }: { defaults: ScreenWidgetDefault[]; teams: TeamSummary[]; onChanged: () => Promise<void> }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<ScreenWidgetKind | null>(null);
  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="widgets-list">
        {SCREEN_WIDGET_KINDS.map((kind) => {
          const mine = defaults.find((one) => one.kind === kind && !one.teamId);
          const teamOnes = defaults.filter((one) => one.kind === kind && one.teamId);
          const widget = newScreenWidget(kind, { x: 0, y: 0, w: 12, h: 12 }, kind, mine?.look ?? {});
          return (
            <li key={kind} className="flex flex-col gap-2" data-testid={`widget-${kind}`} data-customized={mine ? "" : undefined}>
              <WidgetPreview widget={widget} />
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t(`screens.widgetKinds.${kind}.name`)}</p>
                  <p className="text-xs text-muted-foreground">{t(`screens.widgetKinds.${kind}.description`)}</p>
                  {mine || teamOnes.length > 0 ? (
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <Palette className="size-3.5" aria-hidden />
                      {[mine ? t("screens.widgetDefaults.yours") : null, ...teamOnes.map((one) => t("screens.widgetDefaults.team", { team: one.teamName }))].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditing(kind)} data-testid="widget-customize">
                  {t("screens.customize")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {editing ? (
        <WidgetDefaultEditor
          kind={editing}
          defaults={defaults.filter((one) => one.kind === editing)}
          teams={teams.filter((team) => team.currentUserRole === "ADMIN")}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      ) : null}
    </>
  );
}

/** A widget's default look being set: for oneself or a team, its options and look on the left, the widget live on the right. */
function WidgetDefaultEditor({ kind, defaults, teams, onClose, onSaved }: { kind: ScreenWidgetKind; defaults: ScreenWidgetDefault[]; teams: TeamSummary[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const [owner, setOwner] = useState("");
  const existing = defaults.find((one) => (one.teamId ?? "") === owner);
  const [widget, setWidget] = useState<ScreenWidget>(() => newScreenWidget(kind, { x: 0, y: 0, w: 12, h: 12 }, kind, existing?.look ?? {}));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Another owner: their look, to start from.
  const pick = (value: string) => {
    setOwner(value);
    const theirs = defaults.find((one) => (one.teamId ?? "") === value);
    setWidget(newScreenWidget(kind, { x: 0, y: 0, w: 12, h: 12 }, kind, theirs?.look ?? {}));
  };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[94dvh] w-[min(96vw,60rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" data-testid="widget-default-editor">
        <div className="border-b px-4 py-3">
          <DialogTitle className="text-base">{t("screens.widgetDefaults.title", { widget: t(`screens.widgetKinds.${kind}.name`) })}</DialogTitle>
          <p className="text-xs text-muted-foreground">{t("screens.widgetDefaults.description")}</p>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[20rem_minmax(0,1fr)] md:overflow-hidden">
          <div className="flex flex-col gap-3 border-b p-3 md:overflow-y-auto md:border-r md:border-b-0">
            {teams.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="widget-default-owner">{t("screens.themeOwner")}</Label>
                <NativeSelect id="widget-default-owner" value={owner} onChange={(e) => pick(e.target.value)} data-testid="widget-default-owner">
                  <option value="">{t("screens.ownerMe")}</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
            <WidgetSettings widget={widget} onChange={(update) => setWidget(update)} />
          </div>
          <div className="flex min-w-0 flex-col gap-2 bg-muted/40 p-3">
            <span className="text-sm font-medium">{t("screens.preview")}</span>
            <WidgetPreview widget={widget} className="w-full" />
            {owner ? (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="size-3.5" aria-hidden />
                {t("screens.widgetDefaults.forTeam", { team: teams.find((team) => team.id === owner)?.name })}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
          {error ? (
            <p className="w-full text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {existing ? (
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => apiClient.deleteScreenWidgetDefault(kind, owner || undefined))} data-testid="widget-default-reset">
              {t("screens.widgetDefaults.reset")}
            </Button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("screens.closeEditor")}
            </Button>
            <Button disabled={busy} onClick={() => void run(() => apiClient.saveScreenWidgetDefault(kind, { ...(owner && { teamId: owner }), look: { options: widget.options, style: widget.style } }))} data-testid="widget-default-save">
              {t("screens.widgetDefaults.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
