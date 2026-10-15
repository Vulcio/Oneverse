import "../zod-config.js";
import { z } from "zod";
import { SET_TRANSITIONS } from "../constants/index.js";
import { clearableText, optional, requiredText } from "./fields.js";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const eventDate = z.string().regex(DATE_ONLY, "eventDate must be YYYY-MM-DD");

export const CreateSetlistSchema = z.strictObject({
  name: optional(z.string().trim().max(120)).describe("Omit to have the set shown by its date"),
  eventDate: optional(eventDate).describe("Date only (2026-10-04); today or later"),
  teamId: optional(z.string()).describe("Team to own the set (you must be one of its admins). Omit for a personal set."),
});
export type CreateSetlistRequest = z.input<typeof CreateSetlistSchema>;

/** Omitted fields are left unchanged; null (or an empty name) clears. */
export const UpdateSetlistSchema = z.strictObject({
  name: z.string().trim().max(120).nullable().optional(),
  eventDate: eventDate.nullable().optional(),
  teamId: z
    .string()
    .nullable()
    .optional()
    .describe("Move the set to this team (you must be one of its admins), or null to make it your personal set"),
});
export type UpdateSetlistRequest = z.input<typeof UpdateSetlistSchema>;

const transposeSteps = z.number().int().min(-11).max(11);

export const AddSetlistItemSchema = z.strictObject({
  songVersionId: z.string(),
  transposeSteps: optional(transposeSteps).describe("Semitones relative to the song's own key"),
  afterItemId: optional(z.string().min(1).max(40)).describe("Played right after this song of the set (issue #199); at the end when left out"),
});

export const UpdateSetlistItemSchema = z.strictObject({
  songVersionId: optional(z.string()).describe("Another version of the same song"),
  transposeSteps: optional(transposeSteps),
  notes: z.string().trim().max(500).nullable().optional(),
  arrangementId: z.string().nullable().optional().describe("The arrangement to play; null plays the song as written"),
  transition: z.enum(SET_TRANSITIONS).nullable().optional().describe("What happens after it (issue #199); null: nothing said"),
  transitionNote: clearableText(200).describe("For a transition: what's played into the next song"),
  transitionChords: z
    .array(z.string().regex(/^[#b]?[1-7][^/\s]{0,12}(?:\/[#b]?[1-7])?$/, "transitionChords must be degrees of the next song's key, like 2m7 or 57"))
    .max(8)
    .optional()
    .describe('For a transition (issue #10): the chords played into the next song, as degrees of its key ("2m7", "57"); [] for none'),
});
export type UpdateSetlistItemRequest = z.input<typeof UpdateSetlistItemSchema>;

export const SetArrangementSchema = z.strictObject({
  name: requiredText(100).describe('Its name, e.g. "For Sunday 12 October"'),
});

export const ReorderSetlistItemsSchema = z.strictObject({
  itemIds: z
    .array(z.string())
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "All itemIds's elements must be unique")
    .describe("Every item id of the set, in the new order"),
});

