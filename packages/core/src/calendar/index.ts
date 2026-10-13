/**
 * A team's calendar (issue #235): events, one-off or repeating, and the
 * dates they fall on. An event's time is a wall-clock time in the team's
 * time zone - "every Sunday at 10:00" stays at 10:00 across daylight
 * saving - so each date's instant is worked out in that zone. Dates are
 * calendar days, "YYYY-MM-DD", in that zone.
 */

/** How an event repeats: every `everyWeeks` weeks on its first date's weekday, until `until` (that day included) or for ever. */
export interface EventRepeat {
  everyWeeks: number;
  until?: string | null;
}

/** When an event happens: its first date and time, how long, in which zone, and whether it repeats. */
export interface EventTiming {
  /** The first date, YYYY-MM-DD. */
  date: string;
  /** Its start, HH:MM (24-hour), in `timeZone`. */
  startTime: string;
  durationMinutes: number;
  /** An IANA time zone ("Europe/Paris"). */
  timeZone: string;
  repeat?: EventRepeat | null;
}

/** One date of an event changed by itself: cancelled, another time or another title. */
export interface EventDateChange {
  date: string;
  cancelled?: boolean;
  startTime?: string | null;
  title?: string | null;
}

/** A date an event falls on, with its own changes applied. */
export interface EventDate {
  date: string;
  startTime: string;
  /** The start and end instants, ISO 8601 in UTC. */
  startsAt: string;
  endsAt: string;
  /** This date's own title, if it has one. */
  title: string | null;
  cancelled: boolean;
  /** Changed by itself (a time or a title of its own); cancelled dates aren't counted. */
  changed: boolean;
}

/** The most dates `eventDates` lists at once. */
export const EVENT_DATES_LIMIT = 1000;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Whether a string is a calendar date, YYYY-MM-DD, that exists. */
export function isCalendarDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return day.toISOString().slice(0, 10) === value;
}

/** Whether a string is a time of day, HH:MM (24-hour). */
export function isTimeOfDay(value: string): boolean {
  return TIME.test(value);
}

