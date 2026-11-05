import { along } from "#/components/input-level";

/** How a waveform's drawn (issue #386): one filled shape, or thin lines. */
export type WaveStyle = "filled" | "lines";

/** How far apart the columns are (CSS px), and a line's width. */
export const WAVE_STEP: Record<WaveStyle, number> = { filled: 2, lines: 3 };
const LINE = 2;

/**
 * Where a scrolling waveform's columns are (issue #386), for a window from
 * `from` (s), `length` s across `width` CSS px. Each column is a fixed slice
 * of the song - column k from k·per to (k+1)·per - so what it measures is the
 * same every frame, and the whole waveform slides by one offset rounded to a
 * device pixel, so its shape doesn't change as it moves. Measuring from the
 * window's moving edge instead made peaks hop between columns: a shimmer.
 * Column `first + i` is drawn at `origin + i * step`.
 */
export function waveColumns(from: number, length: number, width: number, step: number, ratio: number): { first: number; per: number; count: number; origin: number } {
  const per = (length / width) * step;
  const first = Math.floor(from / per);
  const shift = Math.round((-from / length) * width * ratio) / ratio;
  const origin = first * step + shift;
  return { first, per, count: Math.ceil((width - origin) / step) + 1, origin };
}

/**
 * A waveform mirrored about the middle: one filled shape (issue #379), or a
 * thin line a column. The Tracks view's lanes and the take strip's parts
 * draw it. `levels` are 0-1, one every `step` px from x = `origin`; left of
 * `cut` is drawn as played, the rest as ahead.
 */
export function drawWave(
  context: CanvasRenderingContext2D,
  { width, height, origin = 0, step, levels, cut, played, ahead, style = "filled" }: { width: number; height: number; origin?: number; step: number; levels: ArrayLike<number>; cut: number; played: { colour: string; alpha: number }; ahead: { colour: string; alpha: number }; style?: WaveStyle },
) {
  if (!Array.prototype.some.call(levels, (level: number) => level > 0)) return;
  const middle = height / 2;
  const half = (level: number) => (level > 0 ? Math.max(style === "lines" ? 1 : 0.5, along(level) * (middle - 2)) : 0);
  const paint = () => {
    if (style === "lines") {
      for (let i = 0; i < levels.length; i++) {
        const size = half(levels[i]!);
        if (size > 0) context.fillRect(origin + i * step, middle - size, LINE, size * 2);
      }
      return;
    }
    context.beginPath();
    context.moveTo(origin, middle);
    for (let i = 0; i < levels.length; i++) context.lineTo(origin + i * step, middle - half(levels[i]!));
    for (let i = levels.length - 1; i >= 0; i--) context.lineTo(origin + i * step, middle + half(levels[i]!));
    context.closePath();
    context.fill();
  };
  for (const [left, right, look] of [
    [0, cut, played],
    [cut, width, ahead],
  ] as const) {
    if (right <= left || look.alpha <= 0) continue;
    context.save();
    context.beginPath();
    context.rect(left, 0, right - left, height);
    context.clip();
    context.globalAlpha = look.alpha;
    context.fillStyle = look.colour;
    paint();
    context.restore();
  }
}
