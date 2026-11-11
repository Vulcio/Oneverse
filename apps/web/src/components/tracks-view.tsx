import { barAt, barBeatPlaces, chartBars, cueAt, lineAtPosition, recordingBeatPosition, sortedCues, waveformPeakBetween, WAVEFORM_RATE, type Attachment, type CueSection, type RenderedChart, type SongDocumentV2 } from "@oneverse/core";
import { AudioLines, Metronome, Minus, Palette, Plus } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ViewSwitchAside } from "#/components/chart-or-pdf";
import { Button } from "@oneverse/ui/components/button";
import { cn } from "@oneverse/ui/lib/utils";
import { GROUP_COLOURS, useCueNames } from "#/components/stem-cues";
import { useTrackName } from "#/components/stem-dock";
import { keepInView } from "#/lib/follow-view";
import { ownMetronomeSettings, useMetronome } from "#/lib/metronome-engine";
import { deviceNow } from "#/lib/output-clock";
import { getStemState, seekStems, stemBuffer, stemStoredWave, toggleStemMute, toggleStemSolo, useStems } from "#/lib/stem-engine";
import { isAudible, shownDuration, type StemTrack } from "#/lib/stem-files";
import { partColour, setTrackColours, setTrackWaves, setTrackZoom, TRACK_ZOOMS, useTrackColours, useTrackWaves, useTrackZoom } from "#/lib/track-colours";
import { bufferLevels, drawWave, WAVE_STEP, waveColumns } from "#/lib/wave-shape";
import { COLUMN, liveTake } from "#/lib/take-strip";
import { useMarkTracksShown } from "#/lib/tracks-shown";
import { recordingClicksBetween, setRecordingClick, useRecordingClick } from "#/lib/recording-click";

/** How much of the song the lanes show (s); the last, all of it (TRACK_ZOOMS, kept on the device). */
const ZOOMS = [8, 16, 32, Number.POSITIVE_INFINITY];
/** Where the playhead sits in the lanes when not recording: a fifth of the way in (issue #390). */
const LEAD = 0.2;
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

/** How tall each click is in the metronome lane (issue #410), of the lane's height: as loud as it sounds. */
const CLICK_HEIGHT = { accent: 0.9, medium: 0.65, normal: 0.42, sub: 0.2 } as const;

/** Where the stems are now (s), between renders: the audio clock while playing. */
function stemsPosition(): number {
  const state = getStemState();
  if (state.playing && state.anchor) return Math.min(state.duration, Math.max(0, state.anchor.position + ((deviceNow() - state.anchor.epoch) / 1000) * state.speed));
  return state.position;
}

/** A part's loudest moment from `from` to `to` (s), 0-1: its decoded audio, else - while it downloads - the server's waveform (issue #388), else the one the player drew. */
function peakBetween(track: StemTrack, from: number, to: number): number {
  if (to <= 0 || from >= track.length) return 0;
  const buffer = stemBuffer(track.id);
  if (buffer) return waveformPeakBetween(bufferLevels(buffer), WAVEFORM_RATE, from, to);
  const stored = stemStoredWave(track.id);
  // As loud as it is, as the decoded audio's drawn.
  if (stored) return waveformPeakBetween(stored.levels, stored.rate, from, to) * stored.loudest;
  if (!track.peaks || track.length <= 0) return 0;
  const per = track.peaks.length / track.length;
  let loudest = 0;
  for (let slice = Math.max(0, Math.floor(from * per)); slice <= Math.min(track.peaks.length - 1, Math.floor(to * per)); slice++) loudest = Math.max(loudest, track.peaks[slice]!);
  return loudest;
}

