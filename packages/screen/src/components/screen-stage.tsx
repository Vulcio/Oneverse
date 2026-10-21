import "@fontsource-variable/inter";
import "@fontsource-variable/montserrat";
import "@fontsource-variable/playfair-display";
import "@fontsource-variable/lora";
import "@fontsource-variable/nunito";
import "@fontsource-variable/oswald";
import "@fontsource/bebas-neue";
import "../screen-stage.css";
import { SCREEN_FONT_FAMILIES, SCREEN_SHADERS, SCREEN_TEXT_BACKGROUNDS, screenShader, screenBaseColor, screenLayers, screenWidgetLayer, sectionEnergy, type RenderedChart, type ScreenMask, type ScreenMode, type ScreenSlide, type ScreenTheme, type ScreenThemeAsset } from "@oneverse/core";
import { Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ScreenGrid, type StageLive } from "./screen-widgets";
import { useScreenEffects, type ScreenSignals } from "../lib/screen-effects";
import { TextBackground, type StageText } from "./screen-text-background";
import { ShaderBackground } from "./screen-shader-background";
import { SongChart } from "./song-chart";
import { cn } from "@oneverse/ui/lib/utils";

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
}

const ENERGY = { low: 0.35, mid: 0.65, high: 1 } as const;
/** The longest a slide's words take to come in, piece by piece. */
const REVEAL_MAX_MS = 1600;

/**
 * A screen's stage (issue #194): the theme's background, the slide's words in
 * its font and place, the lines around them, the song's title and credits,
 * and each slide coming in as the theme says - the one before going out at
 * the same time. Fills its box: the whole screen, or a preview card.
 *
 * Drawn as layers (issue #280), from the bottom: the base colour, the video
 * input, the media (the background), the content (the words and the widgets
 * that show the song), the overlays (the other widgets, the title card) and
 * the masks; the operator and the screen's settings say which show.
 */
