import "../zod-config.js";
import { z } from "zod";
import {
  SCREEN_CONTENT_SHOWS,
  SCREEN_MASKS_MAX,
  SCREEN_THEME_TEMPLATES,
  ScreenMaskSchema,
  ScreenThemeRequestSchema,
  ScreenThemeSchema,
  resolveEffects,
  resolveGrid,
  resolveScreenTheme,
  screenEffectsSchema,
  screenReactsSchema,
  type ScreenTheme,
} from "./theme.js";

/**
 * A template's parts (issue #281), each saved and edited on its own: the
 * content theme (what the words look like and how they come and go, the
 * lyrics or the chord chart), the background theme (the base, the video
 * input, the background and how much each of its inputs answers effects)
 * and effects (the background's reactions to the words, the words' own
 * animation). A template combines one of each with its tags and layout
 * (widgets, masks); composeScreenTheme makes what a screen draws.
 */

export const SCREEN_CONTENT_SCHEMA = "screen-content/v1";
export const SCREEN_BACKGROUND_SCHEMA = "screen-background/v1";
export const SCREEN_EFFECTS_SCHEMA = "screen-effects/v1";
export const SCREEN_TEMPLATE_SCHEMA = "screen-template/v1";

/** What a template is for, to find it (issue #281); its names are in the locale files (`screens.tags.<tag>`). */
export const SCREEN_TEMPLATE_TAGS = ["audience", "stage", "presentation", "lyrics", "chords", "signage"] as const;
export type ScreenTemplateTag = (typeof SCREEN_TEMPLATE_TAGS)[number];
export const SCREEN_PART_KINDS = ["content", "background", "effects"] as const;
export type ScreenPartKind = (typeof SCREEN_PART_KINDS)[number];

function contentSchema(strict: boolean) {
  const theme = strict ? ScreenThemeRequestSchema.shape : ScreenThemeSchema.shape;
  const object = strict ? z.strictObject : z.object;
  return object({
    $schema: z.literal(SCREEN_CONTENT_SCHEMA).default(SCREEN_CONTENT_SCHEMA),
    shows: z.enum(SCREEN_CONTENT_SHOWS).default("lyrics"),
    text: theme.text,
    lines: theme.lines,
    layout: theme.layout,
    title: theme.title,
    credits: theme.credits,
    motion: theme.motion,
    chords: theme.chords,
  });
}

function backgroundSchema(strict: boolean) {
  const theme = strict ? ScreenThemeRequestSchema.shape : ScreenThemeSchema.shape;
  const object = strict ? z.strictObject : z.object;
  return object({
    $schema: z.literal(SCREEN_BACKGROUND_SCHEMA).default(SCREEN_BACKGROUND_SCHEMA),
    base: theme.base,
    video: theme.video,
    background: theme.background,
    reacts: screenReactsSchema(strict).prefault({}),
  });
}

function effectsSchema(strict: boolean) {
  return screenEffectsSchema(strict).extend({ $schema: z.literal(SCREEN_EFFECTS_SCHEMA).default(SCREEN_EFFECTS_SCHEMA) });
}

/** A template's own document: its tags and layout - the widget grid and the masks. Its parts are referred to beside it. */
function templateSchema(strict: boolean) {
  const theme = strict ? ScreenThemeRequestSchema.shape : ScreenThemeSchema.shape;
  const object = strict ? z.strictObject : z.object;
  return object({
    $schema: z.literal(SCREEN_TEMPLATE_SCHEMA).default(SCREEN_TEMPLATE_SCHEMA),
    tags: z.array(z.enum(SCREEN_TEMPLATE_TAGS)).max(SCREEN_TEMPLATE_TAGS.length).default([]),
    grid: theme.grid,
    masks: theme.masks,
  });
}

export const ScreenContentThemeSchema = contentSchema(false);
export const ScreenContentThemeRequestSchema = contentSchema(true);
export const ScreenBackgroundThemeSchema = backgroundSchema(false);
export const ScreenBackgroundThemeRequestSchema = backgroundSchema(true);
export const ScreenEffectsSchema = effectsSchema(false);
export const ScreenEffectsRequestSchema = effectsSchema(true);
export const ScreenTemplateSchema = templateSchema(false);
export const ScreenTemplateRequestSchema = templateSchema(true);