/**
 * A song's parts as lanes, as in a DAW (issue #374): the song's sections
 * across the top, a box round what the lanes show; the words being sung;
 * then each part's waveform under a playhead a fifth of the way in (the
 * middle while recording) - played on its
 * left, coming on its right, muted ones faint - zoomed from a few seconds
 * to the whole song. While a part's recorded in the player, the take has a
 * lane of its own, growing left of the playhead; the metronome too (issue
 * #410), a tick per click as loud as it sounds. It reads the stem player:
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
  // While the files download too, from their stored waveforms (issue #388).
  const here = engine.songVersionId === songVersionId && engine.tracks.length > 0 && shownDuration(engine) > 0;
  useMarkTracksShown(here);
  const tracks = here ? engine.tracks : [];
  const duration = here ? shownDuration(engine) : 0;
  const zoom = TRACK_ZOOMS.indexOf(useTrackZoom());
  const setZoom = (index: number) => setTrackZoom(TRACK_ZOOMS[index] ?? "16");
  // The bar count beside the Chart / Grid / Tracks switch, where the page has room for it (issue #390).
  const aside = useContext(ViewSwitchAside);
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
  const waves = useTrackWaves();
  // The metronome with the recording (issue #410): its lane draws the clicks it plays, on or off.
  const click = useRecordingClick();
  const metronome = useMetronome();
  const own = useMemo(() => ownMetronomeSettings(), [metronome.settings]);
  const clickCanvas = useRef<HTMLCanvasElement | null>(null);
  const latest = useRef({ tracks, duration, span, whole, engine, bars, places, lines, coloured, waves, click, own });
  latest.current = { tracks, duration, span, whole, engine, bars, places, lines, coloured, waves, click, own };
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
    /**
     * The window's left edge (s) and the playhead's x for a lane `width` wide.
     * Recording, the playhead stays in the middle, the take growing left of it; else it sits a fifth
     * of the way in (issue #390): from the song's start it moves there, and near its end on to it,
     * so no half of the lanes is left empty.
     */
    const frameOf = (width: number, at: number) => {
      const { duration, span, whole } = latest.current;
      if (whole) return { from: 0, length: duration, head: (at / duration) * width };
      if (liveTake.from !== null) return { from: at - span / 2, length: span, head: width / 2 };
      const from = Math.max(0, Math.min(at - span * LEAD, duration - span));
      return { from, length: span, head: ((at - from) / span) * width };
    };
    /** The canvas sized for the screen; null when it can't draw. */
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
      return { context, width, height, ratio };
    };
    const clear = (context: CanvasRenderingContext2D, width: number, height: number, ratio: number) => {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.globalAlpha = 1;
      context.clearRect(0, 0, width, height);
    };
    // What each lane last drew, so a frame where nothing moved draws nothing (paused, or a pixel not yet crossed).
    const drawn: string[] = [];
    let drawnTake = "";
    let drawnClicks = "";
    // Each lane's columns measured so far (issue #386): a column is a fixed slice of the song, so it's measured once.
    const measured: { source: string; levels: Map<number, number> }[] = [];
    const levelsOf = (index: number, track: StemTrack, first: number, count: number, per: number) => {
      const source = `${track.id}:${per}:${stemBuffer(track.id) ? "decoded" : stemStoredWave(track.id) ? "stored" : (track.peaks?.length ?? 0)}`;
      let lane = measured[index];
      if (!lane || lane.source !== source || lane.levels.size > 50_000) lane = measured[index] = { source, levels: new Map() };
      const levels: number[] = [];
      for (let k = first; k < first + count; k++) {
        let level = lane.levels.get(k);
        if (level === undefined) {
          level = k < 0 ? 0 : peakBetween(track, k * per, (k + 1) * per);
          lane.levels.set(k, level);
        }
        levels.push(level);
      }
      return levels;
    };
    let frame = requestAnimationFrame(function tick() {
      const { tracks, duration, engine, bars, places, lines, coloured, waves } = latest.current;
      const at = stemsPosition();
      const step = WAVE_STEP[waves];
      drawn.length = tracks.length;
      tracks.forEach((track, index) => {
        const element = canvases.current[index];
        const prepared = element ? prepare(element) : null;
        if (!prepared) return;
        const { context, width, height, ratio } = prepared;
        if (width <= 0 || height <= 0) return;
        const { from, length, head } = frameOf(width, at);
        const { first, per, count, origin } = waveColumns(from, length, width, step, ratio);
        const shift = origin - first * step;
        // Still downloading (issue #388): its stored waveform, faint, filled in as far as it's come.
        const arriving = !track.ready && !track.take;
        const until = arriving ? (track.downloaded ?? 0) * track.length : at;
        const cut = Math.round(((until - from) / length) * width * ratio) / ratio;
        const on = isAudible(engine, track.id);
        const tint = coloured && !track.take ? partColour(track.part, index) : null;
        const key = [width, height, ratio, length, shift, cut, Math.round(head * ratio), waves, tint, on, track.id, stemBuffer(track.id) ? 1 : stemStoredWave(track.id) ? 2 : 0, arriving, track.peaks?.length ?? 0, engine.beat?.tempo, engine.beat?.map?.downbeats.length].join(" ");
        if (drawn[index] === key) return;
        drawn[index] = key;
        clear(context, width, height, ratio);
        // The bars, faint, as on a DAW's grid; none when zoomed out too far to read them. They slide with the waveform.
        const lines = barLines(engine.beat, from, from + length);
        if (lines.length < width / 12) {
          context.fillStyle = colours.ahead;
          context.globalAlpha = 0.18;
          for (const line of lines) context.fillRect(Math.round((line / length) * width * ratio) / ratio + shift, 0, 1, height);
        }
        // A colour per part (issue #379), else the page's ink.
        drawWave(context, {
          width,
          height,
          origin,
          step,
          levels: levelsOf(index, track, first, count, per),
          cut,
          played: arriving ? { colour: colours.ahead, alpha: 0.45 * (on ? 1 : 0.3) } : { colour: tint ?? colours.played, alpha: (tint ? 0.9 : 0.75) * (on ? 1 : 0.3) },
          ahead: arriving ? { colour: colours.ahead, alpha: 0.15 * (on ? 1 : 0.3) } : { colour: tint ?? colours.ahead, alpha: (tint ? 0.4 : 0.35) * (on ? 1 : 0.3) },
          style: waves,
        });
        context.globalAlpha = 1;
        context.fillStyle = colours.head;
        context.fillRect(Math.round(head) - 1, 0, 2, height);
      });
      // The metronome (issue #410): a tick per click, as tall as it's loud; played on the playhead's left, faint while off.
      const metronomeLane = clickCanvas.current;
      const clickLane = metronomeLane && engine.beat ? prepare(metronomeLane) : null;
      if (clickLane && engine.beat && clickLane.width > 0 && clickLane.height > 0) {
        const { context, width, height, ratio } = clickLane;
        const { from, length, head } = frameOf(width, at);
        const { click, own } = latest.current;
        const key = [width, height, ratio, from, length, Math.round(head * ratio), click, JSON.stringify(engine.beat), JSON.stringify(own)].join(" ");
        if (key !== drawnClicks) {
          drawnClicks = key;
          clear(context, width, height, ratio);
          const clicks = recordingClicksBetween(own, engine.beat, from, from + length);
          // Too close together to read, zoomed out: the beats only.
          const shown = clicks.length > width / 3 ? clicks.filter((one) => one.level !== "sub") : clicks;
          if (shown.length <= width / 2) {
            const middle = height / 2;
            for (const one of shown) {
              const x = Math.round(((one.at - from) / length) * width * ratio) / ratio;
              const tall = Math.max(2, CLICK_HEIGHT[one.level] * height);
              context.fillStyle = one.at <= at ? colours.played : colours.ahead;
              context.globalAlpha = (one.at <= at ? 0.8 : 0.45) * (click ? 1 : 0.35);
              context.fillRect(x - (one.level === "accent" ? 1 : 0.5), middle - tall / 2, one.level === "accent" ? 2 : 1, tall);
            }
          }
          context.globalAlpha = 1;
          context.fillStyle = colours.head;
          context.fillRect(Math.round(head) - 1, 0, 2, height);
        }
      }
      // The take being recorded (issue #365): what the microphone heard, from where it started to the playhead.
      const taking = liveTake.from !== null;
      if (taking !== shownRecording) {
        shownRecording = taking;
        setRecording(taking);
        drawnTake = "";
      }
      const take = takeCanvas.current;
      const prepared = taking && take ? prepare(take) : null;
      if (prepared && liveTake.from !== null && prepared.width > 0) {
        const { context, width, height, ratio } = prepared;
        const { from, length, head } = frameOf(width, at);
        const { first, per, count, origin } = waveColumns(from, length, width, step, ratio);
        const key = [width, height, ratio, origin, Math.round(head * ratio), waves, liveTake.peaks.length, liveTake.from].join(" ");
        if (key !== drawnTake) {
          drawnTake = key;
          clear(context, width, height, ratio);
          const peaks = liveTake.peaks;
          const levels: number[] = [];
          for (let k = first; k < first + count; k++) {
            const start = k * per;
            if (start > at) break;
            let level = 0;
            const last = Math.min(peaks.length - 1, Math.floor(((k + 1) * per - liveTake.from) / COLUMN));
            for (let column = Math.max(0, Math.floor((start - liveTake.from) / COLUMN)); column <= last; column++) level = Math.max(level, peaks[column]!);
            levels.push(level);
          }
          drawWave(context, { width, height, origin, step, levels, cut: width, played: { colour: colours.take, alpha: 1 }, ahead: { colour: colours.take, alpha: 0 }, style: waves });
          context.globalAlpha = 1;
          context.fillStyle = colours.head;
          context.fillRect(Math.round(head) - 1, 0, 2, height);
        }
      }
      // What the lanes show, boxed on the overview.
      const box = windowBox.current;
      if (box && duration > 0) {
        const { span } = latest.current;
        box.style.left = `${(Math.max(0, frameOf(1, at).from) / duration) * 100}%`;
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
      {(() => {
        const barCount = (
          <span className="text-xs tabular-nums text-muted-foreground" data-testid="tracks-bar">
            {bar !== null ? t("tracks.bar", { n: bar }) : null}
          </span>
        );
        return aside ? createPortal(barCount, aside) : barCount;
      })()}
      {/* On a phone, the look is in Display's Tracks section (issue #390): the lanes get the room. */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground max-sm:hidden">
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
        <Button
          type="button"
          variant={waves === "lines" ? "secondary" : "outline"}
          size="icon"
          className="size-8"
          onClick={() => setTrackWaves(waves === "lines" ? "filled" : "lines")}
          aria-pressed={waves === "lines"}
          aria-label={t("tracks.lines")}
          title={t("tracks.lines")}
          data-testid="tracks-lines"
        >
          <AudioLines />
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
            <li key={track.id} className={cn("flex items-center gap-2 rounded-md bg-muted/40 pr-1", track.take && "bg-destructive/5")} data-testid="tracks-lane" data-audible={String(on)} data-ready={String(!!track.ready || !!track.take)}>
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
        {/* The metronome with the recording (issue #410): the player's click button, as a lane. */}
        {engine.beat ? (
          <li className="flex items-center gap-2 rounded-md bg-muted/40 pr-1" data-testid="tracks-metronome" data-on={String(click)}>
            <span className={cn("w-20 shrink-0 truncate pl-2 text-xs font-medium sm:w-32 sm:text-sm", !click && "text-muted-foreground")} title={t("tracks.metronome")}>
              {t("tracks.metronome")}
            </span>
            <canvas ref={clickCanvas} className="h-8 min-w-0 flex-1 cursor-pointer sm:h-10" onPointerDown={seekFrom(whole)} role="img" aria-label={t("tracks.metronome")} />
            <button
              type="button"
              className={cn("flex h-7 w-16 shrink-0 items-center justify-center rounded-sm border", click ? "border-foreground bg-foreground text-background" : "text-muted-foreground")}
              aria-pressed={click}
              aria-label={t("stems.clickWith")}
              title={t("stems.clickWithAt", { tempo: engine.beat.tempo })}
              onClick={() => setRecordingClick(!click)}
              disabled={!!engine.following}
              data-testid="tracks-metronome-toggle"
            >
              <Metronome className="size-4" />
            </button>
          </li>
        ) : null}
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
