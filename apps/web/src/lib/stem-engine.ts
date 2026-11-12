import { decodeAudio } from "#/lib/decode-audio";
import { speedCorrection, STEM_PARTS, stemSpeed, transposesPart, type StemPart } from "@oneverse/core";
import { useSyncExternalStore } from "react";
import { deviceNow, OutputClock } from "#/lib/output-clock";
import { mediaArtwork } from "#/lib/song-cover";
import { songWaveforms, type StoredWave } from "#/lib/song-files";
import { waveformSlices } from "@oneverse/core";
import type { MetronomeHost } from "#/lib/metronome-engine";
import { beatOf, isAudible, stemKey, TAKE_ID, tracksOf, volumeGain, type StemFile, type StemSong, type StemState, type StemTrack } from "#/lib/stem-files";

/**
 * The stem player's audio (issue #64), kept outside any page so a song
 * keeps playing while the user moves around the app or leaves Practice:
 * one per tab, with the song it has loaded, what's muted and where it is.
 * The dock on a song's page drives it; elsewhere a floating button leads
 * back there.
 *
 * Web Audio keeps the parts on one clock: every part starts at the same
 * instant of the same AudioContext, so they stay sample-locked, where
 * separate <audio> elements drift apart.
 */

const PEAK_SLICES = 400;

const EMPTY: StemState = {
  key: null,
  songVersionId: null,
  multitrackId: null,
  title: "",
  returnTo: "",
  status: "idle",
  complete: false,
  source: null,
  firstSoundMs: null,
  downloaded: 0,
  tracks: [],
  playing: false,
  position: 0,
  duration: 0,
  muted: new Set(),
  soloed: new Set(),
  volumes: {},
  docked: null,
  anchor: null,
  following: null,
  audioBlocked: false,
  transpose: 0,
  transposeParts: {},
  transposeFailed: false,
  speed: 1,
  beat: null,
  loop: null,
};

/** The stretch node's own methods (signalsmith-stretch). */
type StretchNode = AudioWorkletNode & {
  schedule: (change: Record<string, number | boolean>) => Promise<unknown>;
  start: (when?: number) => Promise<unknown>;
  latency: () => Promise<number>;
  configure: (config: { blockMs?: number; intervalMs?: number; splitComputation?: boolean }) => Promise<unknown>;
};

let state: StemState = EMPTY;
const listeners = new Set<() => void>();
let context: AudioContext | null = null;
let clock: OutputClock | null = null;
/** While Sync play is on: straight to the speakers, whose delay the output clock knows (not iOS's audio element, whose it can't). */
let directOutput = false;
// Where every part goes: the speakers, or on iPhone and iPad an <audio> element (see outputFor).
let bus: GainNode | null = null;
let element: HTMLAudioElement | null = null;
let streamOut: MediaStreamAudioDestinationNode | null = null;
/** While the player's recorder is open (issue #134): straight to the speakers, whose delay is known. */
let recordingDirect = false;
// The song last played, for the lock screen's Play button.
let lastSong: StemSong | null = null;
// The song loaded (or loading), for the chord grid's Play (issue #238).
let loadedSong: StemSong | null = null;
/** The waveforms the server worked out for the loaded files (issue #388), by file: what's drawn until each is decoded. */
let storedWaves = new Map<string, StoredWave>();

let buffers = new Map<string, AudioBuffer>();
let gains = new Map<string, GainNode>();
// Transposing (issues #129, #135): each part is moved by the transposition,
// less the semitones it was recorded above its multitrack - or not at all
// (the drums and cues, unless asked). The parts moved by the same amount
// share a bus into a stretch node set to it; the rest go through `plain`,
// delayed by as much as the stretch nodes delay theirs. Sources start that
// much earlier (`latency`), so what's heard stays in place.
let tracksInfo = new Map<string, { part: StemPart | null; offset: number }>();
let plain: GainNode | null = null;
let shiftBuses = new Map<number, GainNode>();
/** The stretch nodes: the amount each moves by (null: free, and stopped), as last told (`scheduled`). */
let pool: { node: StretchNode; channels: number; shift: number | null; scheduled?: number | null }[] = [];
let making: Promise<{ node: StretchNode; channels: number } | null> | null = null;
let stretchLatency = 0;
let delay: DelayNode | null = null;
let latency = 0;
let sources: AudioBufferSourceNode[] = [];
// The context's time at which the song's 0:00 is (or would be) playing.
let startedAt = 0;
// The audio clock's time the last start is heard at (issue #366: time to first sound).
let lastStartAt = 0;
let offset = 0;
let timer: ReturnType<typeof setInterval> | null = null;
// Looping (issue #162): the next pass, scheduled ahead of the loop's end on the audio clock -
// the timer that schedules it, and the time the song's 0:00 moves to (switchAt) once it's heard.
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let nextLoop: { switchAt: number; startedAt: number } | null = null;
// Bumped by each load, so a load that's been replaced drops its results.
let generation = 0;
// The load under way, so Play during a prefetch waits for it rather than starting over.
let loading: { key: string; done: Promise<boolean> } | null = null;

function set(change: Partial<StemState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

function applyGains(immediately = false) {
  if (!context) return;
  for (const [id, gain] of gains) {
    // The click and cues smear when stretched (issue #139): silent while slowed or sped up, the app's metronome playing the beat instead.
    const clickSlowed = state.speed !== 1 && tracksInfo.get(id)?.part === "CLICK";
    const value = isAudible(state, id) && !clickSlowed ? volumeGain(state.volumes[id] ?? 1) : 0;
    if (immediately) gain.gain.setValueAtTime(value, context.currentTime);
    else gain.gain.setTargetAtTime(value, context.currentTime, 0.01);
  }
}

function peaksOf(buffer: AudioBuffer): number[] {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const size = Math.max(1, Math.floor(buffer.length / PEAK_SLICES));
  // Enough samples per slice to see its loudest moments, without reading them all.
  const step = Math.max(1, Math.floor(size / 256));
  const peaks: number[] = [];
  for (let slice = 0; slice < PEAK_SLICES; slice++) {
    let peak = 0;
    const end = Math.min(buffer.length, (slice + 1) * size);
    for (let i = slice * size; i < end; i += step) {
      for (const data of channels) peak = Math.max(peak, Math.abs(data[i] ?? 0));
    }
    peaks.push(peak);
  }
  // Each part at its own scale, so a quiet one still shows its shape.
  const loudest = Math.max(...peaks, 0.0001);
  return peaks.map((peak) => peak / loudest);
}

function stopSources() {
  for (const source of sources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Never started.
    }
  }
  sources = [];
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
  clearLoopTimer();
}

