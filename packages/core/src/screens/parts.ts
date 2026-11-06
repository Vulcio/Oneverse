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
  screenTitleWidgets,
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
export const SCREEN_TEMPLATE_TAGS = ["audience", "stage", "presentation", "lyrics", "chords", "signage", "scripture"] as const;
/** What a template is made for (issue #402): what the editor offers and previews with, and which templates come first where one is picked. None: anything. */
export const SCREEN_CONTENT_KINDS = ["songs", "scripture"] as const;
export type ScreenContentKind = (typeof SCREEN_CONTENT_KINDS)[number];
/** How many verses of a passage a template puts on a slide (issue #310), at most. */
export const SCREEN_VERSES_PER_SLIDE_MAX = 10;
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
    display: theme.display,
    sections: theme.sections,
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

/**
 * A template's own document: its tags and layout - the widget grid and the
 * masks - and how many verses of a passage go on a slide (issue #310). Its
 * parts are referred to beside it.
 */
function templateSchema(strict: boolean) {
  const theme = strict ? ScreenThemeRequestSchema.shape : ScreenThemeSchema.shape;
  const object = strict ? z.strictObject : z.object;
  return object({
    $schema: z.literal(SCREEN_TEMPLATE_SCHEMA).default(SCREEN_TEMPLATE_SCHEMA),
    tags: z.array(z.enum(SCREEN_TEMPLATE_TAGS)).max(SCREEN_TEMPLATE_TAGS.length).default([]),
    grid: theme.grid,
    masks: theme.masks,
    versesPerSlide: z.number().int().min(1).max(SCREEN_VERSES_PER_SLIDE_MAX).default(1),
    /**
     * The song's title and credits are widgets in the grid (issue #398). A
     * template from before has its content theme's made widgets when it's
     * read (screenTitleWidgets); saved again, it has them as widgets.
     */
    titleWidgets: z.boolean().default(false),
    /** What it's made for (issue #402); none: anything. It never stops a screen showing something else with it. */
    madeFor: z.array(z.enum(SCREEN_CONTENT_KINDS)).max(SCREEN_CONTENT_KINDS.length).default([]),
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
  const verses = ScreenTemplateSchema.shape.versesPerSlide.safeParse(raw.versesPerSlide);
  const madeFor = Array.isArray(raw.madeFor) ? [...new Set(raw.madeFor)].filter((kind): kind is ScreenContentKind => (SCREEN_CONTENT_KINDS as readonly unknown[]).includes(kind)) : [];
  return ScreenTemplateSchema.parse({
    tags,
    grid: resolveGrid(raw.grid),
    masks: masks.slice(0, SCREEN_MASKS_MAX),
    versesPerSlide: verses.success ? verses.data : undefined,
    titleWidgets: raw.titleWidgets === true,
    madeFor,
  });
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
    // The title and credits are widgets (issue #398): the content theme's, made ones for a template from before.
    title: { ...words.title, show: false },
    credits: { ...words.credits, show: false },
    grid: template.titleWidgets ? template.grid : screenTitleWidgets(template.grid, words.title, words.credits),
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
  const content = ScreenContentThemeSchema.parse({ shows: theme.shows, text: theme.text, lines: theme.lines, layout: theme.layout, title: theme.title, credits: theme.credits, motion: theme.motion, chords: theme.chords, display: theme.display, sections: theme.sections });
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
  chapel: ["audience", "lyrics", "scripture"],
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
  // For shaders (issue #324): a slow background that speeds up as the words come, then settles quickly.
  { id: "ramp", part: ScreenEffectsSchema.parse({ reactions: [{ on: "slide", target: "movement", amount: 1, rise: 150, fall: 700 }] }) },
  // ...that turns a little further with each slide, and comes a little closer in a chorus.
  { id: "turn", part: ScreenEffectsSchema.parse({ reactions: [{ on: "slide", target: "rotation", amount: 0.8, rise: 200, fall: 1200 }, { on: "chorus", target: "scale", amount: 0.6 }] }) },
  // ...that quickens and glows with each line.
  { id: "nerves", part: ScreenEffectsSchema.parse({ reactions: [{ on: "line", target: "movement", amount: 0.7, rise: 100, fall: 500 }, { on: "line", target: "brightness", amount: 0.5, rise: 100, fall: 500 }] }) },
  // ...calm in the verses, livelier while a chorus lasts.
  { id: "chorus-lift", part: ScreenEffectsSchema.parse({ reactions: [{ on: "slide", target: "pulse", amount: 0.3 }, { on: "chorus", target: "movement", amount: 0.6 }, { on: "chorus", target: "brightness", amount: 0.4 }] }) },
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
export const SCREEN_BACKGROUND_THEMES: ScreenBuiltInPart<ScreenBackgroundTheme>[] = [
  ...split.map((one) => ({ id: one.id, part: one.background })),
  // The backgrounds that follow the words (issue #296).
  { id: "flow", part: ScreenBackgroundThemeSchema.parse({ background: { kind: "flow", colors: ["#050816", "#22d3ee", "#a855f7", "#f472b6"], motion: 0.5 }, reacts: { movement: 0.7, hue: 0.4, elements: 0.6 } }) },
  { id: "strings", part: ScreenBackgroundThemeSchema.parse({ background: { kind: "strings", colors: ["#03040a", "#38bdf8", "#f472b6", "#facc15"], motion: 0.5 }, reacts: { movement: 0.6, elements: 0.8, brightness: 0.6 } }) },
  { id: "grid", part: ScreenBackgroundThemeSchema.parse({ background: { kind: "grid", colors: ["#020617", "#2dd4bf", "#0ea5e9"], motion: 0.4 }, reacts: { elements: 0.8, brightness: 0.6, hue: 0.2 } }) },
  { id: "bokeh", part: ScreenBackgroundThemeSchema.parse({ background: { kind: "bokeh", colors: ["#0b0a1f", "#4f46e5", "#7c3aed", "#db2777"], motion: 0.4 }, reacts: { elements: 0.7, movement: 0.5, hue: 0.3 } }) },
  // Shaders (issue #297), drawn with WebGL.
  { id: "mesh-gradient", part: ScreenBackgroundThemeSchema.parse({ background: { kind: "shader", colors: ["#0b0620", "#7c3aed", "#ec4899", "#0ea5e9"], shader: { builtIn: "mesh-gradient" } }, reacts: { movement: 0.5, hue: 0.3, brightness: 0.5 } }) },
  // Ported from Paper Shaders (issue #324).
  { id: "paper-mesh", part: ScreenBackgroundThemeSchema.parse({ background: { kind: "shader", colors: ["#120a2e", "#241d9a", "#f75092", "#9f50d3", "#0ea5e9"], shader: { builtIn: "paper-mesh" } }, reacts: { movement: 0.5, hue: 0.2, brightness: 0.4 } }) },
  { id: "neuro-noise", part: ScreenBackgroundThemeSchema.parse({ background: { kind: "shader", colors: ["#000000", "#ffffff", "#47a6ff"], motion: 0.3, shader: { builtIn: "neuro-noise", values: { sv_brightness: 0.03, sv_contrast: 0.55 } } }, reacts: { movement: 0.8, brightness: 0.4 } }) },
  // Slow, for effects that speed it up (ramp) or turn it (turn).
  { id: "slow-mesh", part: ScreenBackgroundThemeSchema.parse({ background: { kind: "shader", colors: ["#0c0a24", "#241d9a", "#f75092", "#9f50d3", "#0ea5e9"], motion: 0.15, shader: { builtIn: "paper-mesh" } }, reacts: { movement: 1, hue: 0.2, brightness: 0.3 } }) },
  { id: "turning-mesh", part: ScreenBackgroundThemeSchema.parse({ background: { kind: "shader", colors: ["#06121f", "#0ea5e9", "#22d3ee", "#a855f7", "#f472b6"], motion: 0.25, spin: 3, shader: { builtIn: "paper-mesh", values: { sv_swirl: 0.35 } } }, reacts: { movement: 0.3, rotation: 1, scale: 0.8 } }) },
  { id: "glow-lines", part: ScreenBackgroundThemeSchema.parse({ background: { kind: "shader", colors: ["#02030a", "#22d3ee", "#a855f7", "#f43f5e"], shader: { builtIn: "glow-lines" } }, reacts: { movement: 0.6, elements: 0.7, brightness: 0.5 } }) },
  { id: "embers", part: ScreenBackgroundThemeSchema.parse({ background: { kind: "shader", colors: ["#0a0503", "#f97316", "#facc15", "#ef4444"], shader: { builtIn: "embers" } }, reacts: { movement: 0.5, elements: 0.6, brightness: 0.6 } }) },
];
export const SCREEN_EFFECTS: ScreenBuiltInPart<ScreenEffects>[] = BUILT_IN_EFFECTS;

/** The built-in templates (issue #281): the looks there were before parts, now made of them, each tagged for its use, and the band's chart. */
export const SCREEN_TEMPLATES: ScreenBuiltInTemplate[] = [
  ...split.map((one) => ({
    id: one.id,
    content: one.id,
    background: one.id,
    effects: one.effects ? (BUILT_IN_EFFECTS.some((effects) => effects.id === one.id) ? one.id : "pulse") : null,
    template: ScreenTemplateSchema.parse({ ...one.template, tags: TAGS[one.id] ?? [], madeFor: ["songs"] }),
  })),
  { id: "band-chart", content: "chart", background: "classic", effects: null, template: ScreenTemplateSchema.parse({ tags: TAGS["band-chart"], madeFor: ["songs"] }) },
  // Shaders that move with the words (issue #324).
  { id: "drift", content: "classic", background: "slow-mesh", effects: "ramp", template: ScreenTemplateSchema.parse({ tags: ["audience", "lyrics"], madeFor: ["songs"] }) },
  { id: "turning", content: "classic", background: "turning-mesh", effects: "turn", template: ScreenTemplateSchema.parse({ tags: ["audience", "lyrics"], madeFor: ["songs"] }) },
  { id: "neural", content: "classic", background: "neuro-noise", effects: "nerves", template: ScreenTemplateSchema.parse({ tags: ["audience", "lyrics"], madeFor: ["songs"] }) },
  // For a passage (issue #310): the chapel's look, two verses a slide.
  { id: "scripture", content: "chapel", background: "chapel", effects: null, template: ScreenTemplateSchema.parse({ tags: ["audience", "scripture"], versesPerSlide: 2, madeFor: ["scripture"] }) },
  // For a passage on the singers' and speakers' screen (issue #402): the stage display's, the reference where the song was.
  {
    id: "stage-scripture",
    content: "stage-display",
    background: "stage-display",
    effects: null,
    template: ScreenTemplateSchema.parse({
      tags: ["stage", "scripture"],
      madeFor: ["scripture"],
      titleWidgets: true,
      grid: {
        black: "words",
        widgets: [
          { id: "current", kind: "current-slide", x: 0, y: 0, w: 8, h: 7 },
          { id: "next", kind: "next-slide", x: 0, y: 7, w: 8, h: 3, style: { color: "#a3a3a3" } },
          { id: "clock", kind: "clock", x: 8, y: 0, w: 4, h: 2, options: { seconds: true } },
          { id: "countdown", kind: "countdown", x: 8, y: 2, w: 4, h: 4, style: { opacity: 0.5, background: "#1f2937" } },
          { id: "reference", kind: "song-title", x: 8, y: 6, w: 4, h: 2, options: { when: "every" } },
          { id: "next-item", kind: "next-item", x: 8, y: 8, w: 4, h: 2, style: { color: "#a3a3a3" } },
          { id: "message", kind: "message", x: 0, y: 10, w: 12, h: 2, style: { background: "#b91c1c", opacity: 0.9, color: "#ffffff" } },
        ],
      },
    }),
  },
  // For a passage over a stream (issue #402): the stream's lower third, its reference under it.
  {
    id: "stream-scripture",
    content: "stream",
    background: "stream",
    effects: null,
    template: ScreenTemplateSchema.parse({
      tags: ["presentation", "scripture"],
      madeFor: ["scripture"],
      titleWidgets: true,
      grid: {
        widgets: [
          { id: "words", kind: "stage", x: 0, y: 0, w: 12, h: 10 },
          { id: "reference", kind: "song-title", x: 0, y: 10, w: 12, h: 1, options: { when: "every" } },
        ],
      },
    }),
  },
];

/**
 * Whether a template is made for a kind of content (issue #402): what it
 * says it's made for, else (a template from before) its Scripture tag for
 * passages; one made for nothing in particular is for anything.
 */
export function screenTemplateFor(template: { tags?: readonly string[]; madeFor?: readonly string[] }, kind: ScreenContentKind): boolean {
  if (template.madeFor?.length) return template.madeFor.includes(kind);
  return kind === "scripture" ? !!template.tags?.includes("scripture") : !template.tags?.includes("scripture");
}

/**
 * What a screen is for (issue #402), picked when it's paired: the built-in
 * templates it starts with, for songs and for Bible passages (null: the
 * default look). Changed afterwards in its settings.
 */
export const SCREEN_ROLES = {
  audience: { songs: null, scripture: "scripture" },
  stage: { songs: "stage-display", scripture: "stage-scripture" },
  stream: { songs: "stream", scripture: "stream-scripture" },
  band: { songs: "band-chart", scripture: "stage-scripture" },
} as const satisfies Record<string, { songs: string | null; scripture: string }>;
export type ScreenRole = keyof typeof SCREEN_ROLES;

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
