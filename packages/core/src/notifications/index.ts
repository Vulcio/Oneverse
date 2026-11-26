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
  // A date one signed up for moved to another day (issue #576).
  "EVENT_DATE_MOVED",
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
  // Someone put themselves on an open place, or withdrew (issue #528, to the team's admins).
  "VOLUNTEERED",
  // Someone offered to fill a place through a team that has offers confirmed (issue #559, to the team's admins), and it's confirmed (to them).
  "OFFER_TO_CONFIRM",
  "OFFER_CONFIRMED",
  "VOLUNTEER_WITHDREW",
  // Someone asks for a replacement on a part one plays: take it.
  "SWAP_OFFERED",
  // Someone took the place of the one who asked (to them, and the team's admins).
  "SWAP_TAKEN",
  // One is made the host of an organisation's event (issue #241).
  "HOSTING",
  // A team's admin asks for one of its events to become the organisation's (issue #549, to its admins): accept or decline.
  "EVENT_TRANSFER_REQUESTED",
  // The organisation took the event one asked it to, or declined (to the one who asked).
  "EVENT_TRANSFER_ACCEPTED",
  "EVENT_TRANSFER_DECLINED",
  // Someone asks to connect (issue #149, #77): accept or decline right there.
  "CONNECTION_REQUESTED",
  // Someone one asked to connect said yes.
  "CONNECTION_ACCEPTED",
  // One of one's people shares a song with one, to view or to edit.
  "SONG_SHARED",
  // One of one's people shares a songbook with one.
  "SONGBOOK_SHARED",
  // Someone offers their song to a team one runs (issue #331, to its admins): accept or decline.
  "SONG_OFFERED",
  // Someone joins a set of one's through its link (to its owner, or its team's admins).
  "SET_JOINED",
  // Someone who views a date's set asks to edit it (issue #578, to those who edit it): grant or decline.
  "SET_EDIT_REQUESTED",
  // One's ask to edit a date's set is granted, or declined (to the one who asked).
  "SET_EDIT_GRANTED",
  "SET_EDIT_DECLINED",
  // Someone whose event clashes asks one's event to free a room or resource (issue #565).
  "BOOKING_ASKED",
  // A booking of a room or resource one manages waits for approval (issue #565).
  "BOOKING_REQUESTED",
  // A booking one asked for is approved, or declined (the event gave the room or resource up).
  "BOOKING_APPROVED",
  "BOOKING_DECLINED",
  // Someone joins a team one runs through its invite link (to its admins).
  "TEAM_JOINED",
  // One is made an admin of a team, or a member again.
  "TEAM_ROLE_CHANGED",
  // A suggestion one made to someone's song is taken, or declined.
  "SUGGESTION_ACCEPTED",
  "SUGGESTION_DECLINED",
  // A song one submitted to the global catalogue is published, or sent back with changes asked for.
  "SUBMISSION_PUBLISHED",
  "SUBMISSION_RETURNED",
  // Someone records a part in a multitrack of one's song.
  "PART_RECORDED",
  // Someone replies to a note one wrote or replied to (issue #256).
  "NOTE_REPLY",
  // Someone asks for an organisation (issue #364, to the global admins): review it in Admin.
  "ORGANIZATION_REQUESTED",
  // The organisation one asked for is made, or declined (with the reviewer's reason).
  "ORGANIZATION_APPROVED",
  "ORGANIZATION_DECLINED",
  // News from the server's admins: a new version, new features (issue #536).
  "ANNOUNCEMENT",
  // News from the admins of an organisation one is in (issue #536).
  "ORGANIZATION_ANNOUNCEMENT",
  // News from the admins of a team one is in (issue #536).
  "TEAM_ANNOUNCEMENT",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** A notification's details: what its words are made of. */
