import { addDays, AVAILABILITY_ANSWERS, isTimeOfDay, isTimeZone, localDate, localTime, zonedInstant, type AvailabilityAnswer } from "../calendar/index.js";
import type { Messages } from "../i18n/index.js";

/**
 * What Songverse tells people (issue #236): each notification is a kind and
 * its details, written into words in the reader's language when it's shown
 * or sent (the bell, push, email, the native apps), never stored as text.
 */
export const NOTIFICATION_KINDS = [
  // A date of an event one signed up for is cancelled.
  "EVENT_DATE_CANCELLED",
  // A date one signed up for changed: its time or its title.
  "EVENT_DATE_CHANGED",
  // An event one signed up for (some coming date of it) is deleted.
  "EVENT_CANCELLED",
  // A team admin answered for one (Available, If needed, Not available).
  "ANSWERED_FOR_YOU",
  // A team admin asks for answers for some dates, by a deadline.
  "ANSWERS_REQUESTED",
  // The deadline is tomorrow and some of those dates have no answer from one.
  "ANSWER_DEADLINE",
  // A date one signed up for is tomorrow.
  "EVENT_TOMORROW",
  // A team admin says the set for a date one signed up for is ready.
  "SET_READY",
  // A team admin scheduled one on a part for a date: accept or decline.
  "SCHEDULED",
  // Someone declined a part they were scheduled on (to the team's admins).
  "SCHEDULE_DECLINED",
  // A team admin took one off a part.
  "UNSCHEDULED",
  // Someone asks for a replacement on a part one plays: take it.
  "SWAP_OFFERED",
  // Someone took the place of the one who asked (to them, and the team's admins).
  "SWAP_TAKEN",
  // One is made the host of an organisation's event (issue #241).
  "HOSTING",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** A notification's details: what its words are made of. */
export interface NotificationData {
  event?: string;
  /** YYYY-MM-DD. */
  date?: string;
  team?: string;
  /** HH:MM. */
  startTime?: string;
  /** HH:MM: when to be there (issue #240), before startTime. */
  callTime?: string;
  answer?: AvailabilityAnswer;
  /** Who did it. */
  by?: string;
  /** YYYY-MM-DD: when answers are wanted by. */
  deadline?: string;
  place?: string;
  /** How many: dates without an answer, songs in a set. */
  count?: number;
  /** A part: an instrument or role key, put into words in the reader's language. */
  part?: string;
  /** A part's own name (a team's, or an admin's custom instrument), when its key has none. */
  partName?: string;
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? "");

/** A date as a notification names it: "Sun, Oct 12" / "dim. 12 oct.". */
export function notificationDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

/** A part in words: its instrument or role in the reader's language, else its own name. */
function partWords(data: NotificationData, messages: Messages): string {
  if (data.part) {
    const roles = messages.roles as { instrument: Record<string, string>; techRole: Record<string, string> };
    const known = roles.instrument[data.part] ?? roles.techRole[data.part];
    if (known) return known;
  }
  return data.partName ?? data.part ?? "";
}

/** A notification in words: its title and a line under it, in the language of `messages` (`locale` formats the date). */
export function notificationText(kind: NotificationKind, data: NotificationData, messages: Messages, locale: string): { title: string; body: string } {
  const words = messages.notifications.kinds[kind];
  const answers = messages.notifications.answers;
  const values = {
    event: data.event ?? "",
    date: data.date ? notificationDate(data.date, locale) : "",
    team: data.team ?? "",
    time: data.startTime ?? "",
    answer: data.answer && (AVAILABILITY_ANSWERS as readonly string[]).includes(data.answer) ? answers[data.answer] : "",
    by: data.by ?? "",
    deadline: data.deadline ? notificationDate(data.deadline, locale) : "",
    // After the team, when there's one: "Worship team · Main hall".
    place: data.place ? ` · ${data.place}` : "",
    // After the place: "· call time 9:15".
    call: data.callTime ? ` · ${fill(messages.notifications.callTime, { time: data.callTime })}` : "",
    count: data.count === undefined ? "" : String(data.count),
    part: partWords(data, messages),
  };
  return { title: fill(words.title, values), body: fill(words.body, values) };
}

/** Where a notification goes besides the bell (issue #236): by email, by push to one's devices. */
export const NOTIFICATION_CHANNELS = ["email", "push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** For each kind, whether it goes by each channel. */
export type NotificationPreferences = Record<NotificationKind, Record<NotificationChannel, boolean>>;

/** Until someone chooses: every kind by every channel - they're few, and about dates one plays. */
export function defaultNotificationPreferences(): NotificationPreferences {
  return Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, Object.fromEntries(NOTIFICATION_CHANNELS.map((channel) => [channel, true]))])) as NotificationPreferences;
}