/** Where it is in the recording (s): the audio clock since its 0:00, at the speed it plays. */
function now(): number {
  if (!context) return offset;
  // The loop's next pass has begun: the song's 0:00 is now that pass's.
  if (nextLoop && context.currentTime >= nextLoop.switchAt) {
    startedAt = nextLoop.startedAt;
    const heard = { epoch: clock ? clock.epochOf(nextLoop.switchAt) : Number.NaN, position: state.loop?.start ?? 0 };
    nextLoop = null;
    // Sync play's followers take it as the leader seeking back.
    set({ anchor: heard });
  }
  return Math.min(state.duration, Math.max(0, (context.currentTime - startedAt) * state.speed));
}

function clearLoopTimer() {
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
  nextLoop = null;
}

/** The parts from `from` (s), heard at `when` on the audio clock. */
function startSources(from: number, when: number): AudioBufferSourceNode[] {
  if (!context) return [];
  const started: AudioBufferSourceNode[] = [];
  for (const [id, buffer] of buffers) {
    const gain = gains.get(id);
    if (!gain || from >= buffer.duration) continue;
    const source = context.createBufferSource();
    source.buffer = buffer;
    // Slower or faster (issue #139): resampled, its pitch put back by the stretch nodes.
    source.playbackRate.value = state.speed;
    source.connect(gain);
    // Early by the transposing's latency: heard at `when`.
    source.start(when - latency, from);
    started.push(source);
  }
  return started;
}

/**
 * Looping (issue #162): the parts stop exactly at the loop's end, and the
 * next pass starts then - both scheduled on the audio clock a moment ahead,
 * so it goes round without a gap. `zero` is the audio clock's time of the
 * song's 0:00 for the pass playing, `pass` its sources (a source's stop,
 * set again, replaces the first: the previous pass's are left to stop at
 * their own end). Not while following Sync play's leader: theirs to loop,
 * heard as their seeks.
 */
function armLoop(zero = startedAt, pass = sources) {
  clearLoopTimer();
  const loop = state.loop;
  if (!context || !state.playing || !loop || state.following) return;
  const endAt = zero + loop.end / state.speed;
  if (endAt <= context.currentTime) return;
  for (const source of pass) {
    try {
      source.stop(endAt - latency);
    } catch {
      // Never started.
    }
  }
  loopTimer = setTimeout(
    () => {
      loopTimer = null;
      if (!context || !state.playing || state.loop !== loop) return;
      const next = startSources(loop.start, endAt);
      // The previous pass's, stopping at the loop's end, are dropped once they have.
      sources = [...sources.filter((source) => (source as AudioBufferSourceNode & { ended?: boolean }).ended !== true), ...next];
      for (const source of next) source.onended = () => ((source as AudioBufferSourceNode & { ended?: boolean }).ended = true);
      const nextZero = endAt - loop.start / state.speed;
      armLoop(nextZero, next);
      // Set after arming (which clears it): the song's 0:00 moves when the next pass is heard.
      nextLoop = { switchAt: endAt, startedAt: nextZero };
    },
    Math.max(0, (endAt - context.currentTime - 0.3) * 1000),
  );
}

/**
 * Plays from `start` to `end` over and over (issue #162), or through to the
 * end again (null). While playing, it starts again from where it is, so the
 * loop is scheduled from there.
 */
export function setStemLoop(loop: { start: number; end: number } | null) {
  if (state.following) return;
  const next = loop && loop.end - loop.start > 0.2 ? { start: Math.max(0, loop.start), end: Math.min(state.duration || loop.end, loop.end) } : null;
  set({ loop: next });
  if (!state.playing || !context) return;
  const ahead = 0.05 + latency;
  // Scheduled a moment ahead: from where it'll be then, or - outside the loop - from the loop's start.
  const then = now() + ahead * state.speed;
  const from = next && (then < next.start || then >= next.end) ? next.start : then;
  startAt(from, context.currentTime + ahead);
}

/** Back to the start (issue #162), or to the loop's, stopped. */
export function stopStems() {
  if (state.following) return;
  pause();
  seekStems(state.loop?.start ?? 0);
}

function startAt(from: number, at?: number, anchor?: { epoch: number; position: number }) {
  if (!context) return;
  stopSources();
  stopTimer();
  // A moment ahead, so every part is scheduled before the first one starts.
  const when = Math.max(at ?? 0, context.currentTime + 0.05 + latency);
  // Asked to start at `at` and pushed later (the clock moved on by a block
  // since `at` was worked out): from where the same timeline is by then,
  // or a restart (a transposition's) puts it a few ms behind its own.
  if (at !== undefined && when > at) from = Math.min(state.duration, from + (when - at) * state.speed);
  sources = startSources(from, when);
  lastStartAt = when;
  startedAt = when - from / state.speed;
  const heard = { epoch: clock ? clock.epochOf(when) : Number.NaN, position: from };
  probe()?.push({ zeroAt: heard.epoch - (from / state.speed) * 1000, at: deviceNow() });
  set({ anchor: anchor ?? heard });
  // Looping (issue #162): its end, and the next pass, scheduled now. Armed once
  // `playing` is set (just after, when starting): see playStems.
  armLoop();
  // A timer rather than animation frames, which stop in a background tab.
  timer = setInterval(() => {
    const at = now();
    if (at >= state.duration) {
      stopSources();
      stopTimer();
      offset = 0;
      element?.pause();
      set({ playing: false, position: 0, anchor: null });
      updateMediaSession();
    } else {
      set({ position: at });
    }
  }, 100);
}