/** Whether a time zone is one this runtime knows (an IANA name). */
export function isTimeZone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A date `days` days after `date` (before, if negative). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The days from `a` to `b` (negative if `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  const time = (date: string) => {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((time(b) - time(a)) / 86_400_000);
}

/** The day of the week of a date: 0 Sunday to 6 Saturday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall clock in `timeZone` at an instant: its date, and minutes past midnight. */
function wallClock(ms: number, timeZone: string) {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24, min: Number(parts.minute), s: Number(parts.second) };
}

/** How far ahead of UTC `timeZone` is at an instant, in ms. */
function offsetAt(ms: number, timeZone: string): number {
  const c = wallClock(ms, timeZone);
  return Date.UTC(c.y, c.m - 1, c.d, c.h, c.min, c.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant a wall-clock time happens in a time zone, ISO 8601 in UTC.
 * A time skipped when the clocks go forward is taken as the same time
 * after the change (02:30 becomes 03:30); one that happens twice when they
 * go back, as the first.
 */
export function zonedInstant(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [h, min] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, h, min);
  // The zone's offset a day either side: the larger is before a change back, the smaller after one forward.
  const before = offsetAt(wall - 86_400_000, timeZone);
  const after = offsetAt(wall + 86_400_000, timeZone);
  for (const offset of before >= after ? [before, after] : [after, before]) {
    const instant = wall - offset;
    if (offsetAt(instant, timeZone) === offset) return new Date(instant).toISOString();
  }
  // Skipped (clocks forward): the same wall time, with the offset from before the change.
  return new Date(wall - Math.min(before, after)).toISOString();
}

/** The date an instant falls on in a time zone, YYYY-MM-DD. */
export function localDate(instant: string | Date, timeZone: string): string {
  const c = wallClock(new Date(instant).getTime(), timeZone);
  return `${String(c.y).padStart(4, "0")}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`;
}

/** The wall-clock time an instant falls on in a time zone, HH:MM. */
export function localTime(instant: string | Date, timeZone: string): string {
  const c = wallClock(new Date(instant).getTime(), timeZone);
  return `${String(c.h).padStart(2, "0")}:${String(c.min).padStart(2, "0")}`;
}

/** Whether a date is over: before today in its time zone (an event's date stays coming until the day after). */
export function isPastDate(date: string, now: string | Date, timeZone: string): boolean {
  return date < localDate(now, timeZone);
}

/** Whether an event falls on a date (before any date's own changes). */
export function eventFallsOn(event: Pick<EventTiming, "date" | "repeat">, date: string): boolean {
  if (date === event.date) return true;
  const repeat = event.repeat;
  if (!repeat || date < event.date || (repeat.until && date > repeat.until)) return false;
  const days = daysBetween(event.date, date);
  return days % (7 * repeat.everyWeeks) === 0;
}

/**
 * The dates an event falls on from `from` to `to` (both included), with
 * each date's own changes - cancelled, another start time or title. At
 * most `EVENT_DATES_LIMIT` dates.
 */
export function eventDates(event: EventTiming, from: string, to: string, changes: EventDateChange[] = []): EventDate[] {
  const byDate = new Map(changes.map((change) => [change.date, change]));
  const dates: string[] = [];
  const step = event.repeat ? 7 * Math.max(1, event.repeat.everyWeeks) : 0;
  const last = event.repeat?.until && event.repeat.until < to ? event.repeat.until : to;
  if (!event.repeat) {
    if (event.date >= from && event.date <= to) dates.push(event.date);
  } else {
    // The first date on or after `from`.
    const skip = from > event.date ? Math.ceil(daysBetween(event.date, from) / step) : 0;
    for (let date = addDays(event.date, skip * step); date <= last && dates.length < EVENT_DATES_LIMIT; date = addDays(date, step)) dates.push(date);
  }
  return dates.map((date) => {
    const change = byDate.get(date);
    const startTime = change?.startTime || event.startTime;
    const startsAt = zonedInstant(date, startTime, event.timeZone);
    return {
      date,
      startTime,
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + event.durationMinutes * 60_000).toISOString(),
      title: change?.title || null,
      cancelled: !!change?.cancelled,
      changed: !change?.cancelled && (!!change?.title || (!!change?.startTime && change.startTime !== event.startTime)),
    };
  });
}

/** A rehearsal tied to an event (issue #235, phase 7): that many days before each of its dates, at its own time. */
export interface RehearsalTiming {
  daysBefore: number;
  startTime: string;
  durationMinutes: number;
}

/** The most days a rehearsal comes before its event's date. */
export const REHEARSAL_DAYS_BEFORE_MAX = 14;

/** A rehearsal's date: when it is, and the event's date it's for. */
export interface RehearsalDate extends EventDate {
  /** The event's date it rehearses for. */
  forDate: string;
}

/**
 * A rehearsal's dates from `from` to `to`: one for each of its event's
 * dates (with their own changes), `daysBefore` days before it, at the
 * rehearsal's own time in the event's time zone. Cancelled with the date
 * it's for.
 */
export function rehearsalDates(event: EventTiming, rehearsal: RehearsalTiming, from: string, to: string, changes: EventDateChange[] = []): RehearsalDate[] {
  return eventDates(event, addDays(from, rehearsal.daysBefore), addDays(to, rehearsal.daysBefore), changes).map((date) => {
    const day = addDays(date.date, -rehearsal.daysBefore);
    const startsAt = zonedInstant(day, rehearsal.startTime, event.timeZone);
    return {
      date: day,
      startTime: rehearsal.startTime,
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + rehearsal.durationMinutes * 60_000).toISOString(),
      title: null,
      cancelled: date.cancelled,
      changed: false,
      forDate: date.date,
    };
  });
}

/** How many weeks ahead a team's event sets are made (issue #235): its setting, 1 to 52 (a year). */
export const SETS_AHEAD_WEEKS = { min: 1, max: 52, default: 4 } as const;

/** A person's answer for a date (issue #235): Available, If needed (free if asked, not first choice), Not available. */
export const AVAILABILITY_ANSWERS = ["AVAILABLE", "IF_NEEDED", "UNAVAILABLE"] as const;
export type AvailabilityAnswer = (typeof AVAILABILITY_ANSWERS)[number];

/** Days someone is away ("1-15 August"): every date in them, both included. */
export interface AwayRange {
  from: string;
  to: string;
}

/**
 * Someone's answer for a date: the date's own answer if they gave one,
 * else Not available when the date falls in a range they're away, else
 * none - no answer is never taken as Available.
 */
export function effectiveAnswer(own: AvailabilityAnswer | null, away: AwayRange[], date: string): { answer: AvailabilityAnswer | null; away: boolean } {
  if (own) return { answer: own, away: false };
  return away.some((range) => range.from <= date && date <= range.to) ? { answer: "UNAVAILABLE", away: true } : { answer: null, away: false };
}

/** Whether someone signed up for a date: they answered Available (If needed isn't signing up). */
export function signedUp(answer: AvailabilityAnswer | null): boolean {
  return answer === "AVAILABLE";
}

/**
 * Where a set is listed for someone (issue #235). A set made by hand:
 * "sidebar" (as always). A set made for a date of their team's calendar:
 * "sidebar" while the date is coming and they signed up for it; "list"
 * (the Sets page and the team's calendar, not the sidebar) while it's
 * coming and they didn't; "archive" once it's past if they took part;
 * "hidden" once it's past if they didn't (the team's page still has it).
 */
export type SetListing = "sidebar" | "list" | "archive" | "hidden";

export function setListing(set: { fromEvent?: boolean; signedUp?: boolean; past?: boolean }): SetListing {
  if (!set.fromEvent) return "sidebar";
  if (set.past) return set.signedUp ? "archive" : "hidden";
  return set.signedUp ? "sidebar" : "list";
}

/** The days a calendar's week can start on (issue #235): Sunday, Monday, Saturday. Someone's choice, or none: their language's. */
export const WEEK_STARTS = [0, 1, 6] as const;
export type WeekStart = (typeof WEEK_STARTS)[number];

/** When a date's people are reminded the day before (issue #235): from this time, in the event's time zone. */
export const DAY_BEFORE_REMINDER_TIME = "18:00";
/** When people are reminded that answers are due tomorrow: from this time, in the zone they were asked in. */
export const DEADLINE_REMINDER_TIME = "10:00";

/**
 * Whether the day-before reminder for a date is due at `now`: the day
 * before, from DAY_BEFORE_REMINDER_TIME to midnight, in the event's zone.
 * Not on the day itself, where "tomorrow" would be wrong (the job runs
 * every hour, so it's only missed by a date added after midnight).
 */
export function dayBeforeReminderDue(date: string, startsAt: string, timeZone: string, now: string | Date): boolean {
  if (new Date(now).getTime() >= new Date(startsAt).getTime()) return false;
  return localDate(now, timeZone) === addDays(date, -1) && localTime(now, timeZone) >= DAY_BEFORE_REMINDER_TIME;
}

/** Whether the reminder that answers are due is due at `now`: the day before the deadline from DEADLINE_REMINDER_TIME, or on the deadline itself. */
export function deadlineReminderDue(deadline: string, timeZone: string, now: string | Date): boolean {
  const today = localDate(now, timeZone);
  if (today === deadline) return true;
  return today === addDays(deadline, -1) && localTime(now, timeZone) >= DEADLINE_REMINDER_TIME;
}
export * from "./parts.js";
