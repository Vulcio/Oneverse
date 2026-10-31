import {
  formatTimer,
  readSyncTimer,
  readSyncLayers,
  SCREEN_SWITCHABLE_LAYERS,
  SYNC_STAGE_MESSAGE_MAX,
  type ScreenSwitchableLayer,
  type SetlistOfflineCopy,
  type SetlistSongView,
  type SongNote,
  type SyncPresenting,
  type SyncStageCommand,
  type TeamMember,
  type TeamPosition,
  slideKey,
  passName,
} from "@oneverse/core";
import { ChevronLeft, ChevronRight, Crown, Keyboard, Layers, Minus, MonitorOff, MonitorUp, Pause, Play, Plus, RotateCcw, Send, Square, Timer, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { useMediaQuery } from "@oneverse/ui/hooks/use-media-query";
import { Popover, PopoverContent, PopoverTrigger } from "@oneverse/ui/components/popover";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@oneverse/ui/components/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@oneverse/ui/components/tabs";
import { cn } from "@oneverse/ui/lib/utils";
import { setItemTitle, setItemView } from "@oneverse/screen/lib/set-items";
import { useLive, useOperatorHost } from "../host";
import { ContinueOnPulse } from "./continue-on-pulse";

/** A countdown's lengths, one press away (minutes). */
const PRESETS = [1, 3, 5, 10, 15, 30];
/** Quick messages' keys in the locale files (`screens.operator.quick.<key>`). */
const QUICK = ["wrapUp", "oneMinute", "nextSong", "louder", "slowDown", "repeat"] as const;

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
  useOperatorKeys({ copy, itemId, onLook, onLayers: send, enabled: sync.ready && sync.canOperate });

  return (
    <div className="flex flex-col gap-4" data-testid="operator">
      <div className="flex flex-wrap items-center gap-3">
        {back}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{t("screens.operator.title")}</h1>
          <p className="truncate text-sm text-muted-foreground">{title}</p>
        </div>
        <ShortcutsHelp />
        <Button variant={drawer ? "secondary" : "outline"} aria-pressed={drawer} onClick={() => setDrawer(!drawer)} data-testid="operator-drawer-open">
          <Layers />
          {t("screens.operator.screensAndLayers")}
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
          <ScreensList />
          <LayersCard send={send} />
        </div>
      ) : !sync.canOperate ? (
        <p className="text-sm text-muted-foreground" data-testid="operator-not-allowed">
          {t("screens.operator.notAllowed")}
        </p>
      ) : (
        <>
          <ControlBar />
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
              <SlidesTab copy={copy} view={copy.songs.find((one) => one.item.id === itemId) ?? null} members={members} positions={positions} />
            </TabsContent>
            <TabsContent value="stage" className="pt-2">
              <div className="grid gap-6 xl:grid-cols-2">
                <OnScreens copy={copy} />
                <TimerCard send={send} />
                <MessageCard send={send} />
              </div>
            </TabsContent>
          </Tabs>
          <ScreensPanel open={drawer} onOpenChange={setDrawer} send={send} />
        </>
      )}
    </div>
  );
}

/**
 * Who runs the screens (issue #275): the leader, or this operator - shared
 * with the leader's Live or alone - and the whole lead, one press away.
 */
function ControlBar() {
  const { t } = useTranslation();
  const sync = useLive();
  const { takeScreens, lead } = useOperatorHost();
  const session = sync.session;
  const screens = session?.screens ?? null;
  const mine = sync.screensMine;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2" data-testid="operator-control" data-control={mine ? (screens?.exclusive ? "exclusive" : "shared") : "none"}>
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
  );
}

/** Each item's slides (issue #277): what the arrows step through, from one song into the next, and what they say (issue #247). */
function useSetSlides(copy: SetlistOfflineCopy) {
  return useMemo(
    () =>
      copy.songs.map((view) => {
        const { slides } = setItemView(view);
        return { itemId: view.item.id, count: slides.length, key: slideKey(slides) };
      }),
    [copy],
  );
}