export function ScreenStage({
  theme,
  // What the template shows (issue #281): its words, or the chord chart.
  mode = theme.shows === "chart" ? "CHART" : "LYRICS",
  song,
  slide,
  black = false,
  idle,
  assets = [],
  live = {},
  videoInput = false,
  className,
}: {
  theme: ScreenTheme;
  mode?: ScreenMode;
  song: StageSong | null;
  slide: number;
  black?: boolean;
  /** Shown when there's no song (no set, nothing presented). */
  idle?: ReactNode;
  /** The theme's own pictures, videos and fonts (issue #194), which it refers to by id. */
  assets?: ScreenThemeAsset[];
  /** What widgets read besides the song (issue #268): the next song, timers, the operator's message. */
  live?: StageLive;
  /** A real screen: the video input layer opens the device's camera or capture card; elsewhere (a preview) it's a placeholder. */
  videoInput?: boolean;
  className?: string;
}) {
  const index = song ? Math.max(0, Math.min(slide, song.slides.length - 1)) : 0;
  const current = song?.slides[index];
  const energy = theme.background.reactive ? ENERGY[sectionEnergy(current?.label)] : 0.5;
  // Effects (issue #281): the background answering the slide, its lines and words, the section, a chorus.
  const stageRef = useRef<HTMLDivElement>(null);
  const animation = theme.effects?.text.animation ?? "none";
  const signals = useScreenEffects(stageRef, theme, {
    viewKey: song ? `${song.key}:${index}` : "idle",
    sectionKey: song && current ? `${song.key}:${current.passIndex}` : "idle",
    chorus: !!current && sectionEnergy(current.label) === "high",
    lines: current?.lines ?? [],
  });
  const viewKey = song ? `${song.key}:${index}` : "idle";
  const colors = theme.background.colors;
  // Where the words are (issue #296), for a background that follows them.
  const text = useStageText(stageRef, viewKey, theme, current?.lines ?? []);

  // The slide going out while the next comes in; a new song takes twice as long.
  const [outgoing, setOutgoing] = useState<{ key: string; song: StageSong | null; index: number; songChange: boolean } | null>(null);
  const shown = useRef<{ key: string; song: StageSong | null; index: number }>({ key: viewKey, song, index });
  const songChange = outgoing?.songChange ?? false;
  const duration = theme.motion.transition === "cut" ? 0 : theme.motion.duration * (songChange ? 2 : 1);
  useEffect(() => {
    const before = shown.current;
    shown.current = { key: viewKey, song, index };
    if (before.key === viewKey || theme.motion.transition === "cut") return setOutgoing(null);
    const changed = before.song?.key !== song?.key;
    setOutgoing({ ...before, songChange: changed });
    const timer = setTimeout(() => setOutgoing(null), theme.motion.duration * (changed ? 2 : 1) + 50);
    return () => clearTimeout(timer);
  }, [viewKey]);

  // Black: faded out, then the words gone (nothing to read under it); back at once, coming in as a slide does.
  const [dark, setDark] = useState(black);
  useEffect(() => {
    if (!black) return setDark(false);
    const timer = setTimeout(() => setDark(true), duration);
    return () => clearTimeout(timer);
  }, [black]);

  const customFont = useThemeFont(assets.find((asset) => asset.id === theme.text.customFont && asset.kind === "font"));
  const media = assets.find((asset) => asset.id === theme.background.media && asset.kind === "media");
  const shader = useShaderSource(theme, assets);

  const grid = theme.grid && theme.grid.widgets.length > 0 ? theme.grid : null;
  // What the operator and the screen's settings show (issues #275, #280, #287).
  const { shown: visible, title } = live.layers ?? screenLayers(null, null);
  /** The words, as a screen has always shown them: the whole stage, or a grid's Lyrics or chart cell. */
  const words = (look: ScreenTheme) =>
    dark ? null : !song || !current ? (
      <div className="sv-words items-center justify-center text-center">{idle}</div>
    ) : mode === "CHART" && song.chart ? (
      <ChartStage theme={look} chart={song.chart} title={song.title} passId={current.passId} />
    ) : (
      <>
        {outgoing?.song ? <Words key={outgoing.key} theme={look} song={outgoing.song} index={outgoing.index} phase="out" /> : null}
        <Words key={viewKey} theme={look} song={song} index={index} phase={outgoing ? "in" : "still"} />
      </>
    );
  // A grid's widgets, on the layer each is on.
  const widgets = (layer: "content" | "overlays") => {
    const on = grid ? grid.widgets.filter((widget) => screenWidgetLayer(widget) === layer) : [];
    return grid && on.length > 0 ? (
      <ScreenGrid
        theme={theme}
        grid={{ ...grid, widgets: on }}
        slides={song && current ? song.slides : null}
        index={index}
        black={dark && grid.black === "words"}
        live={live}
        words={words({ ...theme, layout: { ...theme.layout, margin: 2 } })}
      />
    ) : null;
  };
  const windows = theme.masks.filter((mask) => mask.kind === "window");
  const covers = theme.masks.filter((mask) => mask.kind === "cover");
  const video = theme.video.source !== "none" && visible.video;

  const style = {
    "--t": `${duration}ms`,
    "--stagger": `${theme.motion.stagger}ms`,
    "--energy": energy,
    "--motion": theme.background.motion,
    "--text": theme.text.color,
    "--c0": colors[0],
    "--c1": colors[1] ?? colors[0],
    "--c2": colors[2] ?? colors[1] ?? colors[0],
    "--c3": colors[3] ?? colors[2] ?? colors[1] ?? colors[0],
    "--chord": theme.chords.color,
    "--anim-amount": theme.effects?.text.amount ?? 0,
    "--anim-speed": theme.effects?.text.speed ?? 1,
    fontFamily: customFont ? `"${customFont}", ${SCREEN_FONT_FAMILIES[theme.text.font]}` : SCREEN_FONT_FAMILIES[theme.text.font],
  } as CSSProperties;

  return (
    <div
      ref={stageRef}
      className={cn("sv-stage", className)}
      style={style}
      data-text-animation={animation}
      data-effects={theme.effects && theme.effects.reactions.length > 0 ? "" : undefined}
      data-testid="screen-stage"
      data-background={theme.background.kind}
      data-layers={(["video", "media", "content", "overlays", "masks"] as const).filter((layer) => visible[layer]).join(" ") + (title ? " title" : "")}
      data-transition={theme.motion.transition}
      data-reveal={theme.motion.reveal}
      data-energy={energy}
    >
      <div className="sv-layer" style={{ background: screenBaseColor(theme) }} data-layer="base" />
      {video ? (
        <div className="sv-layer" style={{ opacity: theme.video.opacity }} data-layer="video">
          <VideoInput fit={theme.video.fit} live={videoInput} />
        </div>
      ) : null}
      {visible.media ? (
        // A window mask cuts through it, down to the video input and the base.
        <div className="sv-layer" style={windowMask(windows)} data-layer="media">
          <Background theme={theme} media={media} shader={shader} text={text} signals={signals} />
          {theme.effects && theme.effects.reactions.length > 0 ? <div className="sv-react-pulse" aria-hidden /> : null}
          {theme.background.dim > 0 ? <div className="sv-bg-dim" style={{ opacity: theme.background.dim }} aria-hidden /> : null}
        </div>
      ) : null}
      {visible.content ? (
        <div className="sv-layer" data-layer="content">
          {grid ? widgets("content") : words(theme)}
        </div>
      ) : null}
      {visible.overlays ? (
        <div className="sv-layer" data-layer="overlays">
          {widgets("overlays")}
          {/* The operator's title card (issue #275), over the rest. */}
          {title && live.title ? (
            <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-[2cqmin] bg-black/85 p-[6cqmin] text-center" data-testid="screen-overlay">
              <p className="text-[7cqmin] leading-tight font-semibold">{live.title.title}</p>
              {live.title.subtitle ? <p className="text-[3.5cqmin] opacity-70">{live.title.subtitle}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {visible.masks && covers.length > 0 ? (
        <svg className="sv-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden data-layer="masks">
          {covers.map((mask) => (
            <g key={mask.id}>
              {mask.feather > 0 ? (
                <filter id={`sv-feather-${mask.id}`} x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation={mask.feather / 2} />
                </filter>
              ) : null}
              <path d={maskPath(mask)} fillRule="evenodd" fill="#000" filter={mask.feather > 0 ? `url(#sv-feather-${mask.id})` : undefined} data-testid="screen-mask" />
            </g>
          ))}
        </svg>
      ) : null}
      <div className="sv-black" data-on={black && (!grid || grid.black === "all") ? "" : undefined} data-testid="screen-black" />
    </div>
  );
}

/** A mask's shape as an SVG path, on a 100 by 100 screen; inverted, everything but the shape (even-odd). */
function maskPath(mask: ScreenMask): string {
  const { x, y, w, h } = mask;
  const shape =
    mask.shape === "ellipse"
      ? `M${x} ${y + h / 2}a${w / 2} ${h / 2} 0 1 0 ${w} 0a${w / 2} ${h / 2} 0 1 0 ${-w} 0Z`
      : `M${x} ${y}h${w}v${h}h${-w}Z`;
  return mask.invert ? `M-1 -1H101V101H-1Z${shape}` : shape;
}

/** The media layer's CSS mask for window masks: transparent where they cut it. */
function windowMask(windows: ScreenMask[]): CSSProperties | undefined {
  if (windows.length === 0) return undefined;
  const filters = windows
    .filter((mask) => mask.feather > 0)
    .map((mask) => `<filter id="f${mask.id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${mask.feather / 2}"/></filter>`)
    .join("");
  const holes = windows.map((mask) => `<path d="${maskPath(mask)}" fill-rule="evenodd" fill="#000"${mask.feather > 0 ? ` filter="url(#f${mask.id})"` : ""}/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs>${filters}<mask id="m"><rect x="-1" y="-1" width="102" height="102" fill="#fff"/>${holes}</mask></defs><rect width="100" height="100" fill="#fff" mask="url(#m)"/></svg>`;
  const image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return { maskImage: image, WebkitMaskImage: image, maskSize: "100% 100%", WebkitMaskSize: "100% 100%", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" };
}

/** The key the screen's chosen camera or capture card is kept under, on this device (issue #280). */
export const VIDEO_INPUT_KEY = "songverse.screen.videoInput";

/**
 * The video input layer (issue #280): on a screen, its camera or capture card
 * (the one picked in its menu, else the first); in a preview, a placeholder.
 * Nothing when it can't be opened: the base shows.
 */
function VideoInput({ fit, live }: { fit: "cover" | "contain"; live: boolean }) {
  const { t } = useTranslation();
  const element = useRef<HTMLVideoElement>(null);
  const [device, setDevice] = useState<string | null>(() => readVideoInput());
  // Picked in the screen's menu, in this tab or another.
  useEffect(() => {
    const changed = () => setDevice(readVideoInput());
    window.addEventListener("storage", changed);
    window.addEventListener("sv-video-input", changed);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener("sv-video-input", changed);
    };
  }, []);
  useEffect(() => {
    if (!live || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let current = true;
    navigator.mediaDevices
      .getUserMedia({ video: device ? { deviceId: { exact: device } } : true, audio: false })
      // The one picked gone: the first there is.
      .catch(() => (device ? navigator.mediaDevices.getUserMedia({ video: true, audio: false }) : Promise.reject(new Error("no camera"))))
      .then((opened) => {
        if (!current) return opened.getTracks().forEach((track) => track.stop());
        stream = opened;
        if (element.current) element.current.srcObject = opened;
      })
      .catch(() => undefined);
    return () => {
      current = false;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [live, device]);
  if (!live) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1cqmin] bg-[repeating-linear-gradient(45deg,#1f2937_0_2cqmin,#111827_2cqmin_4cqmin)] text-[3cqmin] text-neutral-400" data-testid="screen-video-placeholder">
        <Video className="size-[8cqmin]" aria-hidden />
        {t("screens.layers.video")}
      </div>
    );
  }
  return <video ref={element} className="sv-media" style={{ objectFit: fit }} autoPlay muted playsInline data-testid="screen-video" />;
}

function readVideoInput(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(VIDEO_INPUT_KEY);
  } catch {
    return null;
  }
}

/**
 * Where the words are on the stage (issue #296), measured when a slide comes
 * and again once it has moved in: each current line's box, and each word's
 * share of its line with when it appears - at once, or line by line, word
 * by word or letter by letter as the theme reveals them. Fractions of the
 * stage, read each frame by a background that follows the words.
 */
function useStageText(stage: RefObject<HTMLElement | null>, viewKey: string, theme: ScreenTheme, lines: string[]): RefObject<StageText> {
  const text = useRef<StageText>({ lines: [], words: [], key: 0 });
  useEffect(() => {
    const started = performance.now();
    const { reveal, stagger } = theme.motion;
    const all = lines.join(" ");
    const pieces = reveal === "lines" ? lines.length : reveal === "words" || reveal === "glow" ? all.split(/\s+/).length : all.replace(/\s/g, "").length;
    const pace = reveal === "none" ? 0 : Math.min(stagger, REVEAL_MAX_MS / Math.max(1, pieces));
    const measure = () => {
      const box = stage.current?.getBoundingClientRect();
      if (!box?.width) return;
      const found = [...(stage.current?.querySelectorAll<HTMLElement>('.sv-words:not(.sv-out) [data-testid="screen-lines"] .sv-line') ?? [])];
      const boxes = found.map((one) => {
        const rect = one.getBoundingClientRect();
        // The text's own width, not the line's: a centred line's words sit in its middle.
        const range = document.createRange();
        range.selectNodeContents(one);
        const inner = range.getBoundingClientRect();
        const r = inner.width ? inner : rect;
        return { x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, w: r.width / box.width, h: r.height / box.height };
      });
      let word = 0;
      let letter = 0;
      const words = boxes.flatMap((line, l) => {
        const parts = (lines[l] ?? "").split(/\s+/).filter(Boolean);
        const total = parts.reduce((sum, one) => sum + one.length + 1, 0) || 1;
        let x = line.x;
        return parts.map((part) => {
          const w = (line.w * (part.length + 1)) / total;
          const delay = reveal === "lines" ? l * pace : reveal === "words" || reveal === "glow" ? word * pace : letter * pace;
          word += 1;
          letter += part.length;
          const one = { x, y: line.y, w, h: line.h, at: started + (reveal === "none" ? 0 : delay) };
          x += w;
          return one;
        });
      });
      text.current = { lines: boxes, words, key: text.current.key + (boxes.length ? 1 : 0) };
    };
    const first = requestAnimationFrame(measure);
    // Again once it has moved in (a rise or a zoom moves it).
    const settled = setTimeout(measure, theme.motion.duration + 80);
    return () => {
      cancelAnimationFrame(first);
      clearTimeout(settled);
    };
  }, [viewKey]);
  return text;
}

/**
 * A shader background's source (issue #297): a built-in one, or the one
 * uploaded with the theme, fetched once; null while it loads, or when the
 * theme names none (then the built-in default).
 */
function useShaderSource(theme: ScreenTheme, assets: ScreenThemeAsset[]): string | null {
  const { builtIn, asset } = theme.background.shader;
  const file = theme.background.kind === "shader" && asset ? assets.find((one) => one.id === asset && one.kind === "shader") : undefined;
  const [fetched, setFetched] = useState<{ url: string; source: string } | null>(null);
  useEffect(() => {
    if (!file || fetched?.url === file.url) return;
    let cancelled = false;
    fetch(file.url)
      .then((response) => (response.ok ? response.text() : ""))
      .catch(() => "")
      .then((source) => !cancelled && setFetched({ url: file.url, source }));
    return () => {
      cancelled = true;
    };
  }, [file?.url]);
  if (theme.background.kind !== "shader") return null;
  if (file) return fetched?.url === file.url ? fetched.source : null;
  return screenShader(builtIn) ?? SCREEN_SHADERS[0]!.source;
}

/** The background: a colour, a gradient, or lights that move (and answer the song when reactive). */
function Background({ theme, media, shader, text, signals }: { theme: ScreenTheme; media?: ScreenThemeAsset; shader: string | null; text: RefObject<StageText>; signals: RefObject<ScreenSignals> }) {
  const particles = useMemo(() => {
    // The same field every time: a seeded spread, not Math.random on each render.
    let seed = 7;
    const next = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    return Array.from({ length: 40 }, () => ({
      left: `${next() * 100}%`,
      "--size": `${0.3 + next() * 0.9}cqmin`,
      "--dur": `${10 + next() * 14}s`,
      "--delay": `${-next() * 24}s`,
      "--sway": `${(next() - 0.5) * 16}cqmin`,
    }));
  }, []);
  // A picture or video without its file (not uploaded, or removed): the colours instead.
  const kind = (theme.background.kind === "image" || theme.background.kind === "video") && !media ? "gradient" : theme.background.kind;
  // Still: no motion asked for.
  const still = theme.background.motion === 0;
  if (kind === "shader") return <ShaderBackground theme={theme} source={shader} text={text} signals={signals} still={still} />;
  if ((SCREEN_TEXT_BACKGROUNDS as readonly string[]).includes(kind)) {
    return (
      <div className="sv-bg" aria-hidden>
        <TextBackground kind={kind as (typeof SCREEN_TEXT_BACKGROUNDS)[number]} theme={theme} text={text} signals={signals} still={still} />
      </div>
    );
  }
  return (
    <div className={cn("sv-bg", kind === "gradient" && "sv-bg-gradient", still && "[&_*]:[animation-play-state:paused]")} aria-hidden>
      {kind === "image" && media ? <img className="sv-media sv-media-image" src={media.url} alt="" draggable={false} data-testid="screen-media" /> : null}
      {kind === "video" && media ? (
        // Muted, looping, inline: it plays on its own on any TV's browser.
        <video className="sv-media" src={media.url} autoPlay muted loop playsInline preload="auto" data-testid="screen-media" />
      ) : null}
      {kind === "aurora" ? (
        <>
          <div className="sv-blob" />
          <div className="sv-blob" />
          <div className="sv-blob" />
        </>
      ) : null}
      {kind === "waves" ? (
        <>
          <div className="sv-wave" />
          <div className="sv-wave" />
          <div className="sv-wave" />
        </>
      ) : null}
      {kind === "particles" ? (
        <>
          <div className="sv-blob" style={{ opacity: 0.35 }} />
          {particles.map((particle, i) => (
            <span key={i} className="sv-particle" style={particle as CSSProperties} />
          ))}
        </>
      ) : null}
      {kind === "spotlight" ? (
        <>
          <div className="sv-beam" />
          <div className="sv-beam" />
        </>
      ) : null}
    </div>
  );
}

/** The words of one slide: the current lines, the ones around them, the title and credits, placed as the theme says. */
function Words({ theme, song, index, phase }: { theme: ScreenTheme; song: StageSong; index: number; phase: "in" | "out" | "still" }) {
  const { t } = useTranslation();
  const slides = song.slides;
  const current = slides[index]!;
  const { lines, text, layout, motion } = theme;

  // The lines around the current ones: the slides' before and after it, or the rest of its section.
  const inSection = (i: number) => slides[i]!.passIndex === current.passIndex;
  const before =
    lines.group === "section"
      ? slides.slice(0, index).filter((_, i) => inSection(i)).flatMap((one) => one.lines)
      : lines.before > 0
        ? slides.slice(0, index).flatMap((one) => one.lines).slice(-lines.before)
        : [];
  const after =
    lines.group === "section"
      ? slides.slice(index + 1).filter((_, i) => inSection(index + 1 + i)).flatMap((one) => one.lines)
      : slides.slice(index + 1).flatMap((one) => one.lines).slice(0, lines.after);

  // Auto: the longest current line fits the width; narrow fonts can go bigger.
  const longest = Math.max(8, ...current.lines.map((line) => line.length));
  const width = text.font === "condensed" || text.font === "display" ? 0.72 : text.font === "mono" ? 1.2 : 1;
  const size = text.size === "auto" ? Math.max(3.2, Math.min(text.upperCase ? 8 : 8.5, (8 * 26) / (longest * width * (text.upperCase ? 1.15 : 1)))) : text.size;

  const first = index === 0;
  const last = index === slides.length - 1;
  const showTitle = theme.title.show && (theme.title.when === "every" || first);
  const credits = song.credits;
  const creditsWhen = theme.credits.when;
  // A passage's copyright goes with its words on every slide (issue #301), whatever the theme says of credits.
  const attribution = song.attribution ?? null;
  const showCredits =
    !!attribution ||
    (theme.credits.show &&
    !!credits &&
      (creditsWhen === "every" || (creditsWhen === "first" && first) || (creditsWhen === "last" && last) || (creditsWhen === "first-and-last" && (first || last))));
  const creditLine = attribution ? attribution : credits ? [credits.writers.join(", "), credits.copyright, credits.ccli ? t("screens.ccliSong", { number: credits.ccli }) : null].filter(Boolean).join(" · ") : "";

  // However many pieces a slide has, its words are all in within REVEAL_MAX_MS: a long line typed letter by letter doesn't crawl.
  const pieces = motion.reveal === "lines" ? current.lines.length : motion.reveal === "words" || motion.reveal === "glow" ? current.lines.join(" ").split(/\s+/).length : current.lines.join("").replace(/\s/g, "").length;
  const stagger = Math.min(motion.stagger, REVEAL_MAX_MS / Math.max(1, pieces));

  const justify = { top: "justify-start", center: "justify-center", bottom: "justify-end", "lower-third": "justify-end" }[layout.position];
  const align = { left: "items-start text-left", center: "items-center text-center", right: "items-end text-right" }[text.align];
  let piece = 0;

  return (
    <div
      className={cn(
        "sv-words sv-slide",
        justify,
        align,
        `sv-effect-${text.effect}`,
        phase === "in" && `sv-in sv-in-${motion.transition}`,
        phase === "out" && `sv-out sv-out-${motion.transition}`,
        phase !== "out" && motion.reveal !== "none" && `sv-reveal-${motion.reveal}`,
      )}
      style={{ padding: `${layout.margin}cqh ${layout.margin}cqw`, "--stagger": `${stagger}ms` } as CSSProperties}
      data-testid={phase === "out" ? "screen-out" : "screen-lyrics"}
      aria-hidden={phase === "out" || undefined}
    >
      <div
        className={cn("flex w-full flex-col", align, layout.position === "lower-third" && "rounded-[1.2cqmin] bg-black/55 px-[3cqw] py-[2.2cqh]")}
        style={{ gap: `${size * 0.18}cqmin` }}
      >
        {showTitle ? (
          <p className="sv-line mb-[1cqmin] text-[2.8cqmin] font-semibold tracking-[0.12em] uppercase opacity-70" data-testid={phase === "out" ? undefined : "screen-title"}>
            {song.title}
          </p>
        ) : null}
        {[
          { group: before, now: false, id: "screen-before" },
          { group: current.lines, now: true, id: "screen-lines" },
          { group: after, now: false, id: "screen-after" },
        ].map(({ group, now, id }) =>
          group.length > 0 || now ? (
            <div key={id} className={cn("flex w-full flex-col", align, !now && `sv-context sv-context-${lines.contextStyle}`)} style={{ gap: `${size * 0.18}cqmin` }} data-testid={phase === "out" ? undefined : id}>
              {group.map((line, i) => (
                <p
                  key={i}
                  className="sv-line"
                  style={{
                    fontSize: `calc(${size}cqmin * var(--k, 1))`,
                    fontWeight: text.weight,
                    lineHeight: text.lineHeight,
                    letterSpacing: `${text.letterSpacing}em`,
                    textTransform: text.upperCase ? "uppercase" : undefined,
                  }}
                >
                  {now && phase !== "out" && motion.reveal !== "none" ? reveal(line, motion.reveal, () => piece++) : line}
                </p>
              ))}
            </div>
          ) : null,
        )}
      </div>
      {showCredits && creditLine ? (
        <p
          className={cn(
            "absolute text-[2cqmin] opacity-60",
            theme.credits.where === "top" ? "top-[3cqh]" : theme.credits.where === "lower-third" ? "bottom-[30cqh]" : "bottom-[3cqh]",
          )}
          style={{ left: `${layout.margin}cqw`, right: `${layout.margin}cqw`, textAlign: text.align }}
          data-testid={phase === "out" ? undefined : "screen-credits"}
        >
          {creditLine}
        </p>
      ) : null}
    </div>
  );
}

/** A line cut into the pieces that come in one after the other: the line, its words, or its letters. */
function reveal(line: string, kind: ScreenTheme["motion"]["reveal"], next: () => number): ReactNode {
  const piece = (content: string, key: number | string) => (
    <span key={key} className="sv-piece" style={{ "--i": next() } as CSSProperties}>
      {content}
    </span>
  );
  if (kind === "lines") return piece(line, 0);
  const words = line.split(/(\s+)/);
  if (kind === "words" || kind === "glow") return words.map((word, i) => (/^\s+$/.test(word) ? word : piece(word, i)));
  // Letters (and typed): a word's letters kept together, so it wraps as a word.
  return words.map((word, i) =>
    /^\s+$/.test(word) ? (
      word
    ) : (
      <span key={i} className="inline-block whitespace-nowrap">
        {[...word].map((letter, j) => piece(letter, j))}
      </span>
    ),
  );
}

/** The chart for the band, in the theme's chord colour and size, the pass being sung marked and kept in view. */
function ChartStage({ theme, chart, title, passId }: { theme: ScreenTheme; chart: RenderedChart; title: string; passId: string }) {
  const box = useRef<HTMLDivElement>(null);
  // As big on a preview card as on a projector: the chart's own sizes zoomed to the stage's height.
  const [zoom, setZoom] = useState(1.8);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => entry && setZoom(Math.max(0.4, (entry.contentRect.height / 600) * theme.chords.scale)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [theme.chords.scale]);
  useEffect(() => {
    const pass = box.current?.querySelector<HTMLElement>(`[data-pass="${CSS.escape(passId)}"]`);
    box.current?.querySelectorAll("[data-pass]").forEach((element) => element.removeAttribute("data-current"));
    if (!pass) return;
    pass.setAttribute("data-current", "true");
    pass.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [passId, chart]);
  return (
    <div
      ref={box}
      className={cn(
        "sv-words block overflow-hidden px-[4cqw] py-[4cqh]",
        "[&_[data-pass]]:rounded-lg [&_[data-pass]]:p-2 [&_[data-pass]]:opacity-60 [&_[data-pass]]:transition-opacity [&_[data-pass][data-current]]:bg-white/10 [&_[data-pass][data-current]]:opacity-100",
        "[&_[data-chord]]:!text-(--chord)",
      )}
      style={{ color: theme.text.color }}
      data-testid="screen-chart"
    >
      <div style={{ zoom }}>
        <p className="mb-4 text-xl font-bold">{title}</p>
        <SongChart chart={chart} columns="1" />
      </div>
    </div>
  );
}

/**
 * A font uploaded with the theme, loaded for the stage: its bytes fetched
 * and handed to the browser as a FontFace (the page's CSP only lets fonts
 * come from the app itself as files). Its family's name once it's ready;
 * null until then, or when it can't be read - the theme's font meanwhile.
 */
function useThemeFont(asset: ScreenThemeAsset | undefined): string | null {
  const [family, setFamily] = useState<string | null>(null);
  useEffect(() => {
    setFamily(null);
    if (!asset || typeof FontFace === "undefined") return;
    let current = true;
    const name = `sv-theme-${asset.id}`;
    fetch(asset.url)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
      .then((bytes) => new FontFace(name, bytes).load())
      .then((face) => {
        document.fonts.add(face);
        if (current) setFamily(name);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [asset?.id, asset?.url]);
  return family;
}
