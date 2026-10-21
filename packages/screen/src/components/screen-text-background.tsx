import type { ScreenTheme } from "@oneverse/core";
import { useEffect, useRef, type RefObject } from "react";
import { frameMeter, screenDrawStats } from "../lib/screen-draw-stats";
import type { ScreenSignals } from "../lib/screen-effects";

/** Where the words are on the stage, as fractions of it (0 to 1), and when each word appears (performance.now()). */
export interface StageText {
  lines: Box[];
  words: (Box & { at: number })[];
  /** Bumped when the words change: a new slide. */
  key: number;
}
type Box = { x: number; y: number; w: number; h: number };

type Kind = "flow" | "strings" | "grid" | "bokeh";
type Rgb = [number, number, number];

/** The canvas is drawn at most this sharp: a TV's browser keeps up. */
const MAX_PIXEL_RATIO = 1.5;

/**
 * A background that follows the words (issue #296), drawn on a canvas: flow
 * (trails drifting on a field, parting around the words, a burst where each
 * word appears), strings (glowing lines across the screen, bending away
 * from the words, plucked by each slide), grid (cells lighting up under each
 * word as it appears) and bokeh (big soft discs gathering behind the line).
 * They answer effects through `signals` - movement, hue, brightness,
 * elements, a pulse - read each frame. Still: one frame, nothing moving.
 */
export function TextBackground({ kind, theme, text, signals, still }: { kind: Kind; theme: ScreenTheme; text: RefObject<StageText>; signals: RefObject<ScreenSignals>; still: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const colors = theme.background.colors;
  const motion = theme.background.motion;
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    let width = 0;
    let height = 0;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      width = Math.max(1, Math.round(element.clientWidth * ratio));
      height = Math.max(1, Math.round(element.clientHeight * ratio));
      element.width = width;
      element.height = height;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const palette = colors.map(rgb);
    const base = palette[0]!;
    const accents = palette.length > 1 ? palette.slice(1) : [[255, 255, 255] as Rgb];
    const scene = SCENES[kind]({ accents, base });
    let visible = true;
    const seen = new IntersectionObserver(([entry]) => (visible = !!entry?.isIntersecting));
    seen.observe(element);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let last = performance.now();
    // A slow device: fewer things drawn, from how long frames take.
    let slow = 0;
    const meter = frameMeter();
    screenDrawStats.drawer = "canvas";
    screenDrawStats.scale = 1;
    const draw = (time: number) => {
      const measured = meter.frame(time - last);
      const dt = Math.min(64, time - last);
      last = time;
      if (measured) Object.assign(screenDrawStats, measured);
      slow = slow * 0.95 + (dt > 24 ? 1 : 0) * 0.05;
      const levels = signals.current?.levels ?? { pulse: 0, movement: 0, hue: 0, brightness: 0, elements: 0 };
      scene.draw(context, {
        width,
        height,
        time,
        dt: still || reduced ? 0 : dt,
        motion,
        text: text.current ?? { lines: [], words: [], key: 0 },
        // The levels already carry how much the background answers (theme.reacts).
        movement: levels.movement,
        hue: levels.hue,
        brightness: levels.brightness + levels.pulse * 0.6,
        elements: levels.elements,
        quality: slow > 0.5 ? 0.5 : 1,
      });
      if (still || reduced) return;
      frame = requestAnimationFrame(function next(now) {
        if (visible) draw(now);
        else {
          last = now;
          frame = requestAnimationFrame(next);
        }
      });
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      seen.disconnect();
      Object.assign(screenDrawStats, { drawer: "css", fps: null, worstMs: null });
    };
  }, [kind, colors.join(), motion, still]);
  return <canvas ref={canvas} className="absolute inset-0 size-full" data-testid="screen-text-background" data-kind={kind} aria-hidden />;
}

interface FrameInput {
  width: number;
  height: number;
  time: number;
  /** ms since the last frame; 0 when still. */
  dt: number;
  motion: number;
  text: StageText;
  movement: number;
  hue: number;
  brightness: number;
  elements: number;
  /** 1, or 0.5 on a device that can't keep up. */
  quality: number;
}
interface Scene {
  draw: (context: CanvasRenderingContext2D, frame: FrameInput) => void;
}

const SCENES: Record<Kind, (colors: { accents: Rgb[]; base: Rgb }) => Scene> = { flow, strings, grid, bokeh };

