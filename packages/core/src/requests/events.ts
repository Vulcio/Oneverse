import "../zod-config.js";
import { z } from "zod";
import { ASSIGNMENT_STATUSES, DATE_ASKS_LIMIT, isEventOnlyPart, OPEN_TO_LIMIT, AVAILABILITY_ANSWERS, CALL_MINUTES_MAX, EVENT_PART_COUNT_MAX, REHEARSAL_DAYS_BEFORE_MAX, EVENT_PARTS_LIMIT, isCalendarDate, isTimeOfDay, isTimeZone, partKey, SETS_AHEAD_WEEKS, WISHES_LIMIT } from "../calendar/index.js";
import { clearableText, optional, requiredText } from "./fields.js";

/** A team's calendar (issue #235): its events and their dates. */

const date = (name: string) => z.string().refine(isCalendarDate, `${name} must be a date, YYYY-MM-DD`);
const time = (name: string) => z.string().refine(isTimeOfDay, `${name} must be a time, HH:MM`);
const timeZone = z.string().refine(isTimeZone, "timeZone must be a time zone, like Europe/Paris");
const duration = z.number().int().min(5).max(24 * 60);
/** A call time (issue #240): how long before the start to be there. */
const callMinutes = z.number().int().min(1).max(CALL_MINUTES_MAX).describe("Call time: minutes before the start to be there");

const RepeatSchema = z.strictObject({
  everyWeeks: z.number().int().min(1).max(52).describe("Every n weeks, on the weekday of the event's first date"),
  until: optional(date("repeat.until")).describe("Its last date (included); left out, it goes on"),
});

/** A part an event needs: an instrument or role key (or custom instrument ID), or a name of the team's, and how many. */
const EventPartSchema = z
  .strictObject({
    part: optional(z.string().trim().min(1).max(64)),
    position: optional(z.string().trim().min(1).max(64)).describe("One of the group's own positions (issue #241), by its ID"),
    name: optional(z.string().trim().min(1).max(60)),
    count: z.number().int().min(1).max(EVENT_PART_COUNT_MAX),
    required: optional(z.boolean()).describe("It must be filled (issue #528): a date without it says it's missing"),
    openTo: optional(z.array(z.string().trim().min(1).max(64)).max(OPEN_TO_LIMIT)).describe("Teams whose members may put themselves on it (issue #528): the event's team or groups of its organisation"),
    leadsSet: optional(z.boolean()).describe("Whoever fills it leads the date's set (issue #559); left out, Host and Music leader do"),
  })
  .refine((part) => !(part.part && (part.position || part.name)) && !!(part.part || part.position || part.name), "Each part needs either part, position or name");

const eventParts = z
  .array(EventPartSchema)
  .max(EVENT_PARTS_LIMIT)
  .refine((parts) => new Set(parts.map((part) => partKey(part))).size === parts.length, "parts must not list the same part twice")
  .describe("The parts it needs (issue #235): instruments, roles, the group's positions or names, with how many");

/** A rehearsal for another of the team's events: that many days before each of its dates. */
const RehearsalForSchema = z.strictObject({
  eventId: z.string().trim().min(1).max(64),
  daysBefore: z.number().int().min(0).max(REHEARSAL_DAYS_BEFORE_MAX),
});