/**
 * iOS suspends Web Audio when the screen locks, but lets a media element
 * play on: there the parts are mixed into a stream an <audio> element
 * plays, in the "playback" audio session (which the ring/silent switch
 * doesn't mute either). Elsewhere they go straight to the speakers.
 * (Heard straight from the speakers while on screen, iOS then stopped
 * them at the lock screen, the element muted: issue #136.)
 * `songverse.stems.output` = "element" forces the element (for tests).
 */
function viaElement(): boolean {
  try {
    if (localStorage.getItem("songverse.stems.output") === "element") return true;
  } catch {
    // Storage blocked.
  }
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function outputFor(ctx: AudioContext): GainNode {
  const mix = ctx.createGain();
  if (!directOutput && !recordingDirect && viaElement() && typeof ctx.createMediaStreamDestination === "function") {
    streamOut = ctx.createMediaStreamDestination();
    mix.connect(streamOut);
    element = new Audio();
    element.setAttribute("playsinline", "");
    element.srcObject = streamOut.stream;
    // For the end-to-end suites: which way it's heard.
    if (typeof window !== "undefined") {
      const w = window as unknown as { songverseStems?: { starts: unknown[]; heardVia?: string } };
      w.songverseStems ??= { starts: [] };
      w.songverseStems.heardVia = "element";
    }
  } else {
    mix.connect(ctx.destination);
  }
  return mix;
}

/** The element refused to play (no gesture, say): straight to the speakers instead. */
async function startElement() {
  if (!element || !bus || !context) return;
  try {
    await element.play();
  } catch {
    if (streamOut) bus.disconnect(streamOut);
    element = null;
    try {
      bus.connect(context.destination);
    } catch {
      // Closed meanwhile.
    }
  }
}

function setAudioSession() {
  // Safari 16.4+: play like a music app, on with the screen locked and the silent switch on.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = "playback";
}

/** The lock screen and headphones' controls, and what they show. */
function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const media = navigator.mediaSession;
  media.playbackState = state.playing ? "playing" : state.key ? "paused" : "none";
  if (!state.key) {
    media.metadata = null;
    return;
  }
  if (media.metadata?.title !== state.title) {
    const song = lastSong?.title === state.title ? lastSong : null;
    const metadata = new MediaMetadata({ title: state.title, artist: song?.artist || "Songverse", album: song?.artist ? "Songverse" : "" });
    media.metadata = metadata;
    // Its cover (issue #173), once it's loaded or drawn - if the song hasn't changed meanwhile.
    void mediaArtwork({ title: state.title, imageUrl: song?.imageUrl }).then((artwork) => {
      if (artwork.length > 0 && navigator.mediaSession.metadata === metadata) metadata.artwork = artwork;
    });
  }
  try {
    if (state.duration) media.setPositionState({ duration: state.duration, position: Math.min(state.position, state.duration), playbackRate: state.speed });
  } catch {
    // Not supported here.
  }
}

function setMediaActions() {
  if (!("mediaSession" in navigator)) return;
  const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => void (lastSong && playStems(lastSong))],
    ["pause", () => pauseStems()],
    ["seekto", (details) => seekStems(details.seekTime ?? 0)],
    ["seekbackward", (details) => seekStems(now() - (details.seekOffset ?? 10))],
    ["seekforward", (details) => seekStems(now() + (details.seekOffset ?? 10))],
  ];
  for (const [action, handler] of actions) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Not supported here.
    }
  }
}

// Back from the lock screen or another app with the context interrupted: carry on.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.playing && context && context.state !== "running") void context.resume();
  });
}

/** Forgets the loaded song and frees its audio. */
export function unloadStems() {
  generation++;
  storedWaves = new Map();
  loadedSong = null;
  stopSources();
  stopTimer();
  clock?.dispose();
  clock = null;
  void context?.close().catch(() => {});
  context = null;
  bus = null;
  element?.pause();
  if (element) element.srcObject = null;
  element = null;
  streamOut = null;
  buffers = new Map();
  gains = new Map();
  tracksInfo = new Map();
  plain = null;
  shiftBuses = new Map();
  pool = [];
  making = null;
  delay = null;
  latency = 0;
  offset = 0;
  // Following Sync play's leader carries on through the next song's load.
  set({ ...EMPTY, docked: state.docked, following: state.following });
  updateMediaSession();
}

function load(song: StemSong): Promise<boolean> {
  const key = stemKey(song);
  if (state.key === key && state.status === "ready") return Promise.resolve(true);
  if (loading?.key === key) return loading.done;
  const done = loadNow(song, key);
  loading = { key, done };
  void done.finally(() => {
    if (loading?.done === done) loading = null;
  });
  return done;
}

