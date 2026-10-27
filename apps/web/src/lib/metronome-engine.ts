import { beatAt, clicksBetween, normalizeMetronome, secondsPerBeat, sharedMetronomeSettings, type MetronomeClick, type MetronomeSettings, type MetronomeSound } from "@oneverse/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { deviceNow, OutputClock } from "#/lib/output-clock";

/**
 * The metronome's sound (issue #2), kept outside any page like the stem
 * player, so it keeps time while the user moves around the app: one per
 * tab. It plays the timeline `@oneverse/core` gives (clicksBetween), which a
 * MIDI renderer (#98) or Sync play (#13) read the same way.
 *
 * Clicks are scheduled a little ahead on the audio clock, never fired by
 * timers, which drift and stall when the page is busy: a timer only tops up
 * what's scheduled. Where the beat is comes from the same clock, so what's
 * shown is what's heard (less the device's output delay).
 */

const STORAGE_KEY = "songverse.metronome";
/** How far ahead clicks are scheduled: a hidden tab's timers slow to one a second, so much further then. */
const LOOKAHEAD = 0.15;
const HIDDEN_LOOKAHEAD = 1.5;
const TICK_MS = 25;
/** Time to start after a press, so the first click isn't late; longer when leading Sync play, for the others to hear it too (issue #13). */
let startDelay = 0.08;

export interface MetronomeState {
  settings: MetronomeSettings;
  playing: boolean;
  /** Its settings came from this song (a Live, Practice or song page button), else null. */
  songId: string | null;
  /** Following Sync play's leader (issue #13): their name; they set it, this device only its sound and volume. */
  following: string | null;
  /** Following, but the browser hasn't let it make a sound yet: a press will (unlockMetronomeAudio). */
  audioBlocked: boolean;
  /**
   * Where the timeline is anchored, a new object at each change: beat
   * `position` at `time` on the audio clock, heard at `epoch` on the
   * device's clock (ms). The device's clock is what Sync play shares.
   */
  anchor: { time: number; position: number; epoch: number } | null;
}

let state: MetronomeState = { settings: normalizeMetronome(null), playing: false, songId: null, following: null, audioBlocked: false, anchor: null };
let loaded = false;
const listeners = new Set<() => void>();

function emit(next: Partial<MetronomeState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/** The player's settings, from the last time (in the browser only: the server can't know them). */
function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) state = { ...state, settings: normalizeMetronome(JSON.parse(stored) as Partial<MetronomeSettings>) };
  } catch {
    // Storage blocked or unreadable: the defaults.
  }
}

/**
 * This device's own settings, as kept: not those of a timeline it plays
 * (a leader's, or the recording's beat with its count-in, issue #178).
 */
export function ownMetronomeSettings(): MetronomeSettings {
  load();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeMetronome(JSON.parse(stored) as Partial<MetronomeSettings>);
  } catch {
    // Storage blocked or unreadable.
  }
  return state.settings;
}

function save(settings: MetronomeSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked: they last for this page.
  }
}

// --- audio

let context: AudioContext | null = null;
let clock: OutputClock | null = null;
let output: GainNode | null = null;
let buffers: Map<string, AudioBuffer> | null = null;
/** Where the timeline was anchored: position `anchorPosition` (beats) at `anchorTime` on the audio clock. */
let anchorTime = 0;
/** When beat `anchorPosition` is heard on the device's clock (ms): what the audio clock is kept against. */
let anchorEpoch = 0;
let anchorPosition = 0;
/** Scheduled up to here, in beats. */
let scheduledUntil = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let scheduled: { source: AudioBufferSourceNode; time: number }[] = [];

