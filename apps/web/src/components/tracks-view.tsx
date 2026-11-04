import { barAt, barBeatPlaces, chartBars, cueAt, lineAtPosition, recordingBeatPosition, sortedCues, type Attachment, type CueSection, type RenderedChart, type SongDocumentV2 } from "@oneverse/core";
import { Minus, Palette, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { cn } from "@oneverse/ui/lib/utils";
import { GROUP_COLOURS, useCueNames } from "#/components/stem-cues";
import { useTrackName } from "#/components/stem-dock";
import { keepInView } from "#/lib/follow-view";
import { deviceNow } from "#/lib/output-clock";
import { getStemState, isAudible, seekStems, stemBuffer, toggleStemMute, toggleStemSolo, useStems, type StemTrack } from "#/lib/stem-engine";
import { partColour, setTrackColours, useTrackColours } from "#/lib/track-colours";
import { drawShape } from "#/lib/wave-shape";
import { COLUMN, columnPeaks, liveTake } from "#/lib/take-strip";
import { useMarkTracksShown } from "#/lib/tracks-shown";

/** How much of the song the lanes show (s); the last, all of it. */
const ZOOMS = [8, 16, 32, Number.POSITIVE_INFINITY];
const DEFAULT_ZOOM = 1;
/** How far apart the waveform's outline is read (CSS px). */
const STEP = 2;
/** The words lit a beat before they're sung, as in the chart. */
const AHEAD = 1;

/** The bar lines between `from` and `to` (s): the recording's own downbeats when they were found, else its tempo from its first beat. */
function barLines(beat: ReturnType<typeof getStemState>["beat"], from: number, to: number): number[] {
  if (!beat) return [];
  if (beat.map?.downbeats.length) return beat.map.downbeats.filter((at) => at >= from && at <= to);
  const bar = (60 / beat.tempo) * (beat.timeSignature?.numerator ?? 4);
  if (!(bar > 0)) return [];
  const lines: number[] = [];
  for (let k = Math.max(0, Math.ceil((from - beat.firstBeat) / bar)); ; k++) {
    const at = beat.firstBeat + k * bar;
    if (at > to || lines.length > 400) break;
    lines.push(at);
  }
  return lines;
}

/** Where the stems are now (s), between renders: the audio clock while playing. */
function stemsPosition(): number {
  const state = getStemState();
  if (state.playing && state.anchor) return Math.min(state.duration, Math.max(0, state.anchor.position + ((deviceNow() - state.anchor.epoch) / 1000) * state.speed));
  return state.position;
}

/** A part's loudest moment from `from` to `to` (s), 0-1: its decoded audio, else the waveform the player drew. */
function peakBetween(track: StemTrack, from: number, to: number): number {
  if (to <= 0 || from >= track.length) return 0;
  const buffer = stemBuffer(track.id);
  if (buffer) {
    const peaks = columnPeaks(buffer);
    let loudest = 0;
    for (let column = Math.max(0, Math.floor(from / COLUMN)); column <= Math.min(peaks.length - 1, Math.floor(to / COLUMN)); column++) loudest = Math.max(loudest, peaks[column]!);
    return loudest;
  }
  if (!track.peaks || track.length <= 0) return 0;
  const per = track.peaks.length / track.length;
  let loudest = 0;
  for (let slice = Math.max(0, Math.floor(from * per)); slice <= Math.min(track.peaks.length - 1, Math.floor(to * per)); slice++) loudest = Math.max(loudest, track.peaks[slice]!);
  return loudest;
}

/**
 * A song's parts as lanes, as in a DAW (issue #374): the song's sections
 * across the top, a box round what the lanes show; the words being sung;
 * then each part's waveform under a playhead in the middle - played on its
 * left, coming on its right, muted ones faint - zoomed from a few seconds
 * to the whole song. While a part's recorded in the player, the take has a
 * lane of its own, growing left of the playhead. It reads the stem player:
 * the song's stems have to be loaded there.
 */
export function TracksView({
  songVersionId,
  chart,
  document,
  attachments,
  cueSections,
}: {
  songVersionId: string;
  chart: RenderedChart;
  document: Pick<SongDocumentV2, "sections"> | null | undefined;
  attachments: Attachment[];
  cueSections: CueSection[];
}) {
  const { t } = useTranslation();
  const engine = useStems();
  const nameOf = useTrackName();
  const cueNames = useCueNames();
  const here = engine.songVersionId === songVersionId && engine.tracks.length > 0 && engine.duration > 0;
  useMarkTracksShown(here);
  const tracks = here ? engine.tracks : [];
  const duration = here ? engine.duration : 0;
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const span = Math.min(ZOOMS[zoom]!, duration || Number.POSITIVE_INFINITY);
  const whole = !Number.isFinite(ZOOMS[zoom]!) || span >= duration;

  // The sections, where the loaded multitrack's files place them (issue #110).
  const cues = useMemo(() => {
    const files = attachments.filter((file) => (file.multitrackId ?? null) === (engine.multitrackId ?? null) && file.cuePoints?.length);
    return sortedCues(files[0]?.cuePoints, cueSections);
  }, [attachments, engine.multitrackId, cueSections]);
  const spans = cues.flatMap((cue, index) => {
    const section = cueSections.find((one) => one.id === cue.sectionId);
    const end = Math.min(duration, cues[index + 1]?.at ?? duration);
    return section && duration > 0 && cue.at < duration ? [{ cue, section, start: cue.at, end }] : [];
  });

  // The words: the line sung now, the one before and the one after.
  const bars = useMemo(() => chartBars(chart, document), [chart, document]);
  const places = useMemo(() => barBeatPlaces(chart, bars), [chart, bars]);
  const lines = useMemo(
    () => chart.passes.flatMap((pass, passIndex) => pass.lines.filter((line) => line.kind === "lyric" && line.text.trim() !== "").map((line) => ({ passIndex, id: line.id, text: line.text.replace(/\s+/g, " ").trim() }))),
    [chart],
  );
  const [sung, setSung] = useState<number | null>(null);
  const [bar, setBar] = useState<number | null>(null);

  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const takeCanvas = useRef<HTMLCanvasElement | null>(null);
  const windowBox = useRef<HTMLDivElement | null>(null);
  const coloured = useTrackColours();
  const latest = useRef({ tracks, duration, span, whole, engine, bars, places, lines, coloured });
  latest.current = { tracks, duration, span, whole, engine, bars, places, lines, coloured };
  const [recording, setRecording] = useState(false);
  // The take's lane in view as it starts, above the player and the recorder (once, not on each render).
  const showTake = useCallback((element: HTMLLIElement | null) => {
    if (element) requestAnimationFrame(() => keepInView(element));
  }, []);

  useEffect(() => {
    if (!here) return;
    const style = getComputedStyle(window.document.documentElement);
    const colour = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const colours = { played: colour("--foreground", "#18181b"), ahead: colour("--muted-foreground", "#71717a"), take: colour("--destructive", "#dc2626"), head: colour("--foreground", "#18181b") };
    let shownLine: number | null | undefined;
    let shownBar: number | null | undefined;
    let shownRecording = false;
    /** The window's left edge (s) and the playhead's x for a lane `width` wide. */
    const frameOf = (width: number, at: number) => {
      const { duration, span, whole } = latest.current;
      if (whole) return { from: 0, length: duration, head: (at / duration) * width };
      return { from: at - span / 2, length: span, head: width / 2 };
    };
    const prepare = (element: HTMLCanvasElement) => {
      const context = element.getContext("2d");
      if (!context) return null;
      const width = element.clientWidth;
      const height = element.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
        element.width = Math.round(width * ratio);
        element.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      return { context, width, height };
    };
    let frame = requestAnimationFrame(function tick() {
      const { tracks, duration, engine, bars, places, lines, coloured } = latest.current;
      const at = stemsPosition();
      tracks.forEach((track, index) => {
        const element = canvases.current[index];
        const prepared = element ? prepare(element) : null;
        if (!prepared) return;
        const { context, width, height } = prepared;
        const { from, length, head } = frameOf(width, at);
        const per = (length / width) * STEP;
        const on = isAudible(engine, track.id);
        // The bars, faint, as on a DAW's grid; none when zoomed out too far to read them.
        const lines = barLines(engine.beat, from, from + length);
        if (lines.length < width / 12) {
          context.fillStyle = colours.ahead;
          context.globalAlpha = 0.18;
          for (const line of lines) context.fillRect(Math.round(((line - from) / length) * width), 0, 1, height);
        }
        const levels: number[] = [];
        for (let x = 0; x <= width + STEP; x += STEP) {
          const start = from + (x / width) * length;
          levels.push(start < 0 ? 0 : peakBetween(track, start, start + per));
        }
        // A colour per part (issue #379), else the page's ink.
        const tint = coloured && !track.take ? partColour(track.part, index) : null;
        drawShape(context, width, height, STEP, levels, ((at - from) / length) * width, { colour: tint ?? colours.played, alpha: (tint ? 0.9 : 0.75) * (on ? 1 : 0.3) }, { colour: tint ?? colours.ahead, alpha: (tint ? 0.4 : 0.35) * (on ? 1 : 0.3) });
        context.globalAlpha = 1;
        context.fillStyle = colours.head;
        context.fillRect(Math.round(head) - 1, 0, 2, height);
      });
      // The take being recorded (issue #365): what the microphone heard, from where it started to the playhead.
      const taking = liveTake.from !== null;
      if (taking !== shownRecording) {
        shownRecording = taking;
        setRecording(taking);
      }
      const take = takeCanvas.current;
      const prepared = taking && take ? prepare(take) : null;
      if (prepared && liveTake.from !== null) {
        const { context, width, height } = prepared;
        const { from, length, head } = frameOf(width, at);
        const peaks = liveTake.peaks;
        const levels: number[] = [];
        for (let x = 0; x <= width + STEP; x += STEP) {
          const start = from + (x / width) * length;
          if (start > at) break;
          const first = Math.floor((start - liveTake.from) / COLUMN);
          const last = Math.floor((start + (length / width) * STEP - liveTake.from) / COLUMN);
          let level = 0;
          for (let column = Math.max(0, first); column <= Math.min(peaks.length - 1, last); column++) level = Math.max(level, peaks[column]!);
          levels.push(level);
        }
        drawShape(context, width, height, STEP, levels, width, { colour: colours.take, alpha: 1 }, { colour: colours.take, alpha: 0 });
        context.fillStyle = colours.head;
        context.fillRect(Math.round(head) - 1, 0, 2, height);
      }
      // What the lanes show, boxed on the overview.
      const box = windowBox.current;
      if (box && duration > 0) {
        const { span } = latest.current;
        box.style.left = `${(Math.max(0, at - span / 2) / duration) * 100}%`;
        box.style.width = `${(Math.min(span, duration) / duration) * 100}%`;
      }
      // The words and the bar, as the music has them.
      // Where the stems are in the song's bars, playing or not: the recording's own beats, else its tempo from its first beat.
      const beat = engine.beat;
      const position = beat ? (beat.map ? recordingBeatPosition(beat.map, at, bars) : null) ?? ((at - beat.firstBeat) * beat.tempo) / 60 : null;
      const where = position === null ? null : barAt(bars, position);
      const nowBar = where ? where.bar + 1 : null;
      if (nowBar !== shownBar) {
        shownBar = nowBar;
        setBar(nowBar);
      }
      const line = position === null ? null : lineAtPosition(bars, places, position + AHEAD);
      const index = line ? lines.findIndex((one) => one.passIndex === line.passIndex && one.id === line.lineId) : -1;
      const nowLine = index < 0 ? null : index;
      if (nowLine !== shownLine) {
        shownLine = nowLine;
        setSung(nowLine);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [here]);

  /** A tap on a lane or the overview: there in the song. */
  const seekFrom = (whole: boolean) => (event: ReactPointerEvent<HTMLElement>) => {
    if (!here || engine.following) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const ratio = (event.clientX - box.left) / box.width;
    const at = whole ? ratio * duration : stemsPosition() + (ratio - 0.5) * span;
    seekStems(Math.min(duration, Math.max(0, at)));
  };

  if (!here) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="tracks-view" data-state="waiting">
        {t("tracks.notLoaded")}
      </p>
    );
  }

  const currentCue = cues.length ? cueAt(cues, engine.position) : null;
  const before = sung !== null ? (lines[sung - 1] ?? null) : null;
  const now = sung !== null ? (lines[sung] ?? null) : null;
  const after = sung !== null ? (lines[sung + 1] ?? null) : (lines[0] ?? null);
  return (
    <div className="flex flex-col gap-3" data-testid="tracks-view" data-state="ready" data-zoom={whole ? "song" : String(span)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums" data-testid="tracks-bar">
          {bar !== null ? t("tracks.bar", { n: bar }) : null}
        </span>
        <span className="flex-1" />
        <span className="tabular-nums" data-testid="tracks-zoom">
          {whole ? t("tracks.wholeSong") : t("tracks.seconds", { count: span })}
        </span>
        <Button
          type="button"
          variant={coloured ? "secondary" : "outline"}
          size="icon"
          className="size-8"
          onClick={() => setTrackColours(!coloured)}
          aria-pressed={coloured}
          aria-label={t("tracks.colours")}
          title={t("tracks.colours")}
          data-testid="tracks-colours"
        >
          <Palette />
        </Button>
        <Button type="button" variant="outline" size="icon" className="size-8" disabled={zoom === ZOOMS.length - 1 || whole} onClick={() => setZoom(Math.min(ZOOMS.length - 1, zoom + 1))} aria-label={t("tracks.zoomOut")} title={t("tracks.zoomOut")} data-testid="tracks-zoom-out">
          <Minus />
        </Button>
        <Button type="button" variant="outline" size="icon" className="size-8" disabled={zoom === 0} onClick={() => setZoom(Math.max(0, zoom - 1))} aria-label={t("tracks.zoomIn")} title={t("tracks.zoomIn")} data-testid="tracks-zoom-in">
          <Plus />
        </Button>
      </div>

      {/* The whole song: its sections, a box round what the lanes show; a tap goes there. */}
      <div className="relative h-7 cursor-pointer overflow-hidden rounded-md bg-muted" onPointerDown={seekFrom(true)} role="presentation" data-testid="tracks-overview">
        {spans.map(({ cue, section, start, end }, index) => (
          <div
            key={`${cue.sectionId}-${index}`}
            className={cn("absolute inset-y-0 truncate border-l border-background px-1 text-[11px] leading-7 text-white", currentCue !== null && cues[currentCue] === cue && "font-semibold")}
            style={{ left: `${(start / duration) * 100}%`, width: `${((end - start) / duration) * 100}%`, background: GROUP_COLOURS[section.group], opacity: currentCue !== null && cues[currentCue] === cue ? 1 : 0.55 }}
            data-testid="tracks-section"
          >
            {cueNames.short(section)}
          </div>
        ))}
        <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${(engine.position / duration) * 100}%` }} aria-hidden />
        <div ref={windowBox} className={cn("pointer-events-none absolute inset-y-0 rounded-md border-2 border-foreground", whole && "hidden")} aria-hidden data-testid="tracks-window" />
      </div>

      {/* The words being sung, the line before faint, the next after. */}
      {lines.length > 0 ? (
        <p className="flex min-h-6 items-baseline justify-center gap-6 overflow-hidden whitespace-nowrap text-sm" data-testid="tracks-lyrics" aria-live="off">
          {before ? <span className="hidden truncate text-muted-foreground/60 md:inline">{before.text}</span> : null}
          {now ? (
            <span className="truncate font-semibold" data-testid="tracks-sung">
              {now.text}
            </span>
          ) : null}
          {after ? <span className="truncate text-muted-foreground">{after.text}</span> : null}
        </p>
      ) : null}

      {/* A lane per part. */}
      <ul className="flex flex-col gap-1" data-testid="tracks-lanes">
        {tracks.map((track, index) => {
          const name = nameOf(track);
          const on = isAudible(engine, track.id);
          const muted = engine.muted.has(track.id);
          const soloed = engine.soloed.has(track.id);
          return (
            <li key={track.id} className={cn("flex items-center gap-2 rounded-md bg-muted/40 pr-1", track.take && "bg-destructive/5")} data-testid="tracks-lane" data-audible={String(on)}>
              <span className={cn("w-20 shrink-0 truncate pl-2 text-xs font-medium sm:w-32 sm:text-sm", !on && "text-muted-foreground")} title={name}>
                {name}
              </span>
              <canvas
                ref={(element) => {
                  canvases.current[index] = element;
                }}
                className="h-12 min-w-0 flex-1 cursor-pointer sm:h-14"
                onPointerDown={seekFrom(whole)}
                role="img"
                aria-label={name}
              />
              <button
                type="button"
                className={cn("size-7 shrink-0 rounded-sm border text-[11px] font-semibold", muted ? "border-foreground bg-foreground text-background" : "text-muted-foreground")}
                aria-pressed={muted}
                aria-label={t("stems.mute", { part: name })}
                onClick={() => toggleStemMute(track.id)}
                disabled={!!engine.following}
                data-testid="tracks-mute"
              >
                M
              </button>
              <button
                type="button"
                className={cn("size-7 shrink-0 rounded-sm border text-[11px] font-semibold", soloed ? "border-amber-500 bg-amber-500 text-black" : "text-muted-foreground")}
                aria-pressed={soloed}
                aria-label={soloed ? t("stems.unsolo", { part: name }) : t("stems.solo", { part: name })}
                onClick={() => toggleStemSolo(track.id)}
                disabled={!!engine.following}
                data-testid="tracks-solo"
              >
                S
              </button>
            </li>
          );
        })}
        {/* The take being recorded in the player (issue #365). */}
        {recording ? (
          <li
            ref={showTake}
            className="flex items-center gap-2 rounded-md bg-destructive/10 pr-1"
            data-testid="tracks-take"
          >
            <span className="w-20 shrink-0 truncate pl-2 text-xs font-semibold text-destructive sm:w-32 sm:text-sm">{t("tracks.take")}</span>
            <canvas ref={takeCanvas} className="h-12 min-w-0 flex-1 sm:h-14" role="img" aria-label={t("tracks.take")} />
            <span className="w-[3.75rem] shrink-0" aria-hidden />
          </li>
        ) : null}
      </ul>
    </div>
  );
}
