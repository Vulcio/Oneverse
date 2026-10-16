import "../zod-config.js";
import { z } from "zod";
import { SCREEN_MODES, SCREEN_THEME_TEMPLATES, ScreenThemeRequestSchema, ScreenWidgetLookRequestSchema } from "../screens/index.js";
import { optional } from "./fields.js";

/** Screens (issue #186): a screen paired by its code, and changed later by whoever paired it. */
const screenFields = {
  name: z.string().trim().min(1, "name must not be empty").max(60),
  mode: z.enum(SCREEN_MODES),
  setlistId: z.string().min(1).max(40),
  /** A set put on it, or its owner's set of the day (issue #274). */
  setMode: z.enum(["FIXED", "DAY"]),
  /** A saved theme (issue #194); null for none. */
  themeId: z.string().min(1).max(40).nullable(),
  /** A built-in theme by its id ("concert"); null for none. A screen has one or the other, else the default look. */
  themeTemplate: z.enum(SCREEN_THEME_TEMPLATES.map((one) => one.id) as [string, ...string[]]).nullable(),
};

/**
 * Whose a screen is (issue #222): the person's own ("user"), one of the
 * teams they run, or an organisation they run - by its id.
 */
export const ScreenOwnerSchema = z
  .strictObject({
    kind: z.enum(["user", "team", "organization"]),
    id: optional(z.string().min(1).max(40)).describe("The team's or the organisation's; left out for the person's own"),
  })
  .refine((owner) => owner.kind === "user" || !!owner.id, "owner.id must name the team or the organisation");
export type ScreenOwnerRequest = z.input<typeof ScreenOwnerSchema>;

/** POST /screens/pairings/:code/confirm */
export const ConfirmScreenPairingSchema = z
  .strictObject({
  owner: optional(ScreenOwnerSchema).describe("Left out: the person's own"),
  name: screenFields.name,
  mode: screenFields.mode,
  setMode: optional(screenFields.setMode).describe("FIXED (the default): the set given; DAY: its owner's set of the day (issue #274), setlistId left out"),
  setlistId: optional(screenFields.setlistId),
  themeId: screenFields.themeId.optional(),
  themeTemplate: screenFields.themeTemplate.optional(),
  })
  .refine((pairing) => pairing.setMode === "DAY" || !!pairing.setlistId, "setlistId must name the set, unless setMode is DAY");
export type ConfirmScreenPairingRequest = z.input<typeof ConfirmScreenPairingSchema>;

/** POST /screens/pairings/:id/claim: the screen asks for its token. */
export const ClaimScreenPairingSchema = z.strictObject({
  secret: z.string().min(16).max(200),
});

/** PATCH /screens/:id: a field left out keeps its value; setlistId null leaves it without a set. */
export const UpdateScreenSchema = z.strictObject({
  owner: optional(ScreenOwnerSchema).describe("Given to another owner: its managers, to themselves or what they run"),
  name: optional(screenFields.name),
  mode: optional(screenFields.mode),
  setMode: optional(screenFields.setMode),
  setlistId: screenFields.setlistId.nullable().optional(),
  themeId: screenFields.themeId.optional(),
  themeTemplate: screenFields.themeTemplate.optional(),
});
export type UpdateScreenRequest = z.input<typeof UpdateScreenSchema>;

const themeName = z.string().trim().min(1, "name must not be empty").max(60);

/** POST /screen-themes: a theme of the user's own, or (`teamId`) their team's, which its admins change. */
export const CreateScreenThemeSchema = z.strictObject({
  name: themeName,
  teamId: optional(z.string().min(1).max(40)),
  theme: ScreenThemeRequestSchema,
});
export type CreateScreenThemeRequest = z.input<typeof CreateScreenThemeSchema>;

/** PATCH /screen-themes/:id: a field left out keeps its value. */
export const UpdateScreenThemeSchema = z.strictObject({
  name: optional(themeName),
  theme: optional(ScreenThemeRequestSchema),
});
export type UpdateScreenThemeRequest = z.input<typeof UpdateScreenThemeSchema>;

/** PUT /screen-widget-defaults/:kind (issue #273): a widget's default look, the user's own or (`teamId`) their team's, which its admins set. */
export const SaveScreenWidgetDefaultSchema = z.strictObject({
  teamId: optional(z.string().min(1).max(40)),
  look: ScreenWidgetLookRequestSchema,
});
export type SaveScreenWidgetDefaultRequest = z.input<typeof SaveScreenWidgetDefaultSchema>;

/** DELETE /screen-widget-defaults/:kind: back to the built-in look, the user's own or (`teamId`) their team's. */
export const ScreenWidgetDefaultQuerySchema = z.strictObject({
  teamId: optional(z.string().min(1).max(40)),
});

/** GET /screens/current?today=&time= : the screen's own day and time (issue #274), for its set of the day. */
export const ScreenCurrentQuerySchema = z.strictObject({
  today: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "today is a date written YYYY-MM-DD")),
  time: optional(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time is written HH:MM")),
});

/** POST /screens/current/set (issue #274): a set picked on the screen for today; null goes back to the day's own. */
export const PickScreenSetSchema = z.strictObject({
  setlistId: z.string().min(1).max(40).nullable(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "today is a date written YYYY-MM-DD"),
});

/** POST /screens/current/theme (issue #276): a theme picked on the screen - a saved one, a built-in one, or (both null) the default look. */
export const PickScreenThemeSchema = z
  .strictObject({
    themeId: screenFields.themeId,
    themeTemplate: screenFields.themeTemplate,
  })
  .refine((pick) => !(pick.themeId && pick.themeTemplate), "Pick a saved theme or a built-in one, not both");
export type PickScreenThemeRequest = z.input<typeof PickScreenThemeSchema>;
