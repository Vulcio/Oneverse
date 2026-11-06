import {
  barLyricSpans,
  chartBars,
  lyricSlideLines,
  screenAutoTextSize,
  screenChordLabel,
  screenSectionKind,
  screenTextEffects,
  SCREEN_FONT_FAMILIES,
  type ChartBar,
  type RenderedChart,
  type ScreenSectionKind,
  type ScreenSlide,
  type ScreenSlideLine,
  type ScreenTheme,
} from "@oneverse/core";
import { createContext, useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

/*
 * What every way of showing a song's words shares (issue #395): the song's
 * one size, a text's look and effects, its chords over the words.
 */

/** A song on a screen: its slides (as every screen and Live cut them), and what's shown around them. */
export interface StageSong {
  /** Changes with the song: a new song comes in more slowly than a new slide. */
  key: string;
  title: string;
  slides: ScreenSlide[];
  credits?: { writers: string[]; copyright: string | null; ccli: string | null };
  /** A line shown under every slide whatever the theme says (issue #301): a passage's copyright, which must go with its text. */
  attribution?: string | null;
  /** The chart, for a screen showing it to the band. */
  chart?: RenderedChart | null;
  /** Its bars (issue #395), from the chart and the song's rhythms, for chords on beats and the Grid; worked out from the chart alone without. */
  bars?: ChartBar[] | null;
}

/** The stage's shorter side in pixels (issue #395): an outline's width is drawn in pixels. */
export const StageSide = createContext(1080);

export function useStageSide(stage: RefObject<HTMLElement | null>): number {
  const [side, setSide] = useState(1080);
  useEffect(() => {
    const element = stage.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => entry && setSide(Math.max(1, Math.round(Math.min(entry.contentRect.width, entry.contentRect.height)))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return side;
}

/** The kind of section a song's slide is from (issue #395): by its pass's section type in the chart, else its label. */
export function kindOf(song: StageSong | null, index: number): ScreenSectionKind | null {
  const slide = song?.slides[index];
  if (!slide) return null;
  return screenSectionKind(song?.chart?.passes[slide.passIndex]?.section.type ?? "other", slide.label);
}

/** The words' size for a whole song (issue #395): the theme's, or one auto size from all its lines, so nothing jumps between slides. */
const sizes = new WeakMap<StageSong, Map<string, number>>();
export function songSize(theme: ScreenTheme, song: StageSong): number {
  if (theme.text.size !== "auto") return theme.text.size;
  const key = `${theme.text.font}:${theme.text.upperCase}`;
  let bySong = sizes.get(song);
  if (!bySong) sizes.set(song, (bySong = new Map()));
  let size = bySong.get(key);
  if (size === undefined) bySong.set(key, (size = screenAutoTextSize(song.slides.flatMap((slide) => slide.lines), theme.text)));
  return size;
}

/** The filter that draws a text's effects (issue #395): its outline (an SVG filter, `outlineId`), its shadow and its glow. */
export function effectFilter(look: ScreenTheme["text"], outlineId: string): string | undefined {
  const { shadow, outline, glow } = screenTextEffects(look);
  const mix = (pct: number) => `color-mix(in srgb, ${shadow.color} ${pct}%, transparent)`;
  const shadows = {
    none: [],
    soft: [`drop-shadow(0 0.06em 0.22em ${mix(70)})`],
    lifted: [`drop-shadow(0 0.07em 0.08em ${mix(85)})`, `drop-shadow(0 0.18em 0.55em ${mix(60)})`],
    strong: [`drop-shadow(0 0.05em 0.05em ${shadow.color})`, `drop-shadow(0 0.14em 0.35em ${mix(85)})`, `drop-shadow(0 0 1em ${mix(55)})`],
  }[shadow.style];
  const parts = [outline.width !== "none" ? `url(#${outlineId})` : "", ...shadows, glow === "soft" ? `drop-shadow(0 0 0.28em color-mix(in srgb, ${look.color} 55%, transparent))` : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

/**
 * An outline as one shape around each letter (issue #395): the letters'
 * silhouette grown by a few pixels and drawn behind them. A text stroke would
 * outline every overlapping part of a variable font's letters.
 */
export function OutlineFilter({ id, look, size, side }: { id: string; look: ScreenTheme["text"]; size: number; side: number }) {
  const { outline } = screenTextEffects(look);
  if (outline.width === "none") return null;
  const radius = ((size * side) / 100) * (outline.width === "thin" ? 0.03 : 0.055);
  return (
    <filter id={id} x="-10%" y="-30%" width="120%" height="160%" colorInterpolationFilters="sRGB">
      <feMorphology in="SourceAlpha" operator="dilate" radius={radius.toFixed(2)} result="grown" />
      <feFlood floodColor={outline.color} />
      <feComposite in2="grown" operator="in" result="ring" />
      <feMerge>
        <feMergeNode in="ring" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  );
}

/** A text's own look on a line (issue #395): its font, weight, italic, capitals, colour and spacing; never its size, which the song keeps. */
export function lineLook(look: ScreenTheme["text"], base: ScreenTheme["text"]): CSSProperties {
  return {
    fontWeight: look.weight,
    fontStyle: look.italic ? "italic" : undefined,
    lineHeight: look.lineHeight,
    letterSpacing: `${look.letterSpacing}em`,
    textTransform: look.upperCase ? "uppercase" : undefined,
    color: look.color !== base.color ? look.color : undefined,
    fontFamily: look.font !== base.font ? SCREEN_FONT_FAMILIES[look.font] : undefined,
  };
}


/** A line on a lyrics screen with its chords, when the chart has them (issue #395). */
export interface StageLine {
  text: string;
  /** The line's chords, null without a chart (a text, a passage) or when the slide isn't the chart's any more. */
  chords: ScreenSlideLine | null;
  /** The slide it's on, and the pass. */
  slide: number;
  passIndex: number;
}

/** Each slide's lines with their chords (issue #395): the chart's lines, matched to the slides however many lines they hold. */
const linesCache = new WeakMap<StageSong, StageLine[][]>();
export function songLines(song: StageSong): StageLine[][] {
  const known = linesCache.get(song);
  if (known) return known;
  const passes = new Map<number, ScreenSlideLine[]>();
  const taken = new Map<number, number>();
  const lines = song.slides.map((slide, index) => {
    let chartLines = passes.get(slide.passIndex);
    const pass = song.chart?.passes[slide.passIndex];
    if (!chartLines && pass) passes.set(slide.passIndex, (chartLines = lyricSlideLines({ passes: [pass] }, Number.MAX_SAFE_INTEGER)[0]?.lines ?? []));
    const from = taken.get(slide.passIndex) ?? 0;
    taken.set(slide.passIndex, from + slide.lines.length);
    return slide.lines.map((text, i): StageLine => {
      const chords = chartLines?.[from + i];
      return { text, chords: chords && chords.text === text ? chords : null, slide: index, passIndex: slide.passIndex };
    });
  });
  linesCache.set(song, lines);
  return lines;
}

/** The song's bars (issue #395): its own, else worked out from the chart. */
const barsCache = new WeakMap<StageSong, ChartBar[]>();
export function songBars(song: StageSong): ChartBar[] {
  if (song.bars) return song.bars;
  let bars = barsCache.get(song);
  if (!bars) barsCache.set(song, (bars = song.chart ? chartBars(song.chart) : []));
  return bars;
}

/** The words each bar is sung over (issue #395), for the Grid. */
const barWordsCache = new WeakMap<StageSong, string[]>();
export function songBarWords(song: StageSong): string[] {
  let words = barWordsCache.get(song);
  if (words) return words;
  const bars = songBars(song);
  const chart = song.chart;
  const spans = chart ? barLyricSpans(chart, bars) : [];
  words = bars.map((bar, index) => {
    const line = chart?.passes[bar.passIndex]?.lines.find((one) => one.id === bar.lineId);
    return line ? (spans[index] ?? []).map((span) => line.text.slice(span.from, span.to).trim()).filter(Boolean).join(" ") : "";
  });
  barWordsCache.set(song, words);
  return words;
}

type ChordOptions = ScreenTheme["chords"];

/** A chord's name on the screen, in the template's notation. */
export function chordName(chord: { sounding: string; key: string | null }, options: ChordOptions): string {
  return screenChordLabel(chord, options);
}

/**
 * A line with its chords above the words (issue #395): each chord pinned
 * over the letter it's played on, a word with chords kept whole so a line
 * wraps between words, and a chord wider than its syllable given the room
 * it needs.
 */
export function chordsAbove(line: ScreenSlideLine, options: ChordOptions): ReactNode {
  const { text } = line;
  // A chord on a space belongs to the next word; one after the words, at the end.
  const placed = line.chords
    .map(({ at, chord }) => {
      let place = at;
      while (place < text.length && /\s/.test(text[place]!)) place++;
      return { at: place, chord };
    })
    .sort((a, b) => a.at - b.at);
  if (placed.length === 0) return text;
  const anchor = (key: string, chord: (typeof placed)[number]["chord"], fragment: string) => {
    const name = chordName(chord, options);
    const room = name.length * options.size * 0.62 + 0.3;
    return (
      <span key={key} className="sv-chord-at" style={{ minWidth: fragment.length * 0.5 < room ? `${room.toFixed(2)}em` : undefined }} data-chord-id={chord.id}>
        <span className="sv-chord-name">
          {name}
        </span>
        {fragment || "\u00a0"}
      </span>
    );
  };
  const out: ReactNode[] = [];
  let offset = 0;
  text.split(/(\s+)/).forEach((token, t) => {
    const start = offset;
    const end = (offset += token.length);
    const inWord = /\S/.test(token) ? placed.filter((one) => one.at >= start && one.at < end) : [];
    if (inWord.length === 0) return out.push(token);
    const parts: ReactNode[] = [token.slice(0, inWord[0]!.at - start)];
    inWord.forEach((one, i) => parts.push(anchor(`${t}-${i}`, one.chord, token.slice(one.at - start, (inWord[i + 1]?.at ?? end) - start))));
    out.push(
      <span key={t} className="whitespace-nowrap">
        {parts}
      </span>,
    );
  });
  placed.filter((one) => one.at >= text.length).forEach((one, i) => out.push(" ", anchor(`end-${i}`, one.chord, "")));
  return out;
}

/**
 * A line's bars as beats (issue #395): a block for each beat, the chord in
 * the beat it changes on, for musicians reading along over the words.
 */
export function BeatRow({ bars, chart, options, className }: { bars: ChartBar[]; chart: RenderedChart | null | undefined; options: ChordOptions; className?: string }) {
  if (bars.length === 0) return null;
  return (
    <span className={className ?? "sv-beats"} aria-hidden data-testid="screen-beats">
      {bars.map((bar) => (
        <span key={bar.index} className="sv-beat-bar" data-bar={bar.index}>
          {beatsOf(bar, chart, options)}
        </span>
      ))}
    </span>
  );
}

/** A bar's beats, each with the chord that changes on it. */
export function beatsOf(bar: ChartBar, chart: RenderedChart | null | undefined, options: ChordOptions): ReactNode {
  const key = chart?.passes[bar.passIndex]?.key ?? null;
  return Array.from({ length: bar.beats }, (_, beat) => {
    const chord = bar.chords.find((one) => Math.floor(one.beat) - 1 === beat);
    return (
      <span key={beat} className="sv-beat-block" data-on={chord ? "" : undefined} data-beat={beat}>
        {chord ? chordName({ sounding: chord.sounding, key }, options) : null}
      </span>
    );
  });
}

/** The bars a lyric line is sung over, in its pass. */
export function lineBars(song: StageSong, line: StageLine): ChartBar[] {
  if (!line.chords) return [];
  const id = line.chords.lineId;
  return songBars(song).filter((bar) => bar.passIndex === line.passIndex && bar.lineId === id);
}
