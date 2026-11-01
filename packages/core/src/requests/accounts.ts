import "../zod-config.js";
import { z } from "zod";
import { NEW_NOTES, NOTE_COLORS, NOTE_LOOKS, NOTE_PLACEMENTS, NOTE_SHOWS, NOTE_SIZES } from "../notes/index.js";
import { CAPO_DISPLAY_MODES, CHORD_DIAGRAMS, DIAGRAM_POSITIONS, CHORD_ROW_COLORS, CHORD_ROW_FONTS, CHORD_ROW_NAMES, CHORD_ROW_WEIGHTS, SECOND_ROW_GAPS, SECOND_ROW_POSITIONS, SECOND_ROW_SIZES, CONTROLS_LAYOUTS, CONTROLS_OPACITIES, CONTROLS_POSITIONS, LIVE_CONTROLS, DISPLAY_COLUMNS, DISPLAY_FONTS, DISPLAY_SPACINGS, DISPLAY_TEXT_SIZES, PIANO_HANDS, PIANO_NOTE_NAMES, CHORD_NOTATIONS, ENTITY_COLORS, INSTRUMENTS, LIVE_VIEWS, SUPPORTED_LOCALES, TEAM_ROLES, TECH_ROLES } from "../constants/index.js";
import { TUNINGS } from "../chords/shapes.js";
import { clearableText, optional, requiredText } from "./fields.js";

const TUNING_IDS = {
  guitar: TUNINGS.guitar.map((tuning) => tuning.id) as [string, ...string[]],
  ukulele: TUNINGS.ukulele.map((tuning) => tuning.id) as [string, ...string[]],
};

/**
 * PUT /song-versions/:id/chord-shapes: the shape a player chose for a chord
 * of this song (issue #207); `frets` null goes back to the usual one.
 */
export const ChooseChordShapeSchema = z.strictObject({
  instrument: z.enum(["guitar", "ukulele", "piano"]),
  tuning: z.string().trim().min(1).max(30),
  chord: z.string().trim().min(1).max(64),
  frets: z
    .string()
    .trim()
    // A fretted shape as players write it ("320003"), or a piano voicing ("48|60.64.67").
    .regex(/^[x0-9().|]{3,60}$/, "frets must be a shape as players write it, like 320003")
    .nullable(),
});
export type ChooseChordShapeRequest = z.input<typeof ChooseChordShapeSchema>;

/**
 * One mode's display settings (issue #209), as changed in the Display panel:
 * only what differs from the account's (the dashboard's Chart display); a
 * field set to null goes back to it.
 */