/** Trails drifting on a smooth field; they part around the words, and burst out where each word appears. */
function flow({ accents, base }: { accents: Rgb[]; base: Rgb }): Scene {
  type Particle = { x: number; y: number; px: number; py: number; color: number; life: number };
  const particles: Particle[] = [];
  const seen = new Set<number>();
  let key = -1;
  // Each lives a few seconds, so the trails never bunch up where the field gathers them.
  const spawn = (x = Math.random(), y = Math.random(), life = 0.4 + Math.random() * 0.6): Particle => ({ x, y, px: x, py: y, color: Math.floor(Math.random() * accents.length), life });
  return {
    draw(context, f) {
      // As dense on a preview card as on a projector.
      const area = Math.sqrt(Math.min(1.5, (f.width * f.height) / (1280 * 720)));
      const count = Math.round(320 * area * f.quality * (1 + f.elements));
      while (particles.length < count) particles.push(spawn());
      particles.length = Math.min(particles.length, Math.round(count * 1.6));
      // A new slide: its words not seen yet.
      if (f.text.key !== key) {
        key = f.text.key;
        seen.clear();
      }
      f.text.words.forEach((word, i) => {
        if (seen.has(i) || word.at > f.time) return;
        seen.add(i);
        for (let n = 0; n < 14; n++) particles.push(spawn(word.x + Math.random() * word.w, word.y + word.h / 2 + (Math.random() - 0.5) * word.h, 0.9));
      });
      // The trails fade: a veil of the base colour.
      context.globalCompositeOperation = "source-over";
      context.fillStyle = `rgba(${base.join(",")},${f.dt ? 0.05 + 0.06 * (1 - f.motion) : 1})`;
      context.fillRect(0, 0, f.width, f.height);
      context.globalCompositeOperation = "lighter";
      context.lineWidth = Math.max(1.2, f.width / 700);
      const speed = (0.00006 + f.motion * 0.00018) * (1 + f.movement * 2.5) * f.dt;
      const t = f.time * 0.00004 * (0.3 + f.motion);
      const aspect = f.width / f.height;
      for (const p of particles) {
        const angle = field(p.x * 3 * aspect, p.y * 3, t) * Math.PI * 2;
        let vx = Math.cos(angle) * speed;
        let vy = Math.sin(angle) * speed;
        // Around the words: pushed out of the lines' boxes.
        for (const line of f.text.lines) {
          const cx = line.x + line.w / 2;
          const cy = line.y + line.h / 2;
          const dx = (p.x - cx) / (line.w / 2 + 0.04);
          const dy = (p.y - cy) / (line.h / 2 + 0.04);
          const d = dx * dx + dy * dy;
          if (d < 1) {
            vy += Math.sign(dy || 1) * (1 - d) * speed * 1.5;
            vx += Math.sign(dx || 1) * (1 - d) * speed * 0.3;
          }
        }
        p.px = p.x;
        p.py = p.y;
        p.x += vx / aspect;
        p.y += vy;
        p.life -= f.dt * 0.0001;
        if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || p.life <= 0) Object.assign(p, spawn());
        const color = shift(accents[p.color]!, f.hue);
        context.strokeStyle = `rgba(${color.join(",")},${0.6 + 0.4 * f.brightness})`;
        context.beginPath();
        context.moveTo(p.px * f.width, p.py * f.height);
        context.lineTo(p.x * f.width, p.y * f.height);
        context.stroke();
      }
      context.globalCompositeOperation = "source-over";
    },
  };
}