export const CreateTeamEventSchema = z.strictObject({
  title: requiredText(120),
  date: date("date").describe("Its first date, YYYY-MM-DD"),
  startTime: time("startTime").describe("HH:MM, in the time zone"),
  durationMinutes: optional(duration).describe("90 when left out"),
  callMinutes: optional(callMinutes),
  timeZone: timeZone.describe("An IANA time zone (Europe/Paris): times stay the same across daylight saving"),
  place: optional(z.string().trim().max(200)),
  locationId: optional(z.string().trim().min(1).max(64)).describe("Where it takes place (issue #320): one of the team's or its organisation's locations; `place` is filled from it when left out"),
  roomIds: optional(z.array(z.string().trim().min(1).max(64)).max(20)).describe("Rooms of its location it takes (issue #563)"),
  note: optional(z.string().trim().max(1000)),
  repeat: optional(RepeatSchema).describe("Left out: a one-off"),
  parts: optional(eventParts),
  rehearsalFor: optional(RehearsalForSchema).describe("A rehearsal tied to another event (issue #235): its dates follow that event's"),
  typeId: optional(z.string().trim().min(1).max(64)).describe("The team's event type it's made from (issue #523), kept for reference: the other fields are sent as they are"),
  withSet: optional(z.boolean()).describe("Whether its dates get a set (issue #523); left out, true for a team that uses Songverse and false for a group that only plans (issue #531)"),
  editsSet: optional(z.boolean()).describe("Whether the team's admins and its people on a date's line-up edit the date's set (issue #578); true when left out. false: only its admins"),
});
export type CreateTeamEventRequest = z.input<typeof CreateTeamEventSchema>;

/** Omitted fields are left as they are; null (or "") clears. Dates already passed keep their sets. */
export const UpdateTeamEventSchema = z.strictObject({
  title: requiredText(120).optional(),
  date: date("date").optional(),
  startTime: time("startTime").optional(),
  durationMinutes: duration.optional(),
  callMinutes: callMinutes.nullable().optional().describe("null: no call time"),
  timeZone: timeZone.optional(),
  place: clearableText(200),
  locationId: z.string().trim().min(1).max(64).nullable().optional().describe("null: no location"),
  roomIds: optional(z.array(z.string().trim().min(1).max(64)).max(20)).describe("Rooms of its location it takes (issue #563); [] takes none"),
  note: clearableText(1000),
  repeat: RepeatSchema.nullable().optional().describe("null makes it a one-off"),
  parts: eventParts.optional(),
  rehearsalFor: RehearsalForSchema.nullable().optional().describe("null: an event of its own"),
  typeId: z.string().trim().min(1).max(64).nullable().optional().describe("null: no type"),
  withSet: z.boolean().optional().describe("false: coming empty sets are deleted (sets with songs stay); true: they're made"),
  editsSet: z.boolean().optional().describe("Whether its people on a date's line-up edit the date's set (issue #578)"),
});
export type UpdateTeamEventRequest = z.input<typeof UpdateTeamEventSchema>;

/** A kind of event the team holds (issue #523): what a new event of it starts with. */
export const CreateTeamEventTypeSchema = z.strictObject({
  name: requiredText(120).describe("Its name, and a new event's title"),
  startTime: optional(time("startTime")),
  durationMinutes: optional(duration),
  callMinutes: optional(callMinutes),
  parts: optional(eventParts),
  withSet: optional(z.boolean()).describe("Whether its events' dates get a set; true when left out"),
  editingTeamIds: optional(z.array(z.string().trim().min(1).max(64)).max(30)).describe("An organisation's type (issue #578): the groups that edit its events' sets. Left out or empty: every group that uses Songverse"),
  locationId: optional(z.string().trim().min(1).max(64)).describe("Where its events usually are (issue #559): one of its owner's locations"),
  roomIds: optional(z.array(z.string().trim().min(1).max(64)).max(20)).describe("Rooms of its location it takes (issue #563)"),
});
export type CreateTeamEventTypeRequest = z.input<typeof CreateTeamEventTypeSchema>;

/** Omitted fields are left as they are; null clears. Events already made from it keep what they have. */
export const UpdateTeamEventTypeSchema = z.strictObject({
  name: requiredText(120).optional(),
  startTime: time("startTime").nullable().optional(),
  durationMinutes: duration.nullable().optional(),
  callMinutes: callMinutes.nullable().optional(),
  parts: eventParts.optional(),
  withSet: z.boolean().optional(),
  editingTeamIds: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
  locationId: z.string().trim().min(1).max(64).nullable().optional(),
  roomIds: optional(z.array(z.string().trim().min(1).max(64)).max(20)).describe("Rooms of its location it takes (issue #563); [] takes none"),
});
export type UpdateTeamEventTypeRequest = z.input<typeof UpdateTeamEventTypeSchema>;

