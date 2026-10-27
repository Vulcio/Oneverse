import type { ScreenReport } from "@oneverse/core";
import { screenDrawStats } from "./screen-draw-stats";

const loadedAt = performance.now();
let gpu: { name: string | null; webgl: 0 | 1 | 2; maxTexture: number | null } | null = null;

/** The GPU as WebGL names it, and the WebGL there is: asked once, on a canvas of its own. */
function readGpu() {
  if (gpu) return gpu;
  const canvas = document.createElement("canvas");
  const two = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
  const gl = (two ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
  if (!gl) return (gpu = { name: null, webgl: 0, maxTexture: null });
  // The real name where the browser gives it, else the vendor's.
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String((debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "") || null;
  gpu = { name, webgl: two ? 2 : 1, maxTexture: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || null };
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return gpu;
}

/** The browser and its system, from its client hints when it has them, else its user agent. */
function browserName(): { browser: string | null; model: string | null } {
  const hints = (navigator as Navigator & { userAgentData?: { brands?: { brand: string; version: string }[]; platform?: string } }).userAgentData;
  const brand = hints?.brands?.find((one) => !/not.?a.?brand|chromium/i.test(one.brand)) ?? hints?.brands?.find((one) => /chromium/i.test(one.brand));
  const ua = navigator.userAgent;
  const system = hints?.platform || (/Android [\d.]+/.exec(ua)?.[0] ?? /CrOS|Linux|Windows|Mac OS X|iPhone OS|Tizen|Web0S/.exec(ua)?.[0] ?? null);
  const browser = brand ? `${brand.brand} ${brand.version}` : (/(Chrome|Firefox|Safari|Edg)\/[\d]+/.exec(ua)?.[0]?.replace("/", " ") ?? null);
  // An Android device's model is in its user agent: "Android 12; Chromecast".
  const model = /Android [\d.]+; ([^;)]+?)(?: Build|\))/.exec(ua)?.[1]?.trim() ?? (/Raspberry Pi|CrKey|AFT\w+|BRAVIA|SMART-TV|Web0S/.exec(ua)?.[0] ?? null);
  return { browser: [browser, system].filter(Boolean).join(" on ") || null, model };
}

/** What this screen reports about itself (issue #286): its device, and how it's drawing now. */
export function screenReport(): ScreenReport {
  const card = readGpu();
  const { browser, model } = browserName();
  return {
    device: {
      browser,
      model,
      cores: navigator.hardwareConcurrency || null,
      memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      width: window.screen?.width ?? null,
      height: window.screen?.height ?? null,
      pixelRatio: window.devicePixelRatio || null,
      gpu: card.name,
      webgl: card.webgl,
      maxTexture: card.maxTexture,
    },
    drawing: {
      fps: screenDrawStats.fps,
      worstMs: screenDrawStats.worstMs,
      scale: screenDrawStats.drawer === "shader" ? screenDrawStats.scale : null,
      quality: screenDrawStats.drawer === "shader" ? screenDrawStats.quality : null,
      drawer: screenDrawStats.drawer,
      error: screenDrawStats.error,
      effects: screenDrawStats.effects,
    },
    uptimeS: Math.round((performance.now() - loadedAt) / 1000),
  };
}
