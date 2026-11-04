import { along } from "#/components/input-level";

/**
 * A waveform as one filled shape, mirrored about the middle (issue #379):
 * calmer than lines while it scrolls. The Tracks view's lanes and the take
 * strip's parts draw it. `levels` are 0-1, one every `step` px
 * from x = 0; left of `cut` is drawn as played, the rest as ahead.
 */
export function drawShape(context: CanvasRenderingContext2D, width: number, height: number, step: number, levels: number[], cut: number, played: { colour: string; alpha: number }, ahead: { colour: string; alpha: number }) {
  if (!levels.some((level) => level > 0)) return;
  const middle = height / 2;
  const half = (level: number) => (level > 0 ? Math.max(0.5, along(level) * (middle - 2)) : 0);
  const outline = () => {
    context.beginPath();
    context.moveTo(0, middle);
    levels.forEach((level, i) => context.lineTo(i * step, middle - half(level)));
    for (let i = levels.length - 1; i >= 0; i--) context.lineTo(i * step, middle + half(levels[i]!));
    context.closePath();
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
    outline();
    context.fill();
    context.restore();
  }
}