/** The clicks' sounds, made here rather than downloaded: a sound per level, for each kind. */
function makeBuffers(ctx: AudioContext): Map<string, AudioBuffer> {
  const made = new Map<string, AudioBuffer>();
  const rate = ctx.sampleRate;
  const shapes: Record<MetronomeSound, { partials: [number, number][]; length: number; decay: number; square?: boolean }> = {
    // A short, bright tick.
    click: { partials: [[1, 1]], length: 0.03, decay: 0.006 },
    // Two inharmonic partials, dying fast: a wood block.
    wood: { partials: [[1, 1], [1.58, 0.5]], length: 0.05, decay: 0.012 },
    beep: { partials: [[1, 1]], length: 0.07, decay: 0.05, square: true },
  };
  const pitch: Record<MetronomeSound, Record<MetronomeClick["level"], number>> = {
    click: { accent: 2000, normal: 1400, sub: 1100 },
    wood: { accent: 1250, normal: 900, sub: 760 },
    beep: { accent: 1320, normal: 880, sub: 660 },
  };
  const loudness: Record<MetronomeClick["level"], number> = { accent: 1, normal: 0.7, sub: 0.4 };
  for (const [sound, shape] of Object.entries(shapes) as [MetronomeSound, (typeof shapes)[MetronomeSound]][]) {
    for (const level of ["accent", "normal", "sub"] as const) {
      const buffer = ctx.createBuffer(1, Math.ceil(shape.length * rate), rate);
      const data = buffer.getChannelData(0);
      const frequency = pitch[sound][level];
      for (let i = 0; i < data.length; i++) {
        const t = i / rate;
        let value = 0;
        for (const [ratio, gain] of shape.partials) {
          const wave = Math.sin(2 * Math.PI * frequency * ratio * t);
          value += gain * (shape.square ? Math.sign(wave) * 0.35 : wave);
        }
        // A millisecond's attack, no click at the start; then the decay, to nothing at the end.
        const envelope = Math.min(1, t / 0.001) * Math.exp(-t / shape.decay) * (1 - i / data.length);
        data[i] = value * envelope * loudness[level] * 0.6;
      }
      made.set(`${sound}:${level}`, buffer);
    }
  }
  return made;
}

function audio(): AudioContext {
  if (!context) {
    context = new AudioContext({ latencyHint: "interactive" });
    clock = new OutputClock(context);
    output = context.createGain();
    output.connect(context.destination);
    buffers = makeBuffers(context);
  }
  return context;
}

/** Where the beat is on the audio clock, in beats from the start. */
function positionAt(time: number): number {
  return anchorPosition + (time - anchorTime) / secondsPerBeat(state.settings);
}
function timeOf(position: number): number {
  return anchorTime + (position - anchorPosition) * secondsPerBeat(state.settings);
}

/** For the end-to-end suites, which can't hear it: the last clicks scheduled, on the audio clock. */
interface MetronomeProbe {
  /**
   * `heardAt`: when it's meant to be heard, on the device's clock (ms since
   * the epoch), from the timeline's anchor there; `outputAt`: when the
   * audio output said it would be, as it was scheduled; `clockAt`: when
   * the audio clock itself plays it (its time against the device's, with
   * no output timestamp - what a wrong one can't hide, issue #102).
   */
  clicks: (Pick<MetronomeClick, "position" | "bar" | "beat" | "sub" | "level"> & { time: number; heardAt: number; outputAt: number; clockAt: number })[];
  now: () => number;
  /** When a time on the audio clock is heard, in ms since the epoch on this device's clock. */
  epoch: (time: number) => number;
}
function probe(): MetronomeProbe | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { songverseMetronome?: MetronomeProbe };
  w.songverseMetronome ??= {
    clicks: [],
    now: () => context?.currentTime ?? 0,
    epoch: epochFromAudioTime,
  };
  return w.songverseMetronome;
}

// --- the audio clock against the device's own (Sync play, issue #13): see output-clock.ts

export { deviceNow };

/** When a time on the audio clock is heard, on the device's clock. */
export function epochFromAudioTime(time: number): number {
  return clock ? clock.epochOf(time) : Number.NaN;
}

/** The audio clock's time to schedule a sound at, for it to be heard at `epoch` (device clock, ms). */
export function audioTimeFromEpoch(epoch: number): number {
  audio();
  return clock!.timeOf(epoch);
}

function schedule() {
  const ctx = context;
  if (!ctx || !output || !buffers || !state.playing) return;
  const horizon = ctx.currentTime + (document.hidden ? HIDDEN_LOOKAHEAD : LOOKAHEAD);
  const until = positionAt(horizon);
  const log = probe();
  for (const click of clicksBetween(state.settings, scheduledUntil, until)) {
    const time = timeOf(click.position);
    if (time < ctx.currentTime) continue;
    const source = ctx.createBufferSource();
    source.buffer = buffers.get(`${state.settings.sound}:${click.level}`)!;
    source.connect(output);
    source.start(time);
    scheduled.push({ source, time });
    log?.clicks.push({ time, heardAt: anchorEpoch + (time - anchorTime) * 1000, outputAt: epochFromAudioTime(time), clockAt: deviceNow() + (time - ctx.currentTime) * 1000, position: click.position, bar: click.bar, beat: click.beat, sub: click.sub, level: click.level });
  }
  if (log && log.clicks.length > 200) log.clicks.splice(0, log.clicks.length - 200);
  scheduledUntil = Math.max(scheduledUntil, until);
  scheduled = scheduled.filter((entry) => entry.time > ctx.currentTime - 1);
}

