import {
  DEFAULT_SYNC_LAYERS,
  formatTimer,
  lyricSlides,
  readSyncTimer,
  renderChart,
  SYNC_STAGE_MESSAGE_MAX,
  type SetlistOfflineCopy,
  type SetlistSongView,
  type SongNote,
  type SyncStageCommand,
  type TeamMember,
  type TeamPosition,
} from "@songverse/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronLeft, ChevronRight, Crown, Layers, Minus, MonitorOff, MonitorUp, Pause, Play, Plus, RotateCcw, Send, Square, Timer, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@songverse/ui/components/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@songverse/ui/components/tabs";
import { apiClient } from "#/lib/api-client";
import { disableSync, enableSync, leadSync, presentScreens, screensLocked, sendStage, syncState, takeScreens, useSync } from "#/lib/sync-client";
import { setlistTitle } from "#/lib/setlists";
import { cn } from "@songverse/ui/lib/utils";

export const Route = createFileRoute("/_protected/sets/$setlistId_/operate")({
  loader: async ({ params }) => {
    const copy = await apiClient.getSetlistOffline(params.setlistId);
    // A team set's positions and who holds them (issue #275): its notes filtered by them.
    const teamId = copy.set.teamId;
    const [members, positions] = teamId ? await Promise.all([apiClient.listTeamMembers(teamId).catch(() => [] as TeamMember[]), apiClient.listTeamPositions(teamId).catch(() => [] as TeamPosition[])]) : [[], []];
    return { copy, members, positions };
  },
  component: OperatorPage,
});

/** A countdown's lengths, one press away (minutes). */
const PRESETS = [1, 3, 5, 10, 15, 30];
/** Quick messages' keys in the locale files (`screens.operator.quick.<key>`). */
const QUICK = ["wrapUp", "oneMinute", "nextSong", "louder", "slowDown", "repeat"] as const;

/**
 * The media operator's view of a set (issues #269, #275): the set's items on
 * the left, as in Live; in the middle, the item's slides as tiles to send
 * to the screens - coloured by section, notes shown if asked, all or those
 * of a team position - or the timer, messages and what's on the screens;
 * on the right, a drawer with the screens and their layers. It follows the
 * set without playing along (no metronome, no stems). It runs the screens
 * once it takes them - shared with the leader's Live, or alone - and can
 * take the whole lead.
 */
