import { decodeAudio } from "#/lib/decode-audio";
import { multitracksOf, speedCorrection, STEM_PARTS, stemSpeed, TIME_SIGNATURE_PATTERN, transposesPart, type Attachment, type CueSection, type StemPart, type BeatMap } from "@oneverse/core";
import { useSyncExternalStore } from "react";
import { deviceNow, OutputClock } from "#/lib/output-clock";

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

/** A file the player plays: a stem (with its part), or a whole recording (null) when a song has no stems. */
export type StemFile = Attachment & { stemPart: StemPart | null };

/** A song's stems as a page offers them to the player. */
export interface StemSong {
  songVersionId: string;
  title: string;
  /** The page to come back to: the song's, or its page in a set. */
  returnTo: string;
  stems: StemFile[];
  /** The file's bytes; `onProgress` hears them arrive, when the source can tell. */
  load: (file: Attachment, onProgress?: (received: number, total: number | null) => void) => Promise<Blob>;
  /** The song's tempo and time signature, for the metronome with the recording (issue #100); its recording's own tempo comes first. */
  tempo?: number | null;
  timeSignature?: { numerator: number; denominator: number } | null;
  /** Which of the song's multitracks `stems` are (issue #123): null its original stems. */
  multitrackId?: string | null;
  /** The song's multitracks, for the player to offer the others. */
  multitracks?: MultitrackChoice[];
  /** Its whole recording (issue #182), offered with them; `multitrackId` is RECORDING_CHOICE while it's what plays. */
  recording?: { name: string } | null;
  /** Playing the whole recording: the multitrack to switch to (null: the original stems); undefined when there's none. */
  upgrade?: string | null;
  /** Where the choice of multitrack is remembered: the song, or the song in a set (issue #127). */
  choiceKey?: string;
  /** Transposed by this many semitones as it plays (issue #129); `transposeParts` says, by file, which parts are (#135) - else all but the drums and cues. */
  transpose?: number;
  transposeParts?: Record<string, boolean>;
  /** Played this much slower or faster, in its key (issue #139); 1 as recorded. */
  speed?: number;
  /** The song's own key: what the stems are in when they don't say (for the key they're transposed to). */
  songKey?: string | null;
  /** The key the page plays the song in (a set's): with nothing chosen, the stems are transposed to it. */
  targetKey?: string | null;
  /** The song's sections and the order they're sung in (issue #110): what cue points name and place. */
  cueSections?: { sections: CueSection[]; flow: string[] };
  /** Recording a part from the player (issue #127): what the recorder needs; left out where it can't (offline). */
  record?: {
    attachments: Attachment[];
    songKey?: string;
    setlist?: { id: string; name: string } | null;
    onSaved: () => void;
  };
}

/** A multitrack as the player lists it. */
export interface MultitrackChoice {
  id: string | null;
  name: string | null;
  parts: number;
  /** The set it was recorded for (issue #127). */
  setlistId: string | null;
}

export interface StemTrack {
  id: string;
  /** Null: a whole recording, played when the song has no stems. */
  part: StemPart | null;
  /** Its own name for the part (issue #131), shown instead of the part's. */
  partName: string | null;
  /** Who recorded it, when it isn't the viewer (issue #131). */
  by: string | null;
  /** Who recorded it, the viewer too - on a multitrack's layer, or when the parts come from more than one person (issue #142): their avatar on its button. */
  recorder?: { name: string; avatarUrl: string | null } | null;
  /** The viewer uploaded or recorded it. */
  mine?: boolean;
  /** Kept as uploaded (issue #145): no actions, no one's badge. */
  locked?: boolean;
  /** The viewer can record into it, merge it or delete it (issue #142). */
  canChange?: boolean;
  filename: string;
  /** 1, 2… when two files are the same part ("Guitar 1"), else 0. */
  number: number;
  /** The waveform, 0-1 per slice; null until decoded. */
  peaks: number[] | null;
  /** Its length (s), once decoded: a take shorter than the rest draws as long as it is. */
  length: number;
  /** Recorded this many semitones above the multitrack (issue #135). */
  offset: number;
  /** The take just recorded in the player (issue #134), not kept yet. */
  take?: boolean;
  failed: boolean;
  /** Failed because the file has nothing in it (a take where the microphone gave nothing). */
  empty?: boolean;
}

