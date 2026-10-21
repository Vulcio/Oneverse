import { prettyChord, chartSeconds, type ControlsPositionValue, type LiveControlValue, degreeChords, transposeChord, transposeKey, structureOf, type DiagramPlayer, type EffectiveDisplaySettings, type RenderedChart, type SetTransitionView, type StructureGroup, type SongDocumentV2, type SetlistItemText, type SetItemPassage } from "@oneverse/core";
import { TextItemSlides } from "#/components/set-text-item";
import { PassageReading } from "#/components/set-passage-item";
import { AArrowDown, AArrowUp, ArrowLeft, ChevronDown, ChevronUp, Settings2, ChevronLeft, ChevronRight, Expand, Minus, MonitorUp, Pause, Play, Plus, Rabbit, Shrink, Turtle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type RefObject, type TouchEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { PdfPages, ViewSwitch, type ReadingView } from "#/components/chart-or-pdf";
import { CommandSearch } from "#/components/command-search";
import { MetronomeSongButton } from "#/components/metronome";
import { BarsRow } from "#/components/bars-row";
import { ChordGrid } from "#/components/chord-grid";
import { ModeSwitch } from "#/components/mode-switch";
import { OfflineBanner } from "#/components/offline-banner";
import { DisplayPanel } from "#/components/display-panel";
import { PresentControls } from "@oneverse/operator/components/present-controls";
import { OperatorProvider } from "@oneverse/operator/host";
import { songverseOperatorHost } from "#/lib/operator-host";
import { TransitionChordsChooser, TransitionSymbol, TransitionVariations, transitionText } from "#/components/set-transition";
import { CapoBadge } from "#/components/capo-badge";
import { ChartWithDiagrams, ChordSteps, type ChordStep } from "#/components/chord-diagrams";
import { useChartNotes } from "#/components/notes";
import { useSongNotes, type NotesContext } from "#/lib/notes";
import { Button } from "@oneverse/ui/components/button";
import { SyncControl } from "#/components/sync-control";
import { SidebarTrigger } from "@oneverse/ui/components/sidebar";
import { chartDisplayProps, changeDisplaySettings, stepTextSize } from "#/lib/display-settings";
import { cn } from "@oneverse/ui/lib/utils";

const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** What the Live view shows: a song of a set, or one pulled up on its own (issue #48). */
export interface LiveSong {
  /** Changes with the song shown, which then starts at its top. */
  id: string;
  title: string;
  /** Its artists, under the title. */
  artist: string | null;
  /** The set it's played in, the header's only text; null for a song on its own. */
  setName: string | null;
  /** The set's ID, for Sync play (issue #13); null for a song on its own. */
  setId: string | null;
  /** The chart, moved `extraSteps` semitones more (the last-minute transpose); null when the player can't read the song. */
  chartFor: (extraSteps: number) => RenderedChart | null;
  /** Semitones from the song's own key before that (the arrangement's and the set's): the key's "+1". */
  keyShift: number;
  durationSeconds: number | null | undefined;
  arrangementName: string | null;
  /** Where it is in the player's songbooks: "JEM 855 · JEM3" (issue #59). */
  references: string[];
  /** The set's note on it ("Softer"), above the chart. */
  setNotes: { label?: string; text: string }[];
  /** Back to wherever a song on its own was pulled up from (a set's song, say), beside the sidebar's button; a set's songs have the sidebar (issue #154). */
  exit?: { label: string; go: () => void };
  /** Its chart or its PDF, as the player reads it (issue #155); null: the chart, no switch. */
  reading?: ReadingView | null;
  /** Played through (issue #153): its chart scrolled to 95% - or, when it fits the screen, moved on from to the next song. */
  onPlayed?: () => void;
  /** Going through a set; both null for a song on its own. */
  previous: (() => void) | null;
  next: (() => void) | null;
  /** "Next: …" or "End of the set"; null for a song on its own. */
  nextLabel: string | null;
  /** What happens after it (issue #199), in a set; null when nothing's said. */
  transition?: SetTransitionView | null;
  /** Left-handed diagrams and tunings (issue #207), and the song whose chosen shapes they use. */
  player?: DiagramPlayer;
  songVersionId?: string;
  /** Who can change the set changes its transition's chords in Live (issue #214); absent for who can't. */
  onTransitionChords?: (degrees: string[]) => void;
  /** Its notes (issue #256): where it's opened from (a set or not), and the song they're pinned in. Absent: none. */
  notes?: { context: NotesContext; document: SongDocumentV2 };
  /** A set's text item (issue #305): its slides, in place of a chart. */
  text?: SetlistItemText | null;
  /** A set's passage item (issue #301): its verses, in place of a chart. */
  passage?: SetItemPassage | null;
}

/** How far down a chart is scrolled for its song to count as played (issue #153). */
const PLAYED_AT = 0.95;

/** Semitones as the smaller move: +1, -2, never +11. */
function shiftOf(steps: number): number {
  const up = ((steps % 12) + 12) % 12;
  return up > 6 ? up - 12 : up;
}

/** Moves a stacked Live (issue #214) from outside: to a song of the stack (Sync play's leader), false when it isn't one. */
export interface LiveControl {
  goTo: (songId: string) => boolean;
}

/**
 * A song full screen, to play from (Live mode, issues #29, #47 and #48): the
 * chart big, as this player reads it, what's next, and autoscroll paced by
 * the tempo. Keeps the screen awake. Keys (and page-turner pedals, which
 * send them): Space starts and pauses autoscroll, the up and down arrows
 * and Page Up/Down scroll, the left and right arrows change song.
 *
 * A song that segues or transitions into the next has it stacked under it
 * (issue #214): `songs` is that run, one page scrolled on into the next,
 * with the transition between them. The song being played follows the
 * scroll (`onCurrent`); Next and Previous move within the stack, and change
 * page only past its ends.
 */
export function LiveView({
  songs,
  startAt,
  onCurrent,
  control,
  display,
}: {
  songs: LiveSong[];
  /** How Live reads (issue #209): the Display panel's settings for Live. */
  display: EffectiveDisplaySettings;
  /** The song of the stack the page opens at (a reload after scrolling on into it); its first when left out. */
  startAt?: string;
  onCurrent?: (songId: string) => void;
  control?: MutableRefObject<LiveControl | null>;
}) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLElement>(null);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const head = songs[0]!;
  // The song being played, on which page: another page starts at its own start.
  const startOf = (list: LiveSong[]) => Math.max(0, list.findIndex((one) => one.id === startAt));
  const [position, setPosition] = useState(() => ({ head: head.id, index: startOf(songs) }));
  const at = position.head === head.id ? Math.min(position.index, songs.length - 1) : startOf(songs);
  const setIndex = (index: number) => {
    const page = latest.current[0]!.id;
    setPosition((before) => (before.head === page && before.index === index ? before : { head: page, index }));
  };
  const song = songs[at]!;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const textSize = display.textSize;
  const fullScreen = useFullScreen();
  useWakeLock();

  // (Functions new on each render: kept in a ref.)
  const latest = useRef(songs);
  latest.current = songs;
  // The song last reported as the one playing, on which page.
  const shownIndex = useRef({ head: head.id, at: startOf(songs) });

  // The last-minute transpose (issue #68): each song, here, until it's left.
  const [extra, setExtra] = useState<Record<string, number>>({});
  const charts = useMemo(() => songs.map((one) => one.chartFor(extra[one.id] ?? 0)), [songs, extra]);
  const chart = charts[at] ?? null;
  const secondsOf = (i: number) => (charts[i] ? chartSeconds(charts[i]!, songs[i]!.durationSeconds) : 0);
  const seconds = secondsOf(at);
  const anySeconds = charts.some((_, i) => secondsOf(i) > 0);

  function changeTextSize(step: 1 | -1) {
    changeDisplaySettings("LIVE", { textSize: stepTextSize(textSize, step) });
  }
  function changeSpeed(step: 1 | -1) {
    setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, SPEEDS.indexOf(speed) + step))]!);
  }

  // Another page (the next, a swipe away): from its top, its first song, at its own pace, autoscroll off.
  // The router's scroll restoration puts the last page's position back on the
  // scroller as the page changes, so this runs again once it has.
  // Opened at a song further down the page: its top.
  const start = useRef(startAt);
  start.current = startAt;
  useEffect(() => {
    setPlaying(false);
    setSpeed(1);
    setExtra({});
    const startIndex = Math.max(0, latest.current.findIndex((one) => one.id === start.current));
    setIndex(startIndex);
    shownIndex.current = { head: head.id, at: startIndex };
    const toStart = () => {
      const element = scroller.current;
      const section = sections.current[startIndex];
      if (!element) return;
      element.scrollTo({ top: startIndex > 0 && section ? section.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop - 8 : 0 });
    };
    toStart();
    const frame = requestAnimationFrame(toStart);
    return () => cancelAnimationFrame(frame);
  }, [head.id]);

  // The song being played follows the scroll (issue #214): the last whose top has passed the upper third.
  useEffect(() => {
    const element = scroller.current;
    if (!element || songs.length < 2) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = element.getBoundingClientRect().top + element.clientHeight / 3;
      let found = 0;
      sections.current.slice(0, songs.length).forEach((section, i) => {
        if (section && section.getBoundingClientRect().top <= line) found = i;
      });
      setIndex(found);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [head.id, songs.length]);

  // Scrolled on into the next song: the one before is played, and this one is current.
  const onCurrentRef = useRef(onCurrent);
  onCurrentRef.current = onCurrent;
  useEffect(() => {
    const before = shownIndex.current;
    // Another page: its own start, set as it opened.
    if (before.head !== latest.current[0]!.id || at === before.at) return;
    shownIndex.current = { head: before.head, at };
    for (let i = before.at; i < at; i++) latest.current[i]?.onPlayed?.();
    onCurrentRef.current?.(latest.current[at]!.id);
  }, [at]);

  // Autoscroll: each song over the time it takes to play, nudged by `speed`, on across the join.
  const pace = useRef({ at, secondsOf });
  pace.current = { at, secondsOf };
  useEffect(() => {
    const element = scroller.current;
    if (!playing || !element || !anySeconds) return;
    let position = element.scrollTop;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const distance = element.scrollHeight - element.clientHeight;
      // Scrolled by hand meanwhile: carry on from there.
      if (Math.abs(element.scrollTop - Math.round(position)) > 2) position = element.scrollTop;
      const { at: i, secondsOf: secondsAt } = pace.current;
      const songSeconds = secondsAt(i);
      const section = sections.current[i];
      // A song stacked above another: its own height; the last, what's left to scroll.
      const sectionTop = section ? section.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop : 0;
      const length = section && i < latest.current.length - 1 ? section.offsetHeight : distance - (latest.current.length > 1 ? sectionTop : 0);
      const rate = songSeconds > 0 ? length / songSeconds : 0;
      position = Math.min(distance, position + (rate * speed * (now - last)) / 1000);
      last = now;
      element.scrollTop = position;
      if (position >= distance || rate === 0) setPlaying(false);
      else frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, anySeconds]);

  // Played through (issue #153): scrolled to 95% of the way down, once it's been seen higher up
  // (the router's scroll restoration can put the last song's position back for a moment).
  // (A new function on each render: kept in a ref, so the count starts again only with another song.)
  const onPlayed = useRef(song.onPlayed);
  onPlayed.current = song.onPlayed;
  const played = useRef(false);
  useEffect(() => {
    played.current = false;
    const element = scroller.current;
    if (!element) return;
    let seenHigher = false;
    const check = () => {
      const distance = element.scrollHeight - element.clientHeight;
      if (distance <= 8 || played.current) return;
      const through = element.scrollTop / distance;
      if (through < PLAYED_AT) seenHigher = true;
      else if (seenHigher) {
        played.current = true;
        onPlayed.current?.();
      }
    };
    element.addEventListener("scroll", check, { passive: true });
    return () => element.removeEventListener("scroll", check);
  }, [head.id]);

  // A song of the stack, its top brought up smoothly.
  function scrollToSong(i: number) {
    const element = scroller.current;
    const section = sections.current[i];
    if (!element || !section) return;
    element.scrollTo({ top: section.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop - 8, behavior: "smooth" });
  }
  if (control) control.current = { goTo: (songId) => {
    const i = songs.findIndex((one) => one.id === songId);
    if (i === -1) return false;
    scrollToSong(i);
    return true;
  } };

  // Next: the next song of the stack, or past its end, the next page.
  // A chart that fits the screen has no end to scroll to: played once it's moved on from.
  // (Its room below - the 40vh that lets the last line come up - isn't the song's: issue #199.)
  const leave = song.next;
  const next =
    at < songs.length - 1
      ? () => scrollToSong(at + 1)
      : leave
        ? () => {
            const element = scroller.current;
            const content = element?.firstElementChild as HTMLElement | null | undefined;
            const room = content ? parseFloat(getComputedStyle(content).paddingBottom) : 0;
            if (element && element.scrollHeight - element.clientHeight - room <= 8 && !played.current) onPlayed.current?.();
            leave();
          }
        : null;
  const previous = at > 0 ? () => scrollToSong(at - 1) : head.previous;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      // The search dialog, say, has its own keys.
      if (document.querySelector("[role=dialog]")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      // A song of the set's being moved by its handle, with the keyboard (issue #199).
      if (target?.closest("[aria-roledescription=sortable]")) return;
      const element = scroller.current;
      const page = (element?.clientHeight ?? 0) * 0.8;
      switch (event.key) {
        case " ":
          // A focused button handles its own Space.
          if (target?.closest("button, a")) return;
          setPlaying((p) => !p);
          break;
        case "ArrowDown":
        case "PageDown":
          element?.scrollBy({ top: page, behavior: "smooth" });
          break;
        case "ArrowUp":
        case "PageUp":
          element?.scrollBy({ top: -page, behavior: "smooth" });
          break;
        case "ArrowRight":
          next?.();
          break;
        case "ArrowLeft":
          previous?.();
          break;
        default:
          return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previous, next]);

  // Swiping left or right goes to the next or previous song (issue #67):
  // a quick, mostly sideways move of one finger; scrolling stays vertical.
  const swipe = useRef<{ x: number; y: number; at: number } | null>(null);
  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    swipe.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY, at: Date.now() } : null;
  };
  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = swipe.current;
    const touch = event.changedTouches[0];
    swipe.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - start.at > 800) return;
    if (dx < 0) next?.();
    else previous?.();
  };

  const inSet = song.nextLabel !== null;
  const pdf = song.reading?.shown ?? null;
  const steps = useMemo(() => (chart ? structureOf(chart) : []), [chart]);
  const columns = display.columns;
  const [current, pickPass] = useCurrentPass(scroller, steps, song.id, columns !== "1", () => sections.current[at] ?? null);

  function goToPass(passId: string) {
    pickPass(passId);
    const element = scroller.current;
    const pass = (sections.current[at] ?? element)?.querySelector(`[data-pass="${CSS.escape(passId)}"]`);
    if (!element || !pass) return;
    element.scrollTo({ top: pass.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop - 12, behavior: "smooth" });
  }

  // Where the controls are, and which show (issue #224); a PDF's page has its own.
  const layout = display.controls;
  const shows = (control: LiveControlValue) => !display.hiddenControls.includes(control);
  const autoscroll = (
    <div className="flex items-center gap-1" role="group" aria-label={t("live.autoscroll")}>
      <IconButton label={t("live.slower")} onClick={() => changeSpeed(-1)} disabled={!chart || speed === SPEEDS[0]}>
        <Turtle />
      </IconButton>
      <button
        type="button"
        onClick={() => setPlaying(!playing)}
        disabled={!chart || seconds <= 0}
        aria-label={playing ? t("live.pause") : t("live.play")}
        aria-pressed={playing}
        className="flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50 [&_svg]:size-4"
      >
        {playing ? <Pause /> : <Play />}
        <span className="tabular-nums" data-testid="live-speed">
          {Math.round(speed * 100)}%
        </span>
      </button>
      <IconButton label={t("live.faster")} onClick={() => changeSpeed(1)} disabled={!chart || speed === SPEEDS.at(-1)}>
        <Rabbit />
      </IconButton>
    </div>
  );
  const textSizes = (
    <>
      <IconButton label={t("live.smaller")} onClick={() => changeTextSize(-1)} disabled={!!pdf || stepTextSize(textSize, -1) === textSize}>
        <AArrowDown />
      </IconButton>
      <IconButton label={t("live.bigger")} onClick={() => changeTextSize(1)} disabled={!!pdf || stepTextSize(textSize, 1) === textSize}>
        <AArrowUp />
      </IconButton>
    </>
  );

  return (
    <div className="relative flex h-dvh flex-col bg-background text-foreground" data-testid="live-view">
      {/* Always the same height; the song's own title is at the top of its chart (issue #68). */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b-2 border-b-primary px-2 sm:gap-3 sm:px-4">
        {/* The sidebar (issue #154): beside the song on a wider screen, a sheet on a phone. */}
        <SidebarTrigger className="size-10 text-muted-foreground [&_svg]:size-5" data-testid="live-sidebar" />
        {song.exit ? (
          <IconButton label={song.exit.label} onClick={song.exit.go}>
            <ArrowLeft />
          </IconButton>
        ) : null}
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground" data-testid="live-set">
          {song.setName}
        </p>
        <OfflineBanner compact />
        {/* Its chart or its PDF (issue #155), when it has one. */}
        {song.reading ? <ViewSwitch reading={song.reading} compact /> : null}
        {/* The song's tempo and time signature, one press (issue #2); the rest on the Metronome page. */}
        {song.setId ? <SyncControl setId={song.setId} itemId={song.id} compact /> : null}
        {shows("metronome") ? <MetronomeSongButton songId={song.id} tempo={chart?.tempo} timeSignature={chart?.timeSignature} /> : null}
        <CommandSearch />
        <DisplayPanel mode="LIVE" settings={display} player={head.player} compact className="size-10 border-0 text-muted-foreground [&_svg]:size-5" />
        {fullScreen.available ? (
          <span className="hidden sm:contents">
            <IconButton label={t("live.fullScreen")} pressed={fullScreen.active} onClick={fullScreen.toggle}>
              {fullScreen.active ? <Shrink /> : <Expand />}
            </IconButton>
          </span>
        ) : null}
        <ModeSwitch />
      </header>

      {/* The bars (issue #238): the chords in bars and beats, with the metronome, following the music. */}
      {chart && !pdf && display.bars ? <BarsRow songId={song.id} chart={chart} document={song.notes?.document} chordColors={display.chordColors} /> : null}
      {steps.length > 0 && !pdf && shows("structure") ? <StructureBar steps={steps} current={current} onPick={goToPass} /> : null}

      <main ref={scroller} className="flex-1 overflow-y-auto" data-testid="live-scroll" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {/* The whole screen's width (issue #177): a long song flows into columns rather than down. */}
        <div className={cn("flex w-full flex-col px-4 pt-6 pb-[40vh] sm:px-8", head.reading?.shown && "max-sm:pt-0")}>
          {songs.map((one, i) => (
            <LiveSongSection
              key={one.id}
              ref={(element) => {
                sections.current[i] = element;
              }}
              song={one}
              chart={charts[i] ?? null}
              current={i === at}
              stacked={songs.length > 1}
              followed={i < songs.length - 1}
              display={display}
              extraSteps={extra[one.id] ?? 0}
              nextSteps={songs[i + 1] ? (extra[songs[i + 1]!.id] ?? 0) : 0}
              onTranspose={shows("transpose") ? (steps) => setExtra((before) => ({ ...before, [one.id]: steps })) : null}
            />
          ))}
        </div>
      </main>

      {/* Presenting on the set's screens (issue #186), leading its session. */}
      {song.setId ? (
        <OperatorProvider host={songverseOperatorHost(song.setId)}>
          <PresentControls
            itemId={song.id}
            chart={chart}
            text={song.text ?? null}
            passage={song.passage ?? null}
            next={next}
            previous={previous}
            onSlidePass={goToPass}
            manage={
              <Link to="/screens" search={{ setlistId: song.setId }} className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:underline" data-testid="present-add-screen">
                <MonitorUp className="size-3.5" />
                {t("screens.manage")}
              </Link>
            }
          />
        </OperatorProvider>
      ) : null}

      {layout === "footer" ? (
        <footer className="flex shrink-0 items-center gap-1 border-t bg-card px-2 py-2 sm:gap-2 sm:px-4" data-testid="live-controls" data-layout="footer">
          {shows("songs") && inSet ? (
            <IconButton label={t("sets.previousSong")} onClick={() => previous?.()} disabled={!previous}>
              <ChevronLeft />
            </IconButton>
          ) : null}
          {shows("autoscroll") ? autoscroll : null}
          {shows("textSize") ? <div className="hidden items-center gap-1 sm:flex">{textSizes}</div> : null}
          <p className="hidden flex-1 text-center text-xs text-muted-foreground lg:block">{inSet ? t("live.keys") : t("live.keysAlone")}</p>
          {shows("songs") && inSet ? (
            <button
              type="button"
              onClick={() => next?.()}
              disabled={!next}
              className="ml-auto flex h-10 min-w-0 items-center gap-1 rounded-md border px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0"
              data-testid="live-next"
            >
              <span className="truncate">{song.nextLabel}</span>
              <ChevronRight />
            </button>
          ) : null}
        </footer>
      ) : (
        <FloatingControls
          layout={layout}
          position={layout === "hidden" ? "bottom-center" : display.controlsPosition}
          opacity={layout === "hidden" ? 1 : display.controlsOpacity}
        >
          {shows("songs") && inSet ? (
            <FloatingButton label={t("sets.previousSong")} onClick={() => previous?.()} disabled={!previous}>
              <ChevronLeft />
            </FloatingButton>
          ) : null}
          {shows("autoscroll") ? (
            <>
              <FloatingButton label={t("live.slower")} onClick={() => changeSpeed(-1)} disabled={!chart || speed === SPEEDS[0]}>
                <Turtle />
              </FloatingButton>
              <FloatingButton label={playing ? t("live.pause") : t("live.play")} onClick={() => setPlaying(!playing)} disabled={!chart || seconds <= 0} pressed={playing} primary>
                {playing ? <Pause /> : <Play />}
                <span className="sr-only" data-testid="live-speed">
                  {Math.round(speed * 100)}%
                </span>
              </FloatingButton>
              <FloatingButton label={t("live.faster")} onClick={() => changeSpeed(1)} disabled={!chart || speed === SPEEDS.at(-1)}>
                <Rabbit />
              </FloatingButton>
            </>
          ) : null}
          {shows("textSize") ? (
            <>
              <FloatingButton label={t("live.smaller")} onClick={() => changeTextSize(-1)} disabled={!!pdf || stepTextSize(textSize, -1) === textSize}>
                <AArrowDown />
              </FloatingButton>
              <FloatingButton label={t("live.bigger")} onClick={() => changeTextSize(1)} disabled={!!pdf || stepTextSize(textSize, 1) === textSize}>
                <AArrowUp />
              </FloatingButton>
            </>
          ) : null}
          {shows("songs") && inSet ? (
            <FloatingButton label={song.nextLabel ?? t("sets.nextSong")} onClick={() => next?.()} disabled={!next} testId="live-next">
              <ChevronRight />
            </FloatingButton>
          ) : null}
        </FloatingControls>
      )}
    </div>
  );
}

