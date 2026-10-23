import "../zod-config.js";
import { z } from "zod";
import { SCREEN_MODES, SCREEN_PAIRING_LENGTHS, SCREEN_PART_KINDS, SCREEN_SWITCHABLE_LAYERS, SCREEN_TEMPLATES, ScreenBackgroundThemeRequestSchema, ScreenContentThemeRequestSchema, ScreenEffectsRequestSchema, ScreenTemplateRequestSchema, ScreenThemeRequestSchema, ScreenWidgetLookRequestSchema } from "../screens/index.js";
import { optional } from "./fields.js";

/** Screens (issue #186): a screen paired by its code, and changed later by whoever paired it. */
const screenFields = {
  name: z.string().trim().min(1, "name must not be empty").max(60),
  mode: z.enum(SCREEN_MODES),
  setlistId: z.string().min(1).max(40),
  /** A set put on it, its owner's set of the day (issue #274), or the set of the event on now at a location (issue #320). */
  setMode: z.enum(["FIXED", "DAY", "LOCATION"]),
  /** The location it follows (issue #320): one of its owner's, or its team's organisation's. */
  locationId: z.string().min(1).max(40),
  /** A saved theme (issue #194); null for none. */
  themeId: z.string().min(1).max(40).nullable(),
  /** A built-in theme by its id ("concert"); null for none. A screen has one or the other, else the default look. */
  themeTemplate: z.enum(SCREEN_TEMPLATES.map((one) => one.id) as [string, ...string[]]).nullable(),
  /** The layers it never shows (issue #287), whatever the operator does. */
  hiddenLayers: z.array(z.enum(SCREEN_SWITCHABLE_LAYERS)).max(SCREEN_SWITCHABLE_LAYERS.length),
  /** Effects shown (issue #281), or off on a screen that can't keep up. */
  effects: z.boolean(),
  /** How long the pairing lasts (issue #284), from now: 12h, 1d, 1w or unlimited. */
  lasts: z.enum(SCREEN_PAIRING_LENGTHS),
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
  mode: optional(screenFields.mode).describe("Left out: LYRICS - what the screen shows comes from its template (issue #281); CHART is kept for screens paired before"),
  setMode: optional(screenFields.setMode).describe("FIXED (the default): the set given; DAY: its owner's set of the day (issue #274), setlistId left out; LOCATION: the set of the event on now at `locationId` (issue #320)"),
  setlistId: optional(screenFields.setlistId),
  locationId: optional(screenFields.locationId),
  themeId: screenFields.themeId.optional(),
  themeTemplate: screenFields.themeTemplate.optional(),
  lasts: optional(screenFields.lasts).describe("How long it stays paired (issue #284); left out: unlimited"),
  })
  .refine((pairing) => pairing.setMode === "DAY" || pairing.setMode === "LOCATION" || !!pairing.setlistId, "setlistId must name the set, unless setMode is DAY or LOCATION")
  .refine((pairing) => pairing.setMode !== "LOCATION" || !!pairing.locationId, "locationId must name the location it follows when setMode is LOCATION");
export type ConfirmScreenPairingRequest = z.input<typeof ConfirmScreenPairingSchema>;

/** POST /screens/pairings: a code for a screen, or (issue #320) for a Oneverse Pulse, shown as one when it's confirmed. */
export const StartScreenPairingSchema = z.strictObject({
  kind: optional(z.enum(["SCREEN", "PULSE"])).describe("SCREEN when left out"),
});

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
  locationId: screenFields.locationId.nullable().optional().describe("The location it follows in LOCATION mode (issue #320)"),
  themeId: screenFields.themeId.optional(),
  themeTemplate: screenFields.themeTemplate.optional(),
  hiddenLayers: optional(screenFields.hiddenLayers),
  effects: optional(screenFields.effects),
  lasts: optional(screenFields.lasts).describe("Extended (issue #284): paired for this long from now, or unlimited"),
});
export type UpdateScreenRequest = z.input<typeof UpdateScreenSchema>;

const themeName = z.string().trim().min(1, "name must not be empty").max(60);

/** A template's part (issue #281): a built-in one by its id, or a saved one. */
export const ScreenPartRefSchema = z.union([z.strictObject({ builtIn: z.string().min(1).max(40) }), z.strictObject({ id: z.string().min(1).max(40) })]);
export type ScreenPartRef = z.output<typeof ScreenPartRefSchema>;

/**
 * POST /screen-themes: a template (issue #281) of the user's own, or
 * (`teamId`) their team's, which its admins change - its layout and its
 * parts (left out: the built-in classic's), or a whole look (`theme`, as
 * before parts), split into parts of its own.
 */
export const CreateScreenThemeSchema = z
  .strictObject({
    name: themeName,
    teamId: optional(z.string().min(1).max(40)),
    theme: optional(ScreenThemeRequestSchema),
    template: optional(ScreenTemplateRequestSchema),
    content: optional(ScreenPartRefSchema),
    background: optional(ScreenPartRefSchema),
    effects: ScreenPartRefSchema.nullable().optional(),
  })
  .refine((data) => !data.theme || (!data.template && !data.content && !data.background && data.effects === undefined), "Give a whole theme or a template's parts, not both");
export type CreateScreenThemeRequest = z.input<typeof CreateScreenThemeSchema>;

/** PATCH /screen-themes/:id: a field left out keeps its value; effects null: none. */
export const UpdateScreenThemeSchema = z.strictObject({
  name: optional(themeName),
  template: optional(ScreenTemplateRequestSchema),
  content: optional(ScreenPartRefSchema),
  background: optional(ScreenPartRefSchema),
  effects: ScreenPartRefSchema.nullable().optional(),
});
export type UpdateScreenThemeRequest = z.input<typeof UpdateScreenThemeSchema>;

/** A part's document, of its kind: checked again by kind when it's saved. */
const partDocument = z.union([ScreenContentThemeRequestSchema, ScreenBackgroundThemeRequestSchema, ScreenEffectsRequestSchema]);

/** POST /screen-parts (issue #281): a content theme, a background theme or effects, the user's own or (`teamId`) their team's. */
export const CreateScreenPartSchema = z.strictObject({
  kind: z.enum(SCREEN_PART_KINDS),
  name: themeName,
  teamId: optional(z.string().min(1).max(40)),
  document: partDocument,
});
export type CreateScreenPartRequest = z.input<typeof CreateScreenPartSchema>;

/** PATCH /screen-parts/:id: a field left out keeps its value. Every template using it changes. */
export const UpdateScreenPartSchema = z.strictObject({
  name: optional(themeName),
  document: optional(partDocument),
});
export type UpdateScreenPartRequest = z.input<typeof UpdateScreenPartSchema>;

/** GET /screen-parts?kind= */
export const ScreenPartsQuerySchema = z.strictObject({
  kind: optional(z.enum(SCREEN_PART_KINDS)),
});

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
