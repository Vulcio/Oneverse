import type { ScreenWidget } from "./theme.js";

/**
 * A timer the media operator runs for a set (issue #269), kept in its sync
 * session: a countdown of `duration` seconds, or a count up. Running since
 * `startedAt` (server time, ms) on top of the `elapsed` ms it ran before a
 * pause; stopped, `startedAt` is null.
 */
export interface SyncTimer {
  kind: "countdown" | "count-up";
  /** A countdown's length, in seconds. */
  duration: number;
  startedAt: number | null;
  elapsed: number;
}

/** What a timer widget shows: its seconds (never negative), whether it's past zero, near it, running. */
export interface TimerReading {
  seconds: number;
  overtime: boolean;
  warn: boolean;
  running: boolean;
}

/** What a timer widget reads its time from, all on the server's clock (ms), but `localMidnight`, the device's own day. */
export interface TimerContext {
  now: number;
  /** When the set item on screen came on (a duration countdown, a song's count up); null when none. */
  itemStartedAt: number | null;
  /** The operator's timer (issue #269); null when there's none. */
  operator: SyncTimer | null;
  /** The start of the device's day, for a countdown until a time of day. */
  localMidnight: number;
}

/** How long a timer has run, in ms, at `now`. */
export function timerElapsed(timer: SyncTimer, now: number): number {
  return timer.elapsed + (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt));
}

/**
 * A countdown or count up widget's reading (issue #268), from where its
 * options say its time comes from. Null when there's nothing to count yet:
 * no operator timer, no item on screen.
 */
export function readScreenTimer(widget: { kind: ScreenWidget["kind"]; options: ScreenWidget["options"] }, context: TimerContext): TimerReading | null {
  const { source, duration, until, overtime: countOn, warn } = widget.options;
  const down = widget.kind === "countdown";
  let total: number | null = null;
  let elapsed: number;
  let running = true;
  if (source === "operator" || (!down && source !== "song")) {
    const timer = context.operator;
    if (!timer) return null;
    elapsed = timerElapsed(timer, context.now);
    running = timer.startedAt !== null;
    if (down) total = timer.kind === "countdown" ? timer.duration * 1000 : null;
  } else if (down && source === "until") {
    const [hours, minutes] = until.split(":").map(Number);
    const target = context.localMidnight + (hours! * 60 + minutes!) * 60_000;
    total = target - context.now;
    elapsed = 0;
  } else {
    if (context.itemStartedAt === null) return null;
    elapsed = Math.max(0, context.now - context.itemStartedAt);
    if (down) total = duration * 1000;
  }
  if (!down || total === null) {
    return { seconds: Math.floor(elapsed / 1000), overtime: false, warn: false, running };
  }
  const left = total - elapsed;
  if (left > 0) {
    const seconds = Math.ceil(left / 1000);
    return { seconds, overtime: false, warn: warn > 0 && seconds <= warn, running };
  }
  return { seconds: countOn === "count" ? Math.floor(-left / 1000) : 0, overtime: true, warn: false, running };
}

/** The operator's timer on its own (issue #269): a countdown's time left, or a count up's so far; amber under `warn` seconds. */
export function readSyncTimer(timer: SyncTimer, now: number, warn = 60): TimerReading {
  // From the operator's timer, there's always something to show.
  return readScreenTimer({ kind: timer.kind, options: { ...TIMER_OPTIONS, warn } }, { now, itemStartedAt: null, operator: timer, localMidnight: 0 })!;
}

const TIMER_OPTIONS: ScreenWidget["options"] = { format: "24h", seconds: false, date: false, source: "operator", duration: 300, until: "10:00", overtime: "count", warn: 60, label: "", text: "", details: true, breakpoints: [] };

/**
 * A timer widget's colours at a reading (issue #272): from its break points
 * when it has some - a countdown's with the fewest seconds still at or above
 * what's left (past zero counts as below every one), a count up's with the
 * most seconds gone by - else amber near the end and red past zero; null:
 * its own colours.
 */
export function timerColors(widget: { kind: ScreenWidget["kind"]; options: Pick<ScreenWidget["options"], "breakpoints"> }, reading: TimerReading): { color: string | null; background: string | null } | null {
  const points = widget.options.breakpoints;
  if (points.length === 0) return reading.overtime ? { color: "#ef4444", background: null } : reading.warn ? { color: "#f59e0b", background: null } : null;
  if (widget.kind === "countdown") {
    const left = reading.overtime ? -1 : reading.seconds;
    const hit = points.filter((point) => left <= point.at).sort((a, b) => a.at - b.at)[0];
    return hit ? { color: hit.color, background: hit.background } : null;
  }
  const hit = points.filter((point) => reading.seconds >= point.at).sort((a, b) => b.at - a.at)[0];
  return hit ? { color: hit.color, background: hit.background } : null;
}

/** Seconds as a timer shows them: 4:05, 1:02:03; past zero with a +. */
export function formatTimer(seconds: number, overtime = false): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const text = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return overtime && whole > 0 ? `+${text}` : text;
}
