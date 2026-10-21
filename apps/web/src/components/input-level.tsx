import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Recorder } from "#/lib/recorder";
import { cn } from "@oneverse/ui/lib/utils";

/** Read every 50 ms; judged over the last 1.5 s. */
const EVERY_MS = 50;
const JUDGED_OVER = 30;
/** Under -24 dBFS is too quiet to sing into; at full scale, it clips. */
const QUIET = 0.063;
const CLIPPING = 0.98;
/** The meter's scale: -48 dBFS to 0. */
const FLOOR_DB = -48;
/** The peak held this long before it falls. */
const HOLD_MS = 1200;

export type InputLevelVerdict = "quiet" | "good" | "loud";

/** Whether a singer is loud enough, from their recent peaks (0-1). */
export function judgeLevel(peaks: number[]): InputLevelVerdict {
  const loudest = Math.max(0, ...peaks.slice(-JUDGED_OVER));
  return loudest >= CLIPPING ? "loud" : loudest < QUIET ? "quiet" : "good";
}

/** Where a level (0-1) sits along the meter, 0-1, in decibels. */
function along(level: number): number {
  if (level <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(level) - FLOOR_DB) / -FLOOR_DB));
}

/**
 * What the microphone hears, as soon as it's open (issues #141, #142): a
 * horizontal meter, as on a mixing desk - the level now, its peak held a
 * moment, the too-quiet and clipping zones marked - and whether that's loud
 * enough, before a take, so there's no need to record one to find out.
 */
export function InputLevel({ recorder, className }: { recorder: Recorder | null; className?: string }) {
  const { t } = useTranslation();
  const [level, setLevel] = useState(0);
  const [held, setHeld] = useState(0);
  const [verdict, setVerdict] = useState<InputLevelVerdict | null>(null);
  const recent = useRef<number[]>([]);
  const hold = useRef({ level: 0, at: 0 });

  useEffect(() => {
    recent.current = [];
    hold.current = { level: 0, at: 0 };
    setLevel(0);
    setHeld(0);
    setVerdict(null);
    if (!recorder) return;
    const timer = setInterval(() => {
      const peak = recorder.inputPeak();
      recent.current = [...recent.current.slice(1 - JUDGED_OVER), peak];
      // Up at once, down gently (a meter's ballistics).
      setLevel((before) => Math.max(peak, before * 0.8));
      const now = Date.now();
      if (peak >= hold.current.level || now - hold.current.at > HOLD_MS) hold.current = { level: peak, at: now };
      setHeld(hold.current.level);
      setVerdict(judgeLevel(recent.current));
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [recorder]);

  if (!recorder) return null;
  const colour = verdict === "loud" ? "bg-destructive" : verdict === "quiet" ? "bg-amber-500" : "bg-primary";
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs", className)} data-testid="input-level" data-level={verdict ?? "none"}>
      <span className="shrink-0 text-muted-foreground">{t("recorder.micLevel")}</span>
      <div
        className="relative h-3 min-w-24 flex-1 overflow-hidden rounded-sm bg-muted"
        role="meter"
        aria-label={t("recorder.micLevel")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(along(level) * 100)}
        data-testid="input-meter"
      >
        {/* Too quiet up to -24 dB; clipping at the end. */}
        <div className="absolute inset-y-0 left-0 bg-amber-500/15" style={{ width: `${along(QUIET) * 100}%` }} />
        <div className="absolute inset-y-0 right-0 bg-destructive/20" style={{ width: `${(1 - along(CLIPPING)) * 100}%` }} />
        <div className={cn("absolute inset-y-0 left-0 transition-[width] duration-75", colour)} style={{ width: `${along(level) * 100}%` }} />
        {held > 0 ? <div className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `calc(${along(held) * 100}% - 1px)` }} /> : null}
      </div>
      <span className={cn("w-full sm:w-56 sm:shrink-0", verdict === "loud" ? "text-destructive" : verdict === "quiet" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")} role="status">
        {verdict ? t(verdict === "good" ? "recorder.levelGood" : verdict === "loud" ? "recorder.levelLoud" : "recorder.levelQuiet") : null}
      </span>
    </div>
  );
}