/** The operator's keys (issue #277), as the page lists them: `screens.operator.keys.<id>`. */
const OPERATOR_KEYS = [
  { id: "next", keys: ["→", "↓", "Page Down"] },
  { id: "previous", keys: ["←", "↑", "Page Up"] },
  { id: "present", keys: ["Enter"] },
  { id: "firstLast", keys: ["Home", "End"] },
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
 * black the screens, stop presenting and switch the layers. Not while typing;
 * ahead of the tabs' own arrow keys.
 */
function useOperatorKeys({ copy, itemId, onLook, onLayers, enabled }: { copy: SetlistOfflineCopy; itemId: string | null; onLook: (itemId: string) => void; onLayers: (command: SyncStageCommand) => void; enabled: boolean }) {
  const sync = useLive();
  const { present: presentScreens } = useOperatorHost();
  const canPresent = useCanPresent();
  const slides = useSetSlides(copy);
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
                  <kbd key={key} className="rounded border bg-muted px-1.5 font-mono text-xs">
                    {key}
                  </kbd>
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
function noPanelRoom(_open: boolean) {}

/**
 * An item's slides as tiles (issue #275), coloured by section, the one on the
 * screens picked out: a tile sends its slide. Its notes beside them, if
 * asked: all, or those written by people holding one of the team's positions.
 */
function SlidesTab({ copy, view, members, positions }: { copy: SetlistOfflineCopy; view: SetlistSongView | null; members: TeamMember[]; positions: TeamPosition[] }) {
  const { t } = useTranslation();
  const { session } = useLive();
  const { present: presentScreens } = useOperatorHost();
  const canPresent = useCanPresent();
  const presenting = session?.presenting ?? null;
  const [notesShown, setNotesShown] = useState(false);
  const [position, setPosition] = useState("");
  // A song's chart and lyrics, a text's paragraphs (issue #305), or a passage's verses (issue #301).
  const { chart, slides } = useMemo(() => (view ? setItemView(view) : { chart: null, slides: [] }), [view]);
  if (!view || (!view.song && !view.text && !view.passage)) return <p className="text-sm text-muted-foreground">{t("screens.operator.noSong")}</p>;
  if (view.passage && slides.length === 0) return <p className="text-sm text-muted-foreground" data-testid="operator-passage-hidden">{t(view.passage.projection ? "sets.passage.missing" : "sets.passage.notProjected")}</p>;
  const itemId = view.item.id;
  const here = presenting?.itemId === itemId ? presenting.slide : null;
  const send = (slide: number) => presentScreens({ itemId, slide, black: false, slideKey: slideKey(slides) });
  // The notes (issue #275): those on the song, filtered by their writers' team position.
  const holders = new Set(position ? members.filter((member) => member.positionIds?.includes(position)).map((member) => member.userId) : []);
  const notes = notesShown && view.song ? (copy.notes[view.song.id]?.notes ?? []).filter((note) => !note.resolved && (!position || holders.has(note.author.id))) : [];
  const notesFor = (passIndex: number): SongNote[] => {
    const pass = chart?.passes[passIndex];
    if (!pass) return [];
    return notes.filter((note) => note.anchor.kind !== "song" && ("passId" in note.anchor && note.anchor.passId ? note.anchor.passId === pass.id : "sectionId" in note.anchor && note.anchor.sectionId === pass.section.id));
  };
  const songNotes = notes.filter((note) => note.anchor.kind === "song");

  return (
    <div className="flex flex-col gap-3" data-testid="operator-slides">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" disabled={!canPresent || here === null || here <= 0} onClick={() => here !== null && send(here - 1)} aria-label={t("screens.previousSlide")}>
          <ChevronLeft />
        </Button>
        <Button size="icon" variant="outline" disabled={!canPresent || (here !== null && here >= slides.length - 1)} onClick={() => send(here === null ? 0 : here + 1)} aria-label={t("screens.nextSlide")} data-testid="operator-next">
          <ChevronRight />
        </Button>
        <Button
          size="sm"
          variant={presenting?.black ? "default" : "outline"}
          disabled={!canPresent || !presenting}
          aria-pressed={!!presenting?.black}
          onClick={() => presenting && presentScreens({ ...presenting, black: !presenting.black })}
          data-testid="operator-black"
        >
          <MonitorOff />
          {t("screens.blackButton")}
        </Button>
        <Button size="sm" variant="ghost" disabled={!canPresent || !presenting} onClick={() => presentScreens(null)} data-testid="operator-stop">
          <Square />
          {t("screens.stopPresenting")}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="accent-primary" checked={notesShown} onChange={(e) => setNotesShown(e.target.checked)} data-testid="operator-notes" />
            {t("screens.operator.showNotes")}
          </label>
          {notesShown && positions.length > 0 ? (
            <NativeSelect value={position} onChange={(e) => setPosition(e.target.value)} aria-label={t("screens.operator.notesOf")} data-testid="operator-notes-position" compact>
              <option value="">{t("screens.operator.allNotes")}</option>
              {positions.map((one) => (
                <option key={one.id} value={one.id}>
                  {t("screens.operator.notesByPosition", { position: one.name })}
                </option>
              ))}
            </NativeSelect>
          ) : null}
        </div>
      </div>
      {!canPresent && session?.screens?.exclusive ? (
        <p className="text-xs text-muted-foreground" data-testid="operator-locked">
          {t(session.screens.online === false ? "screens.operator.lockedByOffline" : "screens.operator.lockedBy", { name: session.screens.name })}
        </p>
      ) : null}
      {songNotes.length > 0 ? <NotesList notes={songNotes} /> : null}
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
        {slides.map((slide, index) => {
          const pass = chart?.passes[slide.passIndex];
          const first = index === 0 || slides[index - 1]!.passIndex !== slide.passIndex;
          const passNotes = first ? notesFor(slide.passIndex) : [];
          return (
            <li key={index} className="flex flex-col gap-1">
              <button
                type="button"
                disabled={!canPresent}
                onClick={() => send(index)}
                data-section-color={pass?.section.type}
                className={cn(
                  "flex min-h-24 flex-col gap-1 rounded-lg border-2 bg-[var(--section-tint)] p-2 text-left text-sm enabled:hover:border-[var(--section-line)] disabled:cursor-not-allowed",
                  here === index ? "border-primary ring-2 ring-primary/30" : "border-[var(--section-line)]/40",
                  here === index && presenting?.black && "opacity-60",
                )}
                aria-current={here === index ? "true" : undefined}
                data-testid="operator-slide"
                data-slide={index}
              >
                <span className="flex items-center gap-1">
                  {first && pass ? (
                    <span className="rounded bg-[var(--section-tag)] px-1.5 text-[10px] font-semibold tracking-wide text-[var(--section-ink)] uppercase">
                      {passName(pass, pass.section, pass.section.number, (type) => t(`chart.sections.${type}`))}
                    </span>
                  ) : null}
                  <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{index + 1}</span>
                </span>
                {slide.lines.length ? slide.lines.map((line, i) => <span key={i} className="leading-snug">{line}</span>) : <span className="text-muted-foreground italic">{t("screens.noWords")}</span>}
              </button>
              {passNotes.length > 0 ? <NotesList notes={passNotes} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NotesList({ notes }: { notes: SongNote[] }) {
  return (
    <ul className="flex flex-col gap-1" data-testid="operator-note-list">
      {notes.map((note) => (
        <li key={note.id} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs" data-testid="operator-note">
          <span className="font-semibold">{note.author.displayName}: </span>
          {note.content}
        </li>
      ))}
    </ul>
  );
}

/** From here the panel is a column down the right, as the Display panel's (issue #209). */
const WIDE = "(min-width: 1024px)";

/**
 * Screens & layers (issues #275, #278): the Display panel's kind of drawer -
 * modeless, so the slides, the sidebar and the keys still work beside it; a
 * column down the right that the page makes room for on a large screen, at
 * the bottom on a phone.
 */
function ScreensPanel({ open, onOpenChange, send }: { open: boolean; onOpenChange: (open: boolean) => void; send: (command: SyncStageCommand) => void }) {
  const { t } = useTranslation();
  const wide = useMediaQuery(WIDE);
  const usePanelRoom = useOperatorHost().usePanelRoom ?? noPanelRoom;
  usePanelRoom(open && wide);
  return (
    <Drawer modal={false} disablePointerDismissal open={open} onOpenChange={onOpenChange} swipeDirection={wide ? "right" : "down"}>
      <DrawerContent side={wide ? "right" : "bottom"} data-testid="operator-drawer" aria-label={t("screens.operator.screensAndLayers")}>
        <div className={cn("flex items-center gap-2 border-b px-3 pb-2", wide && "pt-3")}>
          <DrawerTitle className="flex items-center gap-2">
            <Layers className="size-4 text-muted-foreground" aria-hidden />
            {t("screens.operator.screensAndLayers")}
          </DrawerTitle>
          <DrawerClose render={<Button variant="ghost" size="icon" className="ml-auto size-8" />} aria-label={t("screens.operator.closePanel")} data-testid="operator-drawer-close">
            <X aria-hidden />
          </DrawerClose>
        </div>
        <div className="flex flex-col gap-6 overflow-y-auto px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="text-xs text-muted-foreground">{t("screens.operator.drawerDescription")}</p>
          <ScreensList />
          <LayersCard send={send} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** The screens connected to the set now (issue #275). */
function ScreensList() {
  const { t } = useTranslation();
  const { members } = useLive();
  const screens = members.filter((member) => member.screen);
  return (
    <section className="flex flex-col gap-2" data-testid="operator-screens">
      <h3 className="text-sm font-semibold">{t("screens.operator.connectedScreens")}</h3>
      {screens.length === 0 ? <p className="text-sm text-muted-foreground">{t("screens.noScreens")}</p> : null}
      <ul className="flex flex-col gap-1">
        {screens.map((screen) => (
          <li key={screen.id} className="flex items-center gap-2 text-sm">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
            {screen.name}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The screens' layers (issues #275, #280, #287): for every screen or one of
 * those connected, each layer shown or not, or cleared until the next slide;
 * the title card over everything; all back to normal. A screen's own
 * settings may keep some of them off whatever is chosen here.
 */
function LayersCard({ send }: { send: (command: SyncStageCommand) => void }) {
  const { t } = useTranslation();
  const { stage, session, members } = useLive();
  const screens = members.filter((member) => member.screen);
  const [target, setTarget] = useState("");
  // A screen gone: back to all of them.
  const screen = screens.some((one) => one.id === target) ? target : "";
  const layers = readSyncLayers(stage?.layers);
  const state = (screen && layers.screens?.[screen]) || layers;
  const presenting = session?.presenting ?? null;
  const cleared = state.cleared && state.cleared.itemId === (presenting?.itemId ?? null) && state.cleared.slide === (presenting?.slide ?? 0) ? state.cleared.layers : [];
  const command = (change: Omit<NonNullable<SyncStageCommand["layers"]>, "screen">) => send({ layers: { ...change, ...(screen ? { screen } : {}) } });
  return (
    <section className="flex flex-col gap-3" data-testid="operator-layers">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{t("screens.operator.layers")}</h3>
        <NativeSelect className="ml-auto h-8 w-auto text-xs" value={screen} onChange={(event) => setTarget(event.target.value)} aria-label={t("screens.operator.layersFor")} data-testid="operator-layers-for">
          <option value="">{t("screens.operator.allScreens")}</option>
          {screens.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name}
              {layers.screens?.[one.id] ? ` · ${t("screens.operator.ownLayers")}` : ""}
            </option>
          ))}
        </NativeSelect>
      </div>
      <ul className="flex flex-col gap-1.5">
        {[...SCREEN_SWITCHABLE_LAYERS].reverse().map((layer) => {
          const on = !state.hidden.includes(layer);
          const isCleared = on && cleared.includes(layer);
          return (
            <li key={layer} className="flex items-center gap-2 text-sm" data-testid={`operator-layer-${layer}`} data-state={!on ? "hidden" : isCleared ? "cleared" : "shown"}>
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

/** What the screens show now: the song and its slide, or nothing presented. */
function OnScreens({ copy }: { copy: SetlistOfflineCopy }) {
  const { t } = useTranslation();
  const { session } = useLive();
  const presenting = session?.presenting ?? null;
  const view = presenting ? copy.songs.find((one) => one.item.id === presenting.itemId) : undefined;
  const slides = useMemo(() => (view ? setItemView(view).slides : []), [view]);
  const slide = presenting ? slides[presenting.slide] : undefined;
  return (
    <Card className="lg:col-span-2" data-testid="operator-on-screens">
      <CardHeader>
        <CardTitle className="text-base">{t("screens.operator.onScreens")}</CardTitle>
      </CardHeader>
      <CardContent>
        {!presenting || !view || (!view.song && !view.text && !view.passage) ? (
          <p className="text-sm text-muted-foreground">{t("screens.operator.notPresenting")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {setItemTitle(view, t)} · {t("screens.slideOf", { slide: presenting.slide + 1, count: slides.length })}
              {presenting.black ? ` · ${t("screens.black")}` : ""}
            </p>
            <p className={cn("text-lg", presenting.black && "opacity-40")}>{slide?.lines.join(" / ") || t("screens.noWords")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The stage's timer: what it shows now, and its controls. */
function TimerCard({ send }: { send: (command: SyncStageCommand) => void }) {
  const { t } = useTranslation();
  const { stage, offset } = useLive();
  const timer = stage?.timer ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);
  const [minutes, setMinutes] = useState("");
  const reading = timer ? readSyncTimer(timer, now + (offset ?? 0)) : null;

  function custom(event: FormEvent) {
    event.preventDefault();
    const value = Math.round(Number(minutes) * 60);
    if (value > 0 && value <= 86_400) {
      send({ timer: { kind: "countdown", duration: value } });
      setMinutes("");
    }
  }

  return (
    <Card data-testid="operator-timer">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Timer className="size-5" />
          {t("screens.operator.timer")}
        </CardTitle>
        <CardDescription>{t("screens.operator.timerDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p
          className={cn("text-center font-mono text-6xl font-semibold tabular-nums", !timer && "text-muted-foreground", reading?.overtime && "text-red-500", reading?.warn && "text-amber-500")}
          data-testid="operator-timer-readout"
          data-running={reading?.running ? "" : undefined}
        >
          {reading ? formatTimer(reading.seconds, reading.overtime) : "–:––"}
        </p>
        <p className="text-center text-xs text-muted-foreground">
          {!timer ? t("screens.operator.noTimer") : timer.kind === "countdown" ? t("screens.operator.countdownOf", { time: formatTimer(timer.duration) }) : t("screens.operator.countUp")}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button disabled={!timer} onClick={() => send({ run: !timer?.startedAt })} data-testid="operator-timer-run">
            {timer?.startedAt ? <Pause /> : <Play />}
            {timer?.startedAt ? t("screens.operator.pause") : t("screens.operator.start")}
          </Button>
          <Button variant="outline" disabled={!timer} onClick={() => send({ reset: true })} data-testid="operator-timer-reset">
            <RotateCcw />
            {t("screens.operator.reset")}
          </Button>
          <Button variant="outline" size="icon" disabled={!timer} onClick={() => send({ add: -60 })} aria-label={t("screens.operator.minuteLess")}>
            <Minus />
          </Button>
          <Button variant="outline" size="icon" disabled={!timer} onClick={() => send({ add: 60 })} aria-label={t("screens.operator.minuteMore")} data-testid="operator-timer-more">
            <Plus />
          </Button>
          <Button variant="ghost" disabled={!timer} onClick={() => send({ timer: null })} data-testid="operator-timer-clear">
            <X />
            {t("screens.operator.clearTimer")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {PRESETS.map((one) => (
            <Button key={one} size="sm" variant="outline" onClick={() => send({ timer: { kind: "countdown", duration: one * 60 } })} data-testid={`operator-preset-${one}`}>
              {formatTimer(one * 60)}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => send({ timer: { kind: "count-up", duration: 0 }, run: true })} data-testid="operator-count-up">
            {t("screens.operator.countUp")}
          </Button>
          <form className="flex items-center gap-1" onSubmit={custom}>
            <Input type="number" min={1} max={1440} step="any" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder={t("screens.operator.minutes")} className="h-8 w-24" data-testid="operator-custom-minutes" />
            <Button size="sm" type="submit" variant="secondary" disabled={!minutes} data-testid="operator-custom-set">
              {t("screens.operator.set")}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

/** A message to the stage: typed, or one of the quick ones; on the screens until it's cleared. */
function MessageCard({ send }: { send: (command: SyncStageCommand) => void }) {
  const { t } = useTranslation();
  const { stage } = useLive();
  const [text, setText] = useState("");
  const shown = stage?.message?.text ?? null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    send({ message: text });
    setText("");
  };
  return (
    <Card data-testid="operator-message">
      <CardHeader>
        <CardTitle className="text-base">{t("screens.operator.message")}</CardTitle>
        <CardDescription>{t("screens.operator.messageDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className={cn("flex min-h-12 items-center gap-2 rounded-md border px-3 py-2", shown ? "border-red-500/50 bg-red-500/10" : "text-muted-foreground")} data-testid="operator-message-shown">
          <p className="min-w-0 flex-1 text-sm">{shown ?? t("screens.operator.noMessage")}</p>
          {shown ? (
            <Button size="sm" variant="outline" onClick={() => send({ message: null })} data-testid="operator-message-clear">
              {t("screens.operator.clearMessage")}
            </Button>
          ) : null}
        </div>
        <form className="flex gap-2" onSubmit={submit}>
          <Input value={text} maxLength={SYNC_STAGE_MESSAGE_MAX} onChange={(e) => setText(e.target.value)} placeholder={t("screens.operator.messagePlaceholder")} aria-label={t("screens.operator.message")} data-testid="operator-message-input" />
          <Button type="submit" disabled={!text.trim()} data-testid="operator-message-send">
            <Send />
            {t("screens.operator.send")}
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {QUICK.map((key) => (
            <Button key={key} size="sm" variant="outline" onClick={() => send({ message: t(`screens.operator.quick.${key}`) })} data-testid={`operator-quick-${key}`}>
              {t(`screens.operator.quick.${key}`)}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
