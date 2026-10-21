import { readIsf, readIsfValues, type IsfInput, type IsfShader, type IsfValue, type ScreenTheme } from "@oneverse/core";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { StageText } from "#/components/screen-text-background";
import { frameMeter, screenDrawStats } from "#/lib/screen-draw-stats";
import type { ScreenSignals } from "#/lib/screen-effects";

/** The most pixels a shader draws, on the long side: past it, it's stretched (a 4K TV gets a 1080p picture). */
const MAX_SIDE = 1920;
/** The share of the screen it drops to on a slow device, at worst. */
const MIN_SCALE = 0.3;
/** Frames per second it aims for: under it, it draws smaller; well over it, sharper again. */
const LOW_FPS = 45;
const HIGH_FPS = 57;
/** The words' mask: small and blurred, it's only where they are. */
const WORDS_W = 160;
const WORDS_H = 90;

/**
 * A background drawn by an ISF shader (issue #297), with WebGL: the shader's
 * controls get the background theme's values, its `sv_` inputs what the
 * screen knows - the theme's colours, the effects' levels, where the words
 * are (`sv_words`, a mask). It draws at a smaller size on a device that
 * can't keep up, sharper again once it can, and shows the colours instead
 * when it can't draw at all (no WebGL, a shader that doesn't compile, the
 * GPU lost). Still: one frame.
 */
