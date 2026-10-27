import type { ShaderQuality } from "@oneverse/core";

/**
 * How a screen's moving background is drawing, kept by whichever is drawing
 * it (a shader, issue #297, or a canvas, issue #296) for the screen's report
 * (issue #286): frames per second, the slowest frame lately, the scale it
 * draws at, and the GPU, so its owner sees what it can run.
 */
export interface ScreenDrawStats {
  /** Frames per second over the last couple of seconds; null while nothing moves. */
  fps: number | null;
  /** The slowest frame of those, in ms. */
  worstMs: number | null;
  /** The share of the screen's pixels drawn, 0 to 1 (a shader draws smaller on a slow device, then stretches). */
  scale: number;
  /** What a shader draws (issue #324): 0 the least, 2 everything; null when no shader draws. */
  quality: ShaderQuality | null;
  /** What draws it: a "shader", a "canvas", or "css". */
  drawer: "shader" | "canvas" | "css";
  /** A shader that couldn't be drawn: why (the colours are shown instead). */
  error: string | null;
  /** Whether effects are running (issue #281). */
  effects: boolean;
}

export const screenDrawStats: ScreenDrawStats = { fps: null, worstMs: null, scale: 1, quality: null, drawer: "css", error: null, effects: false };

/** Frame times, measured in windows: a drawer calls `frame(dt)` each frame and reads the average and the worst. */
export function frameMeter(window = 60) {
  let count = 0;
  let total = 0;
  let worst = 0;
  return {
    frame(dt: number): { fps: number; worstMs: number } | null {
      count += 1;
      total += dt;
      worst = Math.max(worst, dt);
      if (count < window) return null;
      const result = { fps: Math.round((1000 * count) / Math.max(1, total)), worstMs: Math.round(worst) };
      count = 0;
      total = 0;
      worst = 0;
      return result;
    },
  };
}
