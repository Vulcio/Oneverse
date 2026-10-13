import { formatDuration } from "@songverse/core";
import { useRouter } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, Loader2, Pause, Play, TvMinimalPlay } from "lucide-react";
import { useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { SpeedControl, speedPercent } from "#/components/speed-control";
import { StemDockSlot } from "#/components/stem-dock";
import { Button } from "@songverse/ui/components/button";
import { setMode } from "#/lib/mode";
import { chooseStemSpeed, useChosenSpeed } from "#/lib/stem-engine";
import { cn } from "@songverse/ui/lib/utils";
import {
  dockYouTube,
  pauseYouTube,
  playYouTube,
  seekYouTube,
  setYouTubeHost,
  setYouTubeSpeed,
  showYouTube,
  undockYouTube,
  useYouTube,
  type YouTubeVideo,
} from "#/lib/youtube-player";

// Clear of the screen's rounded corners and the home indicator on a phone (as the stem dock).
const EDGES = "pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:px-6";

/**
 * A song's YouTube video docked at the bottom of its page in Practice
 * (issue #66), for a song with no audio of its own: the video (YouTube
 * requires it shown, at least 200x200) and the controls. The player itself
 * is YouTubeHost's, laid over the space kept here. It opens minimised (issue
 * #184) - one row, no video - unless the video's playing already; as YouTube
 * won't play a video that isn't shown, minimising pauses it, and Play there
 * expands it.
 */
export function YouTubeDock({ video }: { video: YouTubeVideo }) {
  const slot = useContext(StemDockSlot);
  const { t } = useTranslation();
  const yt = useYouTube();
  const anchor = useRef<HTMLDivElement>(null);
  const current = yt.video?.videoId === video.videoId;
  const playing = current && yt.playing;
  const position = current ? yt.position : 0;
  const duration = current ? yt.duration : 0;
  const loading = current && yt.status === "loading";

  const [expanded, setExpanded] = useState(() => playing);
  // Played from elsewhere (the corner player's way back): shown.
  useEffect(() => {
    if (playing) setExpanded(true);
  }, [playing]);
  // Minimised once the pause has taken: playing without its box, the video would go to the corner.
  const [minimizing, setMinimizing] = useState(false);
  useEffect(() => {
    if (!minimizing || playing) return;
    setMinimizing(false);
    setExpanded(false);
  }, [minimizing, playing]);
  function minimize() {
    if (!playing) return setExpanded(false);
    pauseYouTube();
    setMinimizing(true);
  }

  // Slower or faster (issue #139), remembered for the song as the stems' speed is.
  const speed = useChosenSpeed(video.songVersionId);
  useEffect(() => {
    if (current) setYouTubeSpeed(speed);
  }, [current, speed]);

  useEffect(() => {
    showYouTube(video);
    // Once per video; `video` is a new object on every render.
  }, [video.videoId]);

  useEffect(() => {
    if (!current || !expanded || !anchor.current) return;
    dockYouTube(video.songVersionId, anchor.current);
    return () => undockYouTube(video.songVersionId);
  }, [current, expanded, slot, video.songVersionId]);

  const play = (
    <Button
      type="button"
      size="icon"
      className="size-10 shrink-0 rounded-full"
      onClick={() => {
        if (playing) return pauseYouTube();
        // Within the press, as browsers want; shown, as YouTube wants.
        setExpanded(true);
        playYouTube(video);
      }}
      disabled={loading}
      aria-label={playing ? t("stems.pause") : t("stems.play")}
    >
      {loading ? <Loader2 className="animate-spin" /> : playing ? <Pause /> : <Play />}
    </Button>
  );
  const time = (
    <span className="text-xs tabular-nums text-muted-foreground" data-testid="youtube-time">
      {formatDuration(position)} / {formatDuration(duration)}
    </span>
  );

  const dock = (
    <section
      className="relative border-t bg-background shadow-[0_-4px_12px_-8px_rgb(0_0_0/0.3)]"
      aria-label={t("youtube.label")}
      data-testid="youtube-dock"
      data-state={playing ? "playing" : current ? yt.status : "idle"}
      data-view={expanded ? "expanded" : "compact"}
    >
      {/* The playhead, as the stem player's: the line along the top edge - click or drag it to go there (arrow keys too). */}
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={1}
        value={Math.min(position, duration)}
        disabled={!current || !duration}
        onChange={(event) => seekYouTube(Number(event.target.value))}
        aria-label={t("stems.position")}
        aria-valuetext={`${formatDuration(position)} / ${formatDuration(duration)}`}
        className="stem-playhead"
        style={{ "--progress": duration ? `${(Math.min(position, duration) / duration) * 100}%` : "0%" } as CSSProperties}
        data-testid="youtube-playhead"
      />
      {expanded ? (
        // On a phone, the video as wide as the screen, the controls under it (issue #184): a 16:9 picture, not a strip in a square.
        <div className={cn("mx-auto flex w-full flex-col gap-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:pb-2", EDGES)}>
          {current ? (
            // The video goes here (YouTubeHost follows this box): 200 px high, YouTube's least.
            <div ref={anchor} className="h-[200px] w-full shrink-0 overflow-hidden rounded-md bg-black sm:w-[356px]" data-testid="youtube-anchor" />
          ) : (
            <button
              type="button"
              className="relative h-[200px] w-full shrink-0 overflow-hidden rounded-md bg-black sm:w-[356px]"
              onClick={() => playYouTube(video)}
              aria-label={t("stems.play")}
            >
              <img src={`https://i.ytimg.com/vi/${encodeURIComponent(video.videoId)}/hqdefault.jpg`} alt="" className="size-full object-cover opacity-80" />
              <Play className="absolute inset-0 m-auto size-10 text-white" aria-hidden />
            </button>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="hidden items-center gap-2 text-sm font-medium sm:flex">
              <TvMinimalPlay className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {t("youtube.title")}
            </p>
            <p className="hidden text-xs text-muted-foreground sm:block">{t("youtube.caption")}</p>
            {current && yt.status === "error" ? (
              <p className="text-xs text-destructive" role="alert">
                {t("youtube.failed")}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              {play}
              {time}
              <SpeedControl speed={speed} onChange={(next) => chooseStemSpeed(video.songVersionId, next)} testId="youtube-speed" />
              <Button type="button" variant="ghost" size="icon" className="ml-auto shrink-0" onClick={minimize} aria-label={t("stems.minimize")} title={t("youtube.minimize")} data-testid="youtube-minimize">
                <ChevronDown />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className={cn("mx-auto flex w-full items-center gap-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-2", EDGES)}>
          {play}
          <span className="flex min-w-0 flex-1 items-center gap-2 px-1.5 text-sm">
            <TvMinimalPlay className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{t("youtube.title")}</span>
          </span>
          {duration ? time : null}
          {speed !== 1 ? (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary" title={t("stems.speedTitle")} data-testid="youtube-speed-badge">
              {speedPercent(speed)}
            </span>
          ) : null}
          <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => setExpanded(true)} aria-label={t("stems.expand")} data-testid="youtube-expand">
            <ChevronUp />
          </Button>
        </div>
      )}
    </section>
  );

  return slot ? createPortal(dock, slot) : null;
}

/**
 * The one YouTube player (see lib/youtube-player), never moved in the page
 * (an iframe moved reloads): laid over the song's dock when it's on screen,
 * in a corner with a way back while it plays elsewhere, hidden otherwise.
 */
export function YouTubeHost() {
  const { t } = useTranslation();
  const router = useRouter();
  const yt = useYouTube();
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  // In the browser only: nothing of it is drawn on the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const anchor = yt.video && yt.docked?.songVersionId === yt.video.songVersionId ? yt.docked.anchor : null;
  const mini = !anchor && yt.playing && !!yt.video;

  useEffect(() => {
    if (!frame) return;
    setYouTubeHost(frame);
    return () => setYouTubeHost(null);
  }, [frame]);

  // Follow the dock's box, as the page scrolls or the dock changes.
  useEffect(() => {
    const element = box;
    if (!anchor || !element) return;
    let id = 0;
    const follow = () => {
      const rect = anchor.getBoundingClientRect();
      Object.assign(element.style, { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      id = requestAnimationFrame(follow);
    };
    follow();
    return () => {
      cancelAnimationFrame(id);
      Object.assign(element.style, { top: "", left: "", width: "", height: "" });
    };
  }, [anchor, box]);

  if (!mounted) return null;
  return createPortal(
    <div
      ref={setBox}
      className={cn(
        "fixed overflow-hidden",
        anchor && "z-40 rounded-md",
        mini && "right-4 bottom-4 z-50 flex w-[min(356px,calc(100vw-2rem))] flex-col rounded-lg border bg-background shadow-lg",
        !anchor && !mini && "pointer-events-none invisible top-0 -left-[9999px] size-[200px]",
      )}
      data-testid="youtube-host"
      data-view={anchor ? "docked" : mini ? "mini" : "hidden"}
    >
      {mini && yt.video ? (
        <div className="flex items-center gap-1 p-1">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => {
              setMode("practice");
              if (yt.video) void router.navigate({ href: yt.video.returnTo });
            }}
            aria-label={t("stems.backToSong", { title: yt.video.title })}
          >
            <TvMinimalPlay className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{yt.video.title}</span>
          </button>
          <Button type="button" variant="ghost" size="icon" onClick={pauseYouTube} aria-label={t("stems.pause")}>
            <Pause />
          </Button>
        </div>
      ) : null}
      <div ref={setFrame} className={mini ? "h-[200px] w-full" : "size-full"} />
    </div>,
    document.body,
  );
}
