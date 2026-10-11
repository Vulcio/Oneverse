import "../zod-config.js";
import { z } from "zod";
import { AVAILABILITY_ANSWERS, EVENT_PART_COUNT_MAX, EVENT_PARTS_LIMIT, isCalendarDate, isTimeOfDay, isTimeZone, partKey, SETS_AHEAD_WEEKS } from "../calendar/index.js";
import { clearableText, optional, requiredText } from "./fields.js";

/** A team's calendar (issue #235): its events and their dates. */

const date = (name: string) => z.string().refine(isCalendarDate, `${name} must be a date, YYYY-MM-DD`);
const time = (name: string) => z.string().refine(isTimeOfDay, `${name} must be a time, HH:MM`);
const timeZone = z.string().refine(isTimeZone, "timeZone must be a time zone, like Europe/Paris");
const duration = z.number().int().min(5).max(24 * 60);

const RepeatSchema = z.strictObject({
  everyWeeks: z.number().int().min(1).max(52).describe("Every n weeks, on the weekday of the event's first date"),
  until: optional(date("repeat.until")).describe("Its last date (included); left out, it goes on"),
});

/** A part an event needs: an instrument or role key (or custom instrument ID), or a name of the team's, and how many. */
const EventPartSchema = z
  .strictObject({
    part: optional(z.string().trim().min(1).max(64)),
    name: optional(z.string().trim().min(1).max(60)),
    count: z.number().int().min(1).max(EVENT_PART_COUNT_MAX),
  })
  .refine((part) => !!part.part !== !!part.name, "Each part needs either part or name, not both");

const eventParts = z
  .array(EventPartSchema)
  .max(EVENT_PARTS_LIMIT)
  .refine((parts) => new Set(parts.map((part) => partKey(part))).size === parts.length, "parts must not list the same part twice")
  .describe("The parts it needs (issue #235): instruments, roles or names, with how many");

export const CreateTeamEventSchema = z.strictObject({
  title: requiredText(120),
  date: date("date").describe("Its first date, YYYY-MM-DD"),
  startTime: time("startTime").describe("HH:MM, in the time zone"),
  durationMinutes: optional(duration).describe("90 when left out"),
  timeZone: timeZone.describe("An IANA time zone (Europe/Paris): times stay the same across daylight saving"),
  place: optional(z.string().trim().max(200)),
  note: optional(z.string().trim().max(1000)),
  repeat: optional(RepeatSchema).describe("Left out: a one-off"),
  parts: optional(eventParts),
});
export type CreateTeamEventRequest = z.input<typeof CreateTeamEventSchema>;

/** Omitted fields are left as they are; null (or "") clears. Dates already passed keep their sets. */
export const UpdateTeamEventSchema = z.strictObject({
  title: requiredText(120).optional(),
  date: date("date").optional(),
  startTime: time("startTime").optional(),
  durationMinutes: duration.optional(),
  timeZone: timeZone.optional(),
  place: clearableText(200),
  note: clearableText(1000),
  repeat: RepeatSchema.nullable().optional().describe("null makes it a one-off"),
  parts: eventParts.optional(),
});
export type UpdateTeamEventRequest = z.input<typeof UpdateTeamEventSchema>;

/** One date of an event changed by itself. null (or "") goes back to the event's. */
export const UpdateTeamEventDateSchema = z.strictObject({
  cancelled: z.boolean().optional(),
  startTime: time("startTime").nullable().optional(),
  title: clearableText(120),
});
export type UpdateTeamEventDateRequest = z.input<typeof UpdateTeamEventDateSchema>;

export const TeamEventDatesQuerySchema = z.strictObject({
  from: date("from"),
  to: date("to"),
});
export type TeamEventDatesQuery = z.input<typeof TeamEventDatesQuerySchema>;

export const UpdateTeamCalendarSchema = z.strictObject({
  setsAheadWeeks: z
    .number()
    .int()
    .min(SETS_AHEAD_WEEKS.min)
    .max(SETS_AHEAD_WEEKS.max)
    .describe("How many weeks ahead each date's set is made, 1 to 52"),
});
export type UpdateTeamCalendarRequest = z.input<typeof UpdateTeamCalendarSchema>;

/** Someone's answer for a date (issue #235); the note is seen by them and the team's admins only. */
export const AnswerEventDateSchema = z.strictObject({
  answer: z.enum(AVAILABILITY_ANSWERS).describe("AVAILABLE, IF_NEEDED (free if asked) or UNAVAILABLE"),
  note: clearableText(300).describe('"Can only play keys", "arriving late"; seen by the team\'s admins'),
});
export type AnswerEventDateRequest = z.input<typeof AnswerEventDateSchema>;

/** Days someone is away, across all their teams: every date in them reads Not available unless answered. */
export const CreateAwaySchema = z
  .strictObject({
    from: date("from"),
    to: date("to"),
    note: optional(z.string().trim().max(300)),
  })
  .refine((range) => range.to >= range.from, { message: "to must not be before from", path: ["to"] });
export type CreateAwayRequest = z.input<typeof CreateAwaySchema>;

/** Days away changed: the whole range again (first and last day, note). */
export const UpdateAwaySchema = CreateAwaySchema;
export type UpdateAwayRequest = z.input<typeof UpdateAwaySchema>;

export const MyEventDatesQuerySchema = TeamEventDatesQuerySchema;

/** A team admin asking for answers (issue #235): the dates from `from` to `to`, by `deadline`, in the asker's time zone. */
export const CreateAnswerRequestSchema = z
  .strictObject({
    from: date("from"),
    to: date("to"),
    deadline: date("deadline"),
    timeZone: z.string().refine(isTimeZone, "timeZone must be a time zone"),
  })
  .refine((request) => request.to >= request.from, { message: "to must not be before from", path: ["to"] })
  .refine((request) => request.deadline <= request.to, { message: "deadline must not be after to", path: ["deadline"] });
export type CreateAnswerRequestRequest = z.input<typeof CreateAnswerRequestSchema>;