async function loadNow(song: StemSong, key: string): Promise<boolean> {
  // Parts muted or soloed before the first Play stay so.
  const ids = new Set(song.stems.map((stem) => stem.id));
  const muted = new Set([...state.muted].filter((id) => ids.has(id)));
  const soloed = new Set([...state.soloed].filter((id) => ids.has(id)));
  unloadStems();
  loadedSong = song;
  const mine = generation;
  setAudioSession();
  const ctx = new AudioContext();
  context = ctx;
  clock = new OutputClock(ctx);
  const mix = outputFor(ctx);
  bus = mix;
  plain = ctx.createGain();
  plain.connect(mix);
  tapFor(ctx, mix);
  latency = 0;
  set({
    transpose: song.transpose ?? 0,
    transposeParts: song.transposeParts ?? {},
    transposeFailed: false,
    speed: stemSpeed(song.speed ?? 1),
    key,
    songVersionId: song.songVersionId,
    multitrackId: song.multitrackId ?? song.stems[0]?.multitrackId ?? null,
    title: song.title,
    returnTo: song.returnTo,
    status: "loading",
    complete: false,
    source: song.source ?? null,
    downloaded: 0,
    tracks: tracksOf(song.stems),
    muted,
    soloed,
    volumes: savedVolumes(song.songVersionId, ids),
    beat: beatOf(song),
    loop: null,
  });
  // Bytes so far per file, against the sizes the song lists (or the server says).
  const received = new Map<string, number>();
  const sizes = new Map(song.stems.map((stem) => [stem.id, stem.sizeBytes ?? 0]));
  let reported = 0;
  const progress = (id: string, bytes: number, total: number | null, last = false) => {
    received.set(id, bytes);
    if (total && !sizes.get(id)) sizes.set(id, total);
    const now = Date.now();
    // A tenth of a second between updates is plenty for a progress bar.
    if (mine !== generation || (!last && now - reported < 100)) return;
    reported = now;
    const all = [...sizes.values()].reduce((sum, size) => sum + size, 0);
    // Each file's own too (issue #388): its stored waveform fills in as far as it's come.
    const tracks = state.tracks.map((track) => {
      const size = sizes.get(track.id);
      const got = received.get(track.id);
      return track.ready || !size || got === undefined ? track : { ...track, downloaded: Math.min(1, got / size) };
    });
    set({ tracks, ...(all ? { downloaded: Math.min(1, [...received.values()].reduce((sum, size) => sum + size, 0) / all) } : {}) });
  };
  // Their waveforms, worked out by the server (issue #388): drawn at once, greyed, filling in as each file arrives.
  void songWaveforms(song.songVersionId, song.stems.map((stem) => stem.id)).then((found) => {
    if (mine !== generation || found.size === 0) return;
    storedWaves = found;
    set({
      tracks: state.tracks.map((track) => {
        const wave = found.get(track.id);
        return wave && !track.ready && !track.failed ? { ...track, peaks: waveformSlices(wave.levels, PEAK_SLICES), length: wave.seconds } : track;
      }),
    });
  });
  // Fetched a few at a time, the parts heard first (issue #366). Play starts
  // once every part that's heard has arrived, all together; one muted then
  // joins in, in time, when it's decoded.
  const order = [...song.stems].sort((a, b) => loadRank(a, muted, soloed) - loadRank(b, muted, soloed));
  const settled = new Map<string, { buffer: AudioBuffer | null; empty: boolean }>();
  const heard = song.stems.filter((stem) => isHeard(stem, muted, soloed));
  let playable: (ok: boolean) => void = () => {};
  const heardPlayable = new Promise<boolean>((resolve) => (playable = resolve));
  // Joining one at a time: each waits for the routing of the one before.
  let joining = Promise.resolve();
  const fetchOne = async (stem: StemFile) => {
    let buffer: AudioBuffer | null = null;
    let empty = false;
    try {
      const blob = await song.load(stem, (bytes, total) => progress(stem.id, bytes, total));
      progress(stem.id, blob.size, blob.size, true);
      // A few hundred bytes: headers, no sound.
      empty = blob.size < 1024;
      // Ogg Opus where Safari can't read it (before 18.4): rewrapped as WebM (issue #185).
      buffer = await decodeAudio(ctx, await blob.arrayBuffer());
    } catch {
      // Shown on its row; the other parts still play.
    }
    if (mine !== generation) return;
    settled.set(stem.id, { buffer, empty });
    joining = joining.then(() => join(stem, buffer, empty, mine));
    await joining;
    if (mine !== generation) return;
    // Everything that's heard is in (or failed: the rest still play).
    if (state.status !== "ready" && buffers.size > 0 && heard.every((part) => settled.has(part.id))) {
      set({ status: "ready" });
      playable(true);
    }
  };
  const queue = [...order];
  const worker = async () => {
    for (let stem = queue.shift(); stem; stem = queue.shift()) await fetchOne(stem);
  };
  const all = Promise.all(Array.from({ length: Math.min(LOAD_AT_ONCE, queue.length) }, worker)).then(() => {
    if (mine !== generation) return;
    if (buffers.size === 0) {
      set({ status: "error", complete: true });
      playable(false);
      return;
    }
    set({ status: "ready", complete: true });
    playable(true);
  });
  void all;
  return heardPlayable;
}

/** Whether a part is heard as the player stands: soloed, or (nothing soloed) not muted. */
function isHeard(stem: StemFile, muted: ReadonlySet<string>, soloed: ReadonlySet<string>): boolean {
  return soloed.size > 0 ? soloed.has(stem.id) : !muted.has(stem.id);
}

/** How many of a song's files are fetched at once (issue #366). */
const LOAD_AT_ONCE = 2;

/** Which parts are fetched first: those heard (soloed, then not muted), then by the player's order of parts. */
function loadRank(stem: StemFile, muted: ReadonlySet<string>, soloed: ReadonlySet<string>): number {
  const heard = isHeard(stem, muted, soloed) ? 0 : 2;
  // The click last: the app's metronome can stand in for it meanwhile.
  const part = stem.stemPart === "CLICK" ? 1 : 0;
  return (heard + part) * 1000 + (stem.stemPart ? STEM_PARTS.indexOf(stem.stemPart) : 0);
}

/**
 * A part that's just arrived (issue #366): wired in, routed for the
 * transposition, and - while playing - started where the others are, a
 * moment ahead on the same clock. The first makes the player ready.
 */
async function join(stem: StemFile, buffer: AudioBuffer | null, empty: boolean, mine: number) {
  const ctx = context;
  if (mine !== generation || !ctx || !plain) return;
  const track = (changes: Partial<StemTrack>) => set({ tracks: state.tracks.map((item) => (item.id === stem.id ? { ...item, ...changes } : item)) });
  if (!buffer) return track({ failed: true, empty, peaks: null, length: 0, ready: false });
  const gain = ctx.createGain();
  tracksInfo.set(stem.id, { part: stem.stemPart, offset: stem.pitchOffset ?? 0 });
  gain.connect(plain);
  buffers.set(stem.id, buffer);
  gains.set(stem.id, gain);
  track({ peaks: peaksOf(buffer), length: buffer.duration, failed: false, empty: false, ready: true, downloaded: 1 });
  const before = latency;
  await route();
  if (mine !== generation) return;
  const duration = Math.max(...[...buffers.values()].map((item) => item.duration));
  // Not ready until every part that's heard is in (load() says when).
  if (state.status !== "ready") return set({ duration });
  set({ duration });
  applyGains(true);
  if (!state.playing || !context) return;
  // The transposing's latency changed: everything again, in place.
  if (latency !== before) return replay();
  const when = context.currentTime + 0.05 + latency;
  const from = (when - startedAt) * state.speed;
  if (from >= buffer.duration) return;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = state.speed;
  source.connect(gain);
  source.start(when - latency, Math.max(0, from));
  sources.push(source);
  // Looping: its end, and the next pass, with the others.
  if (state.loop) armLoop();
}

