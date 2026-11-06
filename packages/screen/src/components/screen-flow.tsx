import { screenSectionText, type ChartBar, type ScreenTheme } from "@oneverse/core";
import { cn } from "@oneverse/ui/lib/utils";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { BeatRow, beatsOf, chordsAbove, fillWords, effectFilter, kindOf, lineBars, lineLook, OutlineFilter, songBars, songBarWords, songLines, StageSide, type StageSong } from "./screen-text";

const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Where the lines being sung sit, from the top of the screen. */
const ANCHOR = { high: 0.33, middle: 0.46, low: 0.6 } as const;
/** The Grid keeps the bars being played a little above the middle: the next ones are what the band reads. */
const GRID_ANCHOR = 0.42;
const SECTION_KINDS = ["chorus", "bridge"] as const;

/**
 * Scroll and Grid (issue #395): the whole song as it's sung, repeats and
 * all, in one column that glides to keep the lines being sung (Scroll) or
 * the bars being played (Grid) in the same place, as a music player's
 * lyrics do. Nothing comes or goes between slides: the column moves, and
 * the lines around the current ones dim, fade or hide as the template says.
 */
export function Flow({ theme, song, index, phase, size }: { theme: ScreenTheme; song: StageSong; index: number; phase: "in" | "out" | "still"; size: number }) {
  const id = useId().replace(/:/g, "");
  const side = useContext(StageSide);
  const box = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<number | null>(null);
  // Placed at once the first time, then gliding.
  const [glide, setGlide] = useState(false);
  const { text, display, layout } = theme;
  const grid = display.mode === "grid" && songBars(song).length > 0;

  useBeforePaint(() => {
    const outer = box.current;
    const inner = column.current;
    if (!outer || !inner) return;
    const place = () => {
      const now = [...inner.querySelectorAll<HTMLElement>("[data-now]")];
      if (now.length === 0) return;
      const tops = now.map((element) => topIn(element, inner));
      const top = Math.min(...tops);
      const bottom = Math.max(...now.map((element, i) => tops[i]! + element.offsetHeight));
      setOffset(Math.round(outer.clientHeight * (grid ? GRID_ANCHOR : ANCHOR[display.scroll.anchor]) - (top + bottom) / 2));
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [index, grid, display.scroll.anchor, size]);
  useEffect(() => {
    if (offset === null || glide) return;
    const frame = requestAnimationFrame(() => setGlide(true));
    return () => cancelAnimationFrame(frame);
  }, [offset !== null]);

  const looks = { default: text, chorus: screenSectionText(text, theme.sections.chorus), bridge: screenSectionText(text, theme.sections.bridge) };
  const filterOf = (kind: keyof typeof looks) => effectFilter(looks[kind], `${id}-${kind}`);
  const align = { left: "items-start text-left", center: "items-center text-center", right: "items-end text-right" }[text.align];

  return (
    <div
      ref={box}
      className={cn("sv-words sv-flow", phase === "in" && "sv-in sv-in-fade", phase === "out" && "sv-out sv-out-fade")}
      style={{ "--cs": theme.chords.size, "--glide": `${Math.round(theme.motion.duration * 1.5)}ms` } as CSSProperties}
      data-testid={phase === "out" ? "screen-out" : grid ? "screen-grid" : "screen-scroll"}
      data-display={grid ? "grid" : "scroll"}
      aria-hidden={phase === "out" || undefined}
    >
      <svg width="0" height="0" className="absolute" aria-hidden>
        {(["default", ...SECTION_KINDS] as const).map((kind) => (
          <OutlineFilter key={kind} id={`${id}-${kind}`} look={looks[kind]} size={size} side={side} />
        ))}
      </svg>
      <div
        ref={column}
        className={cn("sv-flow-column flex flex-col", align)}
        style={{
          padding: `0 ${layout.margin}cqw`,
          transform: offset === null ? undefined : `translate3d(0, ${offset}px, 0)`,
          visibility: offset === null ? "hidden" : undefined,
          transition: glide ? undefined : "none",
        }}
      >
        {grid ? <GridRows theme={theme} song={song} index={index} looks={looks} /> : <ScrollRows theme={theme} song={song} index={index} size={size} looks={looks} filterOf={filterOf} />}
      </div>
    </div>
  );
}

type Looks = Record<"default" | "chorus" | "bridge", ScreenTheme["text"]>;

/** Scroll's lines: each slide's, the current slide's at full size, the others smaller, dimmed, faded or hidden. */
function ScrollRows({ theme, song, index, size, looks, filterOf }: { theme: ScreenTheme; song: StageSong; index: number; size: number; looks: Looks; filterOf: (kind: keyof Looks) => string | undefined }) {
  const { text, chords } = theme;
  const scroll = theme.display.scroll;
  const all = songLines(song);
  const origin = { left: "0 50%", center: "50% 50%", right: "100% 50%" }[text.align];
  // The coming lines counted from the slide after the current one, to hide those beyond `coming`.
  let coming = 0;
  return (
    <>
      {song.slides.map((slide, i) => {
        const kind = kindOf(song, i);
        const section = kind ? theme.sections[kind] : null;
        const look = looks[kind ?? "default"];
        const now = i === index;
        const past = i < index;
        // How far the lines are from the ones being sung, in slides.
        const away = past ? index - i : i - index;
        const opacity = now ? 1 : past ? (scroll.past === "hide" ? 0 : scroll.past === "fade" ? Math.max(0, 0.4 - 0.13 * (away - 1)) : 0.35) : 0.55;
        const filter = filterOf(kind ?? "default");
        return (
          <div key={i} className="contents">
            {scroll.labels && slide.part === 0 && slide.label ? (
              <p className="sv-flow-label" style={{ opacity: !past && !now && scroll.coming > 0 && coming >= scroll.coming ? 0 : now ? 0.7 : Math.min(opacity, 0.45) }}>
                {slide.label}
              </p>
            ) : null}
            <div
              className={cn("sv-flow-slide flex flex-col", section && section.mark !== "none" ? "w-fit max-w-full" : "w-full", { left: "items-start", center: "items-center", right: "items-end" }[look.align], section && section.mark !== "none" && `sv-mark sv-mark-${section.mark}`)}
              style={{ gap: `${size * 0.18}cqmin`, marginTop: slide.part === 0 && i > 0 ? `${size * 0.9}cqmin` : `${size * 0.18}cqmin`, "--mark": look.color } as CSSProperties}
              data-now={now ? "" : undefined}
              data-section={kind ?? undefined}
              data-testid={now ? "screen-lines" : undefined}
            >
              {(all[i] ?? []).map((line, li) => {
                const hidden = !past && !now && scroll.coming > 0 && ++coming > scroll.coming;
                const above = chords.show === "above" && !!line.chords && line.chords.chords.length > 0;
                const beats = chords.show === "beats" ? lineBars(song, line) : [];
                return (
                  <p
                    key={li}
                    className={cn("sv-line sv-flow-line", above && "sv-has-chords")}
                    data-line-id={line.chords?.lineId}
                    data-pass={line.passIndex}
                    style={{
                      fontSize: `${size}cqmin`,
                      ...lineLook(look, text),
                      ...(above ? { lineHeight: Math.max(look.lineHeight, 1.35 + chords.size) } : null),
                      textAlign: look.align,
                      transformOrigin: origin,
                      transform: now ? undefined : `scale(${scroll.others})`,
                      opacity: hidden ? 0 : opacity,
                      filter: [filter, !now && scroll.soften ? "blur(0.05em)" : ""].filter(Boolean).join(" ") || undefined,
                    }}
                  >
                    {beats.length > 0 ? <BeatRow bars={beats} chart={song.chart} options={chords} /> : null}
                    {above && line.chords ? chordsAbove(line.chords, chords) : theme.display.follow === "fill" && line.chords ? fillWords(line.text) : line.text}
                  </p>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * The Grid's rows, for musicians: every bar of the song as it's played, a
 * block for each beat with the chord in the beat it changes on, the bar's
 * number, and the words sung over it; the bars of the slide being sung lit.
 */
function GridRows({ theme, song, index, looks }: { theme: ScreenTheme; song: StageSong; index: number; looks: Looks }) {
  const bars = songBars(song);
  const words = songBarWords(song);
  const slide = song.slides[index];
  const lineIds = new Set((songLines(song)[index] ?? []).flatMap((line) => (line.chords ? [line.chords.lineId] : [])));
  const isNow = (bar: ChartBar) => !!slide && bar.passIndex === slide.passIndex && (lineIds.size === 0 || (bar.lineId !== null && lineIds.has(bar.lineId)));
  // The bars in their passes, one block each, labelled.
  const passes: { passIndex: number; bars: ChartBar[] }[] = [];
  for (const bar of bars) {
    const last = passes.at(-1);
    if (last && last.passIndex === bar.passIndex) last.bars.push(bar);
    else passes.push({ passIndex: bar.passIndex, bars: [bar] });
  }
  const nowAt = bars.findIndex(isNow);
  return (
    <>
      {passes.map(({ passIndex, bars: inPass }) => {
        const pass = song.chart?.passes[passIndex];
        const first = song.slides.findIndex((one) => one.passIndex === passIndex);
        const kind = first >= 0 ? kindOf(song, first) : null;
        const section = kind ? theme.sections[kind] : null;
        const look = looks[kind ?? "default"];
        const label = pass ? (pass.label ?? pass.section.label ?? null) : null;
        return (
          <div
            key={passIndex}
            className={cn("sv-grid-pass w-full", section && section.mark !== "none" && `sv-mark sv-mark-${section.mark}`)}
            style={{ "--mark": look.color, color: look.color } as CSSProperties}
            data-section={kind ?? undefined}
          >
            {label ? <p className="sv-flow-label">{label}</p> : null}
            <div className="sv-grid-bars">
              {inPass.map((bar) => {
                const now = isNow(bar);
                const state = now ? "now" : nowAt >= 0 && bar.index < nowAt ? "past" : "coming";
                return (
                  <div key={bar.index} className="sv-gbar" data-bar={bar.index} data-state={state} data-now={now ? "" : undefined} data-testid={now ? "screen-grid-now" : undefined}>
                    <span className="sv-gnum">{bar.index + 1}</span>
                    <div className="sv-gbeats" style={{ "--beats": bar.beats } as CSSProperties}>
                      {beatsOf(bar, song.chart, theme.chords)}
                    </div>
                    {theme.display.grid.words ? <div className="sv-gwords">{words[bar.index] || " "}</div> : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** An element's top inside the column, through the elements between (a transform doesn't count). */
function topIn(element: HTMLElement, column: HTMLElement): number {
  let top = 0;
  let at: HTMLElement | null = element;
  while (at && at !== column) {
    top += at.offsetTop;
    at = at.offsetParent as HTMLElement | null;
  }
  return top;
}