export interface StemState {
  /** What's loaded: which song, and which files (a part reassigned is another set of stems). */
  key: string | null;
  songVersionId: string | null;
  /** Which of its multitracks is loaded (issue #123); null its original stems. */
  multitrackId: string | null;
  title: string;
  returnTo: string;
  status: "idle" | "loading" | "ready" | "error";
  /** How much of the stems has downloaded, 0-1, while loading. */
  downloaded: number;
  tracks: StemTrack[];
  playing: boolean;
  position: number;
  duration: number;
  muted: ReadonlySet<string>;
  soloed: ReadonlySet<string>;
  /** Each part's volume (issue #140), 0-1, by file; 1 when not set. */
  volumes: Readonly<Record<string, number>>;
  /** The song whose dock is on screen, if any: elsewhere a playing song gets the floating button. */
  docked: string | null;
  /** Playing: recording position `position` (s) heard at `epoch` on the device's clock (ms) - what Sync play shares (issue #100). */
  anchor: { epoch: number; position: number } | null;
  /** Following Sync play's leader: their name; play, pause and seek are theirs. */
  following: string | null;
  /** Following, but the browser hasn't let it make a sound yet: a press will (unlockStemsAudio). */
  audioBlocked: boolean;
  /** Transposed by this many semitones (issue #129); by file, which parts are, when not as their part says (#135). */
  transpose: number;
  transposeParts: Record<string, boolean>;
  /** Transposing couldn't start here (no AudioWorklet, say): it plays as recorded. */
  transposeFailed: boolean;
  /**
   * Played this much slower or faster (issue #139), in its key: 1 as
   * recorded. Positions and durations stay the recording's time; the audio
   * clock runs `speed` times slower or faster through it.
   */
  speed: number;
  /**
   * The recording's beat: its tempo, time signature and where its first
   * beat falls (s), for the metronome with it; `freeIntro` when what comes
   * before is played freely (issue #178); `map`, its own beats and bars when
   * they were found (issue #299). Null without a tempo.
   */
  beat: { tempo: number; timeSignature: { numerator: number; denominator: number } | null; firstBeat: number; freeIntro: boolean; map: BeatMap | null } | null;
  /** Played over and over (issue #162): from `start` to `end` (s, the recording's time); null: through to the end. */
  loop: { start: number; end: number } | null;
}

const PEAK_SLICES = 400;

