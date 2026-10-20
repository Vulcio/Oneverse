import { lyricSlides, renderChart, screenLayers, songDocumentFromText, type ScreenMode, type ScreenTheme, type ScreenThemeAsset } from "@songverse/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScreenStage, type StageSong } from "#/components/screen-stage";
import type { StageLive } from "#/components/screen-widgets";
import { cn } from "@songverse/ui/lib/utils";

const SAMPLE = `{key: G}
{start_of_verse: Verse 1}
[G]Amazing grace, how [C]sweet the [G]sound
That saved a wretch like [D]me
I [G]once was lost, but [C]now am [G]found
Was blind, but [D]now I [G]see
{end_of_verse}
{start_of_chorus: Chorus}
My [C]chains are gone, I've been set [G]free
My God, my Saviour has [D]ransomed me
And like a [C]flood His mercy [G]reigns
Unending love, [D]amazing [G]grace
{end_of_chorus}`;

/** How long a slide stays in a preview that plays by itself. */
const SLIDE_MS = 3200;

/**
 * A theme on a sample song (issue #194): the screen's own stage, small, at a
 * screen's shape (16:9 or 4:3), stepping through the slides by itself so its
 * transitions, reveals and background can be seen - while it's on screen.
 */
export function ScreenThemePreview({
  theme,
  mode,
  aspect = "16/9",
  playing = true,
  slide: fixed,
  assets,
  hiddenLayers,
  className,
  children,
}: {
  theme: ScreenTheme;
  mode?: ScreenMode;
  aspect?: "16/9" | "4/3";
  playing?: boolean;
  /** A slide shown instead of stepping through them. */
  slide?: number;
  /** The theme's own pictures, videos and fonts. */
  assets?: ScreenThemeAsset[];
  /** Layers a screen never shows (issue #287), left out of the preview too. */
  hiddenLayers?: readonly string[];
  className?: string;
  /** Drawn over it: the template editor's grid (issue #268). */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const song = useSampleSong(t("screens.sampleTitle"), t("screens.sampleWriters"));
  const [slide, setSlide] = useState(0);
  const sample = useSampleLive(song);
  const live = useMemo(() => (hiddenLayers?.length ? { ...sample, layers: screenLayers(null, null, { id: "preview", hidden: hiddenLayers }) } : sample), [sample, hiddenLayers]);
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  // Only what's on screen moves: a page of previews stays light.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!playing || !visible || fixed !== undefined) return;
    const timer = setInterval(() => setSlide((at) => (at + 1) % song.slides.length), SLIDE_MS);
    return () => clearInterval(timer);
  }, [playing, visible, fixed, song.slides.length]);

  return (
    <div ref={box} className={cn("relative overflow-hidden rounded-lg bg-black shadow-sm ring-1 ring-border", className)} style={{ aspectRatio: aspect }} data-testid="theme-preview">
      <ScreenStage className={cn("absolute inset-0", !visible && "[&_*]:[animation-play-state:paused]")} theme={theme} mode={mode} song={song} slide={fixed ?? slide} assets={assets} live={live} />
      {children}
    </div>
  );
}

/** The sample song, as a set's song would be on a screen. */
export function useSampleSong(title: string, writers: string): StageSong {
  return useMemo(() => {
    const chart = renderChart(songDocumentFromText(null, { content: SAMPLE, format: "CHORDPRO" }));
    return { key: "sample", title, slides: lyricSlides(chart), credits: { writers: [writers], copyright: null, ccli: "22025" }, chart };
  }, [title, writers]);
}

/** What a template's widgets show in a preview (issue #268): a next song, a running countdown, a message. */
export function useSampleLive(song: StageSong): StageLive {
  const { t } = useTranslation();
  const [started] = useState(() => Date.now());
  return useMemo(
    () => ({
      preview: true,
      nextSong: { title: t("screens.widgetSample.nextTitle"), slides: [{ passIndex: 0, passId: "next", label: null, lines: [t("screens.widgetSample.nextLine1"), t("screens.widgetSample.nextLine2")], part: 0 }] },
      details: { title: song.title, key: "G", tempo: 72 },
      item: { title: song.title, position: 2, count: 6 },
      setSlides: { counts: [4, song.slides.length, 5, 6, 3, 4], item: 1 },
      nextItem: { title: t("screens.widgetSample.nextTitle") },
      itemStartedAt: started,
      operator: { kind: "countdown", duration: 300, startedAt: started, elapsed: 0 },
      offset: 0,
    }),
    [t, song.title, started],
  );
}