// --- transposing (issue #129)

/** How far a part is moved (semitones): the pitch its speed moved it by put back, and the transposition less what it was recorded above its multitrack, if it's transposed at all. */
function shiftOf(id: string): number {
  const info = tracksInfo.get(id);
  if (!info) return 0;
  const moved = state.transposeParts[id] ?? transposesPart(info.part);
  // Slower or faster (issue #139), every part is put back in its key, the drums too.
  return Math.round(((moved ? state.transpose - info.offset : 0) + speedCorrection(state.speed)) * 1000) / 1000;
}

/**
 * Wires the parts for the transposition: straight to the output when
 * nothing's moved; else each amount through a stretch node set to it (made
 * as needed, loaded only then), the rest through a delay as long as their
 * latency.
 */
async function route() {
  const ctx = context;
  if (!ctx || !bus || !plain) return;
  const mine = generation;
  // Each amount a node with as many channels as its parts have: a mono take
  // alone, mono (about two thirds of the work).
  const wanted = () => {
    const shifts = new Map<number, number>();
    for (const id of gains.keys()) {
      const shift = shiftOf(id);
      if (shift !== 0) shifts.set(shift, Math.max(shifts.get(shift) ?? 1, Math.min(2, buffers.get(id)?.numberOfChannels ?? 2)));
    }
    return shifts;
  };
  // The nodes for the amounts still wanted kept, the rest free; what's still missing.
  const assign = () => {
    const shifts = wanted();
    for (const entry of pool) if (entry.shift !== null && shifts.get(entry.shift) !== entry.channels) entry.shift = null;
    const missing: number[] = [];
    for (const [shift, channels] of shifts) {
      if (pool.some((entry) => entry.shift === shift)) continue;
      const free = pool.find((entry) => entry.shift === null && entry.channels === channels);
      if (free) free.shift = shift;
      else missing.push(channels);
    }
    return missing;
  };
  // The nodes missing, made one at a time (two changes in a row share one).
  let missing = state.transposeFailed ? [] : assign();
  while (missing.length > 0) {
    making ??= makeStretch(ctx, bus, missing[0]!);
    const made = await making;
    making = null;
    if (mine !== generation) return;
    if (!made) {
      set({ transposeFailed: true });
      break;
    }
    if (!pool.some((entry) => entry.node === made.node)) pool.push({ ...made, shift: null, scheduled: undefined });
    missing = assign();
  }
  if (mine !== generation) return;
  if (state.transposeFailed) for (const entry of pool) entry.shift = null;
  // Without the stretch nodes a slowed part would be out of key: as recorded instead.
  if (state.transposeFailed && state.speed !== 1) {
    set({ speed: 1 });
    applyGains(true);
  }
  // A node not in use is stopped: running, it costs as much as moving a part
  // (measured: 2 idle nodes, 8.6 s of work for 120 s of audio; stopped, 0.7).
  for (const entry of pool) {
    if (entry.scheduled === entry.shift) continue;
    entry.scheduled = entry.shift;
    void entry.node.schedule(entry.shift === null ? { active: false, output: ctx.currentTime } : { active: true, semitones: entry.shift, output: ctx.currentTime });
  }
  for (const shiftBus of shiftBuses.values()) shiftBus.disconnect();
  plain.disconnect();
  for (const entry of pool) {
    if (entry.shift === null) continue;
    let shiftBus = shiftBuses.get(entry.shift);
    if (!shiftBus) {
      shiftBus = ctx.createGain();
      shiftBuses.set(entry.shift, shiftBus);
    }
    shiftBus.connect(entry.node);
  }
  const moving = pool.some((entry) => entry.shift !== null);
  plain.connect(moving && delay ? delay : bus);
  latency = moving ? stretchLatency : 0;
  rewire();
  // For the end-to-end suites: the stretch nodes, what each moves by (null: stopped) and its channels.
  const w = window as unknown as { songverseStems?: { stretch?: { shift: number | null; channels: number }[] } };
  if (w.songverseStems) w.songverseStems.stretch = pool.map((entry) => ({ shift: entry.shift, channels: entry.channels }));
}

/** A stretch node on the output, of `channels` (and, with the first, a delay as long as its latency for the parts it doesn't move); null when it can't be made here. */
async function makeStretch(ctx: AudioContext, output: AudioNode, channels: number): Promise<{ node: StretchNode; channels: number } | null> {
  try {
    const { default: SignalsmithStretch } = await import("signalsmith-stretch");
    const node = (await SignalsmithStretch(ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [channels] })) as StretchNode;
    // Its defaults: formant compensation is for one voice alone - on a mix of
    // parts it made the sound wobble, and quieter (measured: twice the
    // wobble of a held chord, a third of its level).
    // Its default block and interval (120 and 30 ms), the work spread over
    // each interval rather than done at once: all at once, a phone's audio
    // thread misses its turn now and then - a crackle, and through iOS's
    // <audio> element a waver in pitch as it catches up (issue #138).
    await node.configure({ blockMs: 120, intervalMs: 30, splitComputation: true });
    await node.start();
    const nodeLatency = await node.latency();
    if (context !== ctx) return null;
    node.connect(output);
    if (!delay) {
      stretchLatency = nodeLatency;
      delay = ctx.createDelay(2);
      delay.delayTime.value = stretchLatency;
      delay.connect(output);
    }
    return { node, channels };
  } catch {
    return null;
  }
}

/** Each part to the bus of the amount it's moved by, or `plain`. */
function rewire() {
  for (const [id, gain] of gains) {
    gain.disconnect();
    const shift = shiftOf(id);
    const target = (shift !== 0 && shiftBuses.get(shift) && pool.some((entry) => entry.shift === shift) ? shiftBuses.get(shift) : plain) ?? null;
    if (target) gain.connect(target);
  }
}

