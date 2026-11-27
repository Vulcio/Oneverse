import "../zod-config.js";
import { z } from "zod";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../constants/index.js";
import { PLACES_PER_REGISTRATION_MAX, QUESTION_TYPES } from "../calendar/registration.js";
import { clearableInt, clearableText, optional, requiredText } from "./fields.js";

/** Registration for event dates (issue #593). */

const id = z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/, "id must be letters, digits, - or _");

const PlaceKindSchema = z.strictObject({
  id: optional(id).describe("Kept across changes; left out for a new kind"),
  name: requiredText(60),
  limit: z.number().int().min(1).max(100_000).nullable().default(null).describe("This kind's places per date; null: no limit but the form's"),
  price: z.number().int().min(0).max(10_000_000).nullable().default(null).describe("In cents of the form's currency; null: free. Shown only"),
});

const QuestionSchema = z
  .strictObject({
    id: optional(id).describe("Kept across changes; left out for a new question"),
    label: requiredText(200),
    type: z.enum(QUESTION_TYPES),
    options: z.array(requiredText(100)).max(20).optional(),
    required: z.boolean().default(false),
  })
  .refine((question) => question.type !== "choice" || (question.options?.length ?? 0) >= 2, { message: "A choice needs at least two options", path: ["options"] });

/** PUT /registration-forms: turns registration on for an event, or changes it. */
export const RegistrationFormSchema = z
  .strictObject({
    teamEventId: optional(z.string().min(1)),
    organizationEventId: optional(z.string().min(1)),
    open: z.boolean().default(true).describe("Off: nobody registers; those registered stay"),
    opensDaysBefore: clearableInt(0, 365).describe("Opens this many days before a date; null: as soon as it's made"),
    closesHoursBefore: z.number().int().min(0).max(24 * 60).default(0).describe("Closes this many hours before a date starts"),
    limit: clearableInt(1, 100_000).describe("Places a date takes in all; null: only the kinds' limits"),
    placeKinds: z.array(PlaceKindSchema).min(1, "placeKinds must have at least one kind").max(12),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "currency must be a code like EUR").nullable().optional(),
    questions: z.array(QuestionSchema).max(20).default([]),
    waitingList: z.boolean().default(true),
    intro: clearableText(2000),
  })
  .refine((form) => !!form.teamEventId !== !!form.organizationEventId, { message: "Give teamEventId or organizationEventId, one of them" });
export type RegistrationFormRequest = z.input<typeof RegistrationFormSchema>;
export type RegistrationFormInput = z.output<typeof RegistrationFormSchema>;

/** GET /registration-forms: an event's registration. */
export const RegistrationFormQuerySchema = z
  .strictObject({ teamEventId: optional(z.string().min(1)), organizationEventId: optional(z.string().min(1)) })
  .refine((query) => !!query.teamEventId !== !!query.organizationEventId, { message: "Give teamEventId or organizationEventId, one of them" });

const places = z.record(id, z.number().int().min(0).max(PLACES_PER_REGISTRATION_MAX));
const answers = z.record(id, z.union([z.string().max(2000), z.number(), z.boolean()]));

/** POST /public/registrations/:publicId/:date (and the signed-in one): register for a date. */
export const RegisterSchema = z.strictObject({
  name: requiredText(120),
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  places,
  answers: answers.default({}),
  locale: z.enum(SUPPORTED_LOCALES).default(DEFAULT_LOCALE).describe("The language of its emails"),
});
export type RegisterRequest = z.input<typeof RegisterSchema>;

/** PATCH /public/registration/:token: someone changes their registration. */
export const UpdateRegistrationSchema = z.strictObject({
  name: optional(requiredText(120)),
  places: places.optional(),
  answers: answers.optional(),
});
export type UpdateRegistrationRequest = z.input<typeof UpdateRegistrationSchema>;

/** PATCH /registrations/:id: its managers mark it paid, or cancel it. */
export const ManageRegistrationSchema = z.strictObject({
  paid: optional(z.boolean()),
  cancelled: optional(z.literal(true)),
});
export type ManageRegistrationRequest = z.input<typeof ManageRegistrationSchema>;