const EMPTY: StemState = {
  key: null,
  songVersionId: null,
  multitrackId: null,
  title: "",
  returnTo: "",
  status: "idle",
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

/** A song's stems in the player's order: by part, then by name - all of them, whatever multitrack. */
export function stemsOf(attachments: Attachment[]): (Attachment & { stemPart: StemPart })[] {
  return attachments
    .filter((file): file is Attachment & { stemPart: StemPart } => file.type === "AUDIO" && file.stemPart !== null)
    .sort((a, b) => STEM_PARTS.indexOf(a.stemPart) - STEM_PARTS.indexOf(b.stemPart) || a.filename.localeCompare(b.filename));
}

/** The choice of the song's whole recording (issue #182), rather than one of its multitracks: kept, and shared in Sync play, as a multitrack's id is. */
export const RECORDING_CHOICE = "recording";

/** A song's whole recording (issue #66): its latest audio file that's neither a stem nor part of a multitrack; null when it has none. */
export function wholeRecordingOf(attachments: Attachment[]): Attachment | null {
  const [latest] = attachments.filter((file) => file.type === "AUDIO" && file.stemPart === null && !file.multitrackId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return latest ?? null;
}

/**
 * What the player plays for a song (issues #66, #123, #182): the
 * multitrack asked for (or its whole recording, RECORDING_CHOICE); with
 * nothing asked for, its whole recording when it has one - one file, quick
 * to load - else its first multitrack (its original stems when it has
 * them); or nothing. `strict`: only what was asked for (Sync play follows
 * the leader's, not another).
 */
export function playableOf(attachments: Attachment[], multitrackId?: string | null, strict = false): StemFile[] {
  // One with only other takes has nothing to play.
  const multitracks = multitracksOf(attachments).filter((multitrack) => multitrack.files.length > 0);
  const recording = wholeRecordingOf(attachments);
  if (multitrackId === RECORDING_CHOICE && recording) return [recording];
  if (multitrackId === undefined && recording) return [recording];
  const chosen = multitrackId === undefined ? undefined : multitracks.find((multitrack) => multitrack.id === multitrackId);
  if (chosen) return chosen.files;
  if (strict && multitrackId) return [];
  if (multitracks[0]) return multitracks[0].files;
  return recording ? [recording] : [];
}

/** A song's files for the player: the chosen multitrack's (see chooseMultitrack), and the others to offer. */
export function stemFilesOf(
  attachments: Attachment[],
  multitrackId: string | null | undefined,
  /** On a set's song page (issue #127): with nothing chosen, the multitrack recorded for that set. */
  setlistId?: string,
): Pick<StemSong, "stems" | "multitrackId" | "multitracks" | "recording" | "upgrade"> {
  const multitracks = multitracksOf(attachments)
    .filter((multitrack) => multitrack.files.length > 0)
    .map((multitrack) => ({ id: multitrack.id, name: multitrack.name, parts: multitrack.files.length, setlistId: multitrack.setlistId }));
  // On a set's page, the multitrack recorded for that set rather than the song's first.
  const forSet = setlistId ? multitracks.find((multitrack) => multitrack.setlistId === setlistId) : undefined;
  const recording = wholeRecordingOf(attachments);
  // Nothing chosen and no whole recording: the set's multitrack, if it has one.
  const stems = playableOf(attachments, multitrackId === undefined && !recording && forSet ? forSet.id : multitrackId);
  const playingRecording = !!recording && stems.length === 1 && stems[0]?.id === recording.id;
  return {
    stems,
    multitrackId: playingRecording ? RECORDING_CHOICE : (stems[0]?.multitrackId ?? null),
    multitracks,
    recording: recording ? { name: recording.filename } : null,
    // Playing the recording (issue #182): the multitrack a press switches to - the set's, else the first.
    upgrade: playingRecording && multitracks.length > 0 ? (forSet ?? multitracks[0]!).id : undefined,
  };
}

// --- how far each song's stems are transposed (issue #129), remembered on the device

const TRANSPOSE_KEY = "songverse.stems.transpose.";

/** A song's transposition (issues #129, #135): how far, and by file which parts, when not as their part says. */
export interface StemTranspose {
  steps: number;
  parts: Record<string, boolean>;
}
const transposes = new Map<string, StemTranspose | undefined>();
const transposeListeners = new Set<() => void>();

function transposeOf(key: string): StemTranspose | undefined {
  if (transposes.has(key)) return transposes.get(key);
  let saved: StemTranspose | undefined;
  try {
    const raw = localStorage.getItem(TRANSPOSE_KEY + key);
    const parsed = raw ? (JSON.parse(raw) as { steps?: unknown; parts?: unknown }) : null;
    if (parsed && typeof parsed.steps === "number") {
      const parts = parsed.parts && typeof parsed.parts === "object" ? Object.entries(parsed.parts).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean") : [];
      saved = { steps: parsed.steps, parts: Object.fromEntries(parts) };
    }
  } catch {
    // Storage blocked, or not ours.
  }
  transposes.set(key, saved);
  return saved;
}

/** Transposes the song's stems (`key`: the song, or the song in a set) from now on; undefined goes back to the default. */
export function chooseStemTranspose(key: string, value: StemTranspose | undefined) {
  transposes.set(key, value);
  try {
    if (value) localStorage.setItem(TRANSPOSE_KEY + key, JSON.stringify(value));
    else localStorage.removeItem(TRANSPOSE_KEY + key);
  } catch {
    // Remembered until the page reloads.
  }
  for (const listener of transposeListeners) listener();
}

/** The transposition chosen for the song; undefined when none was (the default then). */
export function useChosenTranspose(key: string): StemTranspose | undefined {
  return useSyncExternalStore(
    (listener) => {
      transposeListeners.add(listener);
      return () => transposeListeners.delete(listener);
    },
    () => transposeOf(key),
    () => undefined,
  );
}

// --- how fast each song's stems play (issue #139), remembered on the device like the transposition

const SPEED_KEY = "songverse.stems.speed.";
const speeds = new Map<string, number>();
const speedListeners = new Set<() => void>();

function speedOf(key: string): number {
  const known = speeds.get(key);
  if (known !== undefined) return known;
  let saved = 1;
  try {
    const raw = localStorage.getItem(SPEED_KEY + key);
    if (raw) saved = stemSpeed(Number(raw));
  } catch {
    // Storage blocked.
  }
  speeds.set(key, saved);
  return saved;
}

/** Plays the song's stems (`key`: the song, or the song in a set) this much slower or faster from now on; 1 as recorded. */
export function chooseStemSpeed(key: string, rate: number) {
  const speed = stemSpeed(rate);
  speeds.set(key, speed);
  try {
    if (speed === 1) localStorage.removeItem(SPEED_KEY + key);
    else localStorage.setItem(SPEED_KEY + key, String(speed));
  } catch {
    // Remembered until the page reloads.
  }
  for (const listener of speedListeners) listener();
}

/** The speed chosen for the song: 1 when none was. */
export function useChosenSpeed(key: string): number {
  return useSyncExternalStore(
    (listener) => {
      speedListeners.add(listener);
      return () => speedListeners.delete(listener);
    },
    () => speedOf(key),
    () => 1,
  );
}

// --- which multitrack each song plays (issue #123), remembered on the device

const CHOICE_KEY = "songverse.stems.multitrack.";
const choices = new Map<string, string | null>();
const choiceListeners = new Set<() => void>();

function choiceOf(songVersionId: string): string | null | undefined {
  if (choices.has(songVersionId)) return choices.get(songVersionId);
  try {
    const saved = localStorage.getItem(CHOICE_KEY + songVersionId);
    if (saved !== null) return saved === "" ? null : saved;
  } catch {
    // Storage blocked.
  }
  return undefined;
}

/** Plays that multitrack of the song from now on (null: its original stems). */
export function chooseMultitrack(songVersionId: string, multitrackId: string | null) {
  choices.set(songVersionId, multitrackId);
  try {
    localStorage.setItem(CHOICE_KEY + songVersionId, multitrackId ?? "");
  } catch {
    // Remembered until the page reloads.
  }
  for (const listener of choiceListeners) listener();
}

/** The multitrack chosen for the song; undefined when none was (its first then). */
export function useChosenMultitrack(songVersionId: string): string | null | undefined {
  return useSyncExternalStore(
    (listener) => {
      choiceListeners.add(listener);
      return () => choiceListeners.delete(listener);
    },
    () => choiceOf(songVersionId),
    () => undefined,
  );
}

export function stemKey(song: Pick<StemSong, "songVersionId" | "stems">): string {
  return `${song.songVersionId}|${song.stems.map((stem) => `${stem.id}:${stem.stemPart}`).join()}`;
}

/** Tracks as listed before anything is decoded. */
export function tracksOf(stems: StemFile[]): StemTrack[] {
  // Who recorded the parts, the locked stems (issue #145) aside: theirs is the song's.
  const uploaders = new Set(stems.filter((stem) => !stem.locked).map((stem) => stem.uploadedBy?.id ?? null));
  return stems.map((stem) => {
    // Two of a part are numbered ("Guitar 1"), unless they're named.
    const same = stems.filter((other) => other.stemPart === stem.stemPart && !other.partName);
    return {
      id: stem.id,
      part: stem.stemPart,
      partName: stem.partName || null,
      by: stem.mine === false ? (stem.uploadedBy?.displayName ?? null) : null,
      recorder: stem.uploadedBy && !stem.locked && (stem.multitrackId || uploaders.size > 1) ? { name: stem.uploadedBy.displayName, avatarUrl: stem.uploadedBy.avatarUrl ?? null } : null,
      mine: stem.mine,
      locked: !!stem.locked,
      canChange: stem.canChange,
      filename: stem.filename,
      number: !stem.partName && same.length > 1 ? same.indexOf(stem) + 1 : 0,
      peaks: null,
      length: 0,
      offset: stem.pitchOffset ?? 0,
      failed: false,
    };
  });
}

export function isAudible(current: Pick<StemState, "muted" | "soloed">, id: string): boolean {
  return current.soloed.size > 0 ? current.soloed.has(id) : !current.muted.has(id);
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
  if (media.metadata?.title !== state.title) media.metadata = new MediaMetadata({ title: state.title, artist: "Songverse" });
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
    if (all) set({ downloaded: Math.min(1, [...received.values()].reduce((sum, size) => sum + size, 0) / all) });
  };
  const decoded = await Promise.all(
    song.stems.map(async (stem) => {
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
      return { stem, buffer, empty };
    }),
  );
  if (mine !== generation) return false;
  for (const { stem, buffer } of decoded) {
    if (!buffer) continue;
    const gain = ctx.createGain();
    tracksInfo.set(stem.id, { part: stem.stemPart, offset: stem.pitchOffset ?? 0 });
    gain.connect(plain);
    buffers.set(stem.id, buffer);
    gains.set(stem.id, gain);
  }
  const peaks = new Map(decoded.map(({ stem, buffer }) => [stem.id, buffer ? peaksOf(buffer) : null]));
  const lengths = new Map(decoded.map(({ stem, buffer }) => [stem.id, buffer?.duration ?? 0]));
  const empties = new Set(decoded.filter((item) => item.empty && !item.buffer).map((item) => item.stem.id));
  const tracks = state.tracks.map((track) => ({ ...track, peaks: peaks.get(track.id) ?? null, length: lengths.get(track.id) ?? 0, failed: !peaks.get(track.id), empty: empties.has(track.id) }));
  if (buffers.size === 0) {
    set({ status: "error", tracks });
    return false;
  }
  await route();
  if (mine !== generation) return false;
  set({ status: "ready", tracks, duration: Math.max(...[...buffers.values()].map((buffer) => buffer.duration)) });
  return true;
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

/** Whether a part is moved when transposing (issue #135): as chosen for it, else as its part says. */
export function isTransposed(current: Pick<StemState, "transposeParts">, track: Pick<StemTrack, "id" | "part">): boolean {
  return current.transposeParts[track.id] ?? transposesPart(track.part);
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

/** Other players (YouTube, #66) paused when the stems start: one thing plays at a time. */
export const otherPlayers = new Set<() => void>();

/** Plays `song`, loading it first (and stopping another one) if it isn't what's loaded. */
export async function playStems(song: StemSong) {
  // Following Sync play's leader: theirs to start; a press only lets the browser make sound.
  if (state.following) return unlockStemsAudio();
  lastSong = song;
  for (const pause of otherPlayers) pause();
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
  startAt(offset);
  set({ playing: true, returnTo: song.returnTo, title: song.title });
  // Only now playing: the loop, if there is one, from here.
  armLoop();
  setMediaActions();
  updateMediaSession();
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

/** A fader's position (0-1) as a gain: squared, so its travel sounds even (half way is about -12 dB). */
export function volumeGain(volume: number): number {
  return Math.max(0, Math.min(1, volume)) ** 2;
}

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

/** The recording's beat, from its first file (the stems share it) and the song. */
export function beatOf(song: Pick<StemSong, "stems" | "tempo" | "timeSignature">): StemState["beat"] {
  const first = song.stems[0];
  const tempo = first?.recordingTempo ?? song.tempo ?? null;
  if (!tempo) return null;
  return {
    tempo,
    timeSignature: timeSignatureOf(first?.recordingTimeSignature) ?? song.timeSignature ?? null,
    firstBeat: first?.recordingFirstBeat ?? 0,
    freeIntro: song.stems.some((stem) => stem.recordingFreeIntro),
    map: (first?.recordingBeats?.length ?? 0) >= 2 && first?.recordingDownbeats?.length ? { beats: first.recordingBeats!, downbeats: first.recordingDownbeats } : null,
  };
}

/** "6/8" as numbers; null when there's none or it doesn't read. */
export function timeSignatureOf(text: string | null | undefined): { numerator: number; denominator: number } | null {
  const match = text ? TIME_SIGNATURE_PATTERN.exec(text) : null;
  return match ? { numerator: Number(match[1]), denominator: Number(match[2]) } : null;
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

// --- recording in the player (issue #134)

/** The take just recorded, as a track, until it's kept or dropped. */
export const TAKE_ID = "__take";

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
      { id: TAKE_ID, part: take.part, partName: take.name, by: null, filename: take.name, number: 0, peaks: peaksOf(buffer), length: buffer.duration, offset: take.offset, failed: false, take: true },
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