/**
 * Someone's choices as stored (`User.notificationSettings`): `{ kinds: {
 * KIND: { email?, push? } } }`, a choice left out taking the default, and
 * anything else ignored.
 */
export function notificationPreferences(stored: unknown): NotificationPreferences {
  const out = defaultNotificationPreferences();
  const kinds = stored && typeof stored === "object" ? (stored as { kinds?: unknown }).kinds : undefined;
  if (!kinds || typeof kinds !== "object") return out;
  for (const kind of NOTIFICATION_KINDS) {
    const choice = (kinds as Record<string, unknown>)[kind];
    if (!choice || typeof choice !== "object") continue;
    for (const channel of NOTIFICATION_CHANNELS) {
      const on = (choice as Record<string, unknown>)[channel];
      if (typeof on === "boolean") out[kind][channel] = on;
    }
  }
  return out;
}

/** Stored choices with `changes` applied: what's left out stays as it was. */
export function withNotificationChanges(stored: unknown, changes: Partial<Record<NotificationKind, Partial<Record<NotificationChannel, boolean | null>>>>): { kinds: NotificationPreferences } {
  const kinds = notificationPreferences(stored);
  for (const kind of NOTIFICATION_KINDS) for (const channel of NOTIFICATION_CHANNELS) {
    const on = changes[kind]?.[channel];
    if (typeof on === "boolean") kinds[kind][channel] = on;
  }
  return { kinds };
}

/**
 * Notifications in an email (issue #236), in the language of `messages`:
 * one, by its own title, or several at once (an event changed, its dates
 * with it) under one subject. Plain text; the sender makes the HTML.
 */
export function notificationEmail(
  items: { kind: NotificationKind; data: NotificationData }[],
  messages: Messages,
  locale: string,
): { subject: string; lines: { title: string; body: string }[] } {
  const lines = items.map((item) => notificationText(item.kind, item.data, messages, locale));
  const subject = lines.length === 1 ? lines[0]!.title : fill(messages.notifications.email.several, { count: String(lines.length) });
  return { subject, lines };
}

/** A notification on a device's screen (issue #236): one by its own words, several under one title, the first few listed. */
export function notificationPush(items: { kind: NotificationKind; data: NotificationData }[], messages: Messages, locale: string): { title: string; body: string } {
  const { subject, lines } = notificationEmail(items, messages, locale);
  if (lines.length === 1) return { title: subject, body: lines[0]!.body };
  return { title: subject, body: lines.slice(0, 3).map((line) => line.title).join("\n") + (lines.length > 3 ? "\n…" : "") };
}

/** Hours someone's devices stay quiet (issue #236): from, to (HH:MM, to the next day when earlier), in their time zone. */
export interface QuietHours {
  from: string;
  to: string;
  timeZone: string;
}

/** Someone's quiet hours as stored (`User.notificationSettings.quiet`), or null: none, or not valid. */
export function quietHoursOf(stored: unknown): QuietHours | null {
  const quiet = stored && typeof stored === "object" ? (stored as { quiet?: unknown }).quiet : undefined;
  if (!quiet || typeof quiet !== "object") return null;
  const { from, to, timeZone } = quiet as Record<string, unknown>;
  if (typeof from !== "string" || typeof to !== "string" || typeof timeZone !== "string") return null;
  if (!isTimeOfDay(from) || !isTimeOfDay(to) || !isTimeZone(timeZone) || from === to) return null;
  return { from, to, timeZone };
}

/**
 * When quiet hours that are on at `now` end, ISO 8601 in UTC; null when
 * they aren't on (or there are none). Hours from 22:00 to 07:00 run over
 * midnight; the end is the wall-clock time in their zone, whatever the
 * clocks did.
 */
export function quietHoursEnd(quiet: QuietHours | null, now: string | Date): string | null {
  if (!quiet || quiet.from === quiet.to) return null;
  const today = localDate(now, quiet.timeZone);
  const time = localTime(now, quiet.timeZone);
  if (quiet.from < quiet.to) return time >= quiet.from && time < quiet.to ? zonedInstant(today, quiet.to, quiet.timeZone) : null;
  if (time >= quiet.from) return zonedInstant(addDays(today, 1), quiet.to, quiet.timeZone);
  if (time < quiet.to) return zonedInstant(today, quiet.to, quiet.timeZone);
  return null;
}

/** The push services browsers subscribe with: Google (Chrome, Edge, Android), Mozilla, Apple, Microsoft. */
const PUSH_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

/**
 * Whether a device's push address is one of the push services' (issue
 * #236) - the server posts to it, so never anywhere else - or starts with
 * one of `extraOrigins` (a stand-in for tests).
 */
export function isPushEndpoint(endpoint: string, extraOrigins: string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (extraOrigins.some((origin) => origin && url.origin === new URL(origin).origin)) return true;
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  return PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}
