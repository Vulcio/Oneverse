import "../zod-config.js";
import { z } from "zod";
import { optional, requiredText } from "./fields.js";

const description = z.string().trim().max(1000).nullable().optional();
/** A JSON object (not an array, not null). */
const object = z.record(z.string(), z.unknown());

export const CreateArrangementSchema = z.strictObject({
  name: requiredText(100),
  description,
  teamId: optional(z.string()).describe("Owned by this team (its admins can change it); otherwise by you"),
  copyFromId: optional(z.string()).describe("Start as a copy of this arrangement of the same song"),
});
export type CreateArrangementRequest = z.input<typeof CreateArrangementSchema>;

export const UpdateArrangementSchema = z.strictObject({
  name: optional(requiredText(100)),
  description,
  document: optional(object).describe("ArrangementDocument v2 (docs/arrangement-document-v2.md)"),
  isTeamDefault: optional(z.boolean()).describe("The team's usual arrangement of the song (team arrangements only)"),
  linkId: z.string().nullable().optional().describe("The song's reference recording it's played along to (issue #346); null: the song's own"),
  multitrackId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,40}$/, { message: "multitrackId must be up to 40 letters, digits, - or _" })
    .nullable()
    .optional()
    .describe("The song's multitrack it plays (issue #346); null: the song's own"),
  updatedAt: optional(z.union([z.iso.datetime({ offset: true, local: true }), z.iso.date()])).describe(
    "When the arrangement was last saved as the editor loaded it; a save is refused (409) if it changed since",
  ),
});
export type UpdateArrangementRequest = z.input<typeof UpdateArrangementSchema>;

/** PUT a player's chart preferences (the document is ChartPreferencesSchema). */
export const SaveChartPreferencesSchema = z.strictObject({
  songVersionId: z.string(),
  arrangementId: z.string().nullable().optional().describe("Null or left out: the song as written"),
  preferences: object.describe("chart-preferences/v1"),
});

export const SetChartPreferencesSchema = z.strictObject({
  preferences: object.describe("chart-preferences/v1"),
});