export type ScreenContentTheme = z.output<typeof ScreenContentThemeSchema>;
export type ScreenBackgroundTheme = z.output<typeof ScreenBackgroundThemeSchema>;
export type ScreenEffects = z.output<typeof ScreenEffectsSchema>;
export type ScreenTemplateLayout = z.output<typeof ScreenTemplateSchema>;
export type ScreenPart = ScreenContentTheme | ScreenBackgroundTheme | ScreenEffects;

/** A part's document as the API takes it, by kind. */
export const SCREEN_PART_REQUEST_SCHEMAS = { content: ScreenContentThemeRequestSchema, background: ScreenBackgroundThemeRequestSchema, effects: ScreenEffectsRequestSchema } as const;

/** Reads a document part by part: one it can't read falls back to that part's defaults, the rest stays. Never throws. */
function readByPart<T>(schema: z.ZodType<T>, shape: Record<string, z.ZodType>, input: unknown, special: Record<string, (value: unknown) => unknown> = {}): T {
  const whole = schema.safeParse(input && typeof input === "object" ? input : {});
  if (whole.success) return whole.data;
  const parts = input as Record<string, unknown>;
  const read: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    if (key === "$schema" || parts[key] === undefined) continue;
    if (special[key]) {
      read[key] = special[key](parts[key]);
      continue;
    }
    const one = shape[key]!.safeParse(parts[key]);
    if (one.success) read[key] = one.data;
  }
  return schema.parse(read);
}

/** A content theme as a client reads it: a part it can't read falls back to its defaults. Never throws. */
export function readScreenContentTheme(input: unknown): ScreenContentTheme {
  return readByPart(ScreenContentThemeSchema, ScreenContentThemeSchema.shape, input);
}

/** A background theme as a client reads it. Never throws. */
export function readScreenBackgroundTheme(input: unknown): ScreenBackgroundTheme {
  return readByPart(ScreenBackgroundThemeSchema, ScreenBackgroundThemeSchema.shape, input);
}

/** Effects as a client reads them: a reaction it can't read (a trigger from a later version) is left out, the others stay. Never throws. */
export function readScreenEffects(input: unknown): ScreenEffects {
  return ScreenEffectsSchema.parse(resolveEffects(input));
}

/** A template's layout as a client reads it: a widget or a mask it can't read is left out, the rest stays. Never throws. */
export function readScreenTemplate(input: unknown): ScreenTemplateLayout {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const tags = Array.isArray(raw.tags) ? [...new Set(raw.tags)].filter((tag): tag is ScreenTemplateTag => (SCREEN_TEMPLATE_TAGS as readonly unknown[]).includes(tag)) : [];
  const masks = Array.isArray(raw.masks)
    ? raw.masks.flatMap((one) => {
        const mask = ScreenMaskSchema.safeParse(one);
        return mask.success ? [mask.data] : [];
      })
    : [];
  return ScreenTemplateSchema.parse({ tags, grid: resolveGrid(raw.grid), masks: masks.slice(0, SCREEN_MASKS_MAX) });
}

/**
 * What a screen draws (issue #281): a template's content theme, background
 * theme, effects and layout, made into one screen theme. With effects off
 * (a screen that can't keep up), none: the background keeps its own motion
 * but doesn't answer the words, and the words don't move beyond their
 * transitions.
 */
export function composeScreenTheme(
  parts: { content: unknown; background: unknown; effects?: unknown | null; template?: unknown },
  options: { effects?: boolean } = {},
): ScreenTheme {
  const content = readScreenContentTheme(parts.content);
  const background = readScreenBackgroundTheme(parts.background);
  const effects = parts.effects && options.effects !== false ? readScreenEffects(parts.effects) : null;
  const template = readScreenTemplate(parts.template);
  const { $schema: _content, ...words } = content;
  const { $schema: _background, ...look } = background;
  void _content;
  void _background;
  return ScreenThemeSchema.parse({
    ...words,
    ...look,
    // The pulse and the warmer chorus that came with "reactive" before effects: on when the effects make the background react.
    background: { ...look.background, reactive: !!effects && effects.reactions.length > 0 },
    effects: effects ? { reactions: effects.reactions, text: effects.text } : null,
    grid: template.grid,
    masks: template.masks,
  });
}