/** A Live song's chart with its notes (issue #256): the song's own above it, the rest where they're pinned, as Live's Display setting shows them. */
function LiveChartWithNotes({ song, notes: source, chart, display }: { song: LiveSong; notes: NonNullable<LiveSong["notes"]>; chart: RenderedChart; display: EffectiveDisplaySettings }) {
  const { t } = useTranslation();
  // Someone else's new notes: held behind a button, unless Live's Display says at once (issue #263).
  const notes = useChartNotes({ state: useSongNotes(source.context, { hold: display.newNotes === "HOLD" }), chart, document: source.document, show: display.notes, marks: display.noteMarks, style: display.noteStyle, context: source.context });
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{notes.top}</div>
        <div className="relative flex items-center gap-2">
          {notes.button}
          {/* Over the chart, under the Notes button: its coming takes no room, so nothing moves under the reader. */}
          {notes.incoming ? <div className="absolute top-full right-0 z-10 mt-1.5 whitespace-nowrap shadow-sm">{notes.incoming}</div> : null}
        </div>
      </div>
      <ChartWithDiagrams chart={chart} emptyText={t("sets.noChart")} {...chartDisplayProps(display)} player={song.player} songVersionId={song.songVersionId} notes={notes.layer} />
      {notes.dialogs}
    </>
  );
}

