import type { SCREEN_EFFECT_TARGETS } from "./theme.js";

/**
 * The shader spec (issue #324, docs/screen-shader-spec.md): the names every
 * background shader uses for what can be controlled, so the editor shows
 * the same control under the same label whatever the shader, and a preset
 * or a reaction can turn "the rotation" or lift "the brightness" without
 * knowing which shader draws. A shader declares only the ones it has, as
 * ISF inputs; its own other controls stay allowed.
 *
 * Two kinds: controls the theme sets (shown in the editor, pushed by
 * reactions), and inputs the screen fills itself (never shown).
 */

type Target = (typeof SCREEN_EFFECT_TARGETS)[number];

export interface ShaderControl {
  type: "float" | "point2D";
  /** The range and default a shader gets when its header doesn't give its own. */
  min: number;
  max: number;
  default: number | number[];
  /** The reaction that pushes it, and by how much of its range at full strength. */
  target: Target | null;
  push: number;
}

/** The standard controls, in the order the editor shows them. */
export const SHADER_CONTROLS = {
  sv_brightness: { type: "float", min: 0, max: 1, default: 0.5, target: "brightness", push: 0.5 },
  sv_contrast: { type: "float", min: 0, max: 1, default: 0.5, target: null, push: 0 },
  sv_saturation: { type: "float", min: 0, max: 1, default: 0.5, target: null, push: 0 },
  /** A turn of the colour wheel, 0 to 1; a reaction turns it by up to a third. */
  sv_hue: { type: "float", min: 0, max: 1, default: 0, target: "hue", push: 1 / 3 },
  sv_grain: { type: "float", min: 0, max: 1, default: 0, target: null, push: 0 },
  sv_distortion: { type: "float", min: 0, max: 1, default: 0.3, target: null, push: 0 },
  sv_swirl: { type: "float", min: 0, max: 1, default: 0, target: null, push: 0 },
  sv_softness: { type: "float", min: 0, max: 1, default: 0.5, target: null, push: 0 },
  sv_density: { type: "float", min: 0, max: 1, default: 0.5, target: "elements", push: 0.4 },
  sv_size: { type: "float", min: 0, max: 1, default: 0.5, target: "elements", push: 0.4 },
  /** 1 is the shader's own size; more is closer. */
  sv_scale: { type: "float", min: 0.25, max: 4, default: 1, target: "scale", push: 0.07 },
  /** Degrees. The screen adds the turn the theme's spin and rotation reactions have made (see advanceShaderClock). */
  sv_rotation: { type: "float", min: -180, max: 180, default: 0, target: "rotation", push: 0 },
  /** In screen heights, from the middle. */
  sv_offset: { type: "point2D", min: -1, max: 1, default: [0, 0], target: null, push: 0 },
} as const satisfies Record<string, ShaderControl>;
export type ShaderControlName = keyof typeof SHADER_CONTROLS;

/** The most colours a theme gives a shader (sv_color1 to sv_color8). */
export const SHADER_COLORS_MAX = 8;

/**
 * The inputs a screen fills itself: the theme's colours (`sv_color1`… and
 * how many there are, `sv_colors`), the effects' levels (`sv_pulse`, and
 * `sv_movement` and `sv_elements` from before the spec), the speed the clock
 * runs at (`sv_speed`), the quality to draw at (`sv_quality`), where the
 * words are (`sv_words`) and the picture a filter changes (`sv_image`).
 */
export const SHADER_SCREEN_INPUTS = [
  ...Array.from({ length: SHADER_COLORS_MAX }, (_, i) => `sv_color${i + 1}`),
  "sv_colors",
  "sv_pulse",
  "sv_movement",
  "sv_elements",
  "sv_speed",
  "sv_quality",
  "sv_words",
  "sv_image",
] as const;

export function isShaderControl(name: string): name is ShaderControlName {
  return Object.hasOwn(SHADER_CONTROLS, name);
}

/** What the effects have set off, each target 0 to 1. */
export type ShaderLevels = Partial<Record<Target, number>>;

/**
 * A standard control's value now: the theme's (`base`), pushed by the
 * reaction that drives it - its level times its share of the range - and
 * kept within the shader's range. Not a standard control, or a point: the
 * theme's value as it is.
 */