/** Silences what's scheduled from `time` on. */
function cancelFrom(time: number) {
  scheduled = scheduled.filter((entry) => {
    if (entry.time < time - 0.001) return true;
    try {
      entry.source.stop();
    } catch {
      // Not started, or over.
    }
    entry.source.disconnect();
    return false;
  });
  const log = probe();
  if (log) log.clicks = log.clicks.filter((click) => click.time < time - 0.001);
}

// --- what pages call

/**
 * Starts from the top (count-in first), with these settings if given; from a
 * song's button, `songId` says which. `from` starts that many beats into the
 * timeline instead (the chord grid's bars, issue #238): a bar's start in the
 * song, so the count-in's beats are the ones before it.
 */
export function startMetronome(settings?: MetronomeSettings, songId: string | null = null, from = 0) {
  load();
  // Following Sync play's leader: theirs to start.
  if (state.following) return unlockMetronomeAudio();
  adopted = null;
  placing = null;
  const ctx = audio();
  // Within the press: browsers only let sound start from one.
  void ctx.resume();
  if (state.playing) cancelFrom(0);
  const next = settings ? normalizeMetronome(settings) : state.settings;
  if (settings) save(next);
  output!.gain.value = next.volume;
  anchorTime = ctx.currentTime + startDelay;
  anchorEpoch = epochFromAudioTime(anchorTime);
  anchorPosition = Math.max(0, from);
  scheduledUntil = anchorPosition;
  emit({ settings: next, playing: true, songId, anchor: { time: anchorTime, position: anchorPosition, epoch: anchorEpoch } });
  timer ??= setInterval(schedule, TICK_MS);
  schedule();
}

export function stopMetronome() {
  if (state.following) return;
  halt();
}

function halt() {
  adopted = null;
  placing = null;
  if (timer) clearInterval(timer);
  timer = null;
  cancelFrom(0);
  if (state.playing) emit({ playing: false, anchor: null });
}

/** New settings, kept; while it plays, from the next beat (or, for a new bar length, a new bar there). */
export function updateMetronome(change: Partial<MetronomeSettings>) {
  load();
  const previous = state.settings;
  // Playing a timeline it was given (the recording's beat, a leader's it took over): only the change is this device's own.
  const given = adopted !== null;
  // The leader's own change: what was picked up from the session is theirs now.
  if (!state.following) adopted = placing = null;
  // Following Sync play's leader: only this device's sound and volume are its own.
  if (state.following) change = { ...(change.sound !== undefined && { sound: change.sound }), ...(change.volume !== undefined && { volume: change.volume }) };
  const next = normalizeMetronome({ ...previous, ...change });
  // Kept as this device's own, the leader's or the recording's settings aside.
  if (state.following || given) save(normalizeMetronome({ ...ownMetronomeSettings(), ...change }));
  else save(next);
  if (!state.playing || !context) return emit({ settings: next, songId: null });
  output!.gain.value = next.volume;
  const timing = (["tempo", "numerator", "denominator", "beats", "subdivision", "countIn", "countInOnly", "sound"] as const).some(
    (key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]),
  );
  if (!timing) return emit({ settings: next });
  const nextBeat = Math.floor(positionAt(context.currentTime)) + 1;
  const at = timeOf(nextBeat);
  cancelFrom(at);
  const oldCount = previous.countIn * previous.numerator;
  const newCount = next.countIn * next.numerator;
  // On the device's clock, from the anchor it had: the relation read then still holds.
  anchorEpoch += (at - anchorTime) * 1000;
  anchorTime = at;
  if (nextBeat < oldCount) {
    // In the count-in: it carries on, or starts again for another one.
    anchorPosition = next.countIn === previous.countIn && next.numerator === previous.numerator ? nextBeat : 0;
  } else if (next.numerator === previous.numerator) {
    anchorPosition = nextBeat - oldCount + newCount;
  } else {
    // Another bar length: a new bar, on the next beat.
    anchorPosition = newCount + (Math.floor((nextBeat - oldCount) / previous.numerator) + 1) * next.numerator;
  }
  scheduledUntil = anchorPosition;
  emit({ settings: next, songId: null, anchor: { time: anchorTime, position: anchorPosition, epoch: anchorEpoch } });
  schedule();
}

