import "../zod-config.js";
import { z } from "zod";
import { optional } from "./fields.js";

/** Who an announcement is for (issue #536): everyone, Songverse's people, Planiverse's (organisations' members), or one organisation's members. */
export const ANNOUNCEMENT_AUDIENCES = ["EVERYONE", "SONGVERSE", "PLANIVERSE", "ORGANIZATION"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

/** The languages an announcement is written in: its words in each. */
export const ANNOUNCEMENT_LANGUAGES = ["en", "fr"] as const;

/** A page in the app ("/sets") or a web address (https://…). */
const announcementLink = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === "" || /^\/(?!\/)\S*$/.test(value) || (/^https?:\/\/\S+$/.test(value) && URL.canParse(value)), "url must be a page of the app (/…) or a web address (https://…)")
  .transform((value) => value || null)
  .nullable()
  .optional();

const AnnouncementTextSchema = z.strictObject({
  title: z.string().trim().min(1, "title must not be empty").max(120),
  body: z.string().trim().max(500).default(""),
  url: announcementLink.describe("Where it leads: a page of the app, or a web address such as the docs' What's new"),
});

/** An announcement's words: one language at least; a language set to null is taken out. */
const textsSchema = z
  .partialRecord(z.enum(ANNOUNCEMENT_LANGUAGES), AnnouncementTextSchema.nullable())
  .transform((texts) => Object.fromEntries(Object.entries(texts).filter(([, text]) => !!text)) as Partial<Record<(typeof ANNOUNCEMENT_LANGUAGES)[number], z.output<typeof AnnouncementTextSchema>>>)
  .refine((texts) => Object.keys(texts).length > 0, "texts must have the words in one language at least");

/** POST /admin/announcements: a draft (issue #536). The audience defaults to everyone; ORGANIZATION needs organizationId. */
export const CreateAnnouncementSchema = z
  .strictObject({
    texts: textsSchema,
    audience: z.enum(ANNOUNCEMENT_AUDIENCES).default("EVERYONE"),
    organizationId: optional(z.string().trim().min(1).max(64)),
  })
  .refine((dto) => dto.audience !== "ORGANIZATION" || !!dto.organizationId, "organizationId must be given for an organisation's members");
export type CreateAnnouncementRequest = z.input<typeof CreateAnnouncementSchema>;

/** PATCH: a draft, or a sent one's words (fixed in everyone's notifications). Left out keeps it. */
export const UpdateAnnouncementSchema = z.strictObject({
  texts: textsSchema.optional(),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES).optional(),
  organizationId: optional(z.string().trim().min(1).max(64)),
});
export type UpdateAnnouncementRequest = z.input<typeof UpdateAnnouncementSchema>;

/** An organisation's admins' announcement to its members: only its words. */
export const SaveOrganizationAnnouncementSchema = z.strictObject({ texts: textsSchema });
export type SaveOrganizationAnnouncementRequest = z.input<typeof SaveOrganizationAnnouncementSchema>;
