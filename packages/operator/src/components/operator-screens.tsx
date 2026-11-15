import { readSyncLayers, SCREEN_SWITCHABLE_LAYERS, type ScreenSummary, type ScreenSwitchableLayer, type SetlistOfflineCopy, type SetScreenLooks, type SyncMember, type SyncStageCommand } from "@oneverse/core";
import { Grid2x2, Layers, MonitorOff, RotateCcw, Square, TvMinimal } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@oneverse/ui/components/popover";
import { cn } from "@oneverse/ui/lib/utils";
import { ScreenStage } from "@oneverse/screen/components/screen-stage";
import { setlistTitle } from "@oneverse/screen/lib/set-items";
import { useStageShowing } from "@oneverse/screen/lib/stage-showing";
import { useLive, useOperatorHost } from "../host";
import { changeOperatorDisplay, useOperatorDisplay } from "../lib/display-options";

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
}

function useSetScreens(expected: ScreenSummary[] | null): SetScreen[] {
  const { members } = useLive();
  const connected = members.filter((member): member is SyncMember & { screen: true } => !!member.screen);
  return [
    ...connected.map((member) => ({ id: member.id, name: member.name, connected: true, lastSeenAt: null })),
    ...(expected ?? []).filter((screen) => !connected.some((member) => member.id === screen.id)).map((screen) => ({ id: screen.id, name: screen.name, connected: false, lastSeenAt: screen.lastSeenAt })),
  ];
}

/**
 * The set's screens as they are (issue #358): each one drawn as it draws
 * the set now - its template, the slide on it, its layers - in a grid, or
 * one at a time picked by its tab, larger, with its layers beside it. Each
 * layer can be cleared on one screen from here, or hidden; the console's
 * Display options say which view, or none.
 */
