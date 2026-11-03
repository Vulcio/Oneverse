import { detectPitch, type TunerDetector } from "./detect.js";

/**
 * A run of readings (issue #3): the median of the last seven frames, so a
 * stray frame doesn't move the display, and the last confident reading held
 * while a note fades - until `release()`, after a second of silence.
 */
export class TunerSession {
  private window: number[] = [];
  private held: number | null = null;

  constructor(
    public detector: TunerDetector = "mpm",
    private readonly size = 7,
    private readonly minConfidence = 0.5,
  ) {}

  /** One frame: the pitch to show (or null), whether it's a fresh reading, and how sure. */
  push(samples: Float32Array, sampleRate: number, gate?: number): { hz: number | null; live: boolean; confidence: number } {
    const { frequency, confidence } = detectPitch(this.detector, samples, sampleRate, gate);
    if (frequency === null) return { hz: this.held, live: false, confidence: 0 };
    // A different note (more than a semitone away) starts a new window, so the change shows at once.
    const last = this.window.at(-1);
    if (last !== undefined && Math.abs(12 * Math.log2(frequency / last)) > 1) this.window = [];
    this.window.push(frequency);
    if (this.window.length > this.size) this.window.shift();
    const median = medianOf(this.window);
    if (confidence >= this.minConfidence) {
      this.held = median;
      return { hz: median, live: true, confidence };
    }
    return { hz: this.held ?? median, live: this.held !== null, confidence };
  }

  /** The note's over: nothing held. */
  release() {
    this.window = [];
    this.held = null;
  }

  get holding(): number | null {
    return this.held;
  }
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