/**
 * A screen theme split into its parts (issue #281): how the themes made
 * before parts are read again - their words, their background, effects
 * (a background that "moved with the song" pulses with each slide and
 * brightens in a chorus) and their layout. Composing them again gives the
 * same look.
 */
export function splitScreenTheme(input: unknown): { content: ScreenContentTheme; background: ScreenBackgroundTheme; effects: ScreenEffects | null; template: ScreenTemplateLayout } {
  const theme = resolveScreenTheme(input);
  const content = ScreenContentThemeSchema.parse({ shows: theme.shows, text: theme.text, lines: theme.lines, layout: theme.layout, title: theme.title, credits: theme.credits, motion: theme.motion, chords: theme.chords });
  const background = ScreenBackgroundThemeSchema.parse({ base: theme.base, video: theme.video, background: { ...theme.background, reactive: false }, reacts: theme.reacts });
  const effects = theme.effects
    ? ScreenEffectsSchema.parse(theme.effects)
    : theme.background.reactive
      ? ScreenEffectsSchema.parse({ reactions: [{ on: "slide", target: "pulse", amount: 0.6 }, { on: "chorus", target: "brightness", amount: 0.6 }] })
      : null;
  const template = ScreenTemplateSchema.parse({ grid: theme.grid, masks: theme.masks });
  return { content, background, effects, template };
}

/** A built-in part: its id, and its name in the locale files (`screens.parts.<kind>.<id>`). */
export interface ScreenBuiltInPart<T> {
  id: string;
  part: T;
}

/** A built-in template (issue #281): its parts by their built-in ids, its tags and layout. Its name is `screens.templates.<id>`. */
export interface ScreenBuiltInTemplate {
  id: string;
  content: string;
  background: string;
  effects: string | null;
  template: ScreenTemplateLayout;
}

const TAGS: Record<string, ScreenTemplateTag[]> = {
  classic: ["audience", "lyrics"],
  concert: ["audience", "lyrics"],
  chapel: ["audience", "lyrics"],
  sunrise: ["audience", "lyrics"],
  starlight: ["audience", "lyrics"],
  spotlight: ["audience", "lyrics"],
  stream: ["audience", "lyrics", "presentation"],
  minimal: ["audience", "lyrics"],
  "stage-display": ["stage", "lyrics"],
  "stage-monitor": ["stage", "lyrics"],
  "band-chart": ["stage", "chords"],
};

/** The built-in effects: those of the built-in templates whose background moved with the song, and a few more to start from. */
const BUILT_IN_EFFECTS: ScreenBuiltInPart<ScreenEffects>[] = [
  { id: "pulse", part: ScreenEffectsSchema.parse({ reactions: [{ on: "slide", target: "pulse", amount: 0.6 }, { on: "chorus", target: "brightness", amount: 0.6 }] }) },
  {
    id: "concert",
    part: ScreenEffectsSchema.parse({
      reactions: [
        { on: "slide", target: "pulse", amount: 0.7 },
        { on: "word", target: "elements", amount: 0.4 },
        { on: "chorus", target: "movement", amount: 0.7 },
        { on: "chorus", target: "brightness", amount: 0.6 },
      ],
      text: { animation: "glow", amount: 0.4, speed: 1 },
    }),
  },
  {
    id: "sunrise",
    part: ScreenEffectsSchema.parse({ reactions: [{ on: "slide", target: "pulse", amount: 0.5 }, { on: "section", target: "hue", amount: 0.5 }, { on: "chorus", target: "brightness", amount: 0.5 }] }),
  },
  {
    id: "starlight",
    part: ScreenEffectsSchema.parse({ reactions: [{ on: "word", target: "elements", amount: 0.5 }, { on: "chorus", target: "brightness", amount: 0.5 }], text: { animation: "shimmer", amount: 0.4, speed: 0.8 } }),
  },
  { id: "spotlight", part: ScreenEffectsSchema.parse({ reactions: [{ on: "slide", target: "movement", amount: 0.6 }, { on: "chorus", target: "brightness", amount: 0.6 }], text: { animation: "pulse", amount: 0.3, speed: 1 } }) },
  { id: "breathe", part: ScreenEffectsSchema.parse({ reactions: [{ on: "line", target: "pulse", amount: 0.3 }], text: { animation: "breathe", amount: 0.4, speed: 0.6 } }) },
];

