/**
 * A screen following its owner's schedule (issue #274): which of their sets
 * it shows today, and how the others are listed for picking one with a
 * remote. Dates are the screen's own (YYYY-MM-DD), times its local "HH:MM".
 */

/** One of the owner's sets as a screen sees it. */
export interface ScreenSetChoice {
  id: string;
  /** Its date, YYYY-MM-DD; null when it has none. */
  eventDate: string | null;
  /** When its event starts, HH:MM; null when it isn't said. */
  startTime: string | null;
}

/** A set started this long ago (minutes) is still on: a service runs a while. */
export const DAY_SET_RUNNING_MINUTES = 180;

const minutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + m!;
};

/**
 * The set of the day: among those dated today, the one going on (started
 * within DAY_SET_RUNNING_MINUTES, the latest of them), else the next to
 * start, else the latest that started; a set without a time counts as
 * starting at midnight. Null when there's none today.
 */
export function pickDaySet(sets: ScreenSetChoice[], today: string, now: string): string | null {
  const todays = sets.filter((set) => set.eventDate === today).map((set) => ({ set, at: set.startTime ? minutes(set.startTime) : 0 }));
  if (todays.length === 0) return null;
  const at = minutes(now);
  const started = todays.filter((one) => one.at <= at).sort((a, b) => b.at - a.at);
  const running = started.find((one) => at - one.at <= DAY_SET_RUNNING_MINUTES);
  if (running) return running.set.id;
  const next = todays.filter((one) => one.at > at).sort((a, b) => a.at - b.at)[0];
  return (next ?? started[0])!.set.id;
}

/**
 * The owner's sets in the order a screen offers them: today's and upcoming
 * ones by date and time, then those without a date, then past ones (the
 * archive), the latest first.
 */
export function orderScreenSets<T extends ScreenSetChoice>(sets: T[], today: string): { upcoming: T[]; undated: T[]; archive: T[] } {
  const key = (set: T) => `${set.eventDate}T${set.startTime ?? "00:00"}`;
  return {
    upcoming: sets.filter((set) => set.eventDate && set.eventDate >= today).sort((a, b) => key(a).localeCompare(key(b))),
    undated: sets.filter((set) => !set.eventDate),
    archive: sets.filter((set) => set.eventDate && set.eventDate < today).sort((a, b) => key(b).localeCompare(key(a))),
  };
}
