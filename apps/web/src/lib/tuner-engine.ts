import { DEFAULT_A4, MAX_A4, MIN_A4, nearestNote, TEMPERAMENTS, TUNER_DETECTORS, TUNER_SENSITIVITIES, TUNER_SENSITIVITY_GATES, TunerSession, type Temperament, type TunerDetector, type TunerSensitivity } from "@oneverse/core";
import { useSyncExternalStore } from "react";

/**
 * The tuner (issue #3): the microphone, raw (no echo cancellation, noise
 * suppression or gain control, which all bend the waveform), read every
 * animation frame by the core's detectors. The displays draw from `onTunerFrame`
 * at the screen's rate; the readout follows the store a few times a second.
 */

export const TUNER_DISPLAYS = ["strobe", "wheel", "needle", "spectrum"] as const;
export type TunerDisplay = (typeof TUNER_DISPLAYS)[number];

export interface TunerSettings {
  a4: number;
  detector: TunerDetector;
  sensitivity: TunerSensitivity;
  instrument: string;
  tuning: string | null;
  display: TunerDisplay;
  /** The strobe's bands: octaves (×1 ×2 ×4 ×8) or harmonics (F to 5F). */
  bands: "octave" | "harmonic";
  /** Cents shown to a tenth, or whole. */
  precision: "tenth" | "whole";
  temperament: Temperament;
  /** The key the temperament is tuned from: 0 (C) to 11. */
  tonic: number;
}

export const DEFAULT_TUNER_SETTINGS: TunerSettings = {
  a4: DEFAULT_A4,
  detector: "mpm",
  sensitivity: "normal",
  instrument: "chromatic",
  tuning: null,
  display: "strobe",
  bands: "octave",
  precision: "tenth",
  temperament: "equal",
  tonic: 0,
};

export type TunerStatus = "idle" | "starting" | "listening" | "paused" | "denied" | "no-microphone" | "unsupported" | "disconnected" | "failed";

export interface TunerReading {
  hz: number;
  midi: number;
  cents: number;
  /** A fresh reading (not one held while the note fades). */
  live: boolean;
  confidence: number;
}

export interface TunerState {
  status: TunerStatus;
  settings: TunerSettings;
  reading: TunerReading | null;
}

/** One frame for the displays: the reading (or null) and the seconds since the last frame. */
export interface TunerFrame {
  reading: TunerReading | null;
  dt: number;
}

/** Within this many cents is in tune. */
export const IN_TUNE_CENTS = 2;

const SETTINGS_KEY = "songverse.tuner";
/** Frames of silence (about a second) before a held note is let go. */
const SILENCE_FRAMES = 60;
/** The frame the detectors read: the newest 4096 samples. */
const FRAME = 4096;
/** The readout's pace: the displays move every frame, the numbers a few times a second. */
const READOUT_MS = 100;

let state: TunerState = { status: "idle", settings: loadSettings(), reading: null };
const listeners = new Set<() => void>();
const frameListeners = new Set<(frame: TunerFrame) => void>();

let context: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let stream: MediaStream | null = null;
let raf = 0;
let buffer: Float32Array<ArrayBuffer> | null = null;
let session = new TunerSession(state.settings.detector);
let silent = 0;
let lastFrame = 0;
let lastReadout = 0;

function set(change: Partial<TunerState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

export function useTuner(): TunerState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

/** Every frame's reading, for the displays. */
export function onTunerFrame(listener: (frame: TunerFrame) => void): () => void {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

/** The microphone's analyser, for the spectrum. */
export function tunerAnalyser(): AnalyserNode | null {
  return analyser;
}

export function updateTunerSettings(change: Partial<TunerSettings>) {
  const settings = normalize({ ...state.settings, ...change });
  if (settings.detector !== state.settings.detector) session = new TunerSession(settings.detector);
  // Another reference: the held note's cents no longer mean anything.
  if (settings.a4 !== state.settings.a4 || settings.temperament !== state.settings.temperament || settings.tonic !== state.settings.tonic) session.release();
  set({ settings });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Kept for this visit only.
  }
}

function loadSettings(): TunerSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<TunerSettings> | null;
    return normalize({ ...DEFAULT_TUNER_SETTINGS, ...saved });
  } catch {
    return DEFAULT_TUNER_SETTINGS;
  }
}

