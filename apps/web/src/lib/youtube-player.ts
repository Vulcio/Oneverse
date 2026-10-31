import { useSyncExternalStore } from "react";
import { otherPlayers, pauseStems } from "#/lib/stem-engine";

/**
 * A song's YouTube video as its playback in Practice, when it has no audio
 * of its own (issue #66). YouTube's own embedded player (the IFrame API) is
 * the only way allowed: no audio extracted, and the video shown while it
 * plays, at least 200x200 px. There is one player per tab, kept in place
 * (moving an iframe reloads it): YouTubeHost lays it over the dock of the
 * song's page, or in a corner while it plays elsewhere.
 */

export interface YouTubeVideo {
  songVersionId: string;
  videoId: string;
  /** Where it starts, in seconds (a reference recording's, issue #346). */
  start?: number | null;
  title: string;
  /** The page to come back to. */
  returnTo: string;
}

export interface YouTubeState {
  video: YouTubeVideo | null;
  status: "idle" | "loading" | "ready" | "error";
  playing: boolean;
  position: number;
  duration: number;
  /** Its speed (issue #139): YouTube keeps the pitch. */
  speed: number;
  /** The song whose dock is on screen, and where the video goes in it. */
  docked: { songVersionId: string; anchor: HTMLElement } | null;
}

// The parts of YouTube's IFrame API used here.
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  cueVideoById(video: { videoId: string; startSeconds?: number }): void;
  loadVideoById(video: { videoId: string; startSeconds?: number }): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width: string;
      height: string;
      host?: string;
      playerVars?: Record<string, number | string>;
      events: { onReady?: () => void; onStateChange?: (event: { data: number }) => void; onPlaybackRateChange?: (event: { data: number }) => void; onError?: () => void };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PLAYING = 1;

const EMPTY: YouTubeState = { video: null, status: "idle", playing: false, position: 0, duration: 0, speed: 1, docked: null };
// The speed asked for, set again on each video (YouTube starts each at 100%).
let wanted = 1;

let state: YouTubeState = EMPTY;
const listeners = new Set<() => void>();
let api: Promise<YTNamespace> | null = null;
let player: YTPlayer | null = null;
let playerVideo: string | null = null;
let ready = false;
let host: HTMLElement | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function set(change: Partial<YouTubeState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      before?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      api = null;
      reject(new Error("YouTube couldn't be reached"));
    };
    document.head.append(script);
  });
  return api;
}

function poll() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (!player || !ready) return;
    set({ position: player.getCurrentTime() || 0, duration: player.getDuration() || state.duration });
  }, 250);
}

function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function ensurePlayer(video: YouTubeVideo, autoplay: boolean) {
  if (player && playerVideo === video.videoId) return;
  if (player && ready) {
    playerVideo = video.videoId;
    set({ position: 0, duration: 0 });
    const load = { videoId: video.videoId, ...(video.start ? { startSeconds: video.start } : {}) };
    if (autoplay) player.loadVideoById(load);
    else player.cueVideoById(load);
    return;
  }
  if (!host) return;
  set({ status: "loading" });
  let yt: YTNamespace;
  try {
    yt = await loadApi();
  } catch {
    set({ status: "error" });
    return;
  }
  // Replaced meanwhile, or the host went away.
  if (!host || state.video?.videoId !== video.videoId || player) return;
  const target = document.createElement("div");
  host.replaceChildren(target);
  playerVideo = video.videoId;
  player = new yt.Player(target, {
    videoId: video.videoId,
    width: "100%",
    height: "100%",
    // No tracking cookies until the video plays.
    host: "https://www.youtube-nocookie.com",
    playerVars: { playsinline: 1, rel: 0, autoplay: autoplay ? 1 : 0, ...(video.start ? { start: video.start } : {}) },
    events: {
      onReady: () => {
        ready = true;
        set({ status: "ready", duration: player?.getDuration() || 0 });
        applySpeed();
        if (autoplay) player?.playVideo();
      },
      onStateChange: ({ data }) => {
        const playing = data === PLAYING;
        if (playing) {
          // One thing plays at a time: the stems stop.
          pauseStems();
          poll();
        } else {
          stopPolling();
        }
        set({ playing, position: player?.getCurrentTime() || 0, duration: player?.getDuration() || state.duration });
        if (playing && player && player.getPlaybackRate() !== wanted) applySpeed();
      },
      onPlaybackRateChange: ({ data }) => set({ speed: data }),
      onError: () => set({ status: "error", playing: false }),
    },
  });
}

function applySpeed() {
  if (!player || !ready) return;
  try {
    player.setPlaybackRate(wanted);
    set({ speed: player.getPlaybackRate() || wanted });
  } catch {
    // Not this video.
  }
}

/** Plays the video slower or faster (issue #139), from now on; YouTube keeps its pitch. */
export function setYouTubeSpeed(rate: number) {
  wanted = rate;
  set({ speed: rate });
  applySpeed();
}

/** Where the player lives (YouTubeHost's element), or gone. */
export function setYouTubeHost(element: HTMLElement | null) {
  host = element;
  // A video offered before the host was there.
  if (element && state.video && !player) void ensurePlayer(state.video, false);
  if (!element) {
    stopPolling();
    player?.destroy();
    player = null;
    playerVideo = null;
    ready = false;
    set({ ...EMPTY });
  }
}

/**
 * A song's page shows its video (in Practice, with no audio of its own):
 * it's cued there, unless another video is playing.
 */
export function showYouTube(video: YouTubeVideo) {
  if (state.playing && state.video?.videoId !== video.videoId) return;
  set({ video });
  void ensurePlayer(video, false);
}

export function playYouTube(video: YouTubeVideo) {
  pauseStems();
  if (state.video?.videoId !== video.videoId || !player) {
    set({ video });
    void ensurePlayer(video, true);
    return;
  }
  player.playVideo();
}

export function pauseYouTube() {
  player?.pauseVideo();
}

export function seekYouTube(to: number) {
  player?.seekTo(to, true);
  set({ position: to });
}

export function dockYouTube(songVersionId: string, anchor: HTMLElement) {
  set({ docked: { songVersionId, anchor } });
}

export function undockYouTube(songVersionId: string) {
  if (state.docked?.songVersionId === songVersionId) set({ docked: null });
}

// The stems stop YouTube when they start.
otherPlayers.add(pauseYouTube);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useYouTube(): YouTubeState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}