const split = SCREEN_THEME_TEMPLATES.map((one) => ({ id: one.id, ...splitScreenTheme(one.theme) }));
// The chord chart for the band, in the classic look.
const chart = splitScreenTheme(SCREEN_THEME_TEMPLATES[0]!.theme);

/** The built-in content themes: each built-in template's words, and the chord chart. */
export const SCREEN_CONTENT_THEMES: ScreenBuiltInPart<ScreenContentTheme>[] = [
  ...split.map((one) => ({ id: one.id, part: one.content })),
  { id: "chart", part: ScreenContentThemeSchema.parse({ ...chart.content, shows: "chart", chords: { color: "#facc15", scale: 1.1 } }) },
];
/** The built-in background themes: each built-in template's. */
export const SCREEN_BACKGROUND_THEMES: ScreenBuiltInPart<ScreenBackgroundTheme>[] = split.map((one) => ({ id: one.id, part: one.background }));
export const SCREEN_EFFECTS: ScreenBuiltInPart<ScreenEffects>[] = BUILT_IN_EFFECTS;

/** The built-in templates (issue #281): the looks there were before parts, now made of them, each tagged for its use, and the band's chart. */
export const SCREEN_TEMPLATES: ScreenBuiltInTemplate[] = [
  ...split.map((one) => ({
    id: one.id,
    content: one.id,
    background: one.id,
    effects: one.effects ? (BUILT_IN_EFFECTS.some((effects) => effects.id === one.id) ? one.id : "pulse") : null,
    template: ScreenTemplateSchema.parse({ ...one.template, tags: TAGS[one.id] ?? [] }),
  })),
  { id: "band-chart", content: "chart", background: "classic", effects: null, template: ScreenTemplateSchema.parse({ tags: TAGS["band-chart"] }) },
];

export function screenBuiltInPart(kind: "content", id: string | null | undefined): ScreenContentTheme | undefined;
export function screenBuiltInPart(kind: "background", id: string | null | undefined): ScreenBackgroundTheme | undefined;
export function screenBuiltInPart(kind: "effects", id: string | null | undefined): ScreenEffects | undefined;
export function screenBuiltInPart(kind: ScreenPartKind, id: string | null | undefined): ScreenPart | undefined {
  const list: ScreenBuiltInPart<ScreenPart>[] = kind === "content" ? SCREEN_CONTENT_THEMES : kind === "background" ? SCREEN_BACKGROUND_THEMES : SCREEN_EFFECTS;
  return list.find((one) => one.id === id)?.part;
}

export function screenBuiltInTemplate(id: string | null | undefined): ScreenBuiltInTemplate | undefined {
  return SCREEN_TEMPLATES.find((one) => one.id === id);
}

/** A built-in template, composed: what a screen using it draws. */
export function composeBuiltInTemplate(id: string | null | undefined, options: { effects?: boolean } = {}): ScreenTheme | undefined {
  const template = screenBuiltInTemplate(id);
  if (!template) return undefined;
  return composeScreenTheme(
    { content: screenBuiltInPart("content", template.content), background: screenBuiltInPart("background", template.background), effects: screenBuiltInPart("effects", template.effects), template: template.template },
    options,
  );
}

/** Templates with all of these tags (issue #281); none, all of them. */
export function filterScreenTemplates<T extends { tags: readonly string[] }>(templates: T[], tags: readonly string[]): T[] {
  return templates.filter((one) => tags.every((tag) => one.tags.includes(tag)));
}
