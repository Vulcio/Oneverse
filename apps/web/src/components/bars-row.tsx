import { barAt, chartBars, recordingBeatPosition, metronomeForSong, structureOf, type ChartBar, type RenderedChart, type SongDocumentV2, type StructureGroup } from "@songverse/core";
import { Metronome, Square } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FAMILY_COLORS } from "#/components/song-chart";
import { startMetronome, stopMetronome, useMetronome } from "#/lib/metronome-engine";
import { deviceNow } from "#/lib/output-clock";
import { useStems } from "#/lib/stem-engine";
import { unlockSyncAudio } from "#/lib/sync-client";
import { cn } from "@songverse/ui/lib/utils";

/** A section's colour on its first bar, as the structure bar's. */
const GROUP_COLORS: Record<StructureGroup, string> = {
  edge: "bg-violet-500",
  verse: "bg-sky-500",
  chorus: "bg-amber-400",
  bridge: "bg-rose-500",
  instrumental: "bg-emerald-500",
  other: "bg-zinc-500",
};
/** Beats kept in view before the current one: what's coming fills the rest. */
const LEAD_BEATS = 1;

/**
 * The bars row (issue #238), at the top of Practice and Live: the song's
 * chords in bars and beats - a cell a beat, a strong line where a bar
 * starts, the chord written where it changes, each section's name on its
 * first bar - and the metronome. As the music plays, the current beat
 * fills and the row slides so it stays near the left, what's coming in
 * view. It follows the stems when they play this song (their recording's
 * own beats and bars, issue #299, else its tempo and first beat), else the song's metronome (or the Sync leader's),
 * else it stands at bar 1 and can be scrolled.
 */