/** A row of chords' colour (issue #230): the theme's accent, muted, by chord type, or #rrggbb. */
const chordRowColor = z.union([z.enum(CHORD_ROW_COLORS), z.string().regex(/^#[0-9a-fA-F]{6}$/, "chordColor must be theme, muted, family or a colour as #rrggbb")]);

export const DisplaySettingsSchema = z.strictObject({
  textSize: z.union(DISPLAY_TEXT_SIZES.map((size) => z.literal(size)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]).nullable().optional(),
  /** The chords' own size (issue #225); left out or null, the same as the lyrics' (textSize). */
  chordSize: z.union(DISPLAY_TEXT_SIZES.map((size) => z.literal(size)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]).nullable().optional(),
  font: z.enum(DISPLAY_FONTS).nullable().optional(),
  spacing: z.enum(DISPLAY_SPACINGS).nullable().optional(),
  columns: z.enum(DISPLAY_COLUMNS).nullable().optional(),
  /** The main row of chords' names (issue #230): a notation, or a small diagram on each chord. */
  chordNotation: z.enum(CHORD_ROW_NAMES).nullable().optional(),
  chordColors: z.boolean().nullable().optional(),
  /** The main row's look (issue #230); chordColor replaces chordColors ("family" for colours by chord type). */
  chordFont: z.enum(CHORD_ROW_FONTS).nullable().optional(),
  chordWeight: z.enum(CHORD_ROW_WEIGHTS).nullable().optional(),
  chordColor: chordRowColor.nullable().optional(),
  /** A second row of chords (issue #230): absent or null, none. */
  secondRow: z
    .strictObject({
      /** Off keeps its settings for when it's turned on again. */
      on: z.boolean().optional(),
      names: z.enum(CHORD_ROW_NAMES).optional(),
      source: z.enum(CAPO_DISPLAY_MODES).optional(),
      position: z.enum(SECOND_ROW_POSITIONS).optional(),
      size: z.union(SECOND_ROW_SIZES.map((size) => z.literal(size)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]).optional(),
      gap: z.union(SECOND_ROW_GAPS.map((gap) => z.literal(gap)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]).optional(),
      font: z.enum(CHORD_ROW_FONTS).optional(),
      weight: z.enum(CHORD_ROW_WEIGHTS).optional(),
      color: chordRowColor.optional(),
    })
    .nullable()
    .optional(),
  capoDisplayMode: z.enum(CAPO_DISPLAY_MODES).nullable().optional(),
  chordDiagrams: z.enum(CHORD_DIAGRAMS).nullable().optional(),
  /** Where the diagrams sit (issue #212). */
  diagramsPosition: z.enum(DIAGRAM_POSITIONS).nullable().optional(),
  /** Lyrics only: the chords hidden, for a singer. */
  hideChords: z.boolean().nullable().optional(),
  /** The bars row at the top (issue #238). */
  bars: z.boolean().nullable().optional(),
  /** Live's controls (issue #224): where they are, which are hidden, and floating ones' opacity. */
  controls: z.enum(CONTROLS_LAYOUTS).nullable().optional(),
  controlsPosition: z.enum(CONTROLS_POSITIONS).nullable().optional(),
  hiddenControls: z.array(z.enum(LIVE_CONTROLS)).max(LIVE_CONTROLS.length).nullable().optional(),
  controlsOpacity: z.union(CONTROLS_OPACITIES.map((value) => z.literal(value)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]).nullable().optional(),
  /** Notes on the chart (issue #256): every note, one's own, or none. */
  notes: z.enum(NOTE_SHOWS).nullable().optional(),
  /** What a note is on, marked on the chart (issue #263). */
  noteMarks: z.boolean().nullable().optional(),
  /** Someone else's new notes: shown at once, or held until a tap (issue #263). */
  newNotes: z.enum(NEW_NOTES).nullable().optional(),
  /** Where notes go and how they look (issue #264). */
  notesPlacement: z.enum(NOTE_PLACEMENTS).nullable().optional(),
  notesLook: z.enum(NOTE_LOOKS).nullable().optional(),
  notesSize: z.enum(NOTE_SIZES).nullable().optional(),
  notesColor: z.enum(NOTE_COLORS).nullable().optional(),
});
export type DisplaySettingsRequest = z.input<typeof DisplaySettingsSchema>;

/** PATCH /users/me */
export const UpdateUserSchema = z.strictObject({
  /** Display settings for a mode (issue #209), merged into what's kept: { LIVE: { textSize: 2 } }. */
  displaySettings: optional(z.strictObject({ EDIT: optional(DisplaySettingsSchema), PRACTICE: optional(DisplaySettingsSchema), LIVE: optional(DisplaySettingsSchema) })),
  locale: optional(z.enum(SUPPORTED_LOCALES)),
  displayName: optional(requiredText(80)),
  // A built-in instrument's key, or the id of one an admin added (issue #166); the API keeps the known ones.
  instruments: optional(z.array(z.string().trim().min(1).max(40)).max(INSTRUMENTS.length + 100)),
  techRoles: optional(z.array(z.enum(TECH_ROLES)).max(TECH_ROLES.length)),
  capoDisplayMode: optional(z.enum(CAPO_DISPLAY_MODES)),
  chordNotation: optional(z.enum(CHORD_NOTATIONS)),
  chordDiagrams: optional(z.enum(CHORD_DIAGRAMS)),
  chordColors: optional(z.boolean()),
  leftHanded: optional(z.boolean()),
  // Calendars' first day of the week (issue #235): null goes back to the language's.
  weekStartsOn: z.union([z.literal(0), z.literal(1), z.literal(6)]).nullable().optional().describe("0 Sunday, 1 Monday, 6 Saturday; null from the language"),
  guitarTuning: optional(z.enum(TUNING_IDS.guitar)),
  ukuleleTuning: optional(z.enum(TUNING_IDS.ukulele)),
  pianoSmooth: optional(z.boolean()),
  pianoHands: optional(z.enum(PIANO_HANDS)),
  pianoNoteNames: optional(z.enum(PIANO_NOTE_NAMES)),
  liveView: optional(z.enum(LIVE_VIEWS)),
});
export type UpdateUserRequest = z.input<typeof UpdateUserSchema>;

export const MAX_TRANSFER_RETENTION_DAYS = 365;
export const DEFAULT_TRANSFER_RETENTION_DAYS = 30;

/** Admin > Users: each field is optional; omitted fields are left unchanged. */
export const UpdateUserByAdminSchema = z.strictObject({
  banned: optional(z.boolean()),
  banReason: optional(z.string().max(500)),
});

export const DeleteUserSchema = z.strictObject({
  contentAction: z.enum(["delete", "transfer"]),
  retentionDays: optional(z.number().int().min(1).max(MAX_TRANSFER_RETENTION_DAYS)).describe(
    `How long the transfer link works (days, default ${DEFAULT_TRANSFER_RETENTION_DAYS})`,
  ),
});

/**
 * PUT /admin/security (issue #113): each field left out keeps its value;
 * null clears it (back to its env var, else the default).
 */
export const SaveSecuritySettingsSchema = z.strictObject({
  rateLimitEnabled: z.boolean().nullable().optional(),
  rateLimitPerMinute: z.number().int().min(10).max(100_000).nullable().optional(),
  rateLimitAnonymousPerMinute: z.number().int().min(10).max(100_000).nullable().optional(),
  rateLimitHeavyPerMinute: z.number().int().min(1).max(10_000).nullable().optional(),
  trustedProxies: z.number().int().min(0).max(10).nullable().optional(),
  apiDocsPublic: z.boolean().nullable().optional(),
  contentSecurityPolicy: z.enum(["ENFORCE", "REPORT_ONLY", "OFF"]).nullable().optional(),
  signupInviteOnly: z.boolean().nullable().optional(),
});
export type SaveSecuritySettingsRequest = z.input<typeof SaveSecuritySettingsSchema>;

/** PUT /admin/collaboration (issue #27): left out keeps its value; null goes back to LIVE_CO_EDITING, else off. */
export const SaveCollaborationSettingsSchema = z.strictObject({
  liveCoEditing: z.boolean().nullable().optional().describe("Typing in the same song together in the editor"),
});
export type SaveCollaborationSettingsRequest = z.input<typeof SaveCollaborationSettingsSchema>;

/** PUT /admin/storage/limits: a field left out keeps its value; null goes back to the built-in default. */
export const SaveStorageLimitsSchema = z.strictObject({
  defaultLimitMb: z.number().int().min(0).max(1_000_000).nullable().optional().describe("A user's, when no role sets one (MB)"),
  defaultTeamLimitMb: z.number().int().min(0).max(1_000_000).nullable().optional().describe("A team's pool, when no role sets one (MB)"),
});
export type SaveStorageLimitsRequest = z.input<typeof SaveStorageLimitsSchema>;

/**
 * Every field is optional and independently omittable, so an admin can
 * change one without re-entering a secret (write-only, never sent back).
 */
export const SaveAuthConfigSchema = z.strictObject({
  resendApiKey: optional(z.string().max(200)),
  emailFrom: optional(z.string().max(200)),
  googleClientId: optional(z.string().max(200)),
  googleClientSecret: optional(z.string().max(200)),
});

export const SaveStorageConfigSchema = z.strictObject({
  accountId: optional(z.string().max(200)),
  accessKeyId: optional(z.string().max(200)),
  secretAccessKey: optional(z.string().max(500)),
  bucket: optional(z.string().max(200)),
  endpoint: optional(z.string().max(500)),
});

export const CreateTeamSchema = z.strictObject({
  name: z.string().min(2).max(100),
  slug: optional(z.string().regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers, and hyphens")),
  description: optional(z.string().max(500)),
});

/** PATCH /teams/:id (its admins): a field left out keeps its value. */
export const UpdateTeamSchema = z.strictObject({
  name: optional(z.string().trim().min(2).max(100)),
  description: clearableText(500),
  color: z.enum(ENTITY_COLORS).nullable().optional().describe("Its colour (issue #161); null: one derived from its name"),
  bible: optional(z.boolean().describe("A Bible in its members' sidebar (issue #310)")),
  repeatWeeks: optional(z.number().int().min(1).max(52).describe("Songs played often (issue #335): the weeks a song's plays in the team's sets are counted over")),
  repeatLimit: z.number().int().min(1).max(52).nullable().optional().describe("From how many plays in those weeks a song is flagged when it goes in a set; null: never"),
});
export type UpdateTeamRequest = z.input<typeof UpdateTeamSchema>;

export const UpdateMemberRoleSchema = z.strictObject({ role: z.enum(TEAM_ROLES) });

export const CreateInviteLinkSchema = z.strictObject({
  role: optional(z.enum(TEAM_ROLES)),
  expiresInDays: optional(z.number().int().min(1).max(365)),
  maxUses: optional(z.number().int().min(1)),
});

/** Ask someone to connect: by their email, or (someone from your teams) their user id. */
export const ConnectionRequestSchema = z.strictObject({
  email: optional(z.string().trim().toLowerCase().max(320).pipe(z.email())),
  userId: optional(z.string()),
});

export const ShareSchema = z.strictObject({ canEdit: z.boolean() });

/** Moving a personal song to a team (issue #331). */
export const MoveSongToTeamSchema = z.strictObject({ teamId: z.string().min(1).max(40) });

/**
 * Giving a personal songbook to a team (issue #211): its songs that are
 * the giver's own moved to the team too ("move"), or shared with it, to
 * view, and kept ("share").
 */
export const GiveSongbookToTeamSchema = z.strictObject({
  teamId: z.string().min(1).max(40),
  songs: z.enum(["move", "share"]).describe("The giver's own songs in it: moved to the team, or shared with it and kept"),
});
