/**
 * Registration for event dates (issue #593): what a date's registrations
 * count, whether a new one fits, who on the waiting list gets in, and
 * whether registration is open. The API decides with these; the pages show
 * the same answers.
 */
import type { Messages } from "../i18n/index.js";
import { localDate } from "./index.js";

/** What a registration counts (Adult, Child, Bus seat, Meal), with its own limit and price. */
export interface PlaceKind {
  id: string;
  name: string;
  /** Places of this kind a date has; null: no limit but the form's. */
  limit: number | null;
  /** In cents of the form's currency; null: free. Shown only: no online payment. */
  price: number | null;
}

export const QUESTION_TYPES = ["text", "choice", "number", "yesno"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** A field the registration form asks. */
export interface RegistrationQuestion {
  id: string;
  label: string;
  type: QuestionType;
  /** A choice's options. */
  options?: string[];
  required: boolean;
}

export const REGISTRATION_STATUSES = ["CONFIRMED", "WAITING", "CANCELLED"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Places taken by kind: { placeKindId: count }. */
export type Places = Record<string, number>;
export type RegistrationAnswers = Record<string, string | number | boolean>;

/** What decides how many fit: the form's limit and its place kinds'. */
export interface PlaceLimits {
  limit: number | null;
  placeKinds: readonly PlaceKind[];
}

/** The most places one registration takes. */
export const PLACES_PER_REGISTRATION_MAX = 50;
/** The longest an event date runs (issue #593): a weekend, a week. */
export const EVENT_DURATION_DAYS_MAX = 14;

export function placesCount(places: Places): number {
  return Object.values(places).reduce((sum, count) => sum + count, 0);
}

/** The confirmed registrations' places, in all and by kind. */
export function placesTaken(registrations: readonly { places: Places; status: RegistrationStatus | string }[]): { total: number; byKind: Places } {
  const byKind: Places = {};
  let total = 0;
  for (const registration of registrations) {
    if (registration.status !== "CONFIRMED") continue;
    for (const [kind, count] of Object.entries(registration.places)) {
      byKind[kind] = (byKind[kind] ?? 0) + count;
      total += count;
    }
  }
  return { total, byKind };
}

/** Places left, in all and by kind; null: no limit. */
export function placesLeftOf(limits: PlaceLimits, taken: { total: number; byKind: Places }): { total: number | null; byKind: Record<string, number | null> } {
  const byKind: Record<string, number | null> = {};
  for (const kind of limits.placeKinds) byKind[kind.id] = kind.limit === null ? null : Math.max(0, kind.limit - (taken.byKind[kind.id] ?? 0));
  return { total: limits.limit === null ? null : Math.max(0, limits.limit - taken.total), byKind };
}

/** Whether `places` fit in what's left. */
export function placesFit(limits: PlaceLimits, taken: { total: number; byKind: Places }, places: Places): boolean {
  const left = placesLeftOf(limits, taken);
  if (left.total !== null && placesCount(places) > left.total) return false;
  return Object.entries(places).every(([kind, count]) => {
    const kindLeft = left.byKind[kind];
    return kindLeft === null || kindLeft === undefined || count <= kindLeft;
  });
}

/**
 * Whose waiting registrations get in, in the order they came: each that
 * fits in what the confirmed ones leave, one after the other (a larger
 * family waits while a smaller one behind it fits).
 */
export function promotions(limits: PlaceLimits, confirmed: readonly { places: Places }[], waiting: readonly { id: string; places: Places }[]): string[] {
  const taken = placesTaken(confirmed.map((one) => ({ places: one.places, status: "CONFIRMED" })));
  const chosen: string[] = [];
  for (const registration of waiting) {
    if (!placesFit(limits, taken, registration.places)) continue;
    chosen.push(registration.id);
    for (const [kind, count] of Object.entries(registration.places)) taken.byKind[kind] = (taken.byKind[kind] ?? 0) + count;
    taken.total += placesCount(registration.places);
  }
  return chosen;
}

/** What's wrong with the places asked for, or null: kinds the form has, whole numbers, at least one place. */
export function placesProblem(placeKinds: readonly PlaceKind[], places: Places): string | null {
  const known = new Set(placeKinds.map((kind) => kind.id));
  for (const [kind, count] of Object.entries(places)) {
    if (!known.has(kind)) return `places has a kind this event doesn't: ${kind}`;
    if (!Number.isInteger(count) || count < 0) return "places must be whole numbers";
  }
  const total = placesCount(places);
  if (total < 1) return "places must take at least one place";
  if (total > PLACES_PER_REGISTRATION_MAX) return `places must not be more than ${PLACES_PER_REGISTRATION_MAX}`;
  return null;
}

/** Places with the kinds asked for none of left out. */
export function placesKept(places: Places): Places {
  return Object.fromEntries(Object.entries(places).filter(([, count]) => count > 0));
}

/** What's wrong with the answers, or null: every required question answered, each as its type. */
export function answersProblem(questions: readonly RegistrationQuestion[], answers: RegistrationAnswers): string | null {
  const known = new Map(questions.map((question) => [question.id, question]));
  for (const id of Object.keys(answers)) if (!known.has(id)) return `answers has a question this event doesn't ask: ${id}`;
  for (const question of questions) {
    const value = answers[question.id];
    const empty = value === undefined || value === "" || value === null;
    if (empty) {
      if (question.required && question.type !== "yesno") return `${question.label} must be answered`;
      continue;
    }
    if (question.type === "number" && typeof value !== "number") return `${question.label} must be a number`;
    if (question.type === "yesno" && typeof value !== "boolean") return `${question.label} must be yes or no`;
    if (question.type === "text" && (typeof value !== "string" || value.length > 2000)) return `${question.label} must be text, 2000 characters at most`;
    if (question.type === "choice" && (typeof value !== "string" || !(question.options ?? []).includes(value))) return `${question.label} must be one of its options`;
  }
  return null;
}

/** What the places cost, in cents; null when nothing has a price. */
export function priceOf(placeKinds: readonly PlaceKind[], places: Places): number | null {
  const priced = placeKinds.filter((kind) => kind.price !== null && (places[kind.id] ?? 0) > 0);
  if (priced.length === 0) return null;
  return priced.reduce((sum, kind) => sum + kind.price! * (places[kind.id] ?? 0), 0);
}

/** Registration's timing: opens some days before a date (null: open now), closes some hours before it starts. */
export interface RegistrationWindow {
  open: boolean;
  opensDaysBefore: number | null;
  closesHoursBefore: number;
}

export type RegistrationState = "open" | "notYet" | "closed";

/** Whether a date takes registrations now; `startsAt` is the date's start. */
export function registrationState(window: RegistrationWindow, startsAt: string, now: string | Date): RegistrationState {
  if (!window.open) return "closed";
  const start = new Date(startsAt).getTime();
  const at = new Date(now).getTime();
  if (at >= start - window.closesHoursBefore * 3_600_000) return "closed";
  if (window.opensDaysBefore !== null && at < start - window.opensDaysBefore * 86_400_000) return "notYet";
  return "open";
}

/** When a date's registration opens, or null when it's open as soon as it's made. */
export function registrationOpensAt(window: Pick<RegistrationWindow, "opensDaysBefore">, startsAt: string): string | null {
  if (window.opensDaysBefore === null) return null;
  return new Date(new Date(startsAt).getTime() - window.opensDaysBefore * 86_400_000).toISOString();
}

/** A price, as people read it: "12,50 €". */
export function formatPrice(cents: number, currency: string | null, locale: string): string {
  if (!currency) return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

/** What an email about a registration says (issue #593). */
export type RegistrationEmailKind = "confirmed" | "waiting" | "promoted" | "cancelled" | "changed" | "reminder";

const fillIn = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? "");

/**
 * An email about someone's registration, in their language: what happened,
 * then when, where, their places and what they cost.
 */
export function registrationEmail(
  kind: RegistrationEmailKind,
  data: { name: string; event: string; organizer: string; startsAt: string | null; endsAt: string | null; timeZone: string; place: string | null; places: Places; placeKinds: readonly PlaceKind[]; currency: string | null },
  messages: Messages,
  locale: string,
): { subject: string; lines: string[]; open: string } {
  const words = messages.registrationEmail;
  const values = { name: data.name, event: data.event, organizer: data.organizer };
  const lines = [fillIn(words[kind].body, values)];
  if (data.startsAt && data.endsAt) {
    const start = new Date(data.startsAt);
    const end = new Date(data.endsAt);
    const dayAndTime = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: data.timeZone });
    const timeOnly = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: data.timeZone });
    const sameDay = localDate(start, data.timeZone) === localDate(end, data.timeZone);
    lines.push(fillIn(words.when, { when: `${dayAndTime.format(start)} – ${(sameDay ? timeOnly : dayAndTime).format(end)}` }));
  }
  if (data.place) lines.push(fillIn(words.where, { place: data.place }));
  if (kind !== "cancelled") {
    const taken = data.placeKinds.filter((kind) => (data.places[kind.id] ?? 0) > 0).map((kind) => `${data.places[kind.id]} × ${kind.name}`);
    if (taken.length) lines.push(fillIn(words.places, { places: taken.join(", ") }));
    const price = priceOf(data.placeKinds, data.places);
    if (price !== null) lines.push(fillIn(words.price, { price: formatPrice(price, data.currency, locale) }));
  }
  lines.push(data.organizer);
  return { subject: fillIn(words[kind].subject, values), lines, open: words.open };
}