/** One date of an event changed by itself. null (or "") goes back to the event's. */
export const UpdateTeamEventDateSchema = z.strictObject({
  cancelled: z.boolean().optional(),
  startTime: time("startTime").nullable().optional(),
  title: clearableText(120),
});
export type UpdateTeamEventDateRequest = z.input<typeof UpdateTeamEventDateSchema>;

/** One date moved to another day (issue #576), with its answers, line-up and set: a day no other date of the event is on. */
export const MoveEventDateSchema = z.strictObject({
  to: date("to"),
});
export type MoveEventDateRequest = z.input<typeof MoveEventDateSchema>;

/**
 * What a date asks for besides its event's parts (issue #549): the
 * instruments (or the group's positions, or names) its music lead wants
 * that date, each with how many. Whoever the event's Music part is open to
 * answers them; Host and Speaker aren't asked this way (only an event asks for them).
 */
export const SetTeamEventDateAsksSchema = z.strictObject({
  parts: z
    .array(EventPartSchema)
    .max(DATE_ASKS_LIMIT)
    .refine((parts) => new Set(parts.map((part) => partKey(part))).size === parts.length, "parts must not list the same part twice")
    .refine((parts) => parts.every((part) => !part.part || !isEventOnlyPart(part.part)), "parts can't ask for a Host or a Speaker: the event does")
    .describe("What the date asks for besides its event's parts: instruments, positions or names, with how many"),
});
export type SetTeamEventDateAsksRequest = z.input<typeof SetTeamEventDateAsksSchema>;

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
  wishes: optional(z.array(z.string().trim().min(1).max(200)).max(WISHES_LIMIT)).describe(
    "The parts they'd like to play that date (issue #520), by key: the date's parts, or, when its event lists none, their own instruments and roles. Left out, kept; dropped on UNAVAILABLE",
  ),
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

/**
 * Someone scheduled on a part for a date (issue #235, phase 7), and the
 * part's key (partKey): a member or one of the admin's People (`userId`),
 * or someone without an account, by name, for reference (`guestName`).
 * Someone without an account always comes with an email too (`guestEmail`,
 * issues #523 and #520), so they can be reached.
 */
export const AssignPartSchema = z
  .strictObject({
    userId: optional(z.string().trim().min(1).max(64)),
    guestName: optional(z.string().trim().min(1).max(80)),
    guestEmail: optional(z.string().trim().toLowerCase().max(320).pipe(z.email())),
    part: z.string().trim().min(1).max(80).describe("The part's key: its instrument or role, position: and a position's ID, or name: and its name"),
  })
  .refine((place) => !!place.userId !== !!place.guestName, "Each place needs either userId or guestName, not both")
  .refine((place) => !place.guestEmail || !!place.guestName, "guestEmail is only for someone without an account (guestName)")
  .refine((place) => !place.guestName || !!place.guestEmail, "Someone without an account needs guestEmail");
export type AssignPartRequest = z.input<typeof AssignPartSchema>;

/** Someone puts themselves on an open place (issue #528): the event, its date and the part's key. */
export const VolunteerSchema = z.strictObject({
  teamId: z.string().trim().min(1).max(64),
  eventId: z.string().trim().min(1).max(64),
  date: date("date"),
  part: z.string().trim().min(1).max(80).describe("The part's key"),
});
export type VolunteerRequest = z.input<typeof VolunteerSchema>;

/** The person scheduled answers: accepted or declined, with a note for the team's admins. */
export const RespondAssignmentSchema = z.strictObject({
  status: z.enum(ASSIGNMENT_STATUSES.filter((status) => status !== "PENDING") as ["ACCEPTED", "DECLINED"]),
  note: clearableText(300),
});
export type RespondAssignmentRequest = z.input<typeof RespondAssignmentSchema>;

/** Asking for a replacement on one's place, with a note for those offered it. */
export const RequestSwapSchema = z.strictObject({
  note: clearableText(300),
});
export type RequestSwapRequest = z.input<typeof RequestSwapSchema>;

