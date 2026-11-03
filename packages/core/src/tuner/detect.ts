/**
 * Pitch detection for the tuner (issue #3): MPM (McLeod & Wyvill, 2005) and
 * YIN (de Cheveigné & Kawahara, 2002) on one frame of microphone samples.
 *
 * From brice's strobe-tuner (MIT), whose detectors were ported from
 * tuner-core (MIT, M. Ducharme), with the fixes of its review (2026-11-03):
 * one parabola formula for minima and maxima, the period refined from its
 * multiples, the range A0 to C8, YIN's octave errors in noise.
 */

/** Lowest pitch looked for: below A0 (27.5 Hz) even at A4 = 392. */
export const TUNER_MIN_HZ = 24;
/** Highest: above C8 (4186 Hz). A note above it would read an octave low, so it sits above anything played. */
export const TUNER_MAX_HZ = 5000;

/** Microphone sensitivity: the RMS below which a frame is silence. A page can't change the microphone's gain; this lets quiet notes in, or keeps a noisy room out. */
export const TUNER_SENSITIVITY_GATES = { low: 0.02, normal: 0.01, high: 0.004, max: 0.0015 } as const;
export type TunerSensitivity = keyof typeof TUNER_SENSITIVITY_GATES;
export const TUNER_SENSITIVITIES = Object.keys(TUNER_SENSITIVITY_GATES) as TunerSensitivity[];

export const TUNER_DETECTORS = ["mpm", "yin"] as const;
export type TunerDetector = (typeof TUNER_DETECTORS)[number];

export interface PitchReading {
  /** Hz, or null when there's no clear pitch. */
  frequency: number | null;
  /** 0 to 1. */
  confidence: number;
}

/** MPM's peak threshold: the first NSDF maximum above it is the period, which keeps away from subharmonics. */
const MPM_PEAK = 0.88;
/** YIN's: the first CMND dip below it. */
const YIN_DIP = 0.15;
/** A dip at a fraction of YIN's period is taken up to this value (noise hides the real one). */
const YIN_SUBMULTIPLE = 0.4;

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

/** The lag range for a frame: the periods of TUNER_MAX_HZ to TUNER_MIN_HZ, within half the frame. */
function lags(length: number, sampleRate: number): { min: number; max: number } | null {
  const min = Math.max(1, Math.ceil(sampleRate / TUNER_MAX_HZ));
  const max = Math.min(Math.floor(sampleRate / TUNER_MIN_HZ), Math.floor(length / 2) - 1);
  return min > max ? null : { min, max };
}

/** The vertex of the parabola through arr[tau-1..tau+1]: the same offset for a minimum and a maximum. */
export function parabolicInterpolation(arr: Float32Array, tau: number, tauMax: number): number {
  if (tau <= 1 || tau >= tauMax) return tau;
  const y0 = arr[tau - 1]!;
  const y1 = arr[tau]!;
  const y2 = arr[tau + 1]!;
  const denom = y0 - 2 * y1 + y2;
  if (Math.abs(denom) < 1e-14) return tau;
  return tau + Math.max(-1, Math.min(1, (y0 - y2) / (2 * denom)));
}

/**
 * A period read again from its multiples: a high note's is only a few
 * samples long and a parabola through its peak is off by a cent or more; the
 * same peak at 2, 4, 8… periods, divided, is that much more precise.
 */