/** Starts again where it's heard, after the transposing's latency changed. */
function replay() {
  if (!context || !state.playing) return;
  const ahead = 0.05 + latency;
  if (state.following && clock && state.anchor) {
    const zero = clock.timeOf(state.anchor.epoch) - state.anchor.position / state.speed;
    const when = context.currentTime + ahead;
    return startAt((when - zero) * state.speed, when, state.anchor);
  }
  // Where and when from one reading of the clock: read twice, it can move on a block in between.
  now();
  const when = context.currentTime + ahead;
  startAt(Math.min(state.duration, Math.max(0, (when - startedAt) * state.speed)), when);
}

/**
 * Transposes the stems as they play (issues #129, #135): by `steps`
 * semitones; `parts` says, by file, which parts are moved when it's not as
 * their part says. Taken up at the next load when nothing's loaded.
 */
export async function setStemsTranspose(steps: number, parts: Record<string, boolean> = {}) {
  if (state.transpose === steps && sameParts(state.transposeParts, parts)) return;
  const before = latency;
  set({ transpose: steps, transposeParts: parts, transposeFailed: false });
  if (!context || state.status !== "ready") return;
  await route();
  if (latency !== before) replay();
}

function sameParts(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}

/**
 * Plays the stems slower or faster, in their key (issue #139): `rate` 1 as
 * recorded. Each part is resampled (its source's playbackRate) and put
 * back in its key by the stretch nodes, with the transposition - one node
 * per amount, as for transposing. Taken up at the next load when nothing's
 * loaded. Playing, it stops for as long as that takes and carries on where
 * it was.
 */
export async function setStemsSpeed(rate: number) {
  const speed = stemSpeed(rate);
  if (state.speed === speed) return;
  if (!context || state.status !== "ready") return set({ speed });
  const wasPlaying = state.playing;
  if (wasPlaying) {
    offset = now();
    stopSources();
    stopTimer();
  }
  set({ speed, transposeFailed: false });
  applyGains(true);
  await route();
  updateMediaSession();
  if (!wasPlaying || !state.playing || !context) return;
  if (state.following) return replay();
  startAt(offset);
}

/**
 * Starts loading a song's stems before Play (issue #64), when its page
 * opens in Practice, so Play is usually instant. Never while another song
 * plays; a paused one makes way.
 */
export function prefetchStems(song: StemSong) {
  if (state.playing) return;
  void load(song);
}

/** The loaded song's beat as it is now (its first beat or beats moved by hand, issue #448): the metronome follows. */
export function refreshStemsBeat(song: StemSong) {
  if (state.key !== stemKey(song)) return;
  const beat = beatOf(song);
  if (JSON.stringify(beat) !== JSON.stringify(state.beat)) set({ beat });
}

/** Other players (YouTube, #66) paused when the stems start: one thing plays at a time. */
export const otherPlayers = new Set<() => void>();

/** Plays `song`, loading it first (and stopping another one) if it isn't what's loaded; `from` (s): there rather than where it was - another source of the song taking over (issue #366). */
export async function playStems(song: StemSong, from?: number) {
  // Following Sync play's leader: theirs to start; a press only lets the browser make sound.
  if (state.following) return unlockStemsAudio();
  lastSong = song;
  for (const pause of otherPlayers) pause();
  // From the press to the first sound (issue #366).
  const pressed = performance.now();
  // load() sets up the audio before its first wait: start it here, still inside the tap,
  // which is the only time iOS lets sound start.
  const loaded = load(song);
  void context?.resume();
  const starting = startElement();
  if (!(await loaded) || !context) return;
  await context.resume();
  await starting;
  // Gains before the first sound, so a part muted while loading stays silent.
  applyGains(true);
  if (from !== undefined) offset = Math.max(0, Math.min(from, state.duration));
  startAt(offset);
  noteFirstSound(pressed);
  set({ playing: true, position: offset, returnTo: song.returnTo, title: song.title });
  // Only now playing: the loop, if there is one, from here.
  armLoop();
  setMediaActions();
  updateMediaSession();
}

/** How long from `pressed` (performance.now()) until the start just scheduled is heard: kept in the state, and for the end-to-end suites. */
function noteFirstSound(pressed: number) {
  if (!context) return;
  const ahead = Math.max(0, lastStartAt - context.currentTime) + (context.outputLatency || 0);
  const ms = Math.round(performance.now() - pressed + ahead * 1000);
  set({ firstSoundMs: ms });
  const w = window as unknown as { songverseStems?: { starts: unknown[]; firstSoundMs?: number; startedParts?: number } };
  w.songverseStems ??= { starts: [] };
  w.songverseStems.firstSoundMs = ms;
  // How many parts the press started together.
  w.songverseStems.startedParts = sources.length;
}

/**
 * Plays the stems loaded for this song (the page's dock loads them) from
 * `from` seconds, or from where they are: the chord grid's Play and its bars
 * (issue #238). False when they aren't this song's, or the leader's to play.
 */
export function playLoadedStems(songVersionId: string, from: number | null = null): boolean {
  const song = loadedSong;
  if (state.following || !song || state.songVersionId !== songVersionId) return false;
  if (from !== null) seekStems(from);
  if (!state.playing) void playStems(song);
  return true;
}

export function pauseStems() {
  if (state.following) return;
  pause();
}

function pause() {
  if (!state.playing) return;
  offset = now();
  stopSources();
  stopTimer();
  element?.pause();
  set({ playing: false, position: offset, anchor: null });
  updateMediaSession();
}

export function seekStems(to: number) {
  if (state.following) return;
  offset = Math.min(Math.max(0, to), state.duration);
  // Somewhere else than the loop: no longer looping (issue #162).
  if (state.loop && (offset < state.loop.start - 0.05 || offset >= state.loop.end)) set({ loop: null });
  set({ position: offset });
  if (state.playing) startAt(offset);
  updateMediaSession();
}

