import { lyricSlides, renderChart, songDocumentFromText, type ScreenMode, type ScreenTheme, type ScreenThemeAsset } from "@songverse/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScreenStage, type StageSong } from "#/components/screen-stage";
import { cn } from "@songverse/ui/lib/utils";

const SAMPLE = `{key: G}
{start_of_verse}
[G]Amazing grace, how [C]sweet the [G]sound
That saved a wretch like [D]me
I [G]once was lost, but [C]now am [G]found
Was blind, but [D]now I [G]see
{end_of_verse}
{start_of_chorus}
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
  mode = "LYRICS",
  aspect = "16/9",
  playing = true,
  slide: fixed,
  assets,
  className,
}: {
  theme: ScreenTheme;
  mode?: ScreenMode;
  aspect?: "16/9" | "4/3";
  playing?: boolean;
  /** A slide shown instead of stepping through them. */
  slide?: number;
  /** The theme's own pictures, videos and fonts. */
  assets?: ScreenThemeAsset[];
  className?: string;
}) {
  const { t } = useTranslation();
  const song = useSampleSong(t("screens.sampleTitle"), t("screens.sampleWriters"));
  const [slide, setSlide] = useState(0);
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
      <ScreenStage className={cn("absolute inset-0", !visible && "[&_*]:[animation-play-state:paused]")} theme={theme} mode={mode} song={song} slide={fixed ?? slide} assets={assets} />
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