/** What an organisation's event needs from one of its groups (issue #241): the group, and the parts it asks it for. */
const NeedSchema = z.strictObject({
  teamId: z.string().trim().min(1).max(64),
  parts: optional(eventParts),
  callMinutes: optional(callMinutes).describe("When the group is to be there: minutes before it starts"),
  editsSet: optional(z.boolean()).describe("Whether the group edits the set of each date (issue #578): its admins and its people on the date's line-up. Left out: true for a group that uses Songverse, false for one that only plans. Every group needed views it"),
});
const needs = z
  .array(NeedSchema)
  .min(1)
  .max(30)
  .refine((list) => new Set(list.map((need) => need.teamId)).size === list.length, "needs must not list the same group twice")
  .describe("The groups it needs, each with the parts it asks it for");

/** POST /organizations/:id/events (its admins): an event of the organisation, its host, the groups it needs. */
export const CreateOrganizationEventSchema = z.strictObject({
  title: requiredText(120),
  date: date("date").describe("Its first date, YYYY-MM-DD"),
  startTime: time("startTime").describe("HH:MM, in the time zone"),
  durationMinutes: optional(duration).describe("90 when left out"),
  timeZone,
  place: optional(z.string().trim().max(200)),
  locationId: optional(z.string().trim().min(1).max(64)).describe("Where it takes place (issue #320): one of the organisation's locations; `place` is filled from it when left out"),
  roomIds: optional(z.array(z.string().trim().min(1).max(64)).max(20)).describe("Rooms of its location it takes (issue #563)"),
  note: optional(z.string().trim().max(1000)),
  repeat: optional(RepeatSchema).describe("Left out: a one-off"),
  hostUserId: z.string().trim().min(1).max(64).describe("Who's in charge of it: one of the organisation's members"),
  withSet: optional(z.boolean()).describe("Whether each date has a set (issue #578): one for all the groups it needs. true when left out"),
  needs,
});
export type CreateOrganizationEventRequest = z.input<typeof CreateOrganizationEventSchema>;

/** PATCH /organizations/:id/events/:eventId (its admins, or its host): omitted fields are left as they are; `needs` replaces them all. */
export const UpdateOrganizationEventSchema = z.strictObject({
  title: requiredText(120).optional(),
  date: date("date").optional(),
  startTime: time("startTime").optional(),
  durationMinutes: duration.optional(),
  timeZone: timeZone.optional(),
  place: clearableText(200),
  locationId: z.string().trim().min(1).max(64).nullable().optional().describe("null: no location"),
  roomIds: optional(z.array(z.string().trim().min(1).max(64)).max(20)).describe("Rooms of its location it takes (issue #563); [] takes none"),
  note: clearableText(1000),
  repeat: RepeatSchema.nullable().optional().describe("null makes it a one-off"),
  hostUserId: z.string().trim().min(1).max(64).optional(),
  withSet: z.boolean().optional().describe("false: coming empty sets are deleted (sets with songs stay)"),
  needs: needs.optional(),
});
export type UpdateOrganizationEventRequest = z.input<typeof UpdateOrganizationEventSchema>;

/** PUT /organizations/:id/events/:eventId/dates/:date/editors: whether a group edits that date's set, against its usual choice (issue #578). null: as usual. */
export const OrganizationDateEditorsSchema = z.strictObject({
  teamId: z.string().trim().min(1).max(64),
  editsSet: z.boolean().nullable(),
});
export type OrganizationDateEditorsRequest = z.input<typeof OrganizationDateEditorsSchema>;

/** PUT /setlists/:id/edit-requests/:requestId: an ask to edit a date's set granted or declined (issue #578). */
export const DecideSetEditRequestSchema = z.strictObject({
  grant: z.boolean(),
});
export type DecideSetEditRequestRequest = z.input<typeof DecideSetEditRequestSchema>;

/** A date of an organisation's event cancelled, or back, for every group it needs. */
export const UpdateOrganizationEventDateSchema = z.strictObject({
  cancelled: z.boolean(),
});