export function toggleStemMute(id: string) {
  const muted = new Set(state.muted);
  if (!muted.delete(id)) muted.add(id);
  set({ muted });
  applyGains();
}

// --- the mixer (issue #140)

const VOLUMES_KEY = "songverse.stems.volumes.";

/** The volumes set for a song's parts on this device, of the files it has now. */
function savedVolumes(songVersionId: string, ids: Set<string>): Record<string, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUMES_KEY + songVersionId) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, number] => ids.has(entry[0]) && typeof entry[1] === "number"));
  } catch {
    return {};
  }
}

function saveVolumes() {
  if (!state.songVersionId) return;
  // The take being recorded isn't the song's: not kept.
  const kept = Object.fromEntries(Object.entries(state.volumes).filter(([id, volume]) => id !== TAKE_ID && volume !== 1));
  try {
    if (Object.keys(kept).length) localStorage.setItem(VOLUMES_KEY + state.songVersionId, JSON.stringify(kept));
    else localStorage.removeItem(VOLUMES_KEY + state.songVersionId);
  } catch {
    // Storage blocked: for as long as it's loaded.
  }
}

/** A part's volume, 0-1: heard now, remembered for the song on this device. */
export function setStemVolume(id: string, volume: number) {
  set({ volumes: { ...state.volumes, [id]: Math.max(0, Math.min(1, volume)) } });
  applyGains();
  saveVolumes();
}

/** Every part back to full volume. */
export function resetStemVolumes() {
  set({ volumes: {} });
  applyGains();
  saveVolumes();
}

export function toggleStemSolo(id: string) {
  const soloed = new Set(state.soloed);
  if (!soloed.delete(id)) soloed.add(id);
  set({ soloed });
  applyGains();
}

/** A song's dock is on screen. */
export function dockStems(songVersionId: string) {
  if (state.docked !== songVersionId) set({ docked: songVersionId });
}

/** …and gone (unless another song's dock took its place meanwhile). */
export function undockStems(songVersionId: string) {
  if (state.docked === songVersionId) set({ docked: null });
}

// --- Sync play (issue #100)

/** For the end-to-end suites: when each start places the recording's 0:00, on the device's clock. */
function probe(): { zeroAt: number; at: number }[] | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { songverseStems?: { starts: { zeroAt: number; at: number }[] } };
  w.songverseStems ??= { starts: [] };
  if (w.songverseStems.starts.length > 50) w.songverseStems.starts.splice(0, 25);
  return w.songverseStems.starts;
}

/** For the end-to-end suites (issue #129): what the stems play, as a stream they can record, when `songverseStems.tap` is set. */
function tapFor(ctx: AudioContext, mix: GainNode) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { songverseStems?: { tap?: boolean; stream?: MediaStream } };
  if (!w.songverseStems?.tap) return;
  const tap = ctx.createMediaStreamDestination();
  mix.connect(tap);
  w.songverseStems.stream = tap.stream;
}

/** While Sync play is on, stems loaded from now on play straight to the speakers. */
export function setStemsDirectOutput(direct: boolean) {
  directOutput = direct;
}

/** The leader's playback: recording position `position` (s) heard at `epoch` (device clock, ms), or paused there. */
export interface StemTimeline {
  playing: boolean;
  position: number;
  epoch: number;
}

/** A stem start is placed again only when it's drifted further than this from where the device's clock says (s). */
const REPLACE_BEYOND = 0.008;
let followedStems: { song: StemSong; timeline: StemTimeline; leader: string } | null = null;

/**
 * Plays the leader's song as they do (loading it first; a device that
 * wasn't ready joins at the current position), with this device's own
 * mutes and solos; called again whenever it or the clocks change. Null:
 * nothing to follow (the leader's stems stopped, or none to play here).
 */
export async function followStems(song: StemSong | null, timeline: StemTimeline | null, leader: string, attempt = 0) {
  if (!song || !timeline) {
    followedStems = null;
    pause();
    return set({ following: leader });
  }
  followedStems = { song, timeline, leader };
  lastSong = song;
  if (state.following !== leader) set({ following: leader });
  if (!(await load(song)) || !context || !clock) return;
  const latest = followedStems;
  if (!latest || stemKey(latest.song) !== stemKey(song)) return;
  const { timeline: now } = latest;
  if (!now.playing) {
    pause();
    offset = Math.min(Math.max(0, now.position), state.duration);
    return set({ position: offset });
  }
  void context.resume();
  if (context.state !== "running") set({ audioBlocked: true });
  // The audio clock's time of the recording's 0:00, at the speed it plays (issue #139).
  const zero = clock.timeOf(now.epoch) - now.position / state.speed;
  // Already playing it there, within a few milliseconds: left as it is.
  if (state.playing && Math.abs(zero - startedAt) < REPLACE_BEYOND) return;
  const when = Math.max(context.currentTime + 0.1 + latency, zero + now.position / state.speed);
  const from = (when - zero) * state.speed;
  if (from >= state.duration) return pause();
  applyGains(true);
  startAt(from, when, { epoch: now.epoch, position: now.position });
  set({ playing: true, returnTo: song.returnTo, title: song.title });
  updateMediaSession();
  // Just started, the audio clock doesn't say yet when its output is heard: placed again once it does.
  if (!clock.known && attempt < 40) {
    setTimeout(() => {
      if (followedStems?.timeline === now) void followStems(followedStems.song, now, followedStems.leader, attempt + 1);
    }, 250);
  }
}

/** Stops following: the stems stop, and are this device's own again. */
export function unfollowStems() {
  if (!state.following) return;
  followedStems = null;
  pause();
  set({ following: null, audioBlocked: false });
}

/**
 * The stems kept where their anchor on the device's clock says, as the
 * audio and device clocks drift apart (the leader's and the followers').
 */
export function realignStems() {
  if (!context || !clock || !state.playing || !state.anchor) return;
  const zero = clock.timeOf(state.anchor.epoch) - state.anchor.position / state.speed;
  if (Math.abs(zero - startedAt) < REPLACE_BEYOND) return;
  noteStemsCorrection(zero - startedAt);
  const when = context.currentTime + 0.05 + latency;
  startAt((when - zero) * state.speed, when, state.anchor);
}

