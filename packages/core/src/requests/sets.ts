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

/** The longest text item's body (issue #305). */
export const SETLIST_TEXT_MAX = 5000;

/** A text item (issue #305): a title, and a body whose paragraphs (split by a blank line) are its slides. */
export const SetlistItemTextSchema = z.strictObject({
  title: z.string().trim().max(120).describe("Shown in the set and on the screens' title widgets; may be empty"),
  body: z.string().max(SETLIST_TEXT_MAX).describe("Its slides: paragraphs split by a blank line"),
});
export type SetlistItemText = z.output<typeof SetlistItemTextSchema>;

/** A stored text item's text as it's read: null when it can't be. */
export function readItemText(value: unknown): SetlistItemText | null {
  const text = SetlistItemTextSchema.safeParse(value);
  return text.success ? text.data : null;
}

/**
 * A passage item (issue #301): an imported Bible, or a YouVersion version
 * (issue #310), and the verses, as people write them ("John 3:16-18",
 * "Psaume 23,1-4") - never a copy of the text, read from the Bible or from
 * YouVersion whenever the set is.
 */
export const SetlistItemPassageSchema = z
  .strictObject({
    bibleId: optional(z.string().min(1).max(40)).describe("An imported Bible's id (GET /scriptures/bibles); give this or youversionId"),
    youversionId: optional(z.number().int().min(1).max(1_000_000)).describe("A YouVersion version's number (GET /scriptures/youversion/bibles); give this or bibleId"),
    reference: z.string().trim().min(1).max(200).describe("Chapters or verses of one book, as people write them"),
  })
  .refine((passage) => (passage.bibleId === undefined) !== (passage.youversionId === undefined), "Give one of bibleId or youversionId");
export type SetlistItemPassageRef = z.output<typeof SetlistItemPassageSchema>;

/** A stored passage item's Bible and reference: null when it can't be read. */
export function readItemPassage(value: unknown): SetlistItemPassageRef | null {
  const passage = SetlistItemPassageSchema.safeParse(value);
  return passage.success ? passage.data : null;
}

/**
 * A passage item's own screen template (issue #310): a saved one by its id,
 * or a built-in one by its id ("scripture"). The screens show the passage
 * with it, as many verses a slide as it says; the rest of the set keeps the
 * screen's own.
 */
export const SetlistItemScreenTemplateSchema = z.union([
  z.strictObject({ id: z.string().min(1).max(40).describe("A saved template's id (GET /screen-themes)") }),
  z.strictObject({ builtIn: z.string().min(1).max(40).describe('A built-in template\'s id, like "scripture"') }),
]);
export type SetlistItemScreenTemplate = z.output<typeof SetlistItemScreenTemplateSchema>;

/** A stored item's screen template as it's read: null when there's none, or it can't be. */
export function readItemScreenTemplate(value: unknown): SetlistItemScreenTemplate | null {
  const template = SetlistItemScreenTemplateSchema.safeParse(value);
  return template.success ? template.data : null;
}

export const AddSetlistItemSchema = z
  .strictObject({
    songVersionId: optional(z.string()).describe("A song (an item of kind SONG); give this, text or passage"),
    text: optional(SetlistItemTextSchema).describe("Slides of text (an item of kind TEXT, issue #305); give this, songVersionId or passage"),
    passage: optional(SetlistItemPassageSchema).describe("A Bible passage (an item of kind PASSAGE, issue #301); give this, songVersionId or text"),
    transposeSteps: optional(transposeSteps).describe("Semitones relative to the song's own key"),
    afterItemId: optional(z.string().min(1).max(40)).describe("Played right after this item of the set (issue #199); at the end when left out"),
    screenTemplate: optional(SetlistItemScreenTemplateSchema).describe("A passage's screen template (issue #310); the screen's own when left out"),
  })
  .refine((item) => [item.songVersionId, item.text, item.passage].filter((one) => one !== undefined).length === 1, "Give one of songVersionId, text or passage");

/** A set item's own timer (issue #269): started on the screens' stage when Live comes to it. */
export const SetlistItemTimerSchema = z.strictObject({
  kind: z.enum(["countdown", "count-up"]),
  duration: z.number().int().min(0).max(86_400).describe("A countdown's length, in seconds; 0 for a count up"),
});
export type SetlistItemTimer = z.output<typeof SetlistItemTimerSchema>;

/** A stored item timer as it's read: null when there's none, or it can't be. */
export function readItemTimer(value: unknown): SetlistItemTimer | null {
  const timer = SetlistItemTimerSchema.safeParse(value);
  return timer.success ? timer.data : null;
}

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
  timer: SetlistItemTimerSchema.nullable().optional().describe("Its own timer (issue #269), started on the screens when Live comes to it; null: none"),
  text: optional(SetlistItemTextSchema).describe("A text item's title and body (issue #305); refused for a song"),
  passage: optional(SetlistItemPassageSchema).describe("A passage item's Bible and reference (issue #301); refused for any other kind"),
  screenTemplate: SetlistItemScreenTemplateSchema.nullable().optional().describe("A passage item's screen template (issue #310); null: the screen's own. Refused for any other kind"),
});
export type UpdateSetlistItemRequest = z.input<typeof UpdateSetlistItemSchema>;

/** A set's offline copy (issue #301): to keep on a device, or `for=screens`, as the screens may show it (the operator's console). */
export const SetlistOfflineQuerySchema = z.strictObject({
  for: optional(z.enum(["screens"])).describe("screens: its passages' verses where their Bible may be shown on screens, rather than kept offline"),
});

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

