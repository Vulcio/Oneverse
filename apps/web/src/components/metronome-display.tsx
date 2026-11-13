import { beatLightsUp, chartBars, type BeatLevel, type DrumsBeat, type EffectiveDisplaySettings, type MetronomeLightUpValue, type RenderedChart, type SongDocumentV2 } from "@oneverse/core";
import { useMemo } from "react";
import { cn } from "@oneverse/ui/lib/utils";
import { useBeatLevels, useDrumsOnScreen, usePageBeat, useRequestPageBeat, useSongBeat, type PageBeatSource } from "#/lib/song-beat";

/** The four levels' colours (issue #443), told apart by lightness too: accent orange, medium blue, small grey, off dark. */
const LEVEL_RGB: Record<BeatLevel, string> = { accent: "245 158 11", medium: "59 130 246", normal: "148 163 184", mute: "82 82 91" };

const lit = (beat: DrumsBeat | null, index: number, level: BeatLevel | undefined, lightUp: MetronomeLightUpValue) => !!beat && beat.beat === index && beatLightsUp(level, lightUp);

/**
 * The bar as columns, one per beat (issues #443, #107): each column lights up
 * on its beat, in its level's colour, as bright as asked; the others keep a
 * trace of their colour so the bar's shape shows. With reduced motion, a
 * column fades rather than flashes.
 */
export function BeatColumns({ levels, beat, brightness, lightUp, idle = 0.05, className }: { levels: BeatLevel[]; beat: DrumsBeat | null; brightness: number; lightUp: MetronomeLightUpValue; /** How much of its colour a column keeps between its beats. */ idle?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("pointer-events-none flex gap-1", className)} data-testid="beat-columns" data-beats={levels.length}>
      {levels.map((level, index) => {
        const on = lit(beat, index, level, lightUp);
        return (
          <div
            key={index}
            className="flex-1 transition-[background-color] duration-75 motion-reduce:duration-300"
            style={{ backgroundColor: `rgb(${LEVEL_RGB[level]} / ${on ? brightness : idle})` }}
            data-level={level}
            data-lit={on || undefined}
          />
        );
      })}
    </div>
  );
}

/** A row of blocks, one per beat, lit as each comes (issue #443). */
export function BeatBlocks({ levels, beat, lightUp, className }: { levels: BeatLevel[]; beat: DrumsBeat | null; lightUp: MetronomeLightUpValue; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex gap-1.5", className)} data-testid="beat-blocks">
      {levels.map((level, index) => {
        const on = lit(beat, index, level, lightUp);
        return (
          <div
            key={index}
            className="flex h-9 flex-1 items-center justify-center rounded-md text-sm font-bold tabular-nums transition-[background-color] duration-75 motion-reduce:duration-300"
            style={{ backgroundColor: `rgb(${LEVEL_RGB[level]} / ${on ? 1 : 0.15})`, color: on ? "white" : `rgb(${LEVEL_RGB[level]})` }}
            data-level={level}
            data-lit={on || undefined}
          >
            {index + 1}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The metronome's beat on a song's page, as the player chose in Display
 * (issue #443), while the song's music plays: a row of beat blocks or the
 * beat's number big, in a corner under the header, or the whole page behind
 * everything in columns (drawn by the page's shell, `PageBeatBackdrop`). The
 * pill (today's) shows nothing more. Steps aside for a view with its own beat
 * (the Drums view).
 */
export function SongBeatDisplay({ songId, chart, document, settings }: { songId: string; chart: RenderedChart; document: Pick<SongDocumentV2, "sections"> | null | undefined; settings: EffectiveDisplaySettings["metronome"] }) {
  const drums = useDrumsOnScreen();
  if (settings.display === "pill" || drums) return null;
  if (settings.display === "background") return <RequestBackground songId={songId} chart={chart} document={document} settings={settings} />;
  return <SongBeatDisplayOn songId={songId} chart={chart} document={document} settings={settings} />;
}

function RequestBackground({ songId, chart, document, settings }: { songId: string; chart: RenderedChart; document: Pick<SongDocumentV2, "sections"> | null | undefined; settings: EffectiveDisplaySettings["metronome"] }) {
  const source = useMemo<PageBeatSource>(() => ({ songId, chart, document, brightness: settings.brightness, lightUp: settings.lightUp, idle: 0.05, always: false }), [songId, chart, document, settings.brightness, settings.lightUp]);
  useRequestPageBeat(source);
  return null;
}

function SongBeatDisplayOn({ songId, chart, document, settings }: { songId: string; chart: RenderedChart; document: Pick<SongDocumentV2, "sections"> | null | undefined; settings: EffectiveDisplaySettings["metronome"] }) {
  const bars = useMemo(() => chartBars(chart, document), [chart, document]);
  const beat = useSongBeat(songId, bars);
  const levels = useBeatLevels(beat?.beats ?? chart.timeSignature?.numerator ?? 4, chart.timeSignature?.denominator ?? 4);
  if (!beat) return null;
  if (settings.display === "count") {
    const level = levels[beat.beat];
    const on = beatLightsUp(level, settings.lightUp);
    return (
      <div aria-hidden="true" className="pointer-events-none fixed top-20 right-4 z-30 text-8xl leading-none font-extrabold tabular-nums drop-shadow-sm sm:right-8" style={{ color: on && level ? `rgb(${LEVEL_RGB[level]})` : "rgb(148 163 184 / 0.5)" }} data-testid="beat-count" data-beat={beat.beat + 1}>
        {beat.beat + 1}
      </div>
    );
  }
  // In a corner under the header, over the page: nothing moves under it.
  return <BeatBlocks levels={levels} beat={beat} lightUp={settings.lightUp} className="pointer-events-none fixed top-20 right-4 z-30 w-56 rounded-lg bg-background/85 p-1.5 shadow-sm backdrop-blur sm:right-8 sm:w-72" />;
}

/**
 * The beat behind the whole page (issues #107, #443), when the Drums view or
 * the Background display asks for it: one column per beat across the page's
 * whole width and height, under its header, its title and everything on it.
 * Placed by the page's shell as the first child of an isolated, positioned
 * main area, so the sidebar stays as it is.
 */
export function PageBeatBackdrop() {
  const source = usePageBeat();
  return source ? <PageBeatColumns source={source} /> : null;
}

function PageBeatColumns({ source }: { source: PageBeatSource }) {
  const { songId, chart, document } = source;
  const bars = useMemo(() => chartBars(chart, document), [chart, document]);
  const beat = useSongBeat(songId, bars);
  const at = beat?.passIndex ?? 0;
  const timeSignature = chart.passes[at]?.timeSignature ?? chart.timeSignature;
  const levels = useBeatLevels(beat?.beats ?? timeSignature?.numerator ?? 4, timeSignature?.denominator ?? 4);
  if (!beat && !source.always) return null;
  return <BeatColumns levels={levels} beat={beat} brightness={source.brightness} lightUp={source.lightUp} idle={source.idle} className="absolute inset-0 -z-10 gap-1.5" />;
}
