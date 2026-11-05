import { barAt, chartBars, metronomeForSong, structureOf, type ChartBar, type RenderedChart, type SongDocumentV2, type StructureGroup } from "@oneverse/core";
import { Metronome, Square } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FAMILY_COLORS } from "@oneverse/screen/components/song-chart";
import { useBarsClock } from "#/lib/bars-clock";
import { startMetronome, stopMetronome, useMetronome } from "#/lib/metronome-engine";
import { unlockSyncAudio } from "#/lib/sync-client";
import { cn } from "@oneverse/ui/lib/utils";

/** A section's colour on its first bar, as the structure bar's. */
export const GROUP_COLORS: Record<StructureGroup, string> = {
  edge: "bg-violet-500",
  verse: "bg-sky-500",
  chorus: "bg-amber-400",
  bridge: "bg-rose-500",
  instrumental: "bg-emerald-500",
  other: "bg-zinc-500",
};
/** How much of the next page's first beat shows at the right edge: all of it, what's coming at a glance (issue #390). */
const PEEK = 1;
/** A beat's cell at its narrowest (CSS px, its margins included): a phone shows one 4/4 bar. */
const MIN_CELL = 48;
const WIDE_MIN_CELL = 60;
/** A bar's line on its left (CSS px). */
const BAR_LINE = 3;

/**
 * The bars row (issue #238), at the top of Practice and Live: the song's
 * chords in bars and beats - a cell a beat, a strong line where a bar
 * starts, the chord written where it changes, each section's name on its
 * first bar - and the metronome (not in Practice, where the song's pill has
 * it, issue #390). The first beat of each bar is marked. It shows whole bars, as many as fit (one
 * on a phone), and a little of the next one's first beat; as the music
 * plays, the current beat fills, and once the last bar shown is over the
 * row turns to the next page at once - never sliding under the eye. It
 * follows the music as `useBarsClock` says (the stems, the
 * metronome or the Sync leader's), else it stands at bar 1 and can be
 * scrolled.
 */
export function BarsRow({
  songId,
  chart,
  document,
  chordColors = false,
  metronome: withMetronome = true,
  className,
}: {
  songId: string;
  chart: RenderedChart;
  /** The song itself, for its sections' own bars (`rhythm`); without it, bars are filled in from the chart. */
  document?: Pick<SongDocumentV2, "sections"> | null;
  chordColors?: boolean;
  /** Its own metronome button at the left; false where the page has one (Practice, issue #390). */
  metronome?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const bars = useMemo(() => chartBars(chart, document), [chart, document]);
  const steps = useMemo(() => structureOf(chart), [chart]);
  const metronome = useMetronome();
  const { source, position } = useBarsClock(songId, bars);
  const strip = useRef<HTMLDivElement>(null);

  // The cells sized so whole bars fill the row, with a peek at the next one (the bars' usual length).
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const counts = new Map<number, number>();
    for (const bar of bars) counts.set(bar.beats, (counts.get(bar.beats) ?? 0) + 1);
    const beats = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 4;
    const size = () => {
      const width = element.clientWidth;
      if (!width) return;
      const least = window.matchMedia("(min-width: 640px)").matches ? WIDE_MIN_CELL : MIN_CELL;
      const shown = Math.max(1, Math.floor((width - PEEK * least) / (beats * least + BAR_LINE)));
      const cell = (width - shown * BAR_LINE) / (shown * beats + PEEK);
      element.style.setProperty("--beat-w", `${Math.max(least, cell) - 4}px`);
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bars]);

  // Frame by frame, without rendering again: where the music is, in beats from the song's start.
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const barElements = element.querySelectorAll<HTMLElement>("[data-bar]");
    // The page shown: its first bar, and the first bar after it.
    let page = { from: 0, to: 0 };
    const leftOf = (bar: HTMLElement) => bar.getBoundingClientRect().left - element.getBoundingClientRect().left + element.scrollLeft;
    const turnTo = (from: number) => {
      const first = barElements[from];
      if (!first) return;
      const start = leftOf(first);
      // Whole bars while they fit, leaving room for the peek; always one.
      let to = from + 1;
      while (to < barElements.length && leftOf(barElements[to]!) + barElements[to]!.offsetWidth - start <= element.clientWidth - 8) to++;
      page = { from, to };
      element.scrollTo({ left: start, behavior: "instant" });
    };
    const cells = element.querySelectorAll<HTMLElement>("[data-beat]");
    const countIn = element.parentElement?.querySelector<HTMLElement>("[data-count-in]") ?? null;
    let lit: HTMLElement | null = null;
    let shownBeat = Number.NaN;
    const light = (index: number | null) => {
      if (lit) delete lit.dataset.on;
      lit = index === null ? null : (cells[index] ?? null);
      if (lit) lit.dataset.on = "";
    };
    if (!position) {
      light(null);
      if (countIn) countIn.hidden = true;
      element.dataset.position = "";
      return;
    }
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
          // Past the page's last bar (or before its first, after a seek), or out of view (the row resized, scrolled by hand): the next page, at once.
          const current = barElements[where.bar];
          const left = current ? leftOf(current) - element.scrollLeft : 0;
          const shown = !!current && left >= -1 && left + current.offsetWidth <= element.clientWidth + 1;
          if (where.bar < page.from || where.bar >= page.to || !shown) turnTo(where.bar);
        } else {
          light(null);
          if (at < 0 && page.from !== 0) turnTo(0);
        }
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      light(null);
    };
  }, [position, bars]);

  const tempo = chart.tempo;
  const mine = metronome.playing && metronome.songId === songId;
  const press = () => {
    if (metronome.following) return unlockSyncAudio();
    if (mine) return stopMetronome();
    if (tempo) startMetronome(metronomeForSong(metronome.settings, { tempo, tempoUnit: chart.tempoUnit, timeSignature: chart.timeSignature, beats: chart.metronomeBeats }), songId);
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
    <div className={cn("relative flex h-16 shrink-0 items-stretch gap-1 border-b bg-background", !withMetronome && "pl-3", className)} data-testid="bars-row" data-source={source ?? undefined}>
      {withMetronome ? (
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
      ) : null}
      <div ref={strip} className="flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain [--beat-w:2.75rem] [scrollbar-width:none] sm:[--beat-w:3.5rem]" data-testid="bars-strip">
        {bars.map((bar) => (
          <Bar key={bar.index} bar={bar} section={bar.barInPass === 0 ? steps[bar.passIndex] : undefined} chordColors={chordColors} />
        ))}
        {/* Room after the last bar: the last page starts at the left like the others. */}
        <div className="w-full shrink-0" aria-hidden />
      </div>
      <span
        hidden
        data-count-in
        className={cn("pointer-events-none absolute top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md bg-amber-500 text-lg font-bold text-white tabular-nums", withMetronome ? "left-16" : "left-4")}
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
            data-downbeat={beat === 0 ? "" : undefined}
            className={cn(
              "mx-0.5 mb-0.5 flex w-(--beat-w) items-center rounded-sm bg-muted px-1 transition-colors duration-75",
              // The bar's first beat, marked (issue #390).
              beat === 0 && "ring-2 ring-primary ring-inset",
              "data-[on]:bg-foreground data-[on]:text-background",
            )}
          >
            {chords.map((chord) => (
              <span key={chord.id} className={cn("min-w-0 flex-1 truncate text-sm font-bold", chords.length === 1 && "text-center", chords.length > 1 && "not-first:border-l not-first:border-background/60 not-first:pl-1", chordColors && chord.family && FAMILY_COLORS[chord.family])} data-bar-chord={chord.label}>
                {chord.label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
