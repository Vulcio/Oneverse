import {
  readSyncLayers,
  type ScreenSummary,
  type ScreenSwitchableLayer,
  type SetlistOfflineCopy,
  type SyncPresenting,
  type SyncStageCommand,
  type TeamMember,
  type TeamPosition,
} from "@oneverse/core";
import { Crown, Keyboard, Layers, MonitorUp, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { useMediaQuery } from "@oneverse/ui/hooks/use-media-query";
import { Popover, PopoverContent, PopoverTrigger } from "@oneverse/ui/components/popover";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@oneverse/ui/components/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@oneverse/ui/components/tabs";
import { cn } from "@oneverse/ui/lib/utils";
import { useLive, useOperatorHost } from "../host";
import { ContinueOnPulse } from "./continue-on-pulse";
import { Rundown, useOperatorItems, type OperatorItem } from "./operator-rundown";
import { MessageCard, OperatorPresetsProvider, TimersCard } from "./operator-stage";
import { Kbd } from "@oneverse/ui/components/kbd";
import { ScreensView } from "./operator-screens";
import { changeOperatorDisplay, useOperatorDisplay } from "../lib/display-options";
import { DisplayMenu, SlidesTab } from "./operator-slides";

/** The console's width from which the running order gets its own column beside the slides (px). */
const TWO_COLUMNS = 860;

/** An element's width, as it changes (the console's own: beside a sidebar or a panel, not the window's). */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * The operator's console for a set (issues #269, #275, #277, #305), in any
 * app that hosts it (see host.tsx): the item looked at's slides as tiles to
 * send to the screens - coloured by section, notes shown if asked, all or
 * those of a team position - or the timer, messages and what's on the
 * screens; a panel with the screens and their layers, beside the page as the
 * Display panel is (issue #278). It follows the set without playing along
 * (no metronome, no stems). Anyone who runs screens presents, beside the
 * leader and whoever else may (issue #305), and may lock control to this
 * device; who can lead may take the whole lead. The keyboard moves the
 * slides and runs the rest (OPERATOR_KEYS). Someone who only routes the
 * screens (issue #322) gets their layers alone. `back` and `title` head it;
 * `itemId` is the item looked at, `onLook` looks at another.
 */
export function OperatorConsole({
  copy,
  members,
  positions,
  itemId,
  onLook,
  back,
  title,
}: {
  copy: SetlistOfflineCopy;
  members: TeamMember[];
  positions: TeamPosition[];
  itemId: string | null;
  onLook: (itemId: string) => void;
  back?: ReactNode;
  title: ReactNode;
}) {
  const { t } = useTranslation();
  const sync = useLive();
  const { sendStage: send } = useOperatorHost();
  const [drawer, setDrawer] = useState(false);
  const items = useOperatorItems(copy);
  const expected = useExpectedScreens();
  useOperatorKeys({ items, itemId, onLook, onLayers: send, enabled: sync.ready && sync.canOperate });
  const root = useRef<HTMLDivElement>(null);
  const width = useWidth(root);
  const view = copy.songs.find((one) => one.item.id === itemId) ?? null;
  const slidesTab = <SlidesTab copy={copy} view={view} item={items.find((one) => one.itemId === itemId) ?? null} members={members} positions={positions} />;
  const columns = width >= TWO_COLUMNS ? 2 : 1;

  return (
    <div ref={root} className="@container flex flex-col gap-4" data-testid="operator" data-columns={columns}>
      <div className="flex flex-wrap items-center gap-3">
        {back}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{t("screens.operator.title")}</h1>
          <p className="truncate text-sm text-muted-foreground">{title}</p>
        </div>
        <ShortcutsHelp />
        <DisplayMenu />
        <Button variant={drawer ? "secondary" : "outline"} aria-pressed={drawer} onClick={() => setDrawer(!drawer)} title={t("screens.operator.screensAndLayers")} data-testid="operator-drawer-open">
          <Layers />
          {/* Narrow, beside the panel: the icon alone, so the header stays one line. */}
          <span className="@max-3xl:sr-only">{t("screens.operator.screensAndLayers")}</span>
        </Button>
      </div>

      {!sync.ready ? (
        <>
          <ContinueOnPulse />
          <p className="text-sm text-muted-foreground">{sync.error ?? t("screens.operator.connecting")}</p>
        </>
      ) : !sync.canOperate && sync.canRoute ? (
        <div className="grid gap-6 xl:grid-cols-2" data-testid="operator-route-only">
          <p className="text-sm text-muted-foreground xl:col-span-2">{t("screens.operator.routeOnly")}</p>
          <div className="xl:col-span-2">
            <ScreensView copy={copy} expected={expected} send={send} />
          </div>
        </div>
      ) : !sync.canOperate ? (
        <p className="text-sm text-muted-foreground" data-testid="operator-not-allowed">
          {t("screens.operator.notAllowed")}
        </p>
      ) : (
        <OperatorPresetsProvider>
          <ControlBar items={items} expected={expected} onScreens={() => setDrawer(true)} />
          {/* The slides first (issue #358): the rundown down the left when there's room, a strip above them when not, and the timers and messages a tab away. */}
          <div className={cn("grid items-start gap-5", columns === 2 && "grid-cols-[13rem_minmax(0,1fr)]")} data-testid="operator-columns">
            {columns === 2 ? (
              <div className="sticky top-4">
                <Rundown items={items} itemId={itemId} onLook={onLook} />
              </div>
            ) : null}
            <div className="flex min-w-0 flex-col gap-3">
              {columns === 1 ? <Rundown items={items} itemId={itemId} onLook={onLook} strip /> : null}
              <Tabs defaultValue="slides" className="min-w-0">
                <TabsList>
                  <TabsTrigger value="slides" data-testid="operator-tab-slides">
                    {t("screens.operator.tabSlides")}
                  </TabsTrigger>
                  <TabsTrigger value="stage" data-testid="operator-tab-stage">
                    {t("screens.operator.tabStage")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="slides" className="pt-2">
                  {slidesTab}
                </TabsContent>
                <TabsContent value="stage" className="pt-2">
                  <div className="grid gap-6 @2xl:grid-cols-2">
                    <TimersCard send={send} />
                    <MessageCard send={send} />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
          <ScreensPanel copy={copy} items={items} itemId={itemId} open={drawer} onOpenChange={setDrawer} send={send} expected={expected} />
        </OperatorPresetsProvider>
      )}
    </div>
  );
}

/**
 * The screens set to show this set (issue #358), connected or not, from the
 * API through the host: those not connected are named as missing. Read again
 * when the set's screens come and go. Null where the host can't tell.
 */
function useExpectedScreens(): ScreenSummary[] | null {
  const { listScreens } = useOperatorHost();
  const { members } = useLive();
  const connected = members
    .filter((member) => member.screen)
    .map((member) => member.id)
    .sort()
    .join(",");
  const [screens, setScreens] = useState<ScreenSummary[] | null>(null);
  useEffect(() => {
    if (!listScreens) return;
    let live = true;
    listScreens()
      .then((list) => live && setScreens(list.filter((one) => one.kind !== "PULSE")))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [listScreens, connected]);
  return screens;
}

/**
 * Who runs the screens (issue #275): the leader, or this operator - shared
 * with the leader's Live or alone - and the whole lead, one press away.
 */
function ControlBar({ items, expected, onScreens }: { items: OperatorItem[]; expected: ScreenSummary[] | null; onScreens: () => void }) {
  const { t } = useTranslation();
  const sync = useLive();
  const { takeScreens, lead } = useOperatorHost();
  const session = sync.session;
  const screens = session?.screens ?? null;
  const mine = sync.screensMine;
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2" data-testid="operator-control" data-control={mine ? (screens?.exclusive ? "exclusive" : "shared") : "none"}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm">
          {mine
            ? t(screens?.exclusive ? "screens.operator.youRunAlone" : "screens.operator.youRunShared")
            : screens
              ? t(screens.online === false ? "screens.operator.otherRunsOffline" : "screens.operator.otherRuns", { name: screens.name })
              : session
                ? t("screens.operator.leaderRuns", { name: session.leader.name })
                : t("screens.operator.nobodyRuns")}
          {sync.leading ? <span className="ml-2 text-xs text-muted-foreground">· {t("screens.operator.youLead")}</span> : null}
        </p>
        {mine ? (
          <>
            <Button size="sm" variant="outline" onClick={() => takeScreens(screens?.exclusive ? "shared" : "exclusive")} data-testid="operator-control-switch">
              {screens?.exclusive ? t("screens.operator.share") : t("screens.operator.runAlone")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => takeScreens(null)} data-testid="operator-control-release">
              {t("screens.operator.giveBack")}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => takeScreens("shared")} data-testid="operator-take-shared">
              <MonitorUp />
              {t("screens.operator.takeShared")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => takeScreens("exclusive")} data-testid="operator-take-exclusive">
              {t("screens.operator.takeAlone")}
            </Button>
          </>
        )}
        {!sync.leading && sync.canLead && lead ? (
          <Button size="sm" variant="ghost" onClick={lead} title={t("screens.operator.fullControlHint")} data-testid="operator-take-lead">
            <Crown />
            {t("screens.operator.fullControl")}
          </Button>
        ) : null}
      </div>
      <StateLine items={items} expected={expected} onScreens={onScreens} />
    </div>
  );
}

/**
 * Where things stand, at a glance (issue #358): what's on the screens, who
 * put it there, which screens follow and which are missing, whether this
 * device's last change is still on its way. A screen chip opens the panel.
 */
function StateLine({ items, expected, onScreens }: { items: OperatorItem[]; expected: ScreenSummary[] | null; onScreens: () => void }) {
  const { t } = useTranslation();
  const sync = useLive();
  const presenting = sync.session?.presenting ?? null;
  const item = presenting ? items.find((one) => one.itemId === presenting.itemId) : undefined;
  const connected = sync.members.filter((member) => member.screen);
  const missing = (expected ?? []).filter((screen) => !connected.some((member) => member.id === screen.id));
  const chip = "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs";
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t pt-2" data-testid="operator-state">
      <span className={cn(chip, presenting && !presenting.black ? "border-red-500/40 bg-red-500/10" : "text-muted-foreground")} data-testid="operator-state-presenting">
        <span className={cn("size-2 rounded-full", presenting && !presenting.black ? "bg-red-500" : "bg-muted-foreground/40")} aria-hidden />
        {!presenting || !item
          ? t("screens.operator.state.nothing")
          : presenting.black
            ? t("screens.operator.state.black", { title: item.title })
            : t("screens.operator.state.up", { title: item.title, slide: presenting.slide + 1, count: item.slides.length })}
      </span>
      <button type="button" onClick={onScreens} className={cn(chip, connected.length ? "" : "text-muted-foreground", "hover:bg-muted")} data-testid="operator-state-screens" data-count={connected.length}>
        <span className={cn("size-2 rounded-full", connected.length ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden />
        {connected.length ? t("screens.operator.state.following", { count: connected.length }) : t("screens.operator.state.noScreens")}
      </button>
      {missing.map((screen) => (
        <button type="button" key={screen.id} onClick={onScreens} className={cn(chip, "border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20")} data-testid="operator-state-missing">
          <span className="size-2 rounded-full bg-amber-500" aria-hidden />
          {t("screens.operator.state.missing", { name: screen.name })}
        </button>
      ))}
      {sync.sending ? (
        <span className={cn(chip, "text-muted-foreground")} data-testid="operator-state-sending">
          {t("screens.operator.state.sending")}
        </span>
      ) : null}
    </div>
  );
}

/** The operator's keys (issue #277), as the page lists them: `screens.operator.keys.<id>`. */
const OPERATOR_KEYS = [
  { id: "next", keys: ["→", "↓", "Page Down"] },
  { id: "previous", keys: ["←", "↑", "Page Up"] },
  { id: "present", keys: ["Enter"] },
  { id: "firstLast", keys: ["Home", "End"] },
  { id: "section", keys: ["1", "…", "9"] },
  { id: "black", keys: ["B", "."] },
  { id: "stop", keys: ["S"] },
  { id: "words", keys: ["W"] },
  { id: "background", keys: ["G"] },
  { id: "video", keys: ["V"] },
  { id: "overlays", keys: ["O"] },
  { id: "masks", keys: ["M"] },
  { id: "clearLayer", keys: ["Shift"] },
  { id: "title", keys: ["T"] },
  { id: "clearLayers", keys: ["C"] },
] as const;

/** The letters that switch a layer (issue #280), on every screen; with Shift, they clear it until the next slide. */
const LAYER_KEYS: Record<string, ScreenSwitchableLayer> = { w: "content", g: "media", v: "video", o: "overlays", m: "masks" };

/**
 * The keyboard, on the whole page (issue #277): the arrows move the slides on
 * the screens - past a song's last into the next song, before its first into
 * the previous one's last - Enter puts up the song looked at, and letters
 * black the screens, stop presenting and switch the layers; a digit goes to
 * that section of the song (issue #358). Not while typing;
 * ahead of the tabs' own arrow keys.
 */
function useOperatorKeys({ items, itemId, onLook, onLayers, enabled }: { items: OperatorItem[]; itemId: string | null; onLook: (itemId: string) => void; onLayers: (command: SyncStageCommand) => void; enabled: boolean }) {
  const sync = useLive();
  const { present: presentScreens } = useOperatorHost();
  const canPresent = useCanPresent();
  const slides = useMemo(() => items.map((item) => ({ itemId: item.itemId, count: item.slides.length, key: item.key, sections: item.sections })), [items]);
  // What these keys last sent, until the server's answer comes back: a key pressed again before it toggles from
  // there, not from a state the screens have already left (B twice quickly: black, then back).
  const sent = useRef<{ presenting?: SyncPresenting | null; layers?: { hidden: ScreenSwitchableLayer[]; title: boolean } }>({});
  useEffect(() => {
    sent.current.presenting = undefined;
  }, [sync.session?.presenting]);
  useEffect(() => {
    sent.current.layers = undefined;
  }, [sync.stage?.layers]);
  const handle = useRef<(event: KeyboardEvent) => void>(() => undefined);
  handle.current = (event) => {
    const target = event.target as HTMLElement | null;
    if (event.ctrlKey || event.metaKey || event.altKey || target?.closest("input, textarea, select, [contenteditable=true], [aria-roledescription=sortable]")) return;
    const presenting = sent.current.presenting !== undefined ? sent.current.presenting : (sync.session?.presenting ?? null);
    const layers = sent.current.layers ?? readSyncLayers(sync.stage?.layers);
    const show = (shown: SyncPresenting | null) => {
      // With what its slides say (issue #247).
      const next = shown && { ...shown, slideKey: slides.find((one) => one.itemId === shown.itemId)?.key };
      sent.current.presenting = next;
      presentScreens(next);
    };
    const toggle = (layer: ScreenSwitchableLayer) => {
      const shown = layers.hidden.includes(layer);
      sent.current.layers = { ...layers, hidden: shown ? layers.hidden.filter((one) => one !== layer) : [...layers.hidden, layer] };
      onLayers({ layers: { show: { [layer]: shown } } });
    };
    const present = (item: string, slide: number) => {
      show({ itemId: item, slide, black: false });
      if (item !== itemId) onLook(item);
    };
    const at = presenting ? slides.findIndex((one) => one.itemId === presenting.itemId) : -1;
    const step = (direction: 1 | -1) => {
      if (!presenting || at < 0) {
        const looked = slides.find((one) => one.itemId === itemId);
        if (direction === 1 && looked?.count) present(looked.itemId, 0);
        return;
      }
      const slide = presenting.slide + direction;
      if (slide >= 0 && slide < slides[at]!.count) return present(presenting.itemId, slide);
      // Into the next song with words, or back to the previous one's last slide.
      for (let i = at + direction; i >= 0 && i < slides.length; i += direction) {
        if (slides[i]!.count) return present(slides[i]!.itemId, direction === 1 ? 0 : slides[i]!.count - 1);
      }
    };
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const action: Record<string, () => void> = {
      ArrowRight: () => step(1),
      ArrowDown: () => step(1),
      PageDown: () => step(1),
      ArrowLeft: () => step(-1),
      ArrowUp: () => step(-1),
      PageUp: () => step(-1),
      Enter: () => {
        const looked = slides.find((one) => one.itemId === itemId);
        if (looked?.count && presenting?.itemId !== looked.itemId) present(looked.itemId, 0);
      },
      Home: () => presenting && present(presenting.itemId, 0),
      End: () => presenting && at >= 0 && slides[at]!.count && present(presenting.itemId, slides[at]!.count - 1),
      b: () => presenting && show({ ...presenting, black: !presenting.black }),
      ".": () => presenting && show({ ...presenting, black: !presenting.black }),
      s: () => presenting && show(null),
      t: () => {
        sent.current.layers = { ...layers, title: !layers.title };
        onLayers({ layers: { title: !layers.title } });
      },
      c: () => {
        sent.current.layers = { hidden: [], title: false };
        onLayers({ layers: { reset: true } });
      },
    };
    // A digit: that section of the song on the screens, else of the one looked at (issue #358).
    if (/^[1-9]$/.test(key)) {
      const song = slides.find((one) => one.itemId === (presenting?.itemId ?? itemId));
      const section = song?.sections[Number(key) - 1];
      if (song && section) action[key] = () => present(song.itemId, section.slide);
    }
    const layer = LAYER_KEYS[key];
    if (layer) action[key] = event.shiftKey ? () => onLayers({ layers: { clear: [layer] } }) : () => toggle(layer);
    const run = action[key];
    // A focused button or link keeps its own Enter.
    if (!run || (key === "Enter" && target?.closest("button, a"))) return;
    // The slides' keys need the screens; the layers are the stage's, anyone running it may switch them.
    if (!layer && !["t", "c"].includes(key) && !canPresent) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  };
  useEffect(() => {
    if (!enabled) return;
    const listen = (event: KeyboardEvent) => handle.current(event);
    // Captured: before a focused tab takes the arrows as its own.
    window.addEventListener("keydown", listen, true);
    return () => window.removeEventListener("keydown", listen, true);
  }, [enabled]);
}

/** The keys, listed (issue #277). */
function ShortcutsHelp() {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={t("screens.operator.keys.heading")} title={t("screens.operator.keys.heading")} data-testid="operator-keys" />}>
        <Keyboard />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80" data-testid="operator-keys-list">
        <p className="mb-2 text-sm font-semibold">{t("screens.operator.keys.heading")}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          {OPERATOR_KEYS.map((one) => (
            <div key={one.id} className="contents">
              <dt className="flex flex-wrap gap-1">
                {one.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dt>
              <dd className="text-muted-foreground">{t(`screens.operator.keys.${one.id}`)}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/** Whether this device may send slides (issue #305): it may present - leads, runs screens, can edit the set or was handed it - and control isn't locked to someone else. */
function useCanPresent() {
  return useLive().canPresent;
}

/** An app with no panel beside its page. */
function noPanelRoom(_open: boolean, _width?: string) {}

/** The panel's width down the right, unless it's been dragged wider or narrower (issue #358): room for two screens side by side. */
const PANEL_WIDTH = 448;
const PANEL_MIN = 280;
const panelMax = () => Math.max(PANEL_MIN, Math.round(window.innerWidth * 0.6));

/** From here the panel is a column down the right, as the Display panel's (issue #209). */
const WIDE = "(min-width: 1024px)";

/**
 * Screens & layers (issues #275, #278, #358): the Display panel's kind of
 * drawer - modeless, so the slides, the sidebar and the keys still work
 * beside it; a column down the right that the page makes room for on a large
 * screen, as wide as its edge is dragged; at the bottom on a phone.
 */
function ScreensPanel({ copy, items, itemId, open, onOpenChange, send, expected }: { copy: SetlistOfflineCopy; items: OperatorItem[]; itemId: string | null; open: boolean; onOpenChange: (open: boolean) => void; send: (command: SyncStageCommand) => void; expected: ScreenSummary[] | null }) {
  const { t } = useTranslation();
  const wide = useMediaQuery(WIDE);
  const stored = useOperatorDisplay().drawerWidth;
  const [dragging, setDragging] = useState<number | null>(null);
  const width = `${Math.min(dragging ?? stored ?? PANEL_WIDTH, typeof window === "undefined" ? Infinity : panelMax())}px`;
  const usePanelRoom = useOperatorHost().usePanelRoom ?? noPanelRoom;
  usePanelRoom(open && wide, width);
  return (
    <Drawer modal={false} disablePointerDismissal open={open} onOpenChange={onOpenChange} swipeDirection={wide ? "right" : "down"}>
      <DrawerContent side={wide ? "right" : "bottom"} style={{ "--drawer-side-width": width } as CSSProperties} data-testid="operator-drawer" aria-label={t("screens.operator.screensAndLayers")}>
        {wide ? <PanelEdge width={dragging ?? stored ?? PANEL_WIDTH} onDrag={setDragging} /> : null}
        <div className={cn("flex items-center gap-2 border-b px-3 pb-2", wide && "pt-3")}>
          <DrawerTitle className="flex items-center gap-2 text-base">
            <Layers className="size-4 text-muted-foreground" aria-hidden />
            {t("screens.operator.screensAndLayers")}
          </DrawerTitle>
          <DrawerClose render={<Button variant="ghost" size="icon" className="ml-auto size-8" />} aria-label={t("screens.operator.closePanel")} data-testid="operator-drawer-close">
            <X aria-hidden />
          </DrawerClose>
        </div>
        <div className="overflow-y-auto px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <ScreensView copy={copy} items={items} itemId={itemId} expected={expected} send={send} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * The panel's left edge, dragged to make it wider or narrower (issue #358),
 * or moved with the arrow keys; kept on the device once let go.
 */
function PanelEdge({ width, onDrag }: { width: number; onDrag: (width: number | null) => void }) {
  const { t } = useTranslation();
  const clamp = (value: number) => Math.round(Math.min(panelMax(), Math.max(PANEL_MIN, value)));
  const keep = (value: number) => {
    changeOperatorDisplay({ drawerWidth: clamp(value) });
    onDrag(null);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("screens.operator.resizePanel")}
      aria-valuenow={Math.round(width)}
      aria-valuemin={PANEL_MIN}
      tabIndex={0}
      className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:bg-transparent hover:after:bg-primary/40 focus-visible:after:bg-primary"
      data-testid="operator-drawer-resize"
      onPointerDown={(event) => {
        // Not the drawer's swipe to close: this edge only resizes.
        event.stopPropagation();
        event.preventDefault();
        const from = event.clientX;
        const start = width;
        let last = start;
        const move = (e: PointerEvent) => {
          last = clamp(start + from - e.clientX);
          onDrag(last);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          keep(last);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 64 : 16;
        if (event.key === "ArrowLeft") keep(width + step);
        else if (event.key === "ArrowRight") keep(width - step);
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onDoubleClick={() => {
        changeOperatorDisplay({ drawerWidth: null });
        onDrag(null);
      }}
    />
  );
}
