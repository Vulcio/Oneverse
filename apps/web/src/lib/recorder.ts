import { decodeAudio } from "#/lib/decode-audio";
import { alignTake, clapDelayFrom, clickTimes, roundTripFrom } from "@oneverse/core";
import { endStemsRecording } from "#/lib/stem-engine";

/**
 * Recording a part in the browser (issue #123). One AudioContext plays
 * the click and the multitrack's other parts and captures the microphone
 * (an AudioWorklet stamps each block of samples with its frame on the
 * context's clock), so a take lines up with what was heard once the
 * device's round trip is taken off: from a sound being scheduled, through
 * the speakers or headphones, the player, the microphone, to its capture.
 * That delay is the browser's own estimate, or one measured here
 * (`calibrate`), kept per device. Everything that must sound in time is
 * on this one context, so no other clock is involved (output-clock.ts
 * pairs a context with the device's clock, which Sync play needs and a
 * recording doesn't).
 */

const CAPTURE_WORKLET = `
class SongverseCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.buffer = new Float32Array(4096);
    this.filled = 0;
    this.start = 0;
    this.port.onmessage = (event) => {
      if (!event.data && this.filled) this.flush();
      this.on = event.data;
    };
  }
  flush() {
    this.port.postMessage({ frame: this.start, data: this.buffer.slice(0, this.filled) });
    this.filled = 0;
  }
  process(inputs) {
    if (!this.on) return true;
    const channel = inputs[0] && inputs[0][0];
    const size = channel ? channel.length : 128;
    if (this.filled === 0) this.start = currentFrame;
    if (channel) this.buffer.set(channel, this.filled);
    else this.buffer.fill(0, this.filled, this.filled + size);
    this.filled += size;
    if (this.filled + 128 > this.buffer.length) this.flush();
    return true;
  }
}
registerProcessor("songverse-capture", SongverseCapture);
`;

/** Safari's audio session (iOS 16.4+): "playback" plays on with the screen locked, but can't record. */
function setAudioSession(type: "playback" | "play-and-record") {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = type;
}

const ROUND_TRIP_KEY = "songverse.recorder.roundTrip";
/** Clicks are scheduled this far ahead, by a timer. */
const LOOKAHEAD = 0.4;

/** The round trip measured on this device (s), if it was. */
export function savedRoundTrip(): number | null {
  try {
    const saved = Number(localStorage.getItem(ROUND_TRIP_KEY));
    return saved > 0 && saved < 2 ? saved : null;
  } catch {
    return null;
  }
}

function saveRoundTrip(seconds: number | null) {
  try {
    if (seconds === null) localStorage.removeItem(ROUND_TRIP_KEY);
    else localStorage.setItem(ROUND_TRIP_KEY, String(seconds));
  } catch {
    // Kept for this recording only.
  }
}

export interface Beat {
  tempo: number;
  beatsPerBar: number;
  firstBeat: number;
}

export interface Take {
  /** From the multitrack's 0:00, the round trip taken off. */
  captured: Float32Array;
  capturedAt: number;
  zeroAt: number;
  sampleRate: number;
}