export function shaderControlValue(name: string, base: number, range: { min: number; max: number }, levels: ShaderLevels): number {
  if (!isShaderControl(name)) return base;
  const control: ShaderControl = SHADER_CONTROLS[name];
  if (control.type !== "float" || !control.target) return base;
  const level = levels[control.target] ?? 0;
  const value = base + level * control.push * (range.max - range.min);
  return Math.min(range.max, Math.max(range.min, value));
}

/** How much faster a movement reaction at full strength runs the clock: up to 5 times the theme's pace. */
export const SHADER_MOVEMENT_BOOST = 4;
/** Degrees a second a rotation reaction at full strength turns it. */
export const SHADER_ROTATION_RATE = 90;

/** A shader's clock: its time in seconds, and the turn (degrees) its spin and reactions have made. */
export interface ShaderClock {
  time: number;
  turn: number;
  /** The pace it ran at over the last frame, 1 being the shader's own. */
  speed: number;
}

/**
 * The clock a frame (`ms`) later (issue #324). Time runs at the theme's
 * pace - its motion, 0.5 being the shader's own - and faster while a
 * movement reaction lasts; it's added up frame by frame, so a change of
 * pace never makes the picture jump. The turn runs at the theme's spin
 * (degrees a second) and faster while a rotation reaction lasts, and stays
 * within one turn.
 */
export function advanceShaderClock(clock: ShaderClock, ms: number, theme: { motion: number; spin: number }, levels: ShaderLevels): ShaderClock {
  const dt = Math.max(0, ms) / 1000;
  const speed = theme.motion * 2 * (1 + SHADER_MOVEMENT_BOOST * (levels.movement ?? 0));
  const turn = (clock.turn + dt * (theme.spin + SHADER_ROTATION_RATE * (levels.rotation ?? 0))) % 360;
  return { time: clock.time + dt * speed, turn, speed };
}

/** What a shader draws: 0 the least (a weak device), 2 everything. A shader reads it as `sv_quality`. */
export const SHADER_QUALITIES = [0, 1, 2] as const;
export type ShaderQuality = (typeof SHADER_QUALITIES)[number];

/** How a shader is drawing: its quality, and the share of the screen's size it draws at (then stretched). */
export interface ShaderDrawing {
  quality: ShaderQuality;
  scale: number;
  /** The highest quality it may go back to: lowered when going up made it too slow at once. */
  ceiling: ShaderQuality;
  /** Measurements since the quality last changed, and whether that change was up. */
  since: number;
  rose: boolean;
}

/** Frames per second aimed for: under the first it draws less, over the second more again. */
export const SHADER_LOW_FPS = 45;
export const SHADER_HIGH_FPS = 57;
/** The smallest share of the screen it draws at. */
export const SHADER_MIN_SCALE = 0.3;

/** Where a device starts: everything, or a little less on a device with two cores or two gigabytes or fewer. */
export function initialShaderDrawing(device: { cores?: number | null; memoryGb?: number | null } = {}): ShaderDrawing {
  const weak = (device.cores != null && device.cores <= 2) || (device.memoryGb != null && device.memoryGb <= 2);
  return { quality: weak ? 1 : 2, scale: 1, ceiling: 2, since: 0, rose: false };
}

/**
 * How to draw next, from the frames a second just measured (issue #324):
 * too slow, it draws less first (a lower quality), then smaller; fast
 * enough again, it draws at its full size first, then more, a step at a
 * time after a few good measurements. A step up that's too slow at once
 * isn't tried again.
 */
export function adaptShaderDrawing(drawing: ShaderDrawing, fps: number): ShaderDrawing {
  const since = drawing.since + 1;
  if (fps < SHADER_LOW_FPS) {
    if (drawing.quality > 0) {
      const quality = (drawing.quality - 1) as ShaderQuality;
      // Just went up, and too slow already: stay under it.
      const ceiling = drawing.rose && since <= 2 ? quality : drawing.ceiling;
      return { quality, scale: drawing.scale, ceiling, since: 0, rose: false };
    }
    return { ...drawing, scale: Math.max(SHADER_MIN_SCALE, round(drawing.scale * 0.8)), since };
  }
  if (fps > SHADER_HIGH_FPS) {
    if (drawing.scale < 1) return { ...drawing, scale: Math.min(1, round(drawing.scale * 1.1)), since };
    if (drawing.quality < drawing.ceiling && since >= 4) return { ...drawing, quality: (drawing.quality + 1) as ShaderQuality, since: 0, rose: true };
  }
  return { ...drawing, since };
}

const round = (value: number) => Math.round(value * 1000) / 1000;