/** A few glowing lines across the screen, waving; they bend away from the words and ring when a slide comes. */
function strings({ accents, base }: { accents: Rgb[]; base: Rgb }): Scene {
  // Each string keeps above or below the words.
  const lines = Array.from({ length: 6 }, (_, i) => ({ phase: i * 1.7, freq: 1.2 + i * 0.3, offset: (i % 2 ? 1 : -1) * (0.02 + Math.floor(i / 2) * 0.05), above: i % 2 === 0, rank: Math.floor(i / 2), color: i % accents.length }));
  let key = -1;
  let pluck = 0;
  return {
    draw(context, f) {
      if (f.text.key !== key) {
        key = f.text.key;
        pluck = 1;
      }
      pluck *= Math.pow(0.9985, f.dt);
      context.globalCompositeOperation = "source-over";
      context.fillStyle = `rgb(${base.join(",")})`;
      context.fillRect(0, 0, f.width, f.height);
      context.globalCompositeOperation = "lighter";
      const t = f.time * 0.001 * (0.2 + f.motion) * (1 + f.movement * 2);
      // Where the words are, the strings keep clear: the box round the lines, softened at its ends.
      const words = f.text.lines;
      const margin = 0.035;
      const top = words.length ? Math.min(...words.map((one) => one.y)) - margin : 0.5;
      const bottom = words.length ? Math.max(...words.map((one) => one.y + one.h)) + margin : 0.5;
      const left = words.length ? Math.min(...words.map((one) => one.x)) : 0.5;
      const right = words.length ? Math.max(...words.map((one) => one.x + one.w)) : 0.5;
      const cover = (x: number) => (words.length ? smooth(left - 0.12, left, x) * (1 - smooth(right, right + 0.12, x)) : 0);
      const steps = Math.round(120 * f.quality);
      for (const line of lines) {
        const amplitude = (0.04 + 0.05 * f.motion) * (1 + f.elements * 1.5 + pluck * 1.2);
        const color = shift(accents[line.color]!, f.hue);
        for (const [width, alpha] of [
          [f.width / 180, 0.08 + 0.1 * f.brightness],
          [f.width / 900, 0.6 + 0.3 * f.brightness],
        ] as const) {
          context.lineWidth = Math.max(1, width);
          context.strokeStyle = `rgba(${color.join(",")},${alpha})`;
          context.beginPath();
          for (let s = 0; s <= steps; s++) {
            const x = s / steps;
            let y = 0.5 + line.offset + Math.sin(x * line.freq * Math.PI * 2 + t + line.phase) * amplitude;
            // Bent away from the words, smoothly: a string above them stays above, one below stays below.
            const weight = cover(x);
            if (weight > 0) {
              // Each a little further out than the one before, so they don't run together.
              const edge = line.above ? top - line.rank * 0.018 : bottom + line.rank * 0.018;
              y = line.above ? y - weight * Math.max(0, y - edge) : y + weight * Math.max(0, edge - y);
            }
            if (s === 0) context.moveTo(x * f.width, y * f.height);
            else context.lineTo(x * f.width, y * f.height);
          }
          context.stroke();
        }
      }
      context.globalCompositeOperation = "source-over";
    },
  };
}

/** A grid of cells: each lights up under a word as it appears, then fades; a few glimmer on their own. */
function grid({ accents, base }: { accents: Rgb[]; base: Rgb }): Scene {
  const glow = new Map<string, { level: number; color: number }>();
  const seen = new Set<number>();
  let key = -1;
  return {
    draw(context, f) {
      const size = Math.max(24, Math.min(f.width, f.height) / 14);
      const columns = Math.ceil(f.width / size);
      const rows = Math.ceil(f.height / size);
      if (f.text.key !== key) {
        key = f.text.key;
        seen.clear();
      }
      // The cells under each word, as it appears.
      f.text.words.forEach((word, i) => {
        if (seen.has(i) || word.at > f.time) return;
        seen.add(i);
        const from = Math.floor((word.x * f.width) / size);
        const to = Math.floor(((word.x + word.w) * f.width) / size);
        const row = Math.floor(((word.y + word.h / 2) * f.height) / size);
        for (let c = from; c <= to; c++) for (let r = row - 1; r <= row + 1; r++) glow.set(`${c}:${r}`, { level: r === row ? 1 : 0.5, color: i % accents.length });
      });
      // A few on their own, more as the background moves.
      if (f.dt && Math.random() < 0.04 * (0.4 + f.motion) * (1 + f.movement * 3)) glow.set(`${Math.floor(Math.random() * columns)}:${Math.floor(Math.random() * rows)}`, { level: 0.6, color: Math.floor(Math.random() * accents.length) });
      context.fillStyle = `rgb(${base.join(",")})`;
      context.fillRect(0, 0, f.width, f.height);
      // The grid itself, faint.
      const faint = shift(accents[0]!, f.hue);
      context.strokeStyle = `rgba(${faint.join(",")},${0.06 + 0.06 * f.brightness})`;
      context.lineWidth = 1;
      context.beginPath();
      for (let c = 0; c <= columns; c++) {
        context.moveTo(c * size + 0.5, 0);
        context.lineTo(c * size + 0.5, f.height);
      }
      for (let r = 0; r <= rows; r++) {
        context.moveTo(0, r * size + 0.5);
        context.lineTo(f.width, r * size + 0.5);
      }
      context.stroke();
      const fade = f.dt * 0.0006 * (1 - f.elements * 0.6);
      for (const [cell, light] of glow) {
        const [c, r] = cell.split(":").map(Number) as [number, number];
        const color = shift(accents[light.color]!, f.hue);
        const alpha = Math.min(1, light.level * (0.7 + 0.5 * f.brightness));
        context.fillStyle = `rgba(${color.join(",")},${alpha * 0.18})`;
        context.fillRect(c * size, r * size, size, size);
        context.strokeStyle = `rgba(${color.join(",")},${alpha})`;
        context.lineWidth = Math.max(1, size / 40);
        context.strokeRect(c * size + 1, r * size + 1, size - 2, size - 2);
        light.level -= fade;
        if (light.level <= 0) glow.delete(cell);
      }
    },
  };
}