export interface NotificationData {
  event?: string;
  /** YYYY-MM-DD. */
  date?: string;
  /** YYYY-MM-DD: the day a date moved to (issue #576). */
  to?: string;
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
  /** A song's title, a songbook's or a set's name (issue #149). */
  song?: string;
  songbook?: string;
  set?: string;
  /** A team role: ADMIN or MEMBER, put into words in the reader's language. */
  role?: "ADMIN" | "MEMBER";
  /** Shared to edit, not only to view. */
  canEdit?: boolean;
  /** What the reviewer wrote. */
  note?: string;
  /** An organisation's name (issue #364). */
  organization?: string;
  /** A room's or a resource's name (bookings, issue #565). */
  what?: string;
  /** The request to connect it's about: accepted or declined from the notification. */
  connectionId?: string;
  /** An announcement's own words (issue #536), by language ("en", "fr"): the reader's, else English, else the first. */
  texts?: AnnouncementTexts;
}

/** An announcement's words in one language (issue #536): a title, a few lines, and where it leads, if anywhere. */
export interface AnnouncementText {
  title: string;
  body: string;
  /** A page in the app ("/sets") or anywhere ("https://docs.oneverse.top/whats-new/"). */
  url?: string | null;
}

/** An announcement's words in each language it's written in. */
export type AnnouncementTexts = Partial<Record<string, AnnouncementText>>;

/** The kinds whose words are written by someone (issue #536) rather than made from their details. */
export const ANNOUNCEMENT_KINDS: readonly NotificationKind[] = ["ANNOUNCEMENT", "ORGANIZATION_ANNOUNCEMENT", "TEAM_ANNOUNCEMENT"];

/** An announcement's words for a reader in `locale`: theirs, else English, else the first written; null when none. */
export function announcementText(texts: AnnouncementTexts | undefined, locale: string): AnnouncementText | null {
  if (!texts || typeof texts !== "object") return null;
  const language = locale.split("-")[0]!.toLowerCase();
  return texts[language] ?? texts.en ?? Object.values(texts).find((text) => !!text) ?? null;
}

/** Where a notification leads for a reader in `locale`: an announcement's link in their language, else the one stored with it. */
export function notificationUrl(item: { kind: NotificationKind; data: NotificationData; url?: string | null }, locale: string): string | null {
  if (ANNOUNCEMENT_KINDS.includes(item.kind)) {
    const text = announcementText(item.data.texts, locale);
    if (text) return text.url || null;
  }
  return item.url ?? null;
}

/** How long notifications are kept (issue #149): read ones 90 days, unread ones a year. */
export const NOTIFICATIONS_KEPT_DAYS = { read: 90, unread: 365 } as const;

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
    to: data.to ? notificationDate(data.to, locale) : "",
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
    song: data.song ?? "",
    songbook: data.songbook ?? "",
    set: data.set ?? "",
    role: data.role ? messages.notifications.roles[data.role] : "",
    // "to edit" or "to view", after what's shared.
    access: data.canEdit === undefined ? "" : data.canEdit ? messages.notifications.toEdit : messages.notifications.toView,
    note: data.note ?? "",
    organization: data.organization ?? "",
    what: data.what ?? "",
    // What they wrote, after the rest: ": could you move to the kids room?".
    message: data.note ? `: ${data.note}` : "",
    // An announcement's own words (issue #536), in the reader's language.
    ...(ANNOUNCEMENT_KINDS.includes(kind) ? { title: announcementText(data.texts, locale)?.title ?? "", body: announcementText(data.texts, locale)?.body ?? "" } : {}),
  };
  const body = fill(words.body, values);
  // An announcement without a text: its organisation's or team's name alone, not "Grace Church · ".
  return { title: fill(words.title, values), body: ANNOUNCEMENT_KINDS.includes(kind) ? body.replace(/ · $/, "") : body };
}

/** Where a notification goes besides the bell (issue #236): by email, by push to one's devices. */
export const NOTIFICATION_CHANNELS = ["email", "push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** For each kind, whether it goes by each channel. */
export type NotificationPreferences = Record<NotificationKind, Record<NotificationChannel, boolean>>;

/** Until someone chooses: every kind by every channel - they're few, and about dates one plays - except announcements by email (issue #536): pushed, not mailed. */
export function defaultNotificationPreferences(): NotificationPreferences {
  return Object.fromEntries(
    NOTIFICATION_KINDS.map((kind) => [kind, Object.fromEntries(NOTIFICATION_CHANNELS.map((channel) => [channel, !(channel === "email" && ANNOUNCEMENT_KINDS.includes(kind))]))]),
  ) as NotificationPreferences;
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