/**
 * One song of a Live page: its title, key and details, notes, then its
 * chart or PDF, and what happens after it. Stacked (issue #214), only the
 * song being played carries the ids its page is checked by.
 */
function LiveSongSection({
  ref,
  song,
  chart,
  current,
  stacked,
  followed,
  display,
  extraSteps,
  nextSteps,
  onTranspose,
}: {
  ref: (element: HTMLElement | null) => void;
  song: LiveSong;
  chart: RenderedChart | null;
  current: boolean;
  stacked: boolean;
  /** The next song is stacked under it: the transition goes between them. */
  followed: boolean;
  display: EffectiveDisplaySettings;
  extraSteps: number;
  /** The next song's last-minute transpose, when it's stacked under this one. */
  nextSteps: number;
  /** Null: the key shown, without transposing it (issue #224). */
  onTranspose: ((steps: number) => void) | null;
}) {
  const { t } = useTranslation();
  const pdf = song.reading?.shown ?? null;
  const transition = useMemo(() => (song.transition ? transposedTransition(song.transition, extraSteps, nextSteps) : null), [song.transition, extraSteps, nextSteps]);
  const details = [
    ...song.references,
    chart?.tempo ? `${chart.tempo} BPM` : null,
    song.arrangementName,
  ].filter(Boolean);
  const id = (name: string) => (current ? name : undefined);
  return (
    <section ref={ref} className="flex flex-col" data-testid="live-song" data-item={song.id} data-current={current ? "" : undefined}>
      {/* Zoom, not font size: the chart's own sizes (chords, headings, notes) keep their proportions. */}
      {/* A PDF isn't zoomed: its pages fit the width (on a phone, edge to edge). */}
      <div className="flex flex-col gap-4" style={pdf ? undefined : { zoom: display.textSize }}>
        {/* With a PDF on a phone, the PDF's own title does: the whole screen for its pages. */}
        <div className={cn("flex items-start justify-between gap-4", pdf && "max-sm:hidden")} data-testid={id("live-song-top")}>
          <div className="min-w-0">
            <h1 className={cn("text-2xl leading-tight font-bold sm:text-3xl", stacked && !current && "text-muted-foreground")}>{song.title}</h1>
            {song.artist ? <p className="text-base text-muted-foreground sm:text-lg">{song.artist}</p> : null}
            {/* The capo, hard to miss (issue #219). */}
            {chart?.capo ? <CapoBadge capo={chart.capo} shapes={chart.capoShapes} className="mt-1" /> : null}
            {details.length > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground" data-testid={id("live-details")}>
                {details.join(" · ")}
              </p>
            ) : null}
          </div>
          {chart?.key && !onTranspose ? (
            <span className="shrink-0 rounded-lg border px-3 py-1 text-2xl font-bold sm:text-3xl" data-testid={id("live-key")}>
              {prettyChord(chart.key)}
            </span>
          ) : null}
          {chart?.key && onTranspose ? <KeyButton musicalKey={chart.key} shift={shiftOf(song.keyShift + extraSteps)} extraSteps={extraSteps} onTranspose={onTranspose} testId={id("live-key")} /> : null}
        </div>
        {song.setNotes.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-md border-l-4 border-primary bg-muted px-3 py-2 text-sm">
            {song.setNotes.map((note, i) => (
              <p key={i} className={note.label ? "whitespace-pre-wrap text-muted-foreground" : "whitespace-pre-wrap"}>
                {note.label ? <span className="font-medium">{note.label}: </span> : null}
                {note.text}
              </p>
            ))}
          </div>
        ) : null}
        {pdf && song.reading ? (
          <PdfPages key={pdf.id} source={() => song.reading!.source(pdf)} name={pdf.filename} className="max-sm:-mx-4" />
        ) : chart && song.reading?.grid ? (
          // Its chords in bars (issue #238), following the music as the bars row does.
          <ChordGrid songId={song.id} chart={chart} document={song.notes?.document} chordColors={display.chordColors} emptyText={t("sets.noChart")} />
        ) : chart && song.notes ? (
          <LiveChartWithNotes song={song} notes={song.notes} chart={chart} display={display} />
        ) : chart ? (
          <ChartWithDiagrams chart={chart} emptyText={t("sets.noChart")} {...chartDisplayProps(display)} player={song.player} songVersionId={song.songVersionId} />
        ) : song.text ? (
          <TextItemSlides text={song.text} />
        ) : song.passage ? (
          <PassageReading passage={song.passage} />
        ) : (
          <p className="text-muted-foreground">{t("sets.hiddenSong")}</p>
        )}
        {song.nextLabel !== null && !followed ? <p className="mt-8 border-t pt-4 text-sm font-medium text-muted-foreground">{song.nextLabel}</p> : null}
      </div>
      {transition ? <TransitionBlock song={song} transition={transition} between={followed} display={display} /> : null}
    </section>
  );
}