export function ShaderBackground({ theme, source, text, signals, still }: { theme: ScreenTheme; source: string | null; text: RefObject<StageText>; signals: RefObject<ScreenSignals>; still: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shader = useMemo(() => (source === null ? null : readIsf(source)), [source]);
  const [failed, setFailed] = useState<string | null>(null);
  const colors = theme.background.colors;
  const values = theme.background.shader.values;
  const motion = theme.background.motion;
  // The latest values, read each frame: moving a slider in the editor doesn't build the program again.
  const live = useRef({ values: {} as Record<string, IsfValue>, colors, motion });
  live.current = { values: shader && !("error" in shader) ? readIsfValues(shader.inputs, values) : {}, colors, motion };

  useEffect(() => {
    setFailed(null);
    const element = canvas.current;
    if (!element || !shader) return;
    if ("error" in shader) return fail(shader.error);
    const gl = (element.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" }) ??
      element.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return fail("WebGL isn't available");
    const program = build(gl, shader);
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

    let scale = 1;
    let width = 0;
    let height = 0;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const fit = Math.min(1, MAX_SIDE / Math.max(1, element.clientWidth * ratio, element.clientHeight * ratio));
      width = Math.max(1, Math.round(element.clientWidth * ratio * fit * scale));
      height = Math.max(1, Math.round(element.clientHeight * ratio * fit * scale));
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }
      element.dataset.scale = scale.toFixed(2);
      screenDrawStats.scale = Math.round(scale * fit * 100) / 100;
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
    let time = 0;
    let last = performance.now();

    const draw = (now: number) => {
      if (lost) return;
      const elapsed = now - last;
      const dt = Math.min(100, elapsed);
      last = now;
      const { values: controls, colors: palette, motion: speed } = live.current;
      // The theme's motion: 0.5 is the shader's own pace.
      time += (dt / 1000) * speed * 2;
      drawWords(now);
      const levels = signals.current?.levels ?? { pulse: 0, movement: 0, hue: 0, brightness: 0, elements: 0 };
      gl.viewport(0, 0, width, height);
      gl.useProgram(program.program);
      const set = program.set;
      set.float("TIME", time);
      set.float("TIMEDELTA", dt / 1000);
      set.vec2("RENDERSIZE", [width, height]);
      set.int("FRAMEINDEX", frames);
      const date = new Date();
      set.vec4("DATE", [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000]);
      let unit = 0;
      for (const input of program.inputs) {
        if (input.type === "image" || input.type === "audio" || input.type === "audioFFT") {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, input.name === "sv_words" ? wordsTexture : empty);
          set.int(input.name, unit++);
          continue;
        }
        const value = songverseValue(input, palette, levels) ?? controls[input.name] ?? input.default;
        if (value === null) continue;
        if (input.type === "float") set.float(input.name, value as number);
        else if (input.type === "long") set.int(input.name, value as number);
        else if (input.type === "bool" || input.type === "event") set.int(input.name, value ? 1 : 0);
        else if (input.type === "color") set.vec4(input.name, value as number[]);
        else if (input.type === "point2D") set.vec2(input.name, value as number[]);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      frames += 1;

      // Smaller on a device that can't keep up, sharper again once it can.
      const measured = meter.frame(elapsed);
      if (measured) {
        screenDrawStats.fps = measured.fps;
        screenDrawStats.worstMs = measured.worstMs;
        const next = measured.fps < LOW_FPS ? Math.max(MIN_SCALE, scale * 0.8) : measured.fps > HIGH_FPS ? Math.min(1, scale * 1.1) : scale;
        if (Math.abs(next - scale) > 0.01) {
          scale = next;
          resize();
        }
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
      {/* What it can't draw (yet): the colours, as a still gradient. */}
      {state === "drawing" ? null : <div className="sv-bg sv-bg-gradient" />}
      <canvas ref={canvas} className="absolute inset-0 size-full" hidden={state !== "drawing"} />
    </div>
  );
}

/** What the screen gives an `sv_` input: a theme colour (as 0-1 RGBA), an effect's level. */
function songverseValue(input: IsfInput, colors: string[], levels: ScreenSignals["levels"]): IsfValue | null {
  if (!input.songverse) return null;
  const colour = /^sv_color([1-4])$/.exec(input.name);
  if (colour) {
    const hex = colors[Number(colour[1]) - 1] ?? colors[colors.length - 1];
    return hex ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).concat(1) : null;
  }
  const level = input.name.slice(3) as keyof ScreenSignals["levels"];
  return level in levels ? levels[level] : null;
}

const VERTEX = `attribute vec2 position;
varying vec2 isf_FragNormCoord;
void main() {
  isf_FragNormCoord = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const UNIFORM_TYPES: Record<IsfInput["type"], string> = {
  float: "float",
  bool: "bool",
  long: "int",
  color: "vec4",
  point2D: "vec2",
  image: "sampler2D",
  event: "bool",
  audio: "sampler2D",
  audioFFT: "sampler2D",
};

/** ISF's built-ins, its inputs as uniforms, then the shader's GLSL. */
function fragmentSource(shader: IsfShader): string {
  const precise = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif";
  const uniforms = shader.inputs.map((input) => `uniform ${UNIFORM_TYPES[input.type]} ${input.name};`).join("\n");
  // A shader's own #version line: WebGL 1 takes none.
  const body = shader.body.replace(/^\s*#version.*$/m, "");
  return `${precise}
uniform float TIME;
uniform float TIMEDELTA;
uniform vec2 RENDERSIZE;
uniform int FRAMEINDEX;
uniform vec4 DATE;
varying vec2 isf_FragNormCoord;
#define IMG_NORM_PIXEL(image, coord) texture2D(image, coord)
#define IMG_THIS_NORM_PIXEL(image) texture2D(image, isf_FragNormCoord)
#define IMG_PIXEL(image, coord) texture2D(image, (coord) / RENDERSIZE)
#define IMG_THIS_PIXEL(image) texture2D(image, isf_FragNormCoord)
#define IMG_SIZE(image) RENDERSIZE
${uniforms}
#line 1
${body}`;
}

interface Program {
  program: WebGLProgram;
  inputs: IsfInput[];
  set: {
    float: (name: string, value: number) => void;
    int: (name: string, value: number) => void;
    vec2: (name: string, value: number[]) => void;
    vec4: (name: string, value: number[]) => void;
  };
}

/** The shader compiled and linked over a triangle covering the screen; why not, when it can't be. */
function build(gl: WebGLRenderingContext, shader: IsfShader): Program | string {
  const compile = (type: number, source: string) => {
    const one = gl.createShader(type)!;
    gl.shaderSource(one, source);
    gl.compileShader(one);
    if (!gl.getShaderParameter(one, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(one) ?? "";
      gl.deleteShader(one);
      return log.trim().split("\n")[0] || "The shader doesn't compile";
    }
    return one;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  if (typeof vertex === "string") return vertex;
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource(shader));
  if (typeof fragment === "string") return fragment;
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return gl.getProgramInfoLog(program)?.trim() || "The shader doesn't link";
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // One triangle past the corners: the whole screen, no seam.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const locations = new Map<string, WebGLUniformLocation | null>();
  const at = (name: string) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name)!;
  };
  return {
    program,
    inputs: shader.inputs,
    set: {
      float: (name, value) => gl.uniform1f(at(name), value),
      int: (name, value) => gl.uniform1i(at(name), Math.round(value)),
      vec2: (name, value) => gl.uniform2f(at(name), value[0] ?? 0, value[1] ?? 0),
      vec4: (name, value) => gl.uniform4f(at(name), value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1),
    },
  };
}