/** A timeline is placed on the audio clock again only when it's drifted further than this from where the device's clock says (s). */
const REPLACE_BEYOND = 0.003;

/**
 * Keeps this device's own metronome (Sync play's leader's, issue #13) where
 * its device-clock anchor says, as the audio and device clocks drift apart:
 * the others follow that anchor, so this device does too.
 */
export function realignMetronome() {
  const ctx = context;
  if (!ctx || !state.playing || state.following) return;
  const placed = audioTimeFromEpoch(anchorEpoch);
  if (Math.abs(placed - anchorTime) < REPLACE_BEYOND) return;
  const now = ctx.currentTime;
  cancelFrom(now);
  noteCorrection(placed - anchorTime);
  anchorTime = placed;
  scheduledUntil = Math.max(0, positionAt(now));
  emit({ anchor: { time: anchorTime, position: anchorPosition, epoch: anchorEpoch } });
  schedule();
}

/** The last re-placings (ms, and when), for Sync details (issue #101). */
const corrections: { ms: number; at: number }[] = [];
function noteCorrection(seconds: number) {
  corrections.push({ ms: Math.round(seconds * 10000) / 10, at: Date.now() });
  if (corrections.length > 10) corrections.shift();
}

/** What the metronome's clock knows of itself, for Sync details (issue #101). */
export function metronomeClockReport() {
  return { clock: clock?.report() ?? null, corrections: [...corrections], anchor: state.anchor, playing: state.playing, following: state.following };
}

/** How long a start waits: longer while leading Sync play, so the followers hear the first beat too. */
export function setMetronomeStartDelay(seconds: number) {
  startDelay = seconds;
}

/** The leader's timeline (issue #13): the settings they share, and beat `anchorPosition` heard at `anchorEpoch` on this device's clock. */
export interface FollowedTimeline {
  settings: Omit<MetronomeSettings, "sound" | "volume">;
  playing: boolean;
  anchorEpoch: number;
  anchorPosition: number;
}

let followed: { timeline: FollowedTimeline | null; leader: string } | null = null;
/** The session's timeline a new leader picked up, to place again once the browser lets it make sound. */
let adopted: FollowedTimeline | null = null;

/**
 * Plays the leader's timeline from where it is now (clicks already due are
 * dropped, what's ahead rescheduled), with this device's own sound and
 * volume; called again whenever it or the clocks' offset changes. Null: the
 * leader's metronome is stopped.
 */
export function followMetronome(timeline: FollowedTimeline | null, leader: string, attempt = 0) {
  load();
  followed = { timeline, leader };
  const own = state.settings;
  const settings = timeline ? normalizeMetronome({ ...timeline.settings, sound: own.sound, volume: own.volume }) : own;
  if (!timeline?.playing) {
    halt();
    return emit({ settings, following: leader, songId: null });
  }
  const ctx = audio();
  output!.gain.value = settings.volume;
  const placed = audioTimeFromEpoch(timeline.anchorEpoch);
  // The same timeline, already placed within a few milliseconds: left as it is (the output's timestamp wavers a little).
  if (
    state.playing &&
    state.following === leader &&
    anchorEpoch === timeline.anchorEpoch &&
    anchorPosition === timeline.anchorPosition &&
    JSON.stringify(state.settings) === JSON.stringify(settings) &&
    Math.abs(placed - anchorTime) < REPLACE_BEYOND
  ) {
    return;
  }
  const now = ctx.currentTime;
  cancelFrom(now);
  // The same timeline placed again: how far it had drifted.
  if (state.playing && anchorEpoch === timeline.anchorEpoch && anchorPosition === timeline.anchorPosition) noteCorrection(placed - anchorTime);
  state = { ...state, settings };
  anchorTime = placed;
  anchorEpoch = timeline.anchorEpoch;
  anchorPosition = timeline.anchorPosition;
  scheduledUntil = Math.max(0, positionAt(now));
  emit({ playing: true, following: leader, songId: null, audioBlocked: ctx.state !== "running", anchor: { time: anchorTime, position: anchorPosition, epoch: anchorEpoch } });
  timer ??= setInterval(schedule, TICK_MS);
  schedule();
  // Just started (a new audio clock only runs a moment later), it doesn't say yet when its output is heard: placed again once it does.
  placing = timeline;
  if (!clock!.known && attempt < 40) {
    setTimeout(() => {
      // Still this timeline (followed, or picked up as this device's own), and still playing it.
      if (placing !== timeline || !state.playing) return;
      const own = !state.following;
      followMetronome(timeline, own ? "" : state.following!, attempt + 1);
      if (own) emit({ following: null });
    }, 250);
  }
}

