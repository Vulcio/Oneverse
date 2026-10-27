import {
  adaptShaderDrawing,
  advanceShaderClock,
  initialShaderDrawing,
  readIsf,
  readIsfValues,
  shaderControlValue,
  SHADER_COLORS_MAX,
  type IsfInput,
  type IsfValue,
  type ScreenTheme,
  type ShaderClock,
  type ShaderLevels,
} from "@oneverse/core";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { StageText } from "./screen-text-background";
import { frameMeter, screenDrawStats } from "../lib/screen-draw-stats";
import type { ScreenSignals } from "../lib/screen-effects";
import { buildShaderProgram } from "../lib/shader-program";

/** The most pixels a shader draws, on the long side: past it, it's stretched (a 4K TV gets a 1080p picture). */
const MAX_SIDE = 1920;
/** The words' mask: small and blurred, it's only where they are. */
const WORDS_W = 160;
const WORDS_H = 90;

/**
 * A background drawn by an ISF shader (issue #297), with WebGL 2 (issue
 * #324): the shader's controls get the background theme's values, pushed by
 * effects where the shader spec says so, its `sv_` inputs what the screen
 * knows - the theme's colours, the effects' levels, where the words are
 * (`sv_words`, a mask). Its clock runs at the theme's pace, faster while a
 * movement reaction lasts, and its turn at the theme's spin. On a device
 * that can't keep up it draws less (`sv_quality`), then smaller, and more
 * again once it can; it shows the colours, slowly moving, when it can't draw
 * at all (no WebGL 2, a shader that doesn't compile, the GPU lost). Still:
 * one frame.
 */