const stemsCorrections: { ms: number; at: number }[] = [];
function noteStemsCorrection(seconds: number) {
  stemsCorrections.push({ ms: Math.round(seconds * 10000) / 10, at: Date.now() });
  if (stemsCorrections.length > 10) stemsCorrections.shift();
}

/** What the stems' clock knows of itself, for Sync details (issue #101). */
export function stemsClockReport() {
  return { clock: clock?.report() ?? null, corrections: [...stemsCorrections], anchor: state.anchor, playing: state.playing, following: state.following };
}

/** From a press: lets the browser make sound, then catches up with the leader. */
export function unlockStemsAudio() {
  if (!context) return;
  void context.resume().then(() => {
    if (state.audioBlocked) set({ audioBlocked: false });
    if (followedStems) void followStems(followedStems.song, followedStems.timeline, followedStems.leader);
  });
}

/** The stems as they are now, outside React. */
export function getStemState(): StemState {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStems(): StemState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}

// --- the metronome with the recording (issue #448)

/**
 * The stems' audio for the metronome to play its clicks through, on the
 * recording's beat (`secondsAt` and `positionAt`: its click grid): the same
 * clock and the same mix, so what the click plays with is what's heard,
 * whatever the output's delay. Null while they don't play (or follow Sync
 * play's leader).
 */
export function stemsMetronomeHost(grid: { secondsAt(position: number): number; positionAt(seconds: number): number }): MetronomeHost | null {
  if (!context || !bus || !clock || !state.playing || state.following) return null;
  const ctx = context;
  return {
    context: ctx,
    output: bus,
    clock,
    speed: state.speed,
    secondsAt: grid.secondsAt,
    positionAt: grid.positionAt,
    passes(from, to) {
      if (!state.playing || context !== ctx) return [];
      // Past the song's end, nothing; across a loop's end, the next pass from there.
      const end = startedAt + state.duration / state.speed;
      const out: { from: number; to: number; zero: number }[] = [];
      const loop = nextLoop;
      if (loop && to > loop.switchAt) {
        if (from < loop.switchAt) out.push({ from, to: loop.switchAt, zero: startedAt });
        out.push({ from: Math.max(from, loop.switchAt), to, zero: loop.startedAt });
      } else {
        const stop = state.loop ? Math.min(end, startedAt + state.loop.end / state.speed) : end;
        if (from < stop) out.push({ from, to: Math.min(to, stop), zero: startedAt });
      }
      return out;
    },
  };
}

// --- recording in the player (issue #134)

/** The player's audio clock, for the recorder to capture on (so a take lines up with what was heard). */
export function stemsAudioContext(): AudioContext | null {
  return context;
}

/**
 * Plays straight to the speakers from now on: on an iPhone or iPad the
 * stems go through an <audio> element (to play on with the screen
 * locked), whose delay can't be known - a take recorded over them couldn't
 * be lined up.
 */
export function directStemsOutput() {
  recordingDirect = true;
  if (!context || !bus || !element) return;
  if (streamOut) bus.disconnect(streamOut);
  try {
    bus.disconnect(context.destination);
  } catch {
    // Wasn't connected.
  }
  bus.connect(context.destination);
  element.pause();
  element.srcObject = null;
  element = null;
}

/** When the song's 0:00 is heard, on the audio clock, while it plays; null when it doesn't. */
export function stemsZeroAt(): number | null {
  return state.playing && context ? startedAt : null;
}

/** A part's audio, mono, on the player's clock: what a punch-in keeps the start of. */
/** A loaded part's audio, as decoded (the take's too); null if it isn't loaded. */
export function stemBuffer(id: string): AudioBuffer | null {
  return buffers.get(id) ?? null;
}

export function stemStoredWave(id: string): StoredWave | null {
  return storedWaves.get(id) ?? null;
}

export function stemMono(id: string): Float32Array | null {
  const buffer = buffers.get(id);
  if (!buffer) return null;
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < mono.length; i++) mono[i]! += data[i]! / buffer.numberOfChannels;
  }
  return mono;
}

/**
 * The take just recorded, as a track the player plays with the others (a
 * new one replaces it); null takes it away.
 */
export async function setStemsTake(take: { samples: Float32Array; part: StemPart; partName: string | null; name: string; offset: number } | null) {
  if (!context || !plain) return;
  const had = gains.get(TAKE_ID);
  had?.disconnect();
  buffers.delete(TAKE_ID);
  gains.delete(TAKE_ID);
  tracksInfo.delete(TAKE_ID);
  let tracks = state.tracks.filter((track) => track.id !== TAKE_ID);
  if (take && take.samples.length > 0) {
    const buffer = context.createBuffer(1, take.samples.length, context.sampleRate);
    buffer.copyToChannel(take.samples as Float32Array<ArrayBuffer>, 0);
    const gain = context.createGain();
    gain.connect(plain);
    buffers.set(TAKE_ID, buffer);
    gains.set(TAKE_ID, gain);
    tracksInfo.set(TAKE_ID, { part: take.part, offset: take.offset });
    tracks = [
      ...tracks,
      { id: TAKE_ID, part: take.part, partName: take.name, by: null, filename: take.name, number: 0, peaks: peaksOf(buffer), length: buffer.duration, offset: take.offset, failed: false, take: true, ready: true, downloaded: 1 },
    ];
  }
  const duration = Math.max(0, ...[...buffers.values()].map((buffer) => buffer.duration));
  set({ tracks, duration });
  await route();
  applyGains(true);
  // Playing: heard from where it is, the take with it.
  if (state.playing) startAt(now() + (0.05 + latency) * state.speed, context.currentTime + 0.05 + latency);
}

/**
 * A recorder closed (issue #136), the player's or the dialog's: the stems
 * go back to their own way of being heard, afresh. On an iPhone the microphone switched the audio
 * session to play-and-record and back, and a player made before that
 * crackled through its <audio> element; the next Play makes a new one.
 */
export function endStemsRecording() {
  recordingDirect = false;
  if (!context) return;
  if (state.playing) pause();
  unloadStems();
}