/** The timeline last placed from the device's clock, until the clock can say when its output is heard. */
let placing: FollowedTimeline | null = null;

/** Stops following: the metronome stops, and is this device's own again. */
export function unfollowMetronome() {
  if (!state.following) return;
  followed = null;
  halt();
  let own = state.settings;
  try {
    own = normalizeMetronome(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<MetronomeSettings>);
  } catch {
    // Storage blocked: as it was.
  }
  emit({ following: null, audioBlocked: false, settings: own });
}

/** The metronome as it is now, outside React. */
export function getMetronomeState(): MetronomeState {
  load();
  return state;
}

/**
 * Taking over Sync play's lead (issue #13): what was followed carries on
 * as this device's own, without a gap; or, stopped here, the session's
 * timeline is picked up where it is.
 */
export function takeOverMetronome(timeline: FollowedTimeline | null) {
  adopted = null;
  if (!state.following && !state.playing && timeline?.playing) {
    followMetronome(timeline, "");
    adopted = timeline;
  }
  followed = null;
  if (state.following !== null) emit({ following: null });
}

/**
 * This device's own metronome on a given timeline (the recording's beat,
 * issue #100): placed on the audio clock from its anchor on the device's
 * clock, as a leader's is followed - but its own, so it's shared when
 * leading. Not while following a leader.
 */
export function playMetronomeOn(timeline: FollowedTimeline) {
  load();
  if (state.following) return;
  const same =
    state.playing &&
    anchorEpoch === timeline.anchorEpoch &&
    anchorPosition === timeline.anchorPosition &&
    JSON.stringify(sharedMetronomeSettings(state.settings)) === JSON.stringify(sharedMetronomeSettings({ ...state.settings, ...timeline.settings }));
  if (same) return;
  followMetronome(timeline, "");
  followed = null;
  adopted = timeline;
  emit({ following: null, songId: null });
}

/** From a press: lets the browser make sound, then catches up with the leader. */
export function unlockMetronomeAudio() {
  const ctx = audio();
  void ctx.resume().then(() => {
    if (followed) followMetronome(followed.timeline, followed.leader);
    else if (adopted && state.playing) {
      // Placed while the audio clock was stopped: again, now it runs.
      followMetronome(adopted, "");
      emit({ following: null });
    }
    if (state.audioBlocked) emit({ audioBlocked: false });
  });
}

/** The latest settings and whether it plays. */
export function useMetronome(): MetronomeState {
  return useSyncExternalStore(
    (listener) => {
      load();
      listeners.add(listener);
      // Loaded after the first render: show the stored settings.
      listener();
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

export interface MetronomeBeat {
  /** Negative during the count-in. */
  bar: number;
  beat: number;
  /** Counts beats, to restart a flash on each. */
  count: number;
  countIn: boolean;
}

/** Where the beat is now, as heard (the output's delay allowed for), updated on each beat; null when it's stopped. */
export function useMetronomeBeat(): MetronomeBeat | null {
  const { playing, settings } = useMetronome();
  const [current, setCurrent] = useState<MetronomeBeat | null>(null);
  useEffect(() => {
    if (!playing || !context) {
      setCurrent(null);
      return;
    }
    const ctx = context;
    let last = -1;
    let frame = requestAnimationFrame(function step() {
      const heard = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
      const position = positionAt(heard);
      if (position >= 0) {
        const whole = Math.floor(position);
        if (whole !== last) {
          last = whole;
          const { bar, beat } = beatAt(settings, whole);
          setCurrent({ bar, beat, count: whole, countIn: bar < 0 });
        }
      }
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, settings]);
  return current;
}