/**
 * A transition as it's played tonight: the song's last-minute transpose
 * moves where it starts (its key and last chord), the next song's moves
 * where it goes (its key and first chord). Its chords are degrees of the
 * next song's key, so they follow by themselves.
 */
function transposedTransition(transition: SetTransitionView, steps: number, nextSteps: number): SetTransitionView {
  if (steps === 0 && nextSteps === 0) return transition;
  const fromKey = transition.fromKey ? (transposeKey(transition.fromKey, steps) ?? transition.fromKey) : null;
  const toKey = transition.toKey ? (transposeKey(transition.toKey, nextSteps) ?? transition.toKey) : null;
  return {
    ...transition,
    fromKey,
    toKey,
    lastChord: transition.lastChord ? transposeChord(transition.lastChord, steps, fromKey) : transition.lastChord,
    firstChord: transition.firstChord ? transposeChord(transition.firstChord, nextSteps, toKey) : transition.firstChord,
  };
}

/**
 * What happens after a song (issues #199, #10, #214, #217): its symbol and
 * what it says, and for a transition, its chords from the song's last chord
 * to the next one's first - drawn as the player's diagrams, each heard with
 * a tap - which who can change the set changes here. Between two stacked
 * songs, a band across the page.
 */
function TransitionBlock({ song, transition, between, display }: { song: LiveSong; transition: SetTransitionView; between: boolean; display: EffectiveDisplaySettings }) {
  const { t } = useTranslation();
  const [open, setOpen] = useTransitionOpen();
  const chords = transition.chords ?? [];
  const spelled = transition.toKey ? degreeChords(chords, transition.toKey) : chords;
  const isTransition = transition.kind === "TRANSITION";
  const editable = !!song.onTransitionChords;
  // From the song's last chord, through the transition's, into the next one's first.
  const steps: ChordStep[] = [
    ...(transition.lastChord ? [{ chord: transition.lastChord, edge: true, role: "last" }] : []),
    ...(spelled.length > 0 ? spelled.map((chord) => ({ chord, role: "step" })) : [{ chord: null, role: "gap" }]),
    ...(transition.firstChord ? [{ chord: transition.firstChord, edge: true, role: "first" }] : []),
  ];
  return (
    <div
      className={cn("flex flex-col gap-2 text-sm", between ? "my-8 rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 px-4 py-3" : "mt-2")}
      data-testid="live-transition-block"
      data-between={between ? "" : undefined}
    >
      <p className="flex items-center gap-2 font-medium" data-testid="live-transition" data-kind={transition.kind}>
        <TransitionSymbol kind={transition.kind} className="size-4 text-primary" />
        {transitionText(transition, t)}
      </p>
      {isTransition && (chords.length > 0 || editable) ? (
        <>
          {/* Compact: the chords as one row of steps, each heard with a tap; opened, their diagrams and (for who changes the set) the other ways in. */}
          <div className="flex flex-wrap items-start gap-2" data-testid="live-transition-chords">
            <ChordSteps steps={steps} expanded={open} diagrams={display.chordDiagrams} notation={display.chordNotation} player={song.player} musicalKey={transition.toKey} />
            {/* The chosen way in's other variations, a tap away. */}
            {song.onTransitionChords ? (
              <span className="flex h-9 items-center">
                <TransitionVariations
                  fromKey={transition.fromKey}
                  toKey={transition.toKey}
                  lastChord={transition.lastChord}
                  firstChord={transition.firstChord}
                  degrees={chords}
                  onChange={song.onTransitionChords}
                />
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-label={open ? t("sets.transitionCollapse") : t(editable ? "sets.transitionExpandEdit" : "sets.transitionExpand")}
              title={open ? t("sets.transitionCollapse") : t(editable ? "sets.transitionExpandEdit" : "sets.transitionExpand")}
              data-testid="live-transition-expand"
            >
              {open ? <ChevronUp /> : editable ? <Settings2 /> : <ChevronDown />}
            </Button>
          </div>
          {open && editable ? (
            <TransitionChordsChooser
              fromKey={transition.fromKey}
              toKey={transition.toKey}
              lastChord={transition.lastChord}
              firstChord={transition.firstChord}
              degrees={chords}
              onChange={song.onTransitionChords!}
              diagrams={display.chordDiagrams}
              notation={display.chordNotation}
              player={song.player}
              framed={false}
              className="max-w-xl rounded-md border bg-background p-3"
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const TRANSITION_OPEN_KEY = "songverse.live.transitionOpen";

/** Whether Live's transitions are opened (diagrams, the other ways in), on this device: compact unless opened. */
function useTransitionOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(TRANSITION_OPEN_KEY) === "1");
    } catch {
      // Storage blocked: compact.
    }
  }, []);
  return [
    open,
    (next) => {
      setOpen(next);
      try {
        localStorage.setItem(TRANSITION_OPEN_KEY, next ? "1" : "0");
      } catch {
        // Storage blocked: for this page only.
      }
    },
  ];
}

const iconClass =
  "flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-5";

function IconButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className={iconClass} aria-label={label} title={label} aria-pressed={pressed} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** How long floating controls stay before fading, or hidden ones before going again. */
const CONTROLS_AWAKE_MS = 4000;
/** Faded floating controls: a faint outline, out of the way of the chart. */
const CONTROLS_FADED = 0.12;

/**
 * Live's controls over the chart (issue #224): round buttons in a corner or
 * along an edge, fading after a few seconds without a touch and back with
 * the next one, or a key. Hidden: nothing, until a tap at the bottom of the
 * screen brings them up for a moment. A faded button doesn't take the tap
 * that wakes it.
 */
function FloatingControls({ layout, position, opacity, children }: { layout: "floating" | "hidden"; position: ControlsPositionValue; opacity: number; children: ReactNode }) {
  const { t } = useTranslation();
  const [awake, setAwake] = useState(layout === "floating");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = () => {
    setAwake(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAwake(false), CONTROLS_AWAKE_MS);
  };
  useEffect(() => {
    if (layout !== "floating") {
      setAwake(false);
      return;
    }
    wake();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [layout]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const vertical = position === "right";
  const shown = layout === "floating" || awake;
  return (
    <>
      {layout === "hidden" ? (
        // A strip along the bottom: a tap brings the controls up.
        <button type="button" className="absolute inset-x-0 bottom-0 z-20 h-8 opacity-0" aria-label={t("live.showControls")} onClick={wake} data-testid="live-controls-reveal" />
      ) : null}
      {shown ? (
        <div
          role="toolbar"
          aria-label={t("live.controls")}
          className={cn(
            "absolute z-30 flex items-center gap-2 transition-opacity duration-500",
            !awake && "pointer-events-none",
            vertical ? "top-[60%] right-3 -translate-y-1/2 flex-col" : "bottom-[max(1rem,env(safe-area-inset-bottom))]",
            position === "bottom-right" && "right-4",
            position === "bottom-left" && "left-4",
            position === "bottom-center" && "left-1/2 -translate-x-1/2",
          )}
          style={{ opacity: awake ? opacity : Math.min(opacity, CONTROLS_FADED) }}
          onPointerDown={layout === "hidden" ? wake : undefined}
          data-testid="live-controls"
          data-layout={layout}
          data-position={position}
          data-faded={awake ? undefined : ""}
        >
          {children}
        </div>
      ) : null}
    </>
  );
}

/** A floating control: round, big enough to hit on stage. */
function FloatingButton({
  label,
  onClick,
  disabled,
  pressed,
  primary = false,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  primary?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-full border shadow-lg backdrop-blur disabled:opacity-40 [&_svg]:size-5",
        primary ? "border-primary bg-primary text-primary-foreground" : "bg-card/90 text-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

/** Keeps the screen on while the page is shown (where the browser can). */
function useWakeLock() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let active = true;
    const request = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((sentinel) => {
          if (active) lock = sentinel;
          else void sentinel.release();
        })
        .catch(() => {
          // Refused (battery saver, no permission): the screen may sleep.
        });
    };
    request();
    // The browser drops the lock when the page is hidden; take it again on return.
    document.addEventListener("visibilitychange", request);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", request);
      void lock?.release();
    };
  }, []);
}

function useFullScreen() {
  const [available, setAvailable] = useState(false);
  const [active, setActive] = useState(false);
  useEffect(() => {
    setAvailable(document.fullscreenEnabled);
    const onChange = () => setActive(!!document.fullscreenElement);
    onChange();
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  };
  return { available, active, toggle };
}

/**
 * The pass being sung: the last one whose top has scrolled past the upper
 * quarter of the view (the first at the very top), following the scroll -
 * by hand or autoscroll.
 */
function useCurrentPass(
  scroller: RefObject<HTMLElement | null>,
  steps: { passId: string }[],
  songId: string,
  /** The chart in columns (issue #177): how far it's scrolled doesn't say where the song is - the pass picked does. */
  flowed = false,
  /** Where its passes are: the song's own part of a stacked page (issue #214). */
  root: () => HTMLElement | null = () => scroller.current,
): [string | null, (passId: string) => void] {
  const [current, setCurrent] = useState<string | null>(steps[0]?.passId ?? null);
  // A pass picked in the bar stays current while it's scrolled to: near the
  // end of a song it may never reach the top, where it would count as reached.
  const picked = useRef<{ passId: string; until: number } | null>(null);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    // In columns: the song's first pass, until one's picked in the bar.
    if (flowed) {
      picked.current = null;
      setCurrent(steps[0]?.passId ?? null);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (picked.current && Date.now() < picked.current.until) return;
      picked.current = null;
      const line = element.getBoundingClientRect().top + element.clientHeight * 0.25;
      let found: string | null = steps[0]?.passId ?? null;
      for (const pass of (root() ?? element).querySelectorAll<HTMLElement>("[data-pass]")) {
        if (pass.getBoundingClientRect().top <= line) found = pass.dataset.pass ?? found;
        else break;
      }
      setCurrent(found);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scroller, steps, songId, flowed]);
  const pick = (passId: string) => {
    picked.current = { passId, until: Date.now() + 1000 };
    setCurrent(passId);
  };
  return [current, pick];
}

// A colour per kind of section, for Live's dark theme: filled once reached, outlined ahead.
const GROUP_STYLES: Record<StructureGroup, { filled: string; outlined: string }> = {
  edge: { filled: "bg-violet-500 text-white border-violet-500", outlined: "border-violet-400/70 text-violet-300" },
  verse: { filled: "bg-sky-500 text-white border-sky-500", outlined: "border-sky-400/70 text-sky-300" },
  chorus: { filled: "bg-amber-400 text-black border-amber-400", outlined: "border-amber-300/70 text-amber-200" },
  bridge: { filled: "bg-rose-500 text-white border-rose-500", outlined: "border-rose-400/70 text-rose-300" },
  instrumental: { filled: "bg-emerald-500 text-white border-emerald-500", outlined: "border-emerald-400/70 text-emerald-300" },
  other: { filled: "bg-zinc-500 text-white border-zinc-500", outlined: "border-zinc-400/70 text-zinc-300" },
};

/**
 * The song's structure (issue #68), fixed under the header: its passes in
 * order - V1 C V2 C B C - coloured by kind, the one being sung ringed, those
 * sung filled. Tapping one goes there.
 */
function StructureBar({ steps, current, onPick }: { steps: ReturnType<typeof structureOf>; current: string | null; onPick: (passId: string) => void }) {
  const { t } = useTranslation();
  const bar = useRef<HTMLDivElement>(null);
  const reached = Math.max(0, steps.findIndex((step) => step.passId === current));

  // The current one kept in view, on a long song on a phone.
  useEffect(() => {
    bar.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);

  return (
    <nav ref={bar} className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-2 py-2 sm:px-4" aria-label={t("live.structure")} data-testid="live-structure">
      {steps.map((step, index) => {
        const name = `${t(`chart.sections.${step.type}`)}${step.number ? ` ${step.number}` : ""}`;
        const style = GROUP_STYLES[step.group];
        const isCurrent = step.passId === current;
        return (
          <button
            key={step.passId}
            type="button"
            onClick={() => onPick(step.passId)}
            aria-label={t("live.goToPass", { name })}
            aria-current={isCurrent ? "step" : undefined}
            title={name}
            data-group={step.group}
            className={cn(
              "flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full border px-1.5 text-xs font-semibold transition-colors",
              index <= reached ? style.filled : style.outlined,
              index < reached && "opacity-60",
              isCurrent && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
            )}
          >
            {t(`live.short.${step.type}`)}
            {step.number ?? ""}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The key the song is played in, top right of it (issue #68): "G", with a
 * subtle "+1" when it's moved from the song's own. Tapping it transposes,
 * for now only: this song, here, until it's left.
 */
function KeyButton({ musicalKey, shift, extraSteps, onTranspose, testId }: { musicalKey: string; shift: number; extraSteps: number; onTranspose: (steps: number) => void; testId?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shiftText = shift > 0 ? `+${shift}` : shift < 0 ? `−${-shift}` : "";

  // Closed by a tap anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={shiftText ? t("live.keyShifted", { key: musicalKey, shift: shiftText }) : t("live.key", { key: musicalKey })}
        className="flex items-baseline gap-0.5 rounded-lg border px-3 py-1 hover:bg-accent"
        data-testid={testId}
      >
        <span className="text-2xl font-bold sm:text-3xl">{prettyChord(musicalKey)}</span>
        {shiftText ? <span className="text-sm text-muted-foreground">{shiftText}</span> : null}
      </button>
      {open ? (
        <div className="absolute top-full right-0 z-20 mt-2 flex w-64 flex-col gap-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg" data-testid="live-transpose">
          <p className="text-sm font-medium">{t("live.transposeNow")}</p>
          <div className="flex items-center justify-between gap-2">
            <button type="button" className={iconClass} onClick={() => onTranspose(extraSteps - 1)} aria-label={t("live.semitoneDown")}>
              <Minus />
            </button>
            <span className="text-2xl font-bold">{prettyChord(musicalKey)}</span>
            <button type="button" className={iconClass} onClick={() => onTranspose(extraSteps + 1)} aria-label={t("live.semitoneUp")}>
              <Plus />
            </button>
          </div>
          {extraSteps !== 0 ? (
            <button type="button" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent" onClick={() => onTranspose(0)}>
              {t("live.resetKey")}
            </button>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("live.transposeHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