function normalize(settings: TunerSettings): TunerSettings {
  const pick = <T,>(value: T, allowed: readonly T[], fallback: T) => (allowed.includes(value) ? value : fallback);
  return {
    a4: Number.isFinite(settings.a4) ? Math.min(MAX_A4, Math.max(MIN_A4, Math.round(settings.a4 * 10) / 10)) : DEFAULT_A4,
    detector: pick(settings.detector, TUNER_DETECTORS, "mpm"),
    sensitivity: pick(settings.sensitivity, TUNER_SENSITIVITIES, "normal"),
    instrument: typeof settings.instrument === "string" ? settings.instrument : "chromatic",
    tuning: typeof settings.tuning === "string" ? settings.tuning : null,
    display: pick(settings.display, TUNER_DISPLAYS, "strobe"),
    bands: pick(settings.bands, ["octave", "harmonic"] as const, "octave"),
    precision: pick(settings.precision, ["tenth", "whole"] as const, "tenth"),
    temperament: pick(settings.temperament, TEMPERAMENTS, "equal"),
    tonic: Number.isInteger(settings.tonic) && settings.tonic >= 0 && settings.tonic < 12 ? settings.tonic : 0,
  };
}

/** Starts listening: from a tap, which is when iOS lets the audio start. */
export async function startTuner() {
  if (state.status === "paused") return resumeTuner();
  if (state.status === "listening" || state.status === "starting") return;
  if (!navigator.mediaDevices?.getUserMedia) return set({ status: "unsupported" });
  set({ status: "starting", reading: null });
  // Made inside the tap; resumed after the permission prompt.
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const ctx = new Context();
  context = ctx;
  try {
    // Safari: record, rather than play, so the microphone isn't muted by the ringer switch.
    const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (audioSession) audioSession.type = "play-and-record";
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (error) {
      // Only a device that can't meet those gets a second try with none; a refusal stays one.
      if ((error as Error).name !== "OverconstrainedError" && (error as Error).name !== "TypeError") throw error;
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (context !== ctx) return stopStream();
    await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    buffer = new Float32Array(analyser.fftSize);
    session = new TunerSession(state.settings.detector);
    silent = 0;
    lastFrame = performance.now();
    // A call, Siri or the lock screen suspends it (iOS); it resumes only from a tap.
    ctx.onstatechange = () => {
      if (context !== ctx || ctx.state === "closed") return;
      if (ctx.state === "running") return set({ status: "listening" });
      set({ status: "paused" });
    };
    // Unplugged, or taken by another app.
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (context !== ctx) return;
        stopTuner();
        set({ status: "disconnected" });
      };
    }
    set({ status: "listening" });
    raf = requestAnimationFrame(frame);
  } catch (error) {
    if (context === ctx) stopTuner();
    const name = (error as Error).name;
    set({ status: name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "no-microphone" : "failed" });
  }
}

/** After a pause (iOS): from a tap. */
export function resumeTuner() {
  void context?.resume();
}

export function stopTuner() {
  cancelAnimationFrame(raf);
  stopStream();
  const ctx = context;
  context = null;
  analyser = null;
  buffer = null;
  if (ctx) void ctx.close().catch(() => {});
  session.release();
  set({ status: "idle", reading: null });
  publish(null, 0);
}

function stopStream() {
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
}

function frame(now: number) {
  if (!analyser || !buffer || !context) return;
  const dt = Math.min(now - lastFrame, 50) / 1000;
  lastFrame = now;
  analyser.getFloatTimeDomainData(buffer);
  // The newest samples: the buffer runs oldest to newest.
  const samples = buffer.subarray(buffer.length - FRAME);
  const { settings } = state;
  const gate = TUNER_SENSITIVITY_GATES[settings.sensitivity];
  let level = 0;
  for (let i = 0; i < samples.length; i++) level += samples[i]! * samples[i]!;
  level = Math.sqrt(level / samples.length);
  if (level < gate) {
    silent++;
    if (silent > SILENCE_FRAMES) {
      silent = 0;
      session.release();
    }
  } else silent = 0;
  const { hz, live, confidence } = session.push(samples, context.sampleRate, gate);
  let reading: TunerReading | null = null;
  if (hz) {
    const note = nearestNote(hz, { a4: settings.a4, temperament: settings.temperament, tonic: settings.tonic });
    reading = { hz, midi: note.midi, cents: note.cents, live, confidence };
  }
  publish(reading, dt);
  if (now - lastReadout >= READOUT_MS || (reading === null) !== (state.reading === null)) {
    lastReadout = now;
    set({ reading });
  }
  raf = requestAnimationFrame(frame);
}

function publish(reading: TunerReading | null, dt: number) {
  for (const listener of frameListeners) listener({ reading, dt });
  // For the end-to-end suites.
  (window as unknown as { songverseTuner?: TunerReading | null }).songverseTuner = reading;
}