export function ShaderBackground({ theme, source, text, signals, still }: { theme: ScreenTheme; source: string | null; text: RefObject<StageText>; signals: RefObject<ScreenSignals>; still: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shader = useMemo(() => (source === null ? null : readIsf(source)), [source]);
  const [failed, setFailed] = useState<string | null>(null);
  const colors = theme.background.colors;
  const values = theme.background.shader.values;
  const pace = { motion: theme.background.motion, spin: theme.background.spin };
  // The latest values, read each frame: moving a slider in the editor doesn't build the program again.
  const live = useRef({ values: {} as Record<string, IsfValue>, colors, pace });
  live.current = { values: shader && !("error" in shader) ? readIsfValues(shader.inputs, values) : {}, colors, pace };

  useEffect(() => {
    setFailed(null);
    const element = canvas.current;
    if (!element || !shader) return;
    if ("error" in shader) return fail(shader.error);
    const gl = element.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    if (!gl) return fail("WebGL 2 isn't available");
    const program = buildShaderProgram(gl, shader);
    if (typeof program === "string") return fail(program);
    screenDrawStats.drawer = "shader";
    screenDrawStats.error = null;

    const words = document.createElement("canvas");
    words.width = WORDS_W;
    words.height = WORDS_H;
    const wordsContext = words.getContext("2d")!;
    const wordsTexture = gl.createTexture()!;
    const empty = gl.createTexture()!;
    for (const texture of [wordsTexture, empty]) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    }
    // The words' mask, drawn again when the words change or another one appears.
    let wordsShown = "";
    const drawWords = (now: number) => {
      const current = text.current ?? { lines: [], words: [], key: 0 };
      const shown = current.words.filter((word) => word.at <= now);
      const stamp = `${current.key}:${shown.length}`;
      if (stamp === wordsShown) return;
      wordsShown = stamp;
      wordsContext.fillStyle = "#000";
      wordsContext.fillRect(0, 0, WORDS_W, WORDS_H);
      wordsContext.filter = "blur(4px)";
      wordsContext.fillStyle = "#fff";
      for (const word of shown) wordsContext.fillRect(word.x * WORDS_W - 2, word.y * WORDS_H - 1, word.w * WORDS_W + 4, word.h * WORDS_H + 2);
      wordsContext.filter = "none";
      gl.bindTexture(gl.TEXTURE_2D, wordsTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, words);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    };

    let drawing = initialShaderDrawing({ cores: navigator.hardwareConcurrency || null, memoryGb: (navigator as { deviceMemory?: number }).deviceMemory ?? null });
    let width = 0;
    let height = 0;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const fit = Math.min(1, MAX_SIDE / Math.max(1, element.clientWidth * ratio, element.clientHeight * ratio));
      width = Math.max(1, Math.round(element.clientWidth * ratio * fit * drawing.scale));
      height = Math.max(1, Math.round(element.clientHeight * ratio * fit * drawing.scale));
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }
      element.dataset.scale = drawing.scale.toFixed(2);
      element.dataset.quality = String(drawing.quality);
      screenDrawStats.scale = Math.round(drawing.scale * fit * 100) / 100;
      screenDrawStats.quality = drawing.quality;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);

    let lost = false;
    const onLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      fail("The GPU stopped drawing it");
    };
    element.addEventListener("webglcontextlost", onLost);
    let visible = true;
    const seen = new IntersectionObserver(([entry]) => (visible = !!entry?.isIntersecting));
    seen.observe(element);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const meter = frameMeter();
    let frame = 0;
    let frames = 0;
    let clock: ShaderClock = { time: 0, turn: 0, speed: 1 };
    let last = performance.now();

    const draw = (now: number) => {
      if (lost) return;
      const elapsed = now - last;
      const dt = Math.min(100, elapsed);
      last = now;
      const { values: controls, colors: palette, pace } = live.current;
      const levels: ShaderLevels = signals.current?.levels ?? {};
      clock = advanceShaderClock(clock, dt, pace, levels);
      drawWords(now);
      gl.viewport(0, 0, width, height);
      gl.useProgram(program.program);
      const set = program.set;
      set.float("TIME", clock.time);
      set.float("TIMEDELTA", dt / 1000);
      set.vec2("RENDERSIZE", [width, height]);
      set.int("FRAMEINDEX", frames);
      const date = new Date();
      set.vec4("DATE", [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000]);
      set.float("sv_speed", clock.speed);
      set.float("sv_quality", drawing.quality);
      // Where the pattern is: turned, scaled and moved, for a shader that places it with svPlace().
      const value = (input: IsfInput): IsfValue | null => {
        const own = controls[input.name] ?? input.default;
        if (!input.standard || typeof own !== "number") return own;
        const pushed = shaderControlValue(input.name, own, { min: input.min ?? 0, max: input.max ?? 1 }, levels);
        return input.name === "sv_rotation" ? pushed + clock.turn : pushed;
      };
      const byName = new Map(program.inputs.map((input) => [input.name, input]));
      const placed = (name: string, fallback: number | number[]) => {
        const input = byName.get(name);
        return input ? (value(input) ?? fallback) : fallback;
      };
      const angle = (((placed("sv_rotation", clock.turn) as number) * Math.PI) / 180) % (Math.PI * 2);
      const zoom = Math.max(0.01, placed("sv_scale", 1) as number);
      set.vec4("SV_PLACE", [Math.cos(angle), Math.sin(angle), 1 / zoom, width / Math.max(1, height)]);
      set.vec2("SV_SHIFT", placed("sv_offset", [0, 0]) as number[]);
      let unit = 0;
      for (const input of program.inputs) {
        if (input.type === "image" || input.type === "audio" || input.type === "audioFFT") {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, input.name === "sv_words" ? wordsTexture : empty);
          set.int(input.name, unit++);
          continue;
        }
        const one = input.songverse ? screenValue(input, palette, levels, clock, drawing.quality) : value(input);
        if (one === null) continue;
        if (input.type === "float") set.float(input.name, one as number);
        else if (input.type === "long") set.int(input.name, one as number);
        else if (input.type === "bool" || input.type === "event") set.int(input.name, one ? 1 : 0);
        else if (input.type === "color") set.vec4(input.name, one as number[]);
        else if (input.type === "point2D") set.vec2(input.name, one as number[]);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      frames += 1;

      // Less, then smaller, on a device that can't keep up; sharper, then more, once it can.
      const measured = meter.frame(elapsed);
      if (measured) {
        screenDrawStats.fps = measured.fps;
        screenDrawStats.worstMs = measured.worstMs;
        const next = adaptShaderDrawing(drawing, measured.fps);
        const resized = next.scale !== drawing.scale || next.quality !== drawing.quality;
        drawing = next;
        if (resized) resize();
      }
      if (still || reduced) {
        screenDrawStats.fps = null;
        return;
      }
      frame = requestAnimationFrame(function next(at) {
        if (visible) draw(at);
        else {
          last = at;
          frame = requestAnimationFrame(next);
        }
      });
    };
    frame = requestAnimationFrame(draw);
    element.dataset.state = still || reduced ? "still" : "running";
    element.dataset.ready = "";
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      seen.disconnect();
      element.removeEventListener("webglcontextlost", onLost);
      if (!lost) {
        gl.deleteProgram(program.program);
        gl.deleteTexture(wordsTexture);
        gl.deleteTexture(empty);
      }
      screenDrawStats.fps = null;
      screenDrawStats.quality = null;
      screenDrawStats.drawer = "css";
    };

    function fail(why: string) {
      setFailed(why);
      screenDrawStats.drawer = "css";
      screenDrawStats.error = why;
      screenDrawStats.fps = null;
    }
  }, [shader, still]);

  const why = failed ?? (shader && "error" in shader ? shader.error : null);
  const state = source === null ? "loading" : why ? "failed" : "drawing";
  return (
    <div className="sv-bg" data-testid="screen-shader" data-state={state} title={why ?? undefined} aria-hidden>
      {/* What it can't draw (yet): the colours, as a gradient moving slowly. */}
      {state === "drawing" ? null : <div className={`sv-bg sv-bg-gradient ${still ? "" : "sv-bg-fallback"}`} data-testid="screen-shader-fallback" />}
      <canvas ref={canvas} className="absolute inset-0 size-full" hidden={state !== "drawing"} />
    </div>
  );
}

/** What the screen gives an `sv_` input it fills: a theme colour (as 0-1 RGBA) and how many there are, an effect's level, the clock's speed, the quality. */
function screenValue(input: IsfInput, colors: string[], levels: ShaderLevels, clock: ShaderClock, quality: number): IsfValue | null {
  const colour = /^sv_color([1-8])$/.exec(input.name);
  if (colour) {
    const hex = colors[Number(colour[1]) - 1] ?? colors[colors.length - 1];
    return hex ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).concat(1) : null;
  }
  if (input.name === "sv_colors") return Math.min(SHADER_COLORS_MAX, Math.max(1, colors.length));
  if (input.name === "sv_speed") return clock.speed;
  if (input.name === "sv_quality") return quality;
  const level = input.name.slice(3) as keyof ShaderLevels;
  return level in levels ? (levels[level] ?? 0) : input.name === "sv_pulse" || input.name === "sv_movement" || input.name === "sv_elements" ? 0 : null;
}