export class Recorder {
  readonly context: AudioContext;
  private readonly stream: MediaStream;
  private readonly capture: AudioWorkletNode;
  private chunks: { frame: number; data: Float32Array }[] = [];
  private backing = new Map<string, AudioBuffer>();
  private sources: AudioScheduledSourceNode[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private clickGain: GainNode;
  /** Hears each block captured (4096 samples or so), for a live waveform. */
  onChunk: ((data: Float32Array) => void) | null = null;
  /** Its context is its own (closed with it), not the stem player's. */
  private owned = true;
  private nodes: AudioNode[] = [];
  /** What the microphone hears, from the moment it's open (issue #141): its level before and while recording. */
  private meter: AnalyserNode | null = null;
  private meterData: Float32Array<ArrayBuffer> | null = null;

  private constructor(context: AudioContext, stream: MediaStream, capture: AudioWorkletNode) {
    this.context = context;
    this.stream = stream;
    this.capture = capture;
    this.clickGain = context.createGain();
    this.clickGain.gain.value = 0.6;
    this.clickGain.connect(context.destination);
    capture.port.onmessage = (event: MessageEvent<{ frame: number; data: Float32Array }>) => {
      this.chunks.push(event.data);
      this.onChunk?.(event.data.data);
    };
  }

  /**
   * Asks for the microphone (unprocessed: no echo cancelling, levelling or
   * noise removal, which would change the take and its timing), captured
   * on `existing` (the stem player's clock, issue #134) or a context of
   * its own. Call it from a tap: an iPhone's home screen app asks for the
   * microphone only then.
   */
  static async open(existing?: AudioContext): Promise<Recorder> {
    // iOS: the stem player's "playback" audio session can't record; this one can (put back on close).
    setAudioSession("play-and-record");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (error) {
      setAudioSession("playback");
      throw error;
    }
    const context = existing ?? new AudioContext({ latencyHint: "interactive" });
    try {
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" }));
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const capture = new AudioWorkletNode(context, "songverse-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
      const source = context.createMediaStreamSource(stream);
      source.connect(capture);
      // Connected to the output (silently), or some browsers don't run it.
      const silent = context.createGain();
      silent.gain.value = 0;
      capture.connect(silent).connect(context.destination);
      const meter = context.createAnalyser();
      meter.fftSize = 2048;
      source.connect(meter);
      const recorder = new Recorder(context, stream, capture);
      recorder.owned = !existing;
      recorder.nodes = [source, capture, silent, meter];
      recorder.meter = meter;
      recorder.meterData = new Float32Array(meter.fftSize);
      return recorder;
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      if (!existing) void context.close();
      setAudioSession("playback");
      throw error;
    }
  }

  /** The microphone's peak level just now (0-1, 1 is clipping), recording or not. */
  inputPeak(): number {
    if (!this.meter || !this.meterData) return 0;
    this.meter.getFloatTimeDomainData(this.meterData);
    let peak = 0;
    for (const value of this.meterData) peak = Math.max(peak, Math.abs(value));
    return Math.min(1, peak);
  }

  /** The round trip: measured on this device, else what the browser says of its output and input. */
  roundTrip(): { seconds: number; measured: boolean } {
    const saved = savedRoundTrip();
    if (saved !== null) return { seconds: saved, measured: true };
    const input = (this.stream.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined)?.latency ?? 0;
    return { seconds: (this.context.baseLatency || 0) + (this.context.outputLatency || 0) + input, measured: false };
  }

  /** The other parts to play along with, decoded. */
  async setBacking(files: { id: string; blob: Blob }[]) {
    this.backing = new Map();
    for (const { id, blob } of files) {
      try {
        this.backing.set(id, await decodeAudio(this.context, await blob.arrayBuffer()));
      } catch {
        // Not playable here: recorded without it.
      }
    }
  }

  get backingIds(): string[] {
    return [...this.backing.keys()];
  }

  private click(at: number, accent: boolean) {
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.frequency.value = accent ? 1600 : 1000;
    envelope.gain.setValueAtTime(1, at);
    envelope.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    oscillator.connect(envelope).connect(this.clickGain);
    oscillator.start(at);
    oscillator.stop(at + 0.05);
    this.sources.push(oscillator);
  }

  /**
   * Plays the parts heard (0:00 at `zeroAt`, from `from` s in), the take if
   * any, and the click, scheduled as it goes. A part in `stopAt` stops
   * there (the take a punch-in replaces, from where it's replaced).
   */
  private play(
    zeroAt: number,
    options: { beat: Beat | null; lead: number; from: number; click: boolean; heard: Set<string>; stopAt?: Map<string, number>; take?: { buffer: AudioBuffer; offset: number } },
  ) {
    const startAt = zeroAt + options.from;
    for (const [id, buffer] of this.backing) {
      if (!options.heard.has(id) || options.from >= buffer.duration) continue;
      const stop = options.stopAt?.get(id);
      if (stop !== undefined && stop <= options.from) continue;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);
      source.start(startAt, options.from);
      if (stop !== undefined) source.stop(zeroAt + stop);
      this.sources.push(source);
    }
    if (options.take) {
      // A positive offset: the take was late, so it's heard that far on.
      const offset = options.from + options.take.offset;
      const source = this.context.createBufferSource();
      source.buffer = options.take.buffer;
      source.connect(this.context.destination);
      if (offset >= 0) source.start(startAt, offset);
      else source.start(startAt - offset);
      this.sources.push(source);
    }
    const { beat } = options;
    if (!beat || !options.click) return;
    // The next click not yet scheduled is at `next` or after.
    let next = options.from - options.lead;
    const schedule = () => {
      const until = this.context.currentTime + LOOKAHEAD - zeroAt;
      if (until < next) return;
      for (const click of clickTimes({ ...beat, from: next, to: until })) this.click(zeroAt + click.at, click.accent);
      next = until + 1e-6;
    };
    schedule();
    this.timer = setInterval(schedule, 50);
  }

  /**
   * Starts a take: from `from` s into the multitrack (0 its start; later,
   * a punch-in), after `lead` s of count-in, the parts heard and the
   * click, capturing all along. Returns when the multitrack's 0:00 is (or
   * would have been), on the audio clock.
   */
  start(options: { beat: Beat | null; lead: number; from: number; click: boolean; heard: Set<string>; stopAt?: Map<string, number> }): number {
    this.stopPlaying();
    this.chunks = [];
    void this.context.resume();
    const zeroAt = this.context.currentTime + 0.2 + options.lead - options.from;
    this.capture.port.postMessage(true);
    this.play(zeroAt, options);
    return zeroAt;
  }

  /** A part's audio, mono, at this context's rate: what a punch-in keeps the start of. */
  monoOf(id: string): Float32Array | null {
    const buffer = this.backing.get(id);
    if (!buffer) return null;
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i]! += data[i]! / buffer.numberOfChannels;
    }
    return mono;
  }

  /** Starts capturing, with nothing of its own playing: the stem player plays (issue #134). */
  startCapture() {
    this.stopPlaying();
    this.chunks = [];
    this.capture.port.postMessage(true);
  }

  /** Ends the take; resolves with what was captured once the last block is in. */
  async finish(zeroAt: number): Promise<Take> {
    this.capture.port.postMessage(false);
    this.stopPlaying();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return this.collect(zeroAt);
  }

  private collect(zeroAt: number): Take {
    const chunks = [...this.chunks].sort((a, b) => a.frame - b.frame);
    this.chunks = [];
    const first = chunks[0]?.frame ?? 0;
    const last = chunks[chunks.length - 1];
    const captured = new Float32Array(last ? last.frame - first + last.data.length : 0);
    for (const chunk of chunks) captured.set(chunk.data, chunk.frame - first);
    return { captured, capturedAt: first / this.context.sampleRate, zeroAt, sampleRate: this.context.sampleRate };
  }

  /** How long a take has been going (s from its 0:00; negative in the count-in). */
  positionOf(zeroAt: number): number {
    return this.context.currentTime - zeroAt;
  }

  /** The take from 0:00 with the round trip (and a nudge, s) taken off. */
  aligned(take: Take, delay: number): Float32Array {
    return alignTake(take.captured, { sampleRate: take.sampleRate, capturedAt: take.capturedAt, zeroAt: take.zeroAt, delay });
  }

  /** Plays the take back with the parts heard and the click; `nudge` s later or earlier than it was aligned. */
  preview(aligned: Float32Array, options: { beat: Beat | null; click: boolean; heard: Set<string>; nudge: number; from?: number; stopAt?: Map<string, number> }): number {
    this.stopPlaying();
    void this.context.resume();
    const buffer = this.context.createBuffer(1, Math.max(1, aligned.length), this.context.sampleRate);
    buffer.copyToChannel(aligned as Float32Array<ArrayBuffer>, 0);
    const from = options.from ?? 0;
    const zeroAt = this.context.currentTime + 0.1 - from;
    this.play(zeroAt, { ...options, from, lead: 0, take: { buffer, offset: options.nudge } });
    return zeroAt;
  }

  stopPlaying() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Never started.
      }
    }
    this.sources = [];
  }

  /**
   * Measures the round trip: clicks through the speakers, heard back by
   * the microphone. Needs the speakers on (not headphones) and some
   * quiet. Kept on this device; null when the clicks weren't heard.
   */
  async calibrate(): Promise<number | null> {
    this.stopPlaying();
    await this.context.resume();
    this.chunks = [];
    this.capture.port.postMessage(true);
    const start = this.context.currentTime + 0.3;
    const playedAt = Array.from({ length: 6 }, (_, i) => start + i * 0.5);
    for (const at of playedAt) this.click(at, true);
    await new Promise((resolve) => setTimeout(resolve, (start - this.context.currentTime + 3.2) * 1000));
    this.capture.port.postMessage(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const take = this.collect(0);
    const measured = roundTripFrom(take.captured, { sampleRate: take.sampleRate, capturedAt: take.capturedAt, playedAt });
    if (measured !== null) saveRoundTrip(measured);
    return measured;
  }

  /**
   * Measures the delay by clapping along (issue #127), for headphones -
   * which the microphone can't hear, Bluetooth ones included: ten clicks
   * in the headphones, a clap on each; the first two are to get the feel,
   * the other eight are counted. Kept on this device; null when too few
   * claps were heard.
   */
  async calibrateByClapping(onClick?: (index: number) => void): Promise<number | null> {
    this.stopPlaying();
    await this.context.resume();
    this.chunks = [];
    this.capture.port.postMessage(true);
    const start = this.context.currentTime + 0.5;
    const playedAt = Array.from({ length: 10 }, (_, i) => start + i * 0.6);
    playedAt.forEach((at, i) => {
      this.click(at, i % 4 === 0);
      if (onClick) setTimeout(() => onClick(i), (at - this.context.currentTime) * 1000);
    });
    await new Promise((resolve) => setTimeout(resolve, (start - this.context.currentTime + 6.4) * 1000));
    this.capture.port.postMessage(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const take = this.collect(0);
    const measured = clapDelayFrom(take.captured, { sampleRate: take.sampleRate, capturedAt: take.capturedAt, playedAt: playedAt.slice(2) });
    if (measured !== null) saveRoundTrip(measured);
    return measured;
  }

  /** Whether the sound seems to go to Bluetooth headphones or speakers, whose delay is large and can change (issue #127). */
  async bluetoothOutput(): Promise<boolean> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((device) => device.kind === "audiooutput");
      // The default output first (Chrome names it "Default - …"); else, where there's only one.
      const current = outputs.find((device) => device.deviceId === "default") ?? (outputs.length === 1 ? outputs[0] : undefined);
      return !!current && /bluetooth|airpods|buds|beats|headset \(|hands-free|\bbt\b/i.test(current.label);
    } catch {
      return false;
    }
  }

  /** Forgets the measured round trip: the browser's estimate again. */
  forgetCalibration() {
    saveRoundTrip(null);
  }

  close() {
    this.stopPlaying();
    this.capture.port.postMessage(false);
    for (const track of this.stream.getTracks()) track.stop();
    // Its own context closed; the stem player's left playing, the recorder's nodes taken off it.
    if (this.owned) void this.context.close().catch(() => {});
    else for (const node of [...this.nodes, this.clickGain]) node.disconnect();
    setAudioSession("playback");
    // The stem player made afresh: one made before the session switched crackled (issue #136).
    endStemsRecording();
  }
}
