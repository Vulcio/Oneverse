import { barAt, barLyrics, chartBars, structureOf, type ChartBar, type RenderedChart, type SongDocumentV2 } from "@songverse/core";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { GROUP_COLORS } from "#/components/bars-row";
import { FAMILY_COLORS, passLabel } from "#/components/song-chart";
import { useBarsClock } from "#/lib/bars-clock";
import { cn } from "@songverse/ui/lib/utils";

/**
 * The chord grid (issue #238), a way to read a song as Chart and PDF are:
 * its chords in bars, four to a row (two on a phone), each section under
 * its name, a bar's number over it, its beats as slashes with the chord on
 * the beat it changes on, and the words sung in it underneath (Moises' bars
 * with the lyrics). The chords read as on the chart: transposed, capo,
 * names, colours. As the music plays (`useBarsClock`: the stems, the
 * metronome or the Sync leader's), the bar and the beat being played light
 * up, and the bar is kept in view.
 */
export function ChordGrid({
  songId,
  chart,
  document,
  chordColors = false,
  emptyText,
  className,
}: {
  songId: string;
  chart: RenderedChart;
  /** The song itself, for its sections' own bars (`rhythm`); without it, bars are filled in from the chart. */
  document?: Pick<SongDocumentV2, "sections"> | null;
  chordColors?: boolean;
  emptyText?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const bars = useMemo(() => chartBars(chart, document), [chart, document]);
  const words = useMemo(() => barLyrics(chart, bars), [chart, bars]);
  const steps = useMemo(() => structureOf(chart), [chart]);
  const { source, position } = useBarsClock(songId, bars);
  const grid = useRef<HTMLDivElement>(null);

  // The bars of each pass, in order.
  const passes = useMemo(() => {
    const grouped: { passIndex: number; bars: ChartBar[] }[] = [];
    for (const bar of bars) {
      const last = grouped.at(-1);
      if (last?.passIndex === bar.passIndex) last.bars.push(bar);
      else grouped.push({ passIndex: bar.passIndex, bars: [bar] });
    }
    return grouped;
  }, [bars]);

  // Frame by frame, without rendering again: the bar and beat being played lit, the bar kept in view.
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const barElements = element.querySelectorAll<HTMLElement>("[data-grid-bar]");
    let litBar: HTMLElement | null = null;
    let litBeat: HTMLElement | null = null;
    const light = (bar: number | null, beat: number) => {
      if (litBar) delete litBar.dataset.on;
      if (litBeat) delete litBeat.dataset.on;
      litBar = bar === null ? null : (barElements[bar] ?? null);
      litBeat = litBar?.querySelectorAll<HTMLElement>("[data-grid-beat]")[beat] ?? null;
      if (litBar) litBar.dataset.on = "";
      if (litBeat) litBeat.dataset.on = "";
    };
    if (!position) {
      light(null, 0);
      element.dataset.position = "";
      return;
    }
    let shownBeat = Number.NaN;
    let shownBar = -1;
    let frame = requestAnimationFrame(function tick() {
      const whole = Math.floor(position());
      if (whole !== shownBeat) {
        shownBeat = whole;
        const where = barAt(bars, whole);
        element.dataset.position = where ? `${where.bar}:${where.beat}` : "";
        light(where?.bar ?? null, where?.beat ?? 0);
        if (where && where.bar !== shownBar && litBar) {
          // Kept in view, without moving the page under the reader for every bar: only when it nears an edge.
          const box = litBar.getBoundingClientRect();
          if (box.top < window.innerHeight * 0.15 || box.bottom > window.innerHeight * 0.75) litBar.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        shownBar = where?.bar ?? -1;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      light(null, 0);
    };
  }, [position, bars]);

  if (bars.length === 0) return <p className="text-sm text-muted-foreground">{emptyText ?? t("chart.empty")}</p>;
  return (
    <div ref={grid} className={cn("flex flex-col gap-5", className)} data-testid="chord-grid" data-source={source ?? undefined}>
      {passes.map(({ passIndex, bars: passBars }) => {
        const pass = chart.passes[passIndex]!;
        const step = steps[passIndex];
        const heading = pass.section.showLabel === false ? null : passLabel(pass, t);
        return (
          <section key={pass.id} data-pass={pass.id} data-testid="chord-grid-pass">
            <p className="mb-1 flex items-center gap-2 font-sans text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {step ? (
                <span className={cn("rounded-sm px-1 text-[10px] leading-4 font-bold text-white normal-case", GROUP_COLORS[step.group])}>
                  {t(`live.short.${step.type}`)}
                  {step.number ?? ""}
                </span>
              ) : null}
              {heading ? <span data-testid="chord-grid-heading">{heading}</span> : null}
              {pass.timeSignature && (passIndex === 0 || pass.timeSignature.numerator !== chart.passes[passIndex - 1]?.timeSignature?.numerator) ? (
                <span className="tabular-nums normal-case">
                  {pass.timeSignature.numerator}/{pass.timeSignature.denominator}
                </span>
              ) : null}
            </p>
            <div className="grid grid-cols-2 gap-y-2 sm:grid-cols-4">
              {passBars.map((bar) => (
                <GridBar key={bar.index} bar={bar} words={words[bar.index] ?? null} chordColors={chordColors} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** One bar: its number, a cell a beat - the chord where it changes, else a slash - and its words. A bar line at its left, and at its right at the end of a row or of its section. */
function GridBar({ bar, words, chordColors }: { bar: ChartBar; words: string | null; chordColors: boolean }) {
  const { t } = useTranslation();
  const beats = Array.from({ length: bar.beats }, (_, beat) => bar.chords.filter((chord) => Math.floor(chord.beat) - 1 === beat));
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col border-l-2 border-foreground/70 px-1 pt-3.5 pb-1 transition-colors duration-75",
        "last:border-r-2 max-sm:even:border-r-2 sm:nth-[4n]:border-r-2",
        "data-[on]:bg-primary/10",
      )}
      data-grid-bar={bar.index}
      aria-label={t("bars.bar", { n: bar.index + 1 })}
    >
      <span className="absolute top-0 left-1 text-[10px] leading-3.5 text-muted-foreground tabular-nums">{bar.index + 1}</span>
      <div className="flex h-8 items-center">
        {beats.map((chords, beat) => (
          <div key={beat} className="flex min-w-0 flex-1 items-center rounded-sm px-0.5 data-[on]:bg-foreground data-[on]:text-background" data-grid-beat={beat}>
            {chords.length > 0 ? (
              chords.map((chord) => (
                <span key={chord.id} className={cn("text-base font-bold whitespace-nowrap", chordColors && chord.family && FAMILY_COLORS[chord.family])} data-grid-chord={chord.label}>
                  {chord.label}
                </span>
              ))
            ) : beat === 0 && bar.carried ? (
              // Held on from the bar before: named again, quietly.
              <span className="text-base font-bold whitespace-nowrap text-muted-foreground/60" data-grid-carried={bar.carried.label}>
                {bar.carried.label}
              </span>
            ) : (
              <span className="text-muted-foreground/50" aria-hidden>
                /
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="min-h-5 truncate text-sm text-muted-foreground" data-grid-words="">
        {words}
      </p>
    </div>
  );
}
