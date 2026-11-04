import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@oneverse/ui/lib/utils";
import { along } from "#/components/input-level";
import type { Recorder } from "#/lib/recorder";
import { COLUMN, liveTake, peaksAhead } from "#/lib/take-strip";
import { drawShape } from "#/lib/wave-shape";

/** Each column's width and the gap after it (CSS px). */
const BAR = 3;
const STEP = 4;
const CLIPPING = 0.98;
/** What the microphone heard, kept to draw (columns): more than the widest strip shows. */
const KEPT = 600;

/**
 * The take as it's recorded (issue #365), small enough to sit in the
 * recording drawer: a playhead in the middle, the parts heard as a faint
 * shape behind it all, what the microphone hears growing to its left over
 * what was just played - red while recording, its height the level, amber
 * where it clips - and what's coming in the parts that are heard to its
 * right, with the sections' marks. Before a take, the microphone shows too:
 * whether the level's right, at a glance.
 */
export function TakeStrip({
  recorder,
  ahead,
  position,
  marks,
  recording,
  className,
}: {
  recorder: Recorder | null;
  /** The parts heard with the take, decoded (drawn faint, ahead). */
  ahead: AudioBuffer[];
  /** Where the playhead is in the multitrack (s); null: nothing ahead to draw. */
  position: () => number | null;
  /** The sections' starts (s), named. */
  marks: { at: number; label: string }[];
  recording: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const heard = useRef<number[]>([]);
  // The latest of what's drawn, read by the timer without restarting it.
  const latest = useRef({ ahead, position, marks, recording });
  latest.current = { ahead, position, marks, recording };

  useEffect(() => {
    heard.current = [];
    const element = canvas.current;
    if (!element || !recorder) return;
    const style = getComputedStyle(element);
    const colour = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const colours = {
      take: colour("--destructive", "#dc2626"),
      clip: "#f59e0b",
      mic: colour("--muted-foreground", "#71717a"),
      ahead: colour("--muted-foreground", "#71717a"),
      head: colour("--foreground", "#18181b"),
    };
    const draw = () => {
      const context = element.getContext("2d");
      if (!context) return;
      const width = element.clientWidth;
      const height = element.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
        element.width = Math.round(width * ratio);
        element.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const middle = Math.round(width / 2);
      const half = Math.ceil(middle / STEP);
      const tall = height - 8;
      const bar = (x: number, level: number) => {
        const size = Math.max(2, along(level) * tall);
        context.fillRect(x, (height - size) / 2, BAR, size);
      };
      const { ahead, position, marks, recording } = latest.current;
      const at = position();
      // Behind it all, what the parts heard play (a filled shape, as on Tracks): just played to the left, under the take; coming to the right.
      if (at !== null) {
        const mix = peaksAhead(ahead, at - half * COLUMN, half * 2);
        const offset = middle - half * STEP;
        context.save();
        context.translate(offset, 0);
        drawShape(context, width - offset, height, STEP, Array.from(mix), middle - offset, { colour: colours.ahead, alpha: 0.3 }, { colour: colours.ahead, alpha: 0.35 });
        context.restore();
      }
      // Left: the microphone, newest at the playhead.
      const recent = heard.current;
      for (let k = 0; k < half && k < recent.length; k++) {
        const level = recent[recent.length - 1 - k]!;
        context.fillStyle = level >= CLIPPING ? colours.clip : recording ? colours.take : colours.mic;
        context.globalAlpha = recording || level >= CLIPPING ? 1 : 0.6;
        bar(middle - (k + 1) * STEP, level);
      }
      // The sections' marks.
      if (at !== null) {
        context.fillStyle = colours.ahead;
        context.globalAlpha = 0.8;
        context.font = "10px system-ui, sans-serif";
        for (const mark of marks) {
          const x = middle + ((mark.at - at) / COLUMN) * STEP;
          if (x < 0 || x > width) continue;
          context.fillRect(Math.round(x), 0, 1, height);
          context.fillText(mark.label, Math.round(x) + 3, 10, Math.max(0, width - x - 4));
        }
      }
      context.globalAlpha = 1;
      context.fillStyle = colours.head;
      context.fillRect(middle - 1, 0, 2, height);
    };
    let wasRecording = false;
    const timer = setInterval(() => {
      const peak = recorder.inputPeak();
      heard.current.push(peak);
      // Shared with the Tracks view (issue #374): the take's own lane, from where it started.
      const { recording: now, position } = latest.current;
      if (now && !wasRecording) {
        liveTake.from = position();
        liveTake.peaks = [];
      }
      if (now && liveTake.from !== null) liveTake.peaks.push(peak);
      if (!now && wasRecording) liveTake.from = null;
      wasRecording = now;
      if (heard.current.length > KEPT) heard.current.splice(0, heard.current.length - KEPT);
      draw();
    }, COLUMN * 1000);
    return () => {
      clearInterval(timer);
      if (wasRecording) liveTake.from = null;
    };
  }, [recorder]);

  return <canvas ref={canvas} className={cn("block h-16 w-full rounded-md bg-muted/40", className)} role="img" aria-label={t("recorder.screen.strip")} data-testid="take-strip" />;
}