export function BarsRow({
  songId,
  chart,
  document,
  chordColors = false,
  className,
}: {
  songId: string;
  chart: RenderedChart;
  /** The song itself, for its sections' own bars (`rhythm`); without it, bars are filled in from the chart. */
  document?: Pick<SongDocumentV2, "sections"> | null;
  chordColors?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const bars = useMemo(() => chartBars(chart, document), [chart, document]);
  const steps = useMemo(() => structureOf(chart), [chart]);
  const metronome = useMetronome();
  const stems = useStems();
  const strip = useRef<HTMLDivElement>(null);

  const stemsHere = stems.songVersionId === songId && stems.playing && stems.anchor && stems.beat ? { anchor: stems.anchor, beat: stems.beat, speed: stems.speed } : null;
  const clickHere = metronome.playing && metronome.anchor && (metronome.songId === songId || metronome.following) ? { anchor: metronome.anchor, settings: metronome.settings } : null;
  const source: "stems" | "click" | "leader" | null = stemsHere ? "stems" : clickHere ? (metronome.following ? "leader" : "click") : null;

  // Frame by frame, without rendering again: where the music is, in beats from the song's start.
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const cells = element.querySelectorAll<HTMLElement>("[data-beat]");
    const countIn = element.parentElement?.querySelector<HTMLElement>("[data-count-in]") ?? null;
    let lit: HTMLElement | null = null;
    let shownBeat = Number.NaN;
    const light = (index: number | null) => {
      if (lit) delete lit.dataset.on;
      lit = index === null ? null : (cells[index] ?? null);
      if (lit) lit.dataset.on = "";
    };
    if (!source) {
      light(null);
      if (countIn) countIn.hidden = true;
      element.dataset.position = "";
      return;
    }
    const position = (): number => {
      const now = deviceNow();
      if (stemsHere) {
        const seconds = stemsHere.anchor.position + ((now - stemsHere.anchor.epoch) / 1000) * stemsHere.speed;
        // The recording's own beats and bars when they were found (issue #299), else its tempo from its first beat.
        const mapped = stemsHere.beat.map ? recordingBeatPosition(stemsHere.beat.map, seconds, bars) : null;
        return mapped ?? ((seconds - stemsHere.beat.firstBeat) * stemsHere.beat.tempo) / 60;
      }
      const { anchor, settings } = clickHere!;
      const beats = anchor.position + (now - anchor.epoch) / 1000 / (60 / settings.tempo);
      return beats - settings.countIn * settings.numerator;
    };
    let frame = requestAnimationFrame(function tick() {
      const at = position();
      const whole = Math.floor(at);
      if (whole !== shownBeat) {
        shownBeat = whole;
        const where = barAt(bars, at);
        element.dataset.position = where ? `${where.bar}:${where.beat}` : "";
        // Before bar 1: the count-in's beats, counted down.
        if (countIn) {
          countIn.hidden = at >= 0 || at < -16;
          countIn.textContent = at < 0 ? String(Math.ceil(-at)) : "";
        }
        if (where) {
          const index = bars[where.bar]!.start + where.beat;
          light(index);
          const cell = cells[index];
          if (cell) {
            // Where the cell is in the strip, whatever it's scrolled to.
            const left = cell.getBoundingClientRect().left - element.getBoundingClientRect().left + element.scrollLeft;
            element.scrollTo({ left: Math.max(0, left - cell.offsetWidth * LEAD_BEATS - 4), behavior: "smooth" });
          }
        } else {
          light(null);
          if (at < 0) element.scrollTo({ left: 0, behavior: "smooth" });
        }
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      light(null);
    };
  }, [source, bars, stemsHere?.anchor, stemsHere?.beat, stemsHere?.speed, clickHere?.anchor, clickHere?.settings]);

  const tempo = chart.tempo;
  const mine = metronome.playing && metronome.songId === songId;
  const press = () => {
    if (metronome.following) return unlockSyncAudio();
    if (mine) return stopMetronome();
    if (tempo) startMetronome(metronomeForSong(metronome.settings, { tempo, timeSignature: chart.timeSignature }), songId);
  };
  const label = metronome.following
    ? t("bars.followingLeader", { name: metronome.following })
    : mine
      ? t("bars.stop")
      : tempo
        ? t("bars.play", { tempo })
        : t("bars.noTempo");

  if (bars.length === 0) return null;
  return (
    <div className={cn("relative flex h-16 shrink-0 items-stretch gap-1 border-b bg-background", className)} data-testid="bars-row" data-source={source ?? undefined}>
      <button
        type="button"
        onClick={press}
        disabled={!tempo && !metronome.following}
        aria-label={label}
        aria-pressed={mine}
        title={label}
        className={cn(
          "flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 text-[10px] font-medium tabular-nums text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40 [&_svg]:size-4",
          mine && "text-foreground",
        )}
        data-testid="bars-metronome"
      >
        {mine ? <Square /> : <Metronome />}
        {tempo ? `${Math.round(tempo)}` : "–"}
      </button>
      <div ref={strip} className="flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none]" data-testid="bars-strip">
        {bars.map((bar) => (
          <Bar key={bar.index} bar={bar} section={bar.barInPass === 0 ? steps[bar.passIndex] : undefined} chordColors={chordColors} />
        ))}
        {/* Room after the last bar: the end can come to the left like the rest. */}
        <div className="w-1/2 shrink-0" aria-hidden />
      </div>
      <span
        hidden
        data-count-in
        className="pointer-events-none absolute top-1/2 left-16 flex size-9 -translate-y-1/2 items-center justify-center rounded-md bg-amber-500 text-lg font-bold text-white tabular-nums"
        aria-label={t("bars.countIn")}
        data-testid="bars-count-in"
      />
    </div>
  );
}

function Bar({ bar, section, chordColors }: { bar: ChartBar; section?: ReturnType<typeof structureOf>[number]; chordColors: boolean }) {
  const { t } = useTranslation();
  const cells = Array.from({ length: bar.beats }, (_, beat) => bar.chords.filter((chord) => Math.floor(chord.beat) - 1 === beat));
  return (
    <div className="flex shrink-0 flex-col border-l-[3px] border-foreground/70 first:border-l-0" data-bar={bar.index} title={t("bars.bar", { n: bar.index + 1 })}>
      {/* Its section's name, on its first bar, over the cells. */}
      <span className="flex h-4 shrink-0 items-center px-0.5">
        {section ? (
          <span className={cn("block h-3.5 rounded-sm px-1 text-[9px] leading-3.5 font-bold text-white", GROUP_COLORS[section.group])} data-testid="bars-section">
            {t(`live.short.${section.type}`)}
            {section.number ?? ""}
          </span>
        ) : null}
      </span>
      <div className="flex min-h-0 flex-1">
        {cells.map((chords, beat) => (
          <div
            key={beat}
            data-beat={beat}
            className={cn(
              "mx-0.5 mb-0.5 flex w-11 items-center rounded-sm bg-muted px-1 transition-colors duration-75 sm:w-14",
              "data-[on]:bg-foreground data-[on]:text-background",
            )}
          >
            {chords.map((chord) => (
              <span key={chord.id} className={cn("truncate text-sm font-bold", chordColors && chord.family && FAMILY_COLORS[chord.family])} data-bar-chord={chord.label}>
                {chord.label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