/** Big soft discs drifting; they gather behind the line on screen and swell with the words. */
function bokeh({ accents, base }: { accents: Rgb[]; base: Rgb }): Scene {
  const discs = Array.from({ length: 16 }, (_, i) => ({ x: Math.random(), y: Math.random(), r: 0.08 + Math.random() * 0.14, a: Math.random() * Math.PI * 2, s: 0.5 + Math.random(), color: i % accents.length }));
  return {
    draw(context, f) {
      context.globalCompositeOperation = "source-over";
      context.fillStyle = `rgb(${base.join(",")})`;
      context.fillRect(0, 0, f.width, f.height);
      context.globalCompositeOperation = "lighter";
      const lines = f.text.lines;
      const focus = lines.length ? { x: lines.reduce((sum, one) => sum + one.x + one.w / 2, 0) / lines.length, y: lines.reduce((sum, one) => sum + one.y + one.h / 2, 0) / lines.length } : null;
      const speed = (0.00002 + f.motion * 0.00006) * (1 + f.movement * 2) * f.dt;
      const unit = Math.min(f.width, f.height);
      const shown = Math.max(6, Math.round(discs.length * f.quality));
      for (const disc of discs.slice(0, shown)) {
        disc.a += speed * 20 * disc.s;
        disc.x += Math.cos(disc.a) * speed * disc.s;
        disc.y += Math.sin(disc.a * 0.7) * speed * disc.s;
        // Drawn towards the words, gently.
        if (focus) {
          disc.x += (focus.x - disc.x) * 0.00012 * f.dt;
          disc.y += (focus.y - disc.y) * 0.00012 * f.dt;
        }
        disc.x = ((disc.x % 1) + 1) % 1;
        disc.y = ((disc.y % 1) + 1) % 1;
        const radius = disc.r * unit * (1 + f.elements * 0.6);
        const color = shift(accents[disc.color]!, f.hue);
        const gradient = context.createRadialGradient(disc.x * f.width, disc.y * f.height, 0, disc.x * f.width, disc.y * f.height, radius);
        const alpha = 0.22 + 0.25 * f.brightness;
        gradient.addColorStop(0, `rgba(${color.join(",")},${alpha})`);
        gradient.addColorStop(0.7, `rgba(${color.join(",")},${alpha * 0.6})`);
        gradient.addColorStop(1, `rgba(${color.join(",")},0)`);
        context.fillStyle = gradient;
        context.fillRect(disc.x * f.width - radius, disc.y * f.height - radius, radius * 2, radius * 2);
      }
      context.globalCompositeOperation = "source-over";
    },
  };
}

/** 0 before `from`, 1 after `to`, easing in between. */
function smooth(from: number, to: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** A smooth field, -1 to 1, from layered sines: no noise library, the same everywhere. */
function field(x: number, y: number, t: number): number {
  return (Math.sin(x * 1.3 + t * 3 + Math.sin(y * 0.7 + t)) + Math.sin(y * 1.7 - t * 2 + Math.cos(x * 0.9 - t)) + Math.sin((x + y) * 0.6 + t)) / 3;
}

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

/** A colour turned round the colour wheel by `amount` (0 to 1: up to a third of the way). */
function shift([r, g, b]: Rgb, amount: number): Rgb {
  if (amount <= 0.001) return [r, g, b];
  const angle = amount * (Math.PI * 2) / 3;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Rotation about the grey axis.
  const k = (1 - cos) / 3;
  const s = Math.sqrt(1 / 3) * sin;
  const m = [cos + k, k - s, k + s, k + s, cos + k, k - s, k - s, k + s, cos + k];
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
  return [clamp(r * m[0]! + g * m[1]! + b * m[2]!), clamp(r * m[3]! + g * m[4]! + b * m[5]!), clamp(r * m[6]! + g * m[7]! + b * m[8]!)];
}