export function refineByMultiple(arr: Float32Array, tau: number, tauMax: number, findMin: boolean): number {
  const first = arr[Math.round(tau)]!;
  let period = tau;
  for (let k = 2; k * period <= tauMax - 2; k *= 2) {
    const near = Math.round(k * period);
    let best = near;
    for (let t = Math.max(2, near - 2); t <= Math.min(tauMax - 1, near + 2); t++) {
      if (findMin ? arr[t]! < arr[best]! : arr[t]! > arr[best]!) best = t;
    }
    const value = arr[best]!;
    if (findMin ? value > first + 0.1 : value < first - 0.1) break;
    const refined = parabolicInterpolation(arr, best, tauMax) / k;
    if (Math.abs(refined - period) > 0.25) break;
    period = refined;
  }
  return period;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** MPM: amplitude-independent, steady while a note fades. */
export function detectMpm(samples: Float32Array, sampleRate: number, gate: number = TUNER_SENSITIVITY_GATES.normal): PitchReading {
  if (rms(samples) < gate) return { frequency: null, confidence: 0 };
  const range = lags(samples.length, sampleRate);
  if (!range) return { frequency: null, confidence: 0 };
  const n = samples.length;
  // Normalised square difference: 2·Σx[t]x[t+τ] / Σ(x[t]² + x[t+τ]²).
  const nsdf = new Float32Array(range.max + 1);
  nsdf[0] = 1;
  for (let tau = 1; tau <= range.max; tau++) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < n - tau; i++) {
      const a = samples[i]!;
      const b = samples[i + tau]!;
      num += a * b;
      den += a * a + b * b;
    }
    nsdf[tau] = den > 1e-20 ? (2 * num) / den : 0;
  }
  let peak = -1;
  for (let tau = Math.max(2, range.min); tau <= range.max - 1; tau++) {
    const v = nsdf[tau]!;
    if (v >= MPM_PEAK && v >= nsdf[tau - 1]! && v >= nsdf[tau + 1]!) {
      peak = tau;
      break;
    }
  }
  if (peak < 0) {
    let best = 0;
    for (let tau = range.min; tau <= range.max; tau++) best = Math.max(best, nsdf[tau]!);
    return { frequency: null, confidence: clamp01(best) };
  }
  const confidence = clamp01(nsdf[peak]!);
  const period = refineByMultiple(nsdf, parabolicInterpolation(nsdf, peak, range.max), range.max, false);
  const frequency = sampleRate / period;
  return frequency < TUNER_MIN_HZ || frequency > TUNER_MAX_HZ ? { frequency: null, confidence } : { frequency, confidence };
}

/** YIN: very precise on a held note. */
export function detectYin(samples: Float32Array, sampleRate: number, gate: number = TUNER_SENSITIVITY_GATES.normal): PitchReading {
  if (rms(samples) < gate) return { frequency: null, confidence: 0 };
  const range = lags(samples.length, sampleRate);
  if (!range) return { frequency: null, confidence: 0 };
  const n = samples.length;
  // Difference d(τ) = Σ(x[t] − x[t+τ])², then its cumulative mean normalised form.
  const d = new Float32Array(range.max + 1);
  for (let tau = range.min; tau <= range.max; tau++) {
    let sum = 0;
    for (let i = 0; i < n - tau; i++) {
      const diff = samples[i]! - samples[i + tau]!;
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  const cmnd = new Float32Array(range.max + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= range.max; tau++) {
    running += d[tau]!;
    cmnd[tau] = running > 0 ? (d[tau]! * tau) / running : 1;
  }
  let bestTau = -1;
  let bestValue = 1;
  for (let tau = range.min; tau <= range.max; tau++) {
    if (cmnd[tau]! < YIN_DIP) {
      let t = tau;
      while (t + 1 <= range.max && cmnd[t + 1]! < cmnd[t]!) t++;
      bestTau = t;
      bestValue = cmnd[t]!;
      break;
    }
  }
  // In noise the cumulative mean pulls a far multiple of the period under the
  // threshold: a clear dip at a whole fraction of it is the real period.
  if (bestTau > 0) {
    for (let k = Math.floor(bestTau / range.min); k >= 2; k--) {
      const near = Math.round(bestTau / k);
      let t = near;
      for (let u = Math.max(range.min, near - 2); u <= Math.min(range.max, near + 2); u++) if (cmnd[u]! < cmnd[t]!) t = u;
      if (t > range.min && t < range.max && cmnd[t]! < YIN_SUBMULTIPLE && cmnd[t]! <= cmnd[t - 1]! && cmnd[t]! <= cmnd[t + 1]!) {
        bestTau = t;
        bestValue = cmnd[t]!;
        break;
      }
    }
  }
  const confidence = clamp01(1 - bestValue);
  if (bestTau < 0 || bestValue >= YIN_SUBMULTIPLE) return { frequency: null, confidence: bestTau < 0 ? 0 : confidence };
  const period = refineByMultiple(cmnd, parabolicInterpolation(cmnd, bestTau, range.max), range.max, true);
  const frequency = sampleRate / period;
  return frequency < TUNER_MIN_HZ || frequency > TUNER_MAX_HZ ? { frequency: null, confidence } : { frequency, confidence };
}

export function detectPitch(detector: TunerDetector, samples: Float32Array, sampleRate: number, gate?: number): PitchReading {
  return detector === "yin" ? detectYin(samples, sampleRate, gate) : detectMpm(samples, sampleRate, gate);
}
