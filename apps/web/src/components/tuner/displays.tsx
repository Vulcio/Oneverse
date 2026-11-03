import { useEffect, useRef } from "react";
import { cn } from "@oneverse/ui/lib/utils";
import { IN_TUNE_CENTS, onTunerFrame, tunerAnalyser, type TunerReading, type TunerSettings } from "#/lib/tuner-engine";

/**
 * The tuner's four displays (issue #3), from brice's strobe tuner: a strobe
 * (bands of stripes that drift with the error, still when in tune), a wheel,
 * a needle and a spectrum. They draw every frame from `onTunerFrame`, in the
 * theme's colours (read off the swatches below), green when in tune.
 */

type Colors = { fg: string; muted: string; faint: string; accent: string; good: string; goodDim: string; bg: string };

/** The theme's colours, read off hidden swatches (canvas can't use CSS variables). */
function Swatches({ swatches }: { swatches: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={swatches} className="hidden" aria-hidden>
      <span data-c="fg" className="text-foreground" />
      <span data-c="muted" className="text-muted-foreground" />
      <span data-c="faint" className="text-muted" />
      <span data-c="accent" className="text-primary" />
      <span data-c="good" className="text-emerald-500" />
      <span data-c="goodDim" className="text-emerald-500/25" />
      <span data-c="bg" className="text-card" />
    </div>
  );
}

function readColors(root: HTMLElement | null): Colors {
  const colors = { fg: "#ddd", muted: "#888", faint: "#333", accent: "#d4a843", good: "#2db882", goodDim: "#0e3326", bg: "#111" };
  for (const span of root?.querySelectorAll<HTMLElement>("[data-c]") ?? []) colors[span.dataset.c as keyof Colors] = getComputedStyle(span).color;
  return colors;
}

/** A canvas the size of its box, at the screen's pixel density, redrawn every tuner frame. */
function useCanvas(draw: (ctx: CanvasRenderingContext2D, width: number, height: number, reading: TunerReading | null, dt: number, colors: Colors) => void) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const swatches = useRef<HTMLDivElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    let colors = readColors(swatches.current);
    let last: TunerReading | null = null;
    const paint = (reading: TunerReading | null, dt: number) => {
      const scale = window.devicePixelRatio || 1;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (element.width !== Math.round(width * scale) || element.height !== Math.round(height * scale)) {
        element.width = Math.round(width * scale);
        element.height = Math.round(height * scale);
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawRef.current(ctx, width, height, reading, dt, colors);
    };
    const resize = new ResizeObserver(() => {
      colors = readColors(swatches.current);
      paint(last, 0);
    });
    resize.observe(element);
    // The theme changing (light, dark, a mode): its colours again.
    const theme = new MutationObserver(() => {
      colors = readColors(swatches.current);
      paint(last, 0);
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const off = onTunerFrame(({ reading, dt }) => {
      last = reading;
      paint(reading, dt);
    });
    paint(null, 0);
    return () => {
      off();
      resize.disconnect();
      theme.disconnect();
    };
  }, []);
  return { canvas, swatches };
}

const inTune = (reading: TunerReading | null) => !!reading?.live && Math.abs(reading.cents) < IN_TUNE_CENTS;
const clampCents = (cents: number) => Math.max(-50, Math.min(50, cents));

const BANDS = {
  octave: [
    { mult: 1, stripes: 6, label: "×1" },
    { mult: 2, stripes: 10, label: "×2" },
    { mult: 4, stripes: 18, label: "×4" },
    { mult: 8, stripes: 32, label: "×8" },
  ],
  harmonic: [
    { mult: 1, stripes: 6, label: "F" },
    { mult: 2, stripes: 10, label: "2F" },
    { mult: 3, stripes: 14, label: "3F" },
    { mult: 4, stripes: 20, label: "4F" },
    { mult: 5, stripes: 26, label: "5F" },
  ],
} as const;

/** Bands of stripes, one per octave or harmonic, drifting up when sharp and down when flat, at a speed with the error: still when in tune. */
export function StrobeDisplay({ bands, className }: { bands: TunerSettings["bands"]; className?: string }) {
  const offsets = useRef<number[]>([]);
  const { canvas, swatches } = useCanvas((ctx, width, height, reading, dt, colors) => {
    const list = BANDS[bands];
    const gap = 2;
    const column = (width - gap * (list.length - 1)) / list.length;
    const good = inTune(reading);
    ctx.clearRect(0, 0, width, height);
    list.forEach((band, index) => {
      const stripe = height / band.stripes;
      if (reading) offsets.current[index] = (offsets.current[index] ?? 0) - (clampCents(reading.cents) / 50) * height * band.mult * dt;
      const offset = offsets.current[index] ?? 0;
      const shift = ((offset % (2 * stripe)) + 2 * stripe) % (2 * stripe);
      const x = index * (column + gap);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, column, height);
      ctx.clip();
      ctx.fillStyle = good ? colors.goodDim : colors.faint;
      ctx.fillRect(x, 0, column, height);
      ctx.fillStyle = good ? colors.good : colors.fg;
      ctx.globalAlpha = reading?.live ? 1 : 0.35;
      for (let y = -2 * stripe + shift; y < height; y += 2 * stripe) ctx.fillRect(x, y, column, stripe);
      ctx.restore();
      ctx.fillStyle = colors.muted;
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(band.label, x + column / 2, height - 6);
    });
  });
  return (
    <>
      <canvas ref={canvas} className={cn("block h-44 w-full rounded-lg sm:h-52", className)} data-testid="tuner-strobe" />
      <Swatches swatches={swatches} />
    </>
  );
}

