import { z } from "zod";

/**
 * What a screen reports about itself (issue #286), every half minute over
 * /sync: the device - its browser and system, cores and memory, its screen,
 * its GPU and the WebGL it has - and how it's drawing: frames per second,
 * the slowest frame lately, the share of pixels a shader draws at, whether
 * effects are on, what draws the background. Its owner sees it on Screens,
 * with a tier that says what it can run. Every field is the device's own
 * word for it: kept short, never trusted for more than showing.
 */

/** How often a screen reports, and the least time between two the server keeps. */
export const SCREEN_REPORT_EVERY_MS = 30_000;
export const SCREEN_REPORT_MIN_GAP_MS = 10_000;

/** What a device can run: everything smoothly; shaders at a lower resolution and effects lightly; still backgrounds only. */
export const SCREEN_TIERS = ["smooth", "limited", "minimal"] as const;
export type ScreenTier = (typeof SCREEN_TIERS)[number];

const text = (max: number) =>
  z
    .string()
    .transform((value) => value.trim().slice(0, max))
    .nullable()
    .default(null)
    .catch(null);
const count = (max: number) => z.number().int().min(0).max(max).nullable().default(null).catch(null);
const amount = (max: number) => z.number().min(0).max(max).nullable().default(null).catch(null);

export const ScreenReportSchema = z.object({
  device: z
    .object({
      /** The browser and its system, as it names them ("Chrome 128 on Android 12"). */
      browser: text(120),
      /** The device's model when the browser tells it ("Chromecast", "Raspberry Pi 5"). */
      model: text(120),
      cores: count(256),
      /** In GB, as the browser rounds it (0.25 to 8; more is said as 8). */
      memoryGb: amount(1024),
      /** The screen, in CSS pixels, and how many device pixels each is. */
      width: count(100_000),
      height: count(100_000),
      pixelRatio: amount(16),
      /** The GPU, as WebGL names it ("Mali-G31", "V3D 7.1", "Intel(R) UHD Graphics"). */
      gpu: text(200),
      /** The WebGL it has: 2, 1, or 0 (none: shaders can't be drawn). */
      webgl: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0).catch(0),
      maxTexture: count(65_536),
    })
    .prefault({})
    .catch(() => ({ browser: null, model: null, cores: null, memoryGb: null, width: null, height: null, pixelRatio: null, gpu: null, webgl: 0 as const, maxTexture: null })),
  drawing: z
    .object({
      /** Frames per second of the moving background, lately; null while nothing moves. */
      fps: amount(1000),
      worstMs: amount(60_000),
      /** The share of the screen's pixels a shader draws (0 to 1). */
      scale: amount(1),
      /** What a shader draws (issue #324): 0 the least, 2 everything. */
      quality: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable().default(null).catch(null),
      drawer: z.enum(["shader", "canvas", "css"]).default("css").catch("css"),
      /** A shader that couldn't be drawn: why. */
      error: text(200),
      effects: z.boolean().default(false).catch(false),
    })
    .prefault({})
    .catch(() => ({ fps: null, worstMs: null, scale: null, quality: null, drawer: "css" as const, error: null, effects: false })),
  /** Seconds since the screen's page loaded. */
  uptimeS: count(10 * 365 * 86_400),
});
export type ScreenReport = z.output<typeof ScreenReportSchema>;

/** A report as the server keeps it: what the device said, read; null when it isn't one. */
export function readScreenReport(input: unknown): ScreenReport | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const read = ScreenReportSchema.safeParse(input);
  return read.success ? read.data : null;
}

/**
 * What a screen can run, from its report: minimal without WebGL, under 25
 * frames a second, or with a gigabyte of memory or less; limited with only
 * WebGL 1, under 50 frames a second or a shader drawn at under 3/4 of its
 * pixels; smooth when it measured itself drawing faster. Measuring nothing
 * (a still background), limited with two gigabytes or less or two cores or
 * fewer, smooth otherwise.
 */
export function screenTier(report: ScreenReport): ScreenTier {
  const { device, drawing } = report;
  const fps = drawing.fps;
  const scale = drawing.scale ?? 1;
  if (device.webgl === 0 || (fps !== null && fps < 25) || (device.memoryGb !== null && device.memoryGb <= 1)) return "minimal";
  if (device.webgl === 1 || (fps !== null && fps < 50) || (drawing.drawer === "shader" && scale < 0.75)) return "limited";
  if (fps !== null && drawing.drawer !== "css") return "smooth";
  if ((device.memoryGb !== null && device.memoryGb <= 2) || (device.cores !== null && device.cores <= 2)) return "limited";
  return "smooth";
}