export function ScreensView({ copy, expected, send }: { copy: SetlistOfflineCopy; expected: ScreenSummary[] | null; send: (command: SyncStageCommand) => void }) {
  const { t } = useTranslation();
  const display = useOperatorDisplay();
  const looks = useScreenLooks();
  const screens = useSetScreens(expected);
  const [picked, setPicked] = useState<string | null>(null);
  const one = screens.find((screen) => screen.id === picked) ?? screens.find((screen) => screen.connected) ?? screens[0] ?? null;
  const lookOf = (id: string) => looks?.screens.find((look) => look.id === id) ?? null;

  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={t("screens.operator.screensView.title")} data-testid="operator-screens-view" data-view={display.screens}>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{t("screens.operator.screensView.title")}</h2>
        <span className="text-xs text-muted-foreground">{t("screens.operator.screensView.count", { count: screens.filter((screen) => screen.connected).length })}</span>
        <div className="ml-auto flex items-center rounded-md border p-0.5" role="group" aria-label={t("screens.operator.screensView.view")}>
          {(
            [
              ["grid", Grid2x2],
              ["tabs", TvMinimal],
              ["off", Square],
            ] as const
          ).map(([view, Icon]) => (
            <Button
              key={view}
              size="sm"
              variant={display.screens === view ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              aria-pressed={display.screens === view}
              onClick={() => changeOperatorDisplay({ screens: view })}
              data-testid={`operator-screens-${view}`}
            >
              <Icon />
              {t(`screens.operator.screensView.${view}`)}
            </Button>
          ))}
        </div>
      </div>
      {display.screens === "off" ? null : screens.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("screens.noScreens")}</p>
      ) : display.screens === "grid" ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
          {screens.map((screen) => (
            <li key={screen.id}>
              <ScreenTile copy={copy} screen={screen} look={lookOf(screen.id)} looks={looks} send={send} />
            </li>
          ))}
        </ul>
      ) : one ? (
        <div className="flex flex-col gap-3">
          <div className="flex gap-1 overflow-x-auto border-b" role="tablist" aria-label={t("screens.operator.screensView.title")}>
            {screens.map((screen) => (
              <button
                key={screen.id}
                type="button"
                role="tab"
                aria-selected={screen.id === one.id}
                onClick={() => setPicked(screen.id)}
                className={cn("-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm", screen.id === one.id ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
                data-testid="operator-screen-tab"
                data-state={screen.connected ? "following" : "missing"}
              >
                <span className={cn("size-2 rounded-full", screen.connected ? "bg-emerald-500" : "bg-amber-500")} aria-hidden />
                {screen.name}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-4">
            <ScreenTile copy={copy} screen={one} look={lookOf(one.id)} looks={looks} send={send} large />
            {one.connected ? <LayersCard send={send} screen={one.id} /> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** One screen: its name and state, a picture of what it draws now, its layers to clear in a press. */
function ScreenTile({ copy, screen, look, looks, send, large = false }: { copy: SetlistOfflineCopy; screen: SetScreen; look: Look | null; looks: SetScreenLooks | null; send: (command: SyncStageCommand) => void; large?: boolean }) {
  const { t, i18n } = useTranslation();
  const { session, stage, offset } = useLive();
  const presenting = session?.presenting ?? null;
  const layers = readSyncLayers(stage?.layers);
  const own = !!layers.screens?.[screen.id];
  const showing = useStageShowing({ set: copy, credits: looks?.credits, presenting, stage, offset: offset ?? 0, screen: { id: screen.id, hiddenLayers: look?.hiddenLayers }, theme: look?.theme, itemThemes: look?.itemThemes });
  const idle = (
    <div className="flex size-full items-center justify-center p-[6%] text-center text-[clamp(0.6rem,4cqw,1.4rem)] text-neutral-400">
      {setlistTitle(copy.set, t, i18n.language)}
    </div>
  );
  return (
    <article className="flex min-w-0 flex-col gap-1.5" data-testid="operator-screen-tile" data-screen={screen.id} data-state={screen.connected ? "following" : "missing"} data-own-layers={own ? "" : undefined}>
      <header className="flex items-center gap-2 text-sm">
        <span className={cn("size-2 shrink-0 rounded-full", screen.connected ? "bg-emerald-500" : "bg-amber-500")} aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">{screen.name}</span>
        {own ? <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">{t("screens.operator.ownLayers")}</span> : null}
        {screen.connected && !large ? (
          <Popover>
            <PopoverTrigger render={<Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label={t("screens.operator.screensView.layersOf", { name: screen.name })} data-testid="operator-screen-layers" />}>
              <Layers />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <LayersCard send={send} screen={screen.id} />
            </PopoverContent>
          </Popover>
        ) : null}
      </header>
      <div className={cn("relative overflow-hidden rounded-md bg-black ring-1 ring-border [container-type:size]", !screen.connected && "opacity-50")} style={{ aspectRatio: "16/9" }}>
        {screen.connected ? (
          <ScreenStage className="absolute inset-0" theme={showing.look} song={showing.presented ? showing.song : null} slide={presenting?.slide ?? 0} black={!!presenting?.black} idle={idle} assets={looks?.assets ?? []} live={showing.live} />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-xs text-neutral-400" data-testid="operator-screen-missing">
            <MonitorOff className="size-5" aria-hidden />
            {screen.lastSeenAt ? t("screens.operator.lastSeen", { time: new Date(screen.lastSeenAt).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" }) }) : t("screens.operator.notConnected")}
          </div>
        )}
      </div>
      {look ? (
        <p className="truncate text-xs text-muted-foreground" data-testid="operator-screen-details">
          {[
            look.template.name ?? t(`screens.templates.${look.template.builtIn}.name`, { defaultValue: look.template.builtIn ?? "" }),
            look.hiddenLayers.length ? t("screens.operator.screensView.neverShows", { layers: look.hiddenLayers.map((layer) => t(`screens.layers.${layer}`)).join(", ") }) : null,
            look.effects ? null : t("screens.operator.screensView.effectsOff"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      {screen.connected ? <LayerChips send={send} screen={screen.id} /> : null}
    </article>
  );
}

/** What a layer is on a screen now: shown, cleared until the next slide, or hidden. */
function useLayerStates(screen: string | null) {
  const { stage, session } = useLive();
  const layers = readSyncLayers(stage?.layers);
  const state = (screen && layers.screens?.[screen]) || layers;
  const presenting = session?.presenting ?? null;
  const cleared = state.cleared && state.cleared.itemId === (presenting?.itemId ?? null) && state.cleared.slide === (presenting?.slide ?? 0) ? state.cleared.layers : [];
  const of = (layer: ScreenSwitchableLayer): "shown" | "cleared" | "hidden" => (state.hidden.includes(layer) ? "hidden" : cleared.includes(layer) ? "cleared" : "shown");
  return { layers, state, of };
}

/**
 * A screen's layers as chips (issue #358): one pressed clears that layer on
 * this screen until the next slide, pressed again brings it back; a hidden
 * one is shown again.
 */
function LayerChips({ send, screen }: { send: (command: SyncStageCommand) => void; screen: string }) {
  const { t } = useTranslation();
  const { of } = useLayerStates(screen);
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={t("screens.operator.layers")}>
      {[...SCREEN_SWITCHABLE_LAYERS].reverse().map((layer) => {
        const state = of(layer);
        return (
          <button
            key={layer}
            type="button"
            onClick={() => send({ layers: { screen, ...(state === "shown" ? { clear: [layer] } : { show: { [layer]: true } }) } })}
            title={state === "shown" ? t("screens.operator.screensView.clearOn", { layer: t(`screens.layers.${layer}`) }) : t("screens.operator.restoreLayer")}
            aria-pressed={state !== "shown"}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium",
              state === "shown" && "hover:bg-accent",
              state === "cleared" && "border-amber-500/60 bg-amber-500/15 text-amber-700 line-through dark:text-amber-300",
              state === "hidden" && "border-dashed text-muted-foreground line-through",
            )}
            data-testid={`operator-screen-layer-${layer}`}
            data-state={state}
          >
            {t(`screens.layers.${layer}`)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The screens' layers (issues #275, #280, #287): for every screen or one of
 * those connected, each layer shown or not, or cleared until the next slide;
 * the title card over everything; all back to normal. A screen's own
 * settings may keep some of them off whatever is chosen here. Given a
 * `screen`, that one's alone, with no choice of screen.
 */
export function LayersCard({ send, screen: fixed }: { send: (command: SyncStageCommand) => void; screen?: string }) {
  const { t } = useTranslation();
  const { members } = useLive();
  const screens = members.filter((member) => member.screen);
  const [target, setTarget] = useState("");
  // A screen gone: back to all of them.
  const screen = fixed ?? (screens.some((one) => one.id === target) ? target : "");
  const { layers, state, of } = useLayerStates(screen || null);
  const command = (change: Omit<NonNullable<SyncStageCommand["layers"]>, "screen">) => send({ layers: { ...change, ...(screen ? { screen } : {}) } });
  return (
    <section className="flex flex-col gap-3" data-testid="operator-layers" data-screen={screen || undefined}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{t("screens.operator.layers")}</h3>
        {fixed ? null : (
          <NativeSelect className="ml-auto h-8 w-auto text-xs" value={screen} onChange={(event) => setTarget(event.target.value)} aria-label={t("screens.operator.layersFor")} data-testid="operator-layers-for">
            <option value="">{t("screens.operator.allScreens")}</option>
            {screens.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
                {layers.screens?.[one.id] ? ` · ${t("screens.operator.ownLayers")}` : ""}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {[...SCREEN_SWITCHABLE_LAYERS].reverse().map((layer) => {
          const now = of(layer);
          const on = now !== "hidden";
          const isCleared = now === "cleared";
          return (
            <li key={layer} className="flex items-center gap-2 text-sm" data-testid={`operator-layer-${layer}`} data-state={now}>
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input type="checkbox" className="size-4 accent-primary" checked={on} onChange={() => command({ show: { [layer]: !on } })} data-testid={`operator-layer-${layer}-shown`} />
                <span className={cn("truncate", isCleared && "text-muted-foreground line-through")}>{t(`screens.layers.${layer}`)}</span>
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={!on}
                onClick={() => command(isCleared ? { show: { [layer]: true } } : { clear: [layer] })}
                title={t("screens.operator.clearHint")}
                data-testid={`operator-layer-${layer}-clear`}
              >
                {isCleared ? t("screens.operator.restoreLayer") : t("screens.operator.clearLayer")}
              </Button>
            </li>
          );
        })}
        <li className="flex items-center gap-2 border-t pt-2 text-sm">
          <label className="flex flex-1 items-center gap-2">
            <input type="checkbox" className="size-4 accent-primary" checked={state.title} onChange={() => command({ title: !state.title })} data-testid="operator-layer-title" />
            {t("screens.operator.layerTitle")}
          </label>
        </li>
      </ul>
      <Button variant="outline" size="sm" className="self-start" onClick={() => command({ reset: true })} data-testid="operator-layers-reset">
        <RotateCcw />
        {screen ? t("screens.operator.layersLikeAll") : t("screens.operator.layersReset")}
      </Button>
    </section>
  );
}