function OperatorPage() {
  const { t, i18n } = useTranslation();
  const { setlistId } = Route.useParams();
  const { copy } = Route.useLoaderData();
  const sync = useSync();
  useEffect(() => {
    // Turned on here: off again on leaving; already on (from Live), left as it was.
    const wasOn = syncState().setId === setlistId;
    enableSync(setlistId, false, { follow: false });
    return () => {
      if (!wasOn) disableSync();
    };
  }, [setlistId]);
  const ready = sync.setId === setlistId && sync.status === "on";
  const send = (command: SyncStageCommand) => sendStage(command);
  const presenting = sync.session?.presenting ?? null;
  // The item looked at: the one on the screens, until another's picked.
  const [picked, setPicked] = useState<string | null>(null);
  const itemId = picked ?? presenting?.itemId ?? sync.session?.itemId ?? copy.songs[0]?.item.id ?? null;
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="flex flex-col gap-4" data-testid="operator">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" render={<Link to="/sets/$setlistId" params={{ setlistId }} aria-label={t("screens.operator.back")} />}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{t("screens.operator.title")}</h1>
          <p className="truncate text-sm text-muted-foreground">{setlistTitle(copy.set, t, i18n.language)}</p>
        </div>
        <Button variant="outline" onClick={() => setDrawer(true)} data-testid="operator-drawer-open">
          <Layers />
          {t("screens.operator.screensAndLayers")}
        </Button>
      </div>

      {!ready ? (
        <p className="text-sm text-muted-foreground">{sync.error ?? t("screens.operator.connecting")}</p>
      ) : !sync.canLead ? (
        <p className="text-sm text-muted-foreground" data-testid="operator-not-allowed">
          {t("screens.operator.notAllowed")}
        </p>
      ) : (
        <>
          <ControlBar />
          <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <ItemsSidebar copy={copy} itemId={itemId} onPick={setPicked} />
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
                <SlidesTab copy={copy} view={copy.songs.find((one) => one.item.id === itemId) ?? null} />
              </TabsContent>
              <TabsContent value="stage" className="pt-2">
                <div className="grid gap-6 xl:grid-cols-2">
                  <OnScreens copy={copy} />
                  <TimerCard send={send} />
                  <MessageCard send={send} />
                </div>
              </TabsContent>
            </Tabs>
          </div>
          <Sheet open={drawer} onOpenChange={setDrawer}>
            <SheetContent side="right" className="w-[22rem] max-w-[90vw]" data-testid="operator-drawer">
              <SheetHeader>
                <SheetTitle>{t("screens.operator.screensAndLayers")}</SheetTitle>
                <SheetDescription>{t("screens.operator.drawerDescription")}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-6 px-4 pb-4">
                <ScreensList />
                <LayersCard send={send} />
              </div>
            </SheetContent>
          </Sheet>
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
  const sync = useSync();
  const session = sync.session;
  const screens = session?.screens ?? null;
  const mine = sync.screensMine;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2" data-testid="operator-control" data-control={mine ? (screens?.exclusive ? "exclusive" : "shared") : "none"}>
      <p className="min-w-0 flex-1 text-sm">
        {mine
          ? t(screens?.exclusive ? "screens.operator.youRunAlone" : "screens.operator.youRunShared")
          : screens
            ? t("screens.operator.otherRuns", { name: screens.name })
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
      {!sync.leading ? (
        <Button size="sm" variant="ghost" onClick={leadSync} title={t("screens.operator.fullControlHint")} data-testid="operator-take-lead">
          <Crown />
          {t("screens.operator.fullControl")}
        </Button>
      ) : null}
    </div>
  );
}

/** The set's items, as Live lists them: the one on the screens marked, the one looked at picked. */
function ItemsSidebar({ copy, itemId, onPick }: { copy: SetlistOfflineCopy; itemId: string | null; onPick: (itemId: string) => void }) {
  const { t } = useTranslation();
  const { session } = useSync();
  const shown = session?.presenting?.itemId;
  return (
    <nav className="flex flex-col gap-1 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto" aria-label={t("screens.operator.items")} data-testid="operator-items">
      {copy.songs.map((view, index) => (
        <button
          key={view.item.id}
          type="button"
          onClick={() => onPick(view.item.id)}
          aria-current={view.item.id === itemId ? "true" : undefined}
          className={cn("flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm", view.item.id === itemId ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted")}
          data-testid="operator-item"
          data-on-screens={view.item.id === shown ? "" : undefined}
        >
          <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate">{view.song?.title ?? t("sets.hiddenSong")}</span>
          {view.item.id === shown ? <span className="size-2 shrink-0 rounded-full bg-red-500" aria-label={t("screens.operator.onScreens")} /> : null}
        </button>
      ))}
    </nav>
  );
}

/** Whether this device may send slides: it runs the screens, or it leads and nobody has them alone. */
function useCanPresent() {
  const sync = useSync();
  return sync.screensMine || (sync.leading && !screensLocked(sync));
}

/**
 * An item's slides as tiles (issue #275), coloured by section, the one on the
 * screens picked out: a tile sends its slide. Its notes beside them, if
 * asked: all, or those written by people holding one of the team's positions.
 */
function SlidesTab({ copy, view }: { copy: SetlistOfflineCopy; view: SetlistSongView | null }) {
  const { t } = useTranslation();
  const { members, positions } = Route.useLoaderData();
  const { session } = useSync();
  const canPresent = useCanPresent();
  const presenting = session?.presenting ?? null;
  const [notesShown, setNotesShown] = useState(false);
  const [position, setPosition] = useState("");
  const chart = useMemo(() => (view?.song ? renderChart(view.song.document, view.arrangement?.document ?? null, { transposeSteps: view.item.transposeSteps }) : null), [view]);
  const slides = useMemo(() => (chart ? lyricSlides(chart) : []), [chart]);
  if (!view?.song || !chart) return <p className="text-sm text-muted-foreground">{t("screens.operator.noSong")}</p>;
  const itemId = view.item.id;
  const here = presenting?.itemId === itemId ? presenting.slide : null;
  const send = (slide: number) => presentScreens({ itemId, slide, black: false });
  // The notes (issue #275): those on the song, filtered by their writers' team position.
  const holders = new Set(position ? members.filter((member) => member.positionIds?.includes(position)).map((member) => member.userId) : []);
  const notes = notesShown ? (copy.notes[view.song.id]?.notes ?? []).filter((note) => !note.resolved && (!position || holders.has(note.author.id))) : [];
  const notesFor = (passIndex: number): SongNote[] => {
    const pass = chart.passes[passIndex];
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
      {!canPresent ? <p className="text-xs text-muted-foreground">{t("screens.operator.takeFirst")}</p> : null}
      {songNotes.length > 0 ? <NotesList notes={songNotes} /> : null}
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
        {slides.map((slide, index) => {
          const pass = chart.passes[slide.passIndex];
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
                  {first ? (
                    <span className="rounded bg-[var(--section-tag)] px-1.5 text-[10px] font-semibold tracking-wide text-[var(--section-ink)] uppercase">
                      {pass?.label ?? pass?.section.label ?? t(`chart.sections.${pass?.section.type ?? "verse"}`)}
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

/** The screens connected to the set now (issue #275). */
function ScreensList() {
  const { t } = useTranslation();
  const { members } = useSync();
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

/** The screens' layers (issue #275): the words and the background shown or not, and an overlay over them. */
function LayersCard({ send }: { send: (command: SyncStageCommand) => void }) {
  const { t } = useTranslation();
  const { stage } = useSync();
  const layers = stage?.layers ?? DEFAULT_SYNC_LAYERS;
  const toggle = (label: string, on: boolean, change: () => void, testId: string) => (
    <label className="flex items-center justify-between gap-2 text-sm">
      {label}
      <input type="checkbox" className="size-4 accent-primary" checked={on} onChange={change} data-testid={testId} />
    </label>
  );
  return (
    <section className="flex flex-col gap-3" data-testid="operator-layers">
      <h3 className="text-sm font-semibold">{t("screens.operator.layers")}</h3>
      {toggle(t("screens.operator.layerWords"), layers.words, () => send({ layers: { words: !layers.words } }), "operator-layer-words")}
      {toggle(t("screens.operator.layerBackground"), layers.background, () => send({ layers: { background: !layers.background } }), "operator-layer-background")}
      {toggle(t("screens.operator.layerTitle"), layers.overlay === "title", () => send({ layers: { overlay: layers.overlay === "title" ? "none" : "title" } }), "operator-layer-title")}
    </section>
  );
}

/** What the screens show now: the song and its slide, or nothing presented. */
function OnScreens({ copy }: { copy: SetlistOfflineCopy }) {
  const { t } = useTranslation();
  const { session } = useSync();
  const presenting = session?.presenting ?? null;
  const view = presenting ? copy.songs.find((one) => one.item.id === presenting.itemId) : undefined;
  const slides = useMemo(
    () => (view?.song ? lyricSlides(renderChart(view.song.document, view.arrangement?.document ?? null, { transposeSteps: view.item.transposeSteps })) : []),
    [view],
  );
  const slide = presenting ? slides[presenting.slide] : undefined;
  return (
    <Card className="lg:col-span-2" data-testid="operator-on-screens">
      <CardHeader>
        <CardTitle className="text-base">{t("screens.operator.onScreens")}</CardTitle>
      </CardHeader>
      <CardContent>
        {!presenting || !view?.song ? (
          <p className="text-sm text-muted-foreground">{t("screens.operator.notPresenting")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {view.song.title} · {t("screens.slideOf", { slide: presenting.slide + 1, count: slides.length })}
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
  const { stage, offset } = useSync();
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
  const { stage } = useSync();
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