/** A disc of 24 segments turning with the error: clockwise sharp, still in tune. */
export function WheelDisplay({ className }: { className?: string }) {
  const phase = useRef(0);
  const { canvas, swatches } = useCanvas((ctx, width, height, reading, dt, colors) => {
    const size = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;
    const radius = size / 2 - 6;
    const good = inTune(reading);
    if (reading) phase.current += (clampCents(reading.cents) / 50) * dt * Math.PI * 2 * 0.8;
    ctx.clearRect(0, 0, width, height);
    const step = (Math.PI * 2) / 24;
    for (let i = 0; i < 24; i++) {
      const start = phase.current + i * step;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + step / 2);
      ctx.closePath();
      ctx.fillStyle = !reading ? colors.faint : good ? colors.good : colors.accent;
      ctx.globalAlpha = reading?.live ? 1 : 0.5;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = colors.bg;
    ctx.fill();
    if (good) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = colors.good;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
  return (
    <>
      <canvas ref={canvas} className={cn("mx-auto block aspect-square w-full max-w-72", className)} data-testid="tuner-wheel" />
      <Swatches swatches={swatches} />
    </>
  );
}

/** A needle over a ±50 cent arc, eased so it doesn't jitter. */
export function NeedleDisplay({ className }: { className?: string }) {
  const angle = useRef(0);
  const { canvas, swatches } = useCanvas((ctx, width, height, reading, dt, colors) => {
    const cx = width / 2;
    const cy = height - 16;
    const radius = Math.min(width / 2 - 16, height - 32);
    const target = reading ? clampCents(reading.cents) : 0;
    angle.current += (target - angle.current) * Math.min(1, dt * 12);
    const toAngle = (cents: number) => ((cents / 50) * 70 * Math.PI) / 180;
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = "round";
    for (let cents = -50; cents <= 50; cents += 5) {
      const a = toAngle(cents);
      const long = cents % 25 === 0;
      const inner = radius - (long ? 16 : cents % 10 === 0 ? 10 : 6);
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * radius, cy - Math.cos(a) * radius);
      ctx.lineTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner);
      ctx.strokeStyle = cents === 0 ? colors.good : colors.muted;
      ctx.lineWidth = long ? 1.5 : 1;
      ctx.stroke();
      if (long) {
        ctx.fillStyle = colors.muted;
        ctx.font = "11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(cents > 0 ? `+${cents}` : `${cents}`, cx + Math.sin(a) * (inner - 12), cy - Math.cos(a) * (inner - 12) + 4);
      }
    }
    const good = inTune(reading);
    const a = toAngle(angle.current);
    const color = !reading ? colors.faint : good ? colors.good : Math.abs(reading.cents) > 30 ? "rgb(220 80 80)" : colors.accent;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(a) * (radius - 4), cy - Math.cos(a) * (radius - 4));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
  return (
    <>
      <canvas ref={canvas} className={cn("block h-48 w-full sm:h-56", className)} data-testid="tuner-needle" />
      <Swatches swatches={swatches} />
    </>
  );
}

const SPECTRUM_LOW = 20;
const SPECTRUM_HIGH = 8000;

/** The microphone's spectrum on a log scale, the note's harmonics marked, the note at its peak. */
export function SpectrumDisplay({ className }: { className?: string }) {
  const bins = useRef<Float32Array<ArrayBuffer> | null>(null);
  const { canvas, swatches } = useCanvas((ctx, width, height, reading, _dt, colors) => {
    const analyser = tunerAnalyser();
    const xOf = (hz: number) => ((Math.log10(hz) - Math.log10(SPECTRUM_LOW)) / (Math.log10(SPECTRUM_HIGH) - Math.log10(SPECTRUM_LOW))) * width;
    const yOf = (db: number) => height - ((Math.max(-100, Math.min(-10, db)) + 100) / 90) * (height - 14);
    ctx.clearRect(0, 0, width, height);
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    for (const hz of [50, 100, 200, 500, 1000, 2000, 5000]) {
      const x = xOf(hz);
      ctx.fillStyle = colors.faint;
      ctx.fillRect(x, 0, 1, height - 14);
      ctx.fillStyle = colors.muted;
      ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : `${hz}`, x, height - 2);
    }
    if (!analyser) return;
    if (!bins.current || bins.current.length !== analyser.frequencyBinCount) bins.current = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(bins.current);
    const nyquist = analyser.context.sampleRate / 2;
    if (reading) {
      for (let h = 1; h <= 8 && reading.hz * h < SPECTRUM_HIGH; h++) {
        ctx.fillStyle = colors.accent;
        ctx.globalAlpha = h === 1 ? 0.5 : 0.2;
        ctx.fillRect(xOf(reading.hz * h), 0, 1, height - 14);
      }
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const hz = 10 ** (Math.log10(SPECTRUM_LOW) + (x / width) * (Math.log10(SPECTRUM_HIGH) - Math.log10(SPECTRUM_LOW)));
      const db = bins.current[Math.min(bins.current.length - 1, Math.round((hz / nyquist) * (bins.current.length - 1)))]!;
      if (x === 0) ctx.moveTo(x, yOf(db));
      else ctx.lineTo(x, yOf(db));
    }
    ctx.strokeStyle = inTune(reading) ? colors.good : colors.accent;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  });
  return (
    <>
      <canvas ref={canvas} className={cn("block h-56 w-full sm:h-64", className)} data-testid="tuner-spectrum" />
      <Swatches swatches={swatches} />
    </>
  );
}
