import { readSyncLayers, SCREEN_SWITCHABLE_LAYERS, type ScreenSummary, type ScreenSwitchableLayer, type SetlistOfflineCopy, type SetScreenLooks, type SyncMember, type SyncStageCommand } from "@oneverse/core";
import { ChevronDown, CornerUpLeft, Eraser, MonitorUp, Eye, EyeOff, Image, Layers2, LayoutGrid, MonitorOff, Presentation, RotateCcw, SquareDashed, TvMinimal, Type, Undo2, Video, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@oneverse/ui/components/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@oneverse/ui/components/dropdown-menu";
import { cn } from "@oneverse/ui/lib/utils";
import { ScreenStage } from "@oneverse/screen/components/screen-stage";
import { setlistTitle } from "@oneverse/screen/lib/set-items";
import { useStageShowing } from "@oneverse/screen/lib/stage-showing";
import { useLive, useOperatorHost } from "../host";
import { changeOperatorDisplay, useOperatorDisplay } from "../lib/display-options";
import { ProgramCard } from "./operator-stage";
import type { OperatorItem } from "./operator-rundown";

type Look = SetScreenLooks["screens"][number];

/**
 * How the set's screens look (issue #358), from the API through the host:
 * read again when the set's screens come and go. Null where the host can't
 * tell (offline): each screen is drawn in the default look.
 */
export function useScreenLooks(): SetScreenLooks | null {
  const { screenLooks } = useOperatorHost();
  const { members } = useLive();
  const connected = members
    .filter((member) => member.screen)
    .map((member) => member.id)
    .sort()
    .join(",");
  const [looks, setLooks] = useState<SetScreenLooks | null>(null);
  useEffect(() => {
    if (!screenLooks) return;
    let live = true;
    screenLooks()
      .then((found) => live && setLooks(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [screenLooks, connected]);
  return looks;
}

/** A screen of the set: connected now (a member of its session), or set to show it and not connected. */
interface SetScreen {
  id: string;
  name: string;
  connected: boolean;
  lastSeenAt: string | null;
  /** Borrowed for this set (issue #480): until when, and by whom. */
  borrowed: { until: string; by: string } | null;
}

function useSetScreens(expected: ScreenSummary[] | null): SetScreen[] {
  const { members } = useLive();
  const connected = members.filter((member): member is SyncMember & { screen: true } => !!member.screen);
  return [
    ...connected.map((member) => ({ id: member.id, name: member.name, connected: true, lastSeenAt: null, borrowed: expected?.find((screen) => screen.id === member.id)?.borrowed ?? null })),
    ...(expected ?? []).filter((screen) => !connected.some((member) => member.id === screen.id)).map((screen) => ({ id: screen.id, name: screen.name, connected: false, lastSeenAt: screen.lastSeenAt, borrowed: screen.borrowed ?? null })),
  ];
}

/** Each layer's icon (issue #358), top first: the bars name them in a tooltip rather than in words. */
const LAYER_ICONS: Record<ScreenSwitchableLayer, LucideIcon> = { masks: SquareDashed, overlays: Layers2, content: Type, media: Image, video: Video };
const LAYERS_TOP_FIRST = [...SCREEN_SWITCHABLE_LAYERS].reverse();

/**
 * Screens & layers (issues #275, #287, #358), the drawer's body: what's on
 * the screens and what's next, the layers of every screen in one bar, then
 * each screen of the set as it draws the set now - its template, the slide,
 * its layers - in a grid or one at a time, with its own bar. The pictures
 * can be hidden, for a bar per screen alone.
 */
export function ScreensView({ copy, items, itemId, expected, send, onScreensChanged }: { copy: SetlistOfflineCopy; items?: OperatorItem[]; itemId?: string | null; expected: ScreenSummary[] | null; send: (command: SyncStageCommand) => void; onScreensChanged?: () => void }) {
  const { t } = useTranslation();
  const display = useOperatorDisplay();
  const looks = useScreenLooks();
  const screens = useSetScreens(expected);
  const [picked, setPicked] = useState<string | null>(null);
  const one = screens.find((screen) => screen.id === picked) ?? screens.find((screen) => screen.connected) ?? screens[0] ?? null;
  const lookOf = (id: string) => looks?.screens.find((look) => look.id === id) ?? null;
  const shown = display.previews ? (display.screens === "tabs" && one ? [one] : screens) : screens;

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={t("screens.operator.screensView.title")} data-testid="operator-screens-view" data-view={display.previews ? display.screens : "off"}>
      {items ? <ProgramCard items={items} itemId={itemId ?? null} compact /> : null}
      <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-2">
        <span className="text-xs font-semibold text-muted-foreground">{t("screens.operator.allScreens")}</span>
        <LayerBar send={send} />
      </div>
      <div className="flex items-center gap-1">
        <h3 className="text-sm font-semibold">{t("screens.operator.screensView.title")}</h3>
        <span className="text-xs text-muted-foreground">{t("screens.operator.screensView.count", { count: screens.filter((screen) => screen.connected).length })}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <BorrowScreen onBorrowed={onScreensChanged} />
          {display.previews ? (
            <>
              <IconToggle icon={LayoutGrid} label={t("screens.operator.screensView.grid")} on={display.screens === "grid"} onClick={() => changeOperatorDisplay({ screens: "grid" })} testid="operator-screens-grid" />
              <IconToggle icon={TvMinimal} label={t("screens.operator.screensView.tabs")} on={display.screens === "tabs"} onClick={() => changeOperatorDisplay({ screens: "tabs" })} testid="operator-screens-tabs" />
            </>
          ) : null}
          <IconToggle icon={display.previews ? Eye : EyeOff} label={t(display.previews ? "screens.operator.screensView.hidePreviews" : "screens.operator.screensView.showPreviews")} on={display.previews} onClick={() => changeOperatorDisplay({ previews: !display.previews })} testid="operator-screens-previews" />
        </div>
      </div>
      {screens.length === 0 ? <p className="text-sm text-muted-foreground">{t("screens.noScreens")}</p> : null}
      {display.previews && display.screens === "tabs" && screens.length > 1 ? (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("screens.operator.screensView.title")}>
          {screens.map((screen) => (
            <button
              key={screen.id}
              type="button"
              role="tab"
              aria-selected={screen.id === one?.id}
              onClick={() => setPicked(screen.id)}
              className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs", screen.id === one?.id ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:text-foreground")}
              data-testid="operator-screen-tab"
              data-state={screen.connected ? "following" : "missing"}
            >
              <span className={cn("size-1.5 rounded-full", screen.connected ? "bg-emerald-500" : "bg-amber-500")} aria-hidden />
              {screen.name}
            </button>
          ))}
        </div>
      ) : null}
      <ul className={cn("grid gap-3", display.previews && display.screens === "grid" ? "grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]" : "grid-cols-1")}>
        {shown.map((screen) => (
          <li key={screen.id}>
            <ScreenTile copy={copy} screen={screen} look={lookOf(screen.id)} looks={looks} send={send} picture={display.previews} onGivenBack={onScreensChanged} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** An icon button that's on or off, named in its tooltip. */
function IconToggle({ icon: Icon, label, on, onClick, testid, className, state }: { icon: LucideIcon; label: string; on: boolean; onClick: () => void; testid?: string; className?: string; state?: string }) {
  return (
    <Button size="icon" variant={on ? "secondary" : "ghost"} className={cn("size-7", className)} aria-pressed={on} aria-label={label} title={label} onClick={onClick} data-testid={testid} data-state={state}>
      <Icon />
    </Button>
  );
}

/** One screen: its name and details, a picture of what it draws now (unless hidden), and its own layer bar. */
function ScreenTile({ copy, screen, look, looks, send, picture, onGivenBack }: { copy: SetlistOfflineCopy; screen: SetScreen; look: Look | null; looks: SetScreenLooks | null; send: (command: SyncStageCommand) => void; picture: boolean; onGivenBack?: () => void }) {
  const { t, i18n } = useTranslation();
  const { session, stage, offset } = useLive();
  const presenting = session?.presenting ?? null;
  const own = !!readSyncLayers(stage?.layers).screens?.[screen.id];
  const showing = useStageShowing({ set: copy, credits: looks?.credits, presenting, stage, offset: offset ?? 0, screen: { id: screen.id, hiddenLayers: look?.hiddenLayers }, theme: look?.theme, itemThemes: look?.itemThemes });
  const details = look
    ? [
        look.template.name ?? t(`screens.templates.${look.template.builtIn}.name`, { defaultValue: look.template.builtIn ?? "" }),
        look.hiddenLayers.length ? t("screens.operator.screensView.neverShows", { layers: look.hiddenLayers.map((layer) => t(`screens.layers.${layer}`)).join(", ") }) : null,
        look.effects ? null : t("screens.operator.screensView.effectsOff"),
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const lastSeen = screen.lastSeenAt ? t("screens.operator.lastSeen", { time: new Date(screen.lastSeenAt).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" }) }) : t("screens.operator.notConnected");
  const idle = <div className="flex size-full items-center justify-center p-[6%] text-center text-[clamp(0.6rem,4cqw,1.4rem)] text-neutral-400">{setlistTitle(copy.set, t, i18n.language)}</div>;
  return (
    <article className="flex min-w-0 flex-col gap-1" data-testid="operator-screen-tile" data-screen={screen.id} data-state={screen.connected ? "following" : "missing"} data-own-layers={own ? "" : undefined} data-borrowed={screen.borrowed ? "" : undefined}>
      <header className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className={cn("size-2 shrink-0 rounded-full", screen.connected ? "bg-emerald-500" : "bg-amber-500")} aria-hidden />
        <span className="shrink-0 font-medium">{screen.name}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={screen.connected ? details : lastSeen} data-testid="operator-screen-details">
          {screen.connected ? details : lastSeen}
        </span>
        {screen.borrowed ? <GiveBack screen={screen} borrowed={screen.borrowed} onGivenBack={onGivenBack} /> : null}
      </header>
      {picture ? (
        <div className={cn("relative overflow-hidden rounded-md bg-black ring-1 ring-border [container-type:size]", !screen.connected && "opacity-50")} style={{ aspectRatio: "16/9" }}>
          {screen.connected ? (
            <ScreenStage className="absolute inset-0" theme={showing.look} song={showing.presented ? showing.song : null} slide={presenting?.slide ?? 0} line={presenting?.line} black={!!presenting?.black} idle={idle} assets={looks?.assets ?? []} live={showing.live} />
          ) : (
            <div className="flex size-full items-center justify-center text-neutral-500" data-testid="operator-screen-missing">
              <MonitorOff className="size-5" aria-label={lastSeen} />
            </div>
          )}
        </div>
      ) : null}
      {screen.connected ? <LayerBar send={send} screen={screen.id} /> : null}
    </article>
  );
}

/** What a layer is on a screen now (or on every screen): shown, cleared until the next slide, or hidden. */
function useLayerStates(screen: string | null) {
  const { stage, session } = useLive();
  const layers = readSyncLayers(stage?.layers);
  const state = (screen && layers.screens?.[screen]) || layers;
  const presenting = session?.presenting ?? null;
  const cleared = state.cleared && state.cleared.itemId === (presenting?.itemId ?? null) && state.cleared.slide === (presenting?.slide ?? 0) ? state.cleared.layers : [];
  const of = (layer: ScreenSwitchableLayer): "shown" | "cleared" | "hidden" => (state.hidden.includes(layer) ? "hidden" : cleared.includes(layer) ? "cleared" : "shown");
  return { layers, state, cleared, of };
}

/**
 * A row of layer toggles (issues #280, #287, #358), for every screen or, with
 * `screen`, that one's own: each layer's icon shows or hides it; Clear takes
 * the words off until the next slide - or, from its menu, the media, the
 * overlays or everything - and, once something's cleared, brings it back;
 * the title card over everything (every screen's row); and back to normal
 * when anything differs.
 */
export function LayerBar({ send, screen }: { send: (command: SyncStageCommand) => void; screen?: string }) {
  const { t } = useTranslation();
  const { layers, state, cleared, of } = useLayerStates(screen ?? null);
  const prefix = screen ? "operator-screen-layer" : "operator-layer";
  const command = (change: Omit<NonNullable<SyncStageCommand["layers"]>, "screen">) => send({ layers: { ...change, ...(screen ? { screen } : {}) } });
  const shownLayers = LAYERS_TOP_FIRST.filter((layer) => of(layer) === "shown");
  const changed = screen ? !!layers.screens?.[screen] : state.hidden.length > 0 || state.title || cleared.length > 0 || Object.keys(layers.screens ?? {}).length > 0;
  const clear = (which: ScreenSwitchableLayer[]) => which.length && command({ clear: which });
  return (
    <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label={t("screens.operator.layers")} data-testid="operator-layers" data-screen={screen}>
      {LAYERS_TOP_FIRST.map((layer) => {
        const now = of(layer);
        const name = t(`screens.layers.${layer}`);
        const Icon = LAYER_ICONS[layer];
        return (
          <Button
            key={layer}
            size="icon"
            variant="ghost"
            className={cn("relative size-7", now === "shown" && "bg-secondary text-secondary-foreground", now === "cleared" && "bg-amber-500/15 text-amber-700 dark:text-amber-300", now === "hidden" && "text-muted-foreground/60")}
            aria-pressed={now !== "hidden"}
            aria-label={t(`screens.operator.bar.${now}`, { layer: name })}
            title={t(`screens.operator.bar.${now}`, { layer: name })}
            onClick={() => command({ show: { [layer]: now === "shown" ? false : true } })}
            data-testid={`${prefix}-${layer}`}
            data-state={now}
          >
            <Icon />
            {now === "shown" ? null : <span className="pointer-events-none absolute inset-x-1 top-1/2 h-px -rotate-45 bg-current" aria-hidden />}
          </Button>
        );
      })}
      {screen ? null : (
        <IconToggle icon={Presentation} label={t("screens.operator.layerTitle")} on={state.title} onClick={() => command({ title: !state.title })} testid="operator-layer-title" className="ml-1" />
      )}
      <div className="ml-auto flex items-center">
        {cleared.length ? (
          <Button size="sm" variant="outline" className="h-7 gap-1 border-amber-500/60 px-2 text-xs" onClick={() => command({ show: Object.fromEntries(cleared.map((layer) => [layer, true])) })} title={t("screens.operator.restoreLayer")} data-testid={screen ? "operator-screen-clear" : "operator-clear"} data-state="cleared">
            <Undo2 />
            {screen ? <span className="sr-only">{t("screens.operator.restoreLayer")}</span> : t("screens.operator.restoreLayer")}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" className="h-7 gap-1 rounded-r-none px-2 text-xs" disabled={of("content") !== "shown"} onClick={() => clear(["content"])} title={screen ? `${t("screens.operator.clearLayer")}: ${t("screens.operator.bar.clearHint")}` : t("screens.operator.bar.clearHint")} data-testid={screen ? "operator-screen-clear" : "operator-clear"} data-state="none">
              <Eraser />
              {/* A screen's own row stays one line in the grid: the icon alone, named in its tooltip. */}
              {screen ? <span className="sr-only">{t("screens.operator.clearLayer")}</span> : t("screens.operator.clearLayer")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="icon" variant="outline" className="size-7 rounded-l-none border-l-0" aria-label={t("screens.operator.bar.clearWhat")} data-testid={screen ? "operator-screen-clear-menu" : "operator-clear-menu"} />}>
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(["content", "media", "overlays"] as const).map((layer) => (
                  <DropdownMenuItem key={layer} disabled={of(layer) !== "shown"} onClick={() => clear([layer])} data-testid={`operator-clear-${layer}`}>
                    {t(`screens.operator.bar.clear_${layer}`)}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem disabled={!shownLayers.length} onClick={() => clear(shownLayers)} data-testid="operator-clear-all">
                  {t("screens.operator.bar.clearAll")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        {changed ? (
          <Button size="icon" variant="ghost" className="ml-0.5 size-7" onClick={() => command({ reset: true })} aria-label={screen ? t("screens.operator.layersLikeAll") : t("screens.operator.layersReset")} title={screen ? t("screens.operator.layersLikeAll") : t("screens.operator.layersReset")} data-testid={screen ? "operator-screen-layers-reset" : "operator-layers-reset"}>
            <RotateCcw />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Borrow a screen (issue #480): the screens this person may put a set on
 * that show something else now - a lobby TV, the side screens - each put on
 * this set for an hour or a few, then back to what it showed by itself.
 */
function BorrowScreen({ onBorrowed }: { onBorrowed?: () => void }) {
  const { t, i18n } = useTranslation();
  const { borrowing } = useOperatorHost();
  const [open, setOpen] = useState(false);
  const [screens, setScreens] = useState<ScreenSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !borrowing) return;
    let live = true;
    setError(null);
    borrowing
      .list()
      .then((list) => live && setScreens(list))
      .catch(() => live && setError(t("screens.operator.borrow.notAllowed")));
    return () => {
      live = false;
    };
  }, [open, borrowing, t]);
  if (!borrowing) return null;
  const shows = (screen: ScreenSummary) =>
    screen.borrowed
      ? t("screens.operator.borrow.borrowedBy", { name: screen.borrowed.by, setName: screen.setlist?.name ?? t("screens.operator.borrow.aSet") })
      : screen.setMode === "LOCATION" && screen.location
        ? t("screens.operator.borrow.atLocation", { location: screen.location.name })
        : screen.setMode === "DAY"
          ? t("screens.operator.borrow.daysSet")
          : screen.setlist
            ? (screen.setlist.name ?? t("screens.operator.borrow.aSet"))
            : t("screens.operator.borrow.noSet");
  const borrow = async (screen: ScreenSummary) => {
    setBusy(screen.id);
    try {
      await borrowing.borrow(screen.id, hours);
      setOpen(false);
      onBorrowed?.();
    } catch {
      setError(t("screens.operator.borrow.failed"));
    } finally {
      setBusy(null);
    }
  };
  const until = new Date(Date.now() + hours * 3600_000).toLocaleTimeString(i18n.language, { timeStyle: "short" });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="icon" variant="ghost" className="size-7" aria-label={t("screens.operator.borrow.button")} title={t("screens.operator.borrow.button")} data-testid="operator-borrow" />}>
        <MonitorUp />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-2 p-3" data-testid="operator-borrow-list">
        <p className="text-sm font-semibold">{t("screens.operator.borrow.title")}</p>
        <p className="text-xs text-muted-foreground">{t("screens.operator.borrow.hint")}</p>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>{t("screens.operator.borrow.for")}</span>
          <NativeSelect compact value={String(hours)} onChange={(event) => setHours(Number(event.target.value))} data-testid="operator-borrow-hours">
            {[1, 3, 6, 12].map((one) => (
              <option key={one} value={one}>
                {t("screens.operator.borrow.hours", { count: one })}
              </option>
            ))}
          </NativeSelect>
        </label>
        <p className="text-xs text-muted-foreground">{t("screens.operator.borrow.until", { time: until })}</p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {screens === null && !error ? <p className="text-sm text-muted-foreground">{t("screens.operator.connecting")}</p> : null}
        {screens?.length === 0 ? <p className="text-sm text-muted-foreground">{t("screens.operator.borrow.none")}</p> : null}
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {screens?.map((screen) => (
            <li key={screen.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5" data-testid="operator-borrow-screen" data-screen={screen.id}>
              <span className={cn("size-2 shrink-0 rounded-full", screen.online ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-label={screen.online ? t("screens.operator.borrow.online") : t("screens.operator.notConnected")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{screen.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{shows(screen)}</span>
              </span>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy !== null} onClick={() => void borrow(screen)} data-testid="operator-borrow-go">
                {t("screens.operator.borrow.go")}
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** A screen borrowed for the set (issue #480): until when, and given back now. */
function GiveBack({ screen, borrowed, onGivenBack }: { screen: SetScreen; borrowed: { until: string; by: string }; onGivenBack?: () => void }) {
  const { t, i18n } = useTranslation();
  const { borrowing } = useOperatorHost();
  const [busy, setBusy] = useState(false);
  const until = new Date(borrowed.until).toLocaleTimeString(i18n.language, { timeStyle: "short" });
  const label = t("screens.operator.borrow.giveBack", { name: screen.name, time: until });
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-sky-600 dark:text-sky-400" data-testid="operator-screen-borrowed">
      {t("screens.operator.borrow.borrowedUntil", { time: until })}
      {borrowing ? (
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          disabled={busy}
          aria-label={label}
          title={label}
          onClick={() => {
            setBusy(true);
            void borrowing
              .giveBack(screen.id)
              .then(() => onGivenBack?.())
              .finally(() => setBusy(false));
          }}
          data-testid="operator-screen-give-back"
        >
          <CornerUpLeft />
        </Button>
      ) : null}
    </span>
  );
}
