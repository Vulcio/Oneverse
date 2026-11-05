/**
 * An audio file's waveform, worked out once by the server (issue #388) and
 * kept beside the file: what a player draws before the audio has arrived,
 * filling it in as it downloads - and anything else that wants a file's
 * shape without decoding it (Pulse, the native apps).
 *
 * A level every 1/`rate` s: the loudest sample in that slice, across the
 * channels, against the loudest in the whole file (0-255), so a quiet part
 * still shows its shape; `loudest` says how loud that was (0-1, linear).
 */

/**
 * Levels a second: one every 10 ms - finer than a column of the closest
 * zoom anyone draws (8 s across a screen), about 6 KB a minute.
 */
export const WAVEFORM_RATE = 100;

export interface Waveform {
  /** Levels a second. */
  rate: number;
  /** How long the file lasts (s). */
  seconds: number;
  /** The loudest sample in it, 0-1 (linear): what 255 stands for. */
  loudest: number;
  /** One a slice, 0-255. */
  peaks: Uint8Array;
}

/** A waveform as the API sends it (GET …/attachments/waveforms): its levels in base64. */
export interface WaveformWire {
  attachmentId: string;
  rate: number;
  seconds: number;
  loudest: number;
  /** The levels, one byte each, in base64. */
  peaks: string;
}

/**
 * Measures a waveform from interleaved 16-bit samples, a chunk at a time
 * (a whole song needn't be in memory at once).
 */
export class WaveformMeter {
  private readonly perSlice: number;
  private readonly slices: number[] = [];
  private frame = 0;
  private loudest = 0;
  private current = 0;

  constructor(
    private readonly sampleRate: number,
    private readonly channels: number,
    private readonly rate = WAVEFORM_RATE,
  ) {
    this.perSlice = sampleRate / rate;
  }

  /** More samples, interleaved, as signed 16-bit (-32768 to 32767). */
  add(samples: ArrayLike<number>) {
    const { channels } = this;
    for (let i = 0; i + channels <= samples.length; i += channels) {
      let peak = 0;
      for (let c = 0; c < channels; c++) {
        const value = Math.abs(samples[i + c]!);
        if (value > peak) peak = value;
      }
      if (peak > this.current) this.current = peak;
      this.frame++;
      if (this.frame >= (this.slices.length + 1) * this.perSlice) this.close();
    }
  }

  private close() {
    this.slices.push(this.current);
    if (this.current > this.loudest) this.loudest = this.current;
    this.current = 0;
  }

  finish(): Waveform {
    if (this.frame > this.slices.length * this.perSlice) this.close();
    const loudest = this.loudest;
    const peaks = Uint8Array.from(this.slices, (peak) => (loudest > 0 ? Math.round((peak / loudest) * 255) : 0));
    return { rate: this.rate, seconds: this.frame / this.sampleRate, loudest: Math.min(1, loudest / 32768), peaks };
  }
}

/** Bytes as base64, in a browser or Node. */
export function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Base64 as bytes; empty when it isn't base64. */
export function base64ToBytes(text: string): Uint8Array {
  try {
    const binary = atob(text);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return new Uint8Array(0);
  }
}

/** A waveform the API sent, as levels 0-1 against its loudest (one every 1/rate s); null when it holds none. */
export function readWaveform(wire: Pick<WaveformWire, "rate" | "seconds" | "loudest" | "peaks">): { rate: number; seconds: number; loudest: number; levels: Float32Array } | null {
  const bytes = base64ToBytes(wire.peaks);
  if (!bytes.length || !(wire.rate > 0) || !(wire.seconds > 0)) return null;
  return { rate: wire.rate, seconds: wire.seconds, loudest: wire.loudest, levels: Float32Array.from(bytes, (byte) => byte / 255) };
}

/** The loudest level from `from` to `to` (s), 0-1, of levels `rate` a second. */
export function waveformPeakBetween(levels: ArrayLike<number>, rate: number, from: number, to: number): number {
  const last = Math.min(levels.length - 1, Math.floor(to * rate));
  let loudest = 0;
  for (let i = Math.max(0, Math.floor(from * rate)); i <= last; i++) if (levels[i]! > loudest) loudest = levels[i]!;
  return loudest;
}

/** `count` levels across the whole of it, each the loudest of its share: for a waveform drawn at a fixed width. */
export function waveformSlices(levels: ArrayLike<number>, count: number): number[] {
  const out: number[] = [];
  if (!levels.length) return new Array<number>(count).fill(0);
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * levels.length) / count);
    const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / count));
    let loudest = 0;
    for (let j = start; j < end && j < levels.length; j++) if (levels[j]! > loudest) loudest = levels[j]!;
    out.push(loudest);
  }
  return out;
}
