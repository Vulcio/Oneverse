import "../zod-config.js";
import { z } from "zod";

/**
 * Screen themes (issue #194): how a big screen shows a set - its text,
 * the lines around the current ones, where they sit, the background, the
 * song's title and credits, and how slides come and go. A small JSON
 * document (docs/screen-theme-v1.md), the same for the web screen, the
 * Google TV app (#187) and the native apps (#165): a field a client doesn't
 * know is ignored, a theme it can't read falls back to the default look.
 */

export const SCREEN_THEME_SCHEMA = "screen-theme/v1";

/** Built-in typefaces every client has (the web app serves them itself). */
export const SCREEN_FONTS = ["sans", "rounded", "geometric", "serif", "elegant", "condensed", "display", "mono"] as const;
export type ScreenFont = (typeof SCREEN_FONTS)[number];

/** Each font's family on the web, and what it falls back to. */
export const SCREEN_FONT_FAMILIES: Record<ScreenFont, string> = {
  sans: '"Inter Variable", "Inter", system-ui, sans-serif',
  rounded: '"Nunito Variable", "Nunito", ui-rounded, system-ui, sans-serif',
  geometric: '"Montserrat Variable", "Montserrat", system-ui, sans-serif',
  serif: '"Lora Variable", "Lora", Georgia, serif',
  elegant: '"Playfair Display Variable", "Playfair Display", Georgia, serif',
  condensed: '"Oswald Variable", "Oswald", "Arial Narrow", sans-serif',
  display: '"Bebas Neue", "Oswald Variable", Impact, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
};

/** How the lines before and after the current ones look. */
export const SCREEN_CONTEXT_STYLES = ["dim", "small", "blur", "hidden"] as const;
/** Where the lines sit: a lower third leaves the picture above free, for a stream or a video. */
export const SCREEN_POSITIONS = ["top", "center", "bottom", "lower-third"] as const;
/**
 * A still colour, a gradient, or a moving background that answers the words.
 * Flow, strings, grid and bokeh (issue #296) also follow where the words are
 * on the screen: trails part around them, strings bend away, cells light up
 * under each word, discs gather behind the line. A shader (issue #297) is an
 * ISF fragment shader, built in or uploaded, drawn with WebGL.
 */
export const SCREEN_BACKGROUNDS = ["color", "gradient", "aurora", "waves", "particles", "spotlight", "image", "video", "flow", "strings", "grid", "bokeh", "shader"] as const;
/** The backgrounds drawn on a canvas, following the words (issue #296). */
export const SCREEN_TEXT_BACKGROUNDS = ["flow", "strings", "grid", "bokeh"] as const;
/** What a theme's own files are for (issue #194): a background picture or looping video, a font, or an ISF shader (issue #297). */
export const SCREEN_THEME_ASSET_KINDS = ["media", "font", "shader"] as const;
export type ScreenThemeAssetKind = (typeof SCREEN_THEME_ASSET_KINDS)[number];
/** How one slide gives way to the next. */
export const SCREEN_TRANSITIONS = ["cut", "fade", "slide", "rise", "scale", "blur", "zoom"] as const;
/** How a slide's words come in: all at once, line by line, word by word, letter by letter, typed, or glowing in. */
export const SCREEN_REVEALS = ["none", "lines", "words", "letters", "typewriter", "glow"] as const;
export const SCREEN_TEXT_EFFECTS = ["none", "shadow", "outline", "glow"] as const;

/**
 * What a screen draws, from the bottom (issue #280): a colour; a camera or a
 * capture card; the picture, video or moving background; the words and the
 * widgets that show the song; the other widgets and the operator's title
 * card; and masks over it all. Their names are in the locale files
 * (`screens.layers.<id>`).
 */
export const SCREEN_LAYERS = ["base", "video", "media", "content", "overlays", "masks"] as const;
export type ScreenLayer = (typeof SCREEN_LAYERS)[number];
/** The layers a screen or the operator shows, hides or clears: all but the base, which is always there. */
export const SCREEN_SWITCHABLE_LAYERS = ["video", "media", "content", "overlays", "masks"] as const;
export type ScreenSwitchableLayer = (typeof SCREEN_SWITCHABLE_LAYERS)[number];
/** Where a theme's video input comes from (issue #280): none, or a camera or capture card on the screen's device. */
export const SCREEN_VIDEO_SOURCES = ["none", "camera"] as const;
/** A mask's shape, and what it does: cover (black, for a projector on an odd-shaped wall) or window (a hole in the media layer, down to the video input and the base). */
export const SCREEN_MASK_SHAPES = ["rect", "ellipse"] as const;
export const SCREEN_MASK_KINDS = ["cover", "window"] as const;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: "a colour is written #rrggbb" });

/**
 * What a screen can show besides the words (issue #267), placed on a
 * template's grid (issue #268). Their names and descriptions are in the
 * locale files (`screens.widgetKinds.<kind>`).
 */
export const SCREEN_WIDGET_KINDS = [
  "stage",
  "current-slide",
  "next-slide",
  "current-section",
  "next-section",
  "song-structure",
  "clock",
  "analog-clock",
  "countdown",
  "count-up",
  "message",
  "song",
  "next-song",
  "current-item",
  "next-item",
  "text",
  "date",
  "slide-count",
  "qr-code",
] as const;
export type ScreenWidgetKind = (typeof SCREEN_WIDGET_KINDS)[number];
/** Where a timer's time comes from: the media operator (issue #269), a length from when the set item came on, a time of day, the song on screen. */
export const SCREEN_TIMER_SOURCES = ["operator", "duration", "until", "song"] as const;
/** How the Date widget writes the day (issue #289): "Sunday 20 October", "20 Oct 2026", "20/10/2026", "2026-10-20", or the weekday alone. */
export const SCREEN_DATE_FORMATS = ["long", "medium", "short", "iso", "weekday"] as const;
/** What a QR code widget holds (issue #289): an address, an event, a contact card, a Wi-Fi network. */
export const SCREEN_QR_KINDS = ["url", "event", "contact", "wifi"] as const;
/** The most columns or rows a template's grid has. */
export const SCREEN_GRID_MAX = 24;

/** A widget on a template's grid (issue #268): what it is, the cells it covers, its options and its look. */
function screenWidgetSchema(strict: boolean) {
  const object = strict ? z.strictObject : z.object;
  return object({
    id: z.string().min(1).max(40),
    kind: z.enum(SCREEN_WIDGET_KINDS),
    /** The layer it's on (issue #280): null, its kind's (screenWidgetLayer). */
    layer: z.enum(["content", "overlays"]).nullable().default(null),
    /** Its first column and row (from 0), and how many it covers. */
    x: z.number().int().min(0).max(SCREEN_GRID_MAX - 1),
    y: z.number().int().min(0).max(SCREEN_GRID_MAX - 1),
    w: z.number().int().min(1).max(SCREEN_GRID_MAX),
    h: z.number().int().min(1).max(SCREEN_GRID_MAX),
    /** What it shows; each kind reads the options it has, and ignores the others. */
    options: object({
      /** Clock: 24 or 12 hours, the seconds, the date. */
      format: z.enum(["24h", "12h"]).default("24h"),
      seconds: z.boolean().default(false),
      date: z.boolean().default(false),
      /** Countdown and count up: where the time comes from. */
      source: z.enum(SCREEN_TIMER_SOURCES).default("operator"),
      /** Countdown from "duration": its length, in seconds. */
      duration: z.number().int().min(1).max(86_400).default(300),
      /** Countdown "until": a time of day, HH:MM. */
      until: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "until is a time written HH:MM" }).default("10:00"),
      /** Countdown past zero: counting on (in red), or holding at 0:00. */
      overtime: z.enum(["count", "stop"]).default("count"),
      /** Countdown: shown in amber under this many seconds. */
      warn: z.number().int().min(0).max(3600).default(60),
      /** A few words above it ("Sermon", "Next"). */
      label: z.string().max(60).default(""),
      /** Text: its words. */
      text: z.string().max(280).default(""),
      /** Song: its key and tempo beside the title; current and next item: where it is in the set (3 of 8). */
      details: z.boolean().default(true),
      /**
       * Countdown and count up (issue #272): colours by time, for the text and
       * the panel behind it - a countdown's once that many seconds are left
       * (the fewest that apply), a count up's once that many have gone by.
       */
      breakpoints: z
        .array(object({ at: z.number().int().min(0).max(86_400), color: color.nullable().default(null), background: color.nullable().default(null) }))
        .max(6)
        .default([]),
      /** Date (issue #289): how the day is written; with the time (in the clock's `format`) or not. */
      dateFormat: z.enum(SCREEN_DATE_FORMATS).default("long"),
      time: z.boolean().default(false),
      /** Slide count (issue #289): the song's slides or the whole set's, and a progress bar under it. */
      scope: z.enum(["song", "set"]).default("song"),
      progress: z.enum(["none", "thin", "thick"]).default("thin"),
      /** QR code (issue #289): what it holds; its caption is the label. */
      qr: object({
        kind: z.enum(SCREEN_QR_KINDS).default("url"),
        url: z.string().max(500).default(""),
        /** An event: its title, start and end (YYYY-MM-DDTHH:MM, the screen's time) and place. */
        title: z.string().max(120).default(""),
        start: z.string().max(16).default(""),
        end: z.string().max(16).default(""),
        place: z.string().max(200).default(""),
        /** A contact: name, phone, email, organisation. */
        name: z.string().max(120).default(""),
        phone: z.string().max(40).default(""),
        email: z.string().max(200).default(""),
        organization: z.string().max(120).default(""),
        /** Wi-Fi: the network's name, its password and how it's secured. */
        ssid: z.string().max(64).default(""),
        password: z.string().max(64).default(""),
        security: z.enum(["WPA", "WEP", "nopass"]).default("WPA"),
      }).prefault({}),
    }).prefault({}),
    style: object({
      /** The template's font, or another. */
      font: z.enum(SCREEN_FONTS).nullable().default(null),
      /** The template's text colour, or another. */
      color: color.nullable().default(null),
      /** A panel behind it, and how much it shows (0: none). */
      background: color.default("#000000"),
      opacity: z.number().min(0).max(1).default(0),
      align: z.enum(["left", "center", "right"]).default("center"),
      /** "auto" fits the cell; a number is the text's height in % of the cell's. */
      size: z.union([z.literal("auto"), z.number().min(5).max(90)]).default("auto"),
      /** Rounded corners, in % of the screen's shorter side. */
      radius: z.number().min(0).max(10).default(1),
    }).prefault({}),
  });
}

export const ScreenWidgetSchema = screenWidgetSchema(false);
/** A widget's look and options without its place (issue #273): a kind's default, applied when it's added to a template. */
export const ScreenWidgetLookSchema = screenWidgetSchema(false).pick({ options: true, style: true });
export const ScreenWidgetLookRequestSchema = screenWidgetSchema(true).pick({ options: true, style: true });
export type ScreenWidgetLook = z.output<typeof ScreenWidgetLookSchema>;
export type ScreenWidget = z.output<typeof ScreenWidgetSchema>;
export type ScreenWidgetInput = z.input<typeof ScreenWidgetSchema>;

/** A template's grid (issue #268): its columns and rows inside the safe margin, the gap between cells, and its widgets, drawn in order (later ones on top). */
function screenGridSchema(strict: boolean) {
  const object = strict ? z.strictObject : z.object;
  return object({
    columns: z.number().int().min(1).max(SCREEN_GRID_MAX).default(12),
    rows: z.number().int().min(1).max(SCREEN_GRID_MAX).default(12),
    /** Between cells, in % of the screen's shorter side. */
    gap: z.number().min(0).max(5).default(1),
    /** What Black hides: the whole screen, or only the words (a stage display keeps its clock and timers). */
    black: z.enum(["all", "words"]).default("all"),
    widgets: z.array(screenWidgetSchema(strict)).max(32).default([]),
  });
}

/** What a template's words are (issue #281): the lyrics, for the audience, or the chord chart, for the band. */
export const SCREEN_CONTENT_SHOWS = ["lyrics", "chart"] as const;
/**
 * Effects (issue #281), the glue between the words and the background: what
 * sets a reaction off - a slide coming, a line or a word appearing, a new
 * section, a chorus (while it lasts) - and what in the background answers:
 * a pulse of light, its movement, its hue, its brightness, its elements
 * (blobs, waves, particles, beams) swelling; for a shader that follows the
 * spec (issue #324), its rotation and its scale too. Names in the locale
 * files.
 */
export const SCREEN_EFFECT_TRIGGERS = ["slide", "line", "word", "section", "chorus"] as const;
export const SCREEN_EFFECT_TARGETS = ["pulse", "movement", "hue", "brightness", "elements", "rotation", "scale"] as const;
/** What effects do to the words themselves, besides their readability. */
export const SCREEN_TEXT_ANIMATIONS = ["none", "pulse", "breathe", "glow", "shimmer", "float"] as const;
/** The most reactions effects have. */
export const SCREEN_REACTIONS_MAX = 12;

/** Effects (issue #281): reactions of the background to the words, and an animation of the words. */
export function screenEffectsSchema(strict: boolean) {
  const object = strict ? z.strictObject : z.object;
  return object({
    reactions: z
      .array(
        object({
          on: z.enum(SCREEN_EFFECT_TRIGGERS),
          target: z.enum(SCREEN_EFFECT_TARGETS),
          /** How strongly, 0 to 1. */
          amount: z.number().min(0).max(1).default(0.5),
        }),
      )
      .max(SCREEN_REACTIONS_MAX)
      .default([]),
    text: object({
      animation: z.enum(SCREEN_TEXT_ANIMATIONS).default("none"),
      amount: z.number().min(0).max(1).default(0.5),
      /** Its pace: 1 is a breath every few seconds; 0.25 to 4. */
      speed: z.number().min(0.25).max(4).default(1),
    }).prefault({}),
  });
}

/**
 * How much each of a background's inputs answers effects (issue #281), 0 to
 * 1: its movement, its hue, its brightness, its elements, its rotation and
 * scale (a shader's, issue #324). Built into a
 * background theme; effects decide when they're set off.
 */
export function screenReactsSchema(strict: boolean) {
  const object = strict ? z.strictObject : z.object;
  return object({
    movement: z.number().min(0).max(1).default(0.5),
    hue: z.number().min(0).max(1).default(0.3),
    brightness: z.number().min(0).max(1).default(0.5),
    elements: z.number().min(0).max(1).default(0.5),
    rotation: z.number().min(0).max(1).default(0.5),
    scale: z.number().min(0).max(1).default(0.5),
  });
}

/** A mask (issue #280): a shape, in % of the screen, covered in black or cut through the media layer; inverted, everything but the shape. */
function screenMaskSchema(strict: boolean) {
  const object = strict ? z.strictObject : z.object;
  return object({
    id: z.string().min(1).max(40),
    kind: z.enum(SCREEN_MASK_KINDS).default("cover"),
    shape: z.enum(SCREEN_MASK_SHAPES).default("rect"),
    x: z.number().min(0).max(100).default(0),
    y: z.number().min(0).max(100).default(0),
    w: z.number().min(1).max(100).default(20),
    h: z.number().min(1).max(100).default(20),
    invert: z.boolean().default(false),
    /** Its edge, softened over this much of the screen's shorter side (%). */
    feather: z.number().min(0).max(10).default(0),
  });
}
export const ScreenMaskSchema = screenMaskSchema(false);
export type ScreenMask = z.output<typeof ScreenMaskSchema>;
/** The most masks a theme has. */
export const SCREEN_MASKS_MAX = 8;

/** A theme's parts, as an object that ignores fields it doesn't know (reading) or refuses them (a request). */
function screenThemeSchema(strict: boolean) {
  const object = strict ? z.strictObject : z.object;
  return object({
  $schema: z.literal(SCREEN_THEME_SCHEMA).default(SCREEN_THEME_SCHEMA),
  /** The bottom layer (issue #280): a colour; null, the background's first, as before layers. */
  base: object({ color: color.nullable().default(null) }).prefault({}),
  /** The video input layer (issue #280): the screen's camera or capture card, under the media. */
  video: object({
      source: z.enum(SCREEN_VIDEO_SOURCES).default("none"),
      fit: z.enum(["cover", "contain"]).default("cover"),
      opacity: z.number().min(0).max(1).default(1),
    })
    .prefault({}),
  text: object({
      font: z.enum(SCREEN_FONTS).default("sans"),
      /** A font uploaded with the theme (its asset's id): used when the client has it, `font` otherwise. */
      customFont: z.string().max(40).nullable().default(null),
      /** "auto" fits the longest line; a number is the size in % of the screen's shorter side. */
      size: z.union([z.literal("auto"), z.number().min(2).max(20)]).default("auto"),
      weight: z.number().int().min(100).max(900).multipleOf(100).default(600),
      upperCase: z.boolean().default(false),
      color: color.default("#ffffff"),
      effect: z.enum(SCREEN_TEXT_EFFECTS).default("shadow"),
      lineHeight: z.number().min(0.8).max(2.5).default(1.15),
      align: z.enum(["left", "center", "right"]).default("center"),
      letterSpacing: z.number().min(-0.1).max(0.5).default(0),
    })
    .prefault({}),
  /**
   * The lines being sung and the ones around them. Every screen and Live cut
   * a song into the same slides (lyricSlides), so a theme doesn't change
   * them: it shows the slide, or its whole section with the slide's lines
   * picked out.
   */
  lines: object({
      group: z.enum(["slide", "section"]).default("slide"),
      before: z.number().int().min(0).max(3).default(1),
      after: z.number().int().min(0).max(3).default(1),
      contextStyle: z.enum(SCREEN_CONTEXT_STYLES).default("dim"),
    })
    .prefault({}),
  layout: object({
      position: z.enum(SCREEN_POSITIONS).default("center"),
      /** Kept clear all round, in % of the screen: for TVs that crop their edges. */
      margin: z.number().min(0).max(20).default(5),
    })
    .prefault({}),
  background: object({
      kind: z.enum(SCREEN_BACKGROUNDS).default("color"),
      /** The first is the base; a gradient or a moving background uses the others too. */
      colors: z.array(color).min(1).max(4).default(["#000000"]),
      /** Moves with the song: a pulse as each slide comes, warmer and brighter in a chorus. */
      reactive: z.boolean().default(false),
      /** How much it moves, 0 (still) to 1: a shader's pace, 0.5 being its own. */
      motion: z.number().min(0).max(1).default(0.5),
      /** A shader's turn, in degrees a second (issue #324), one way or the other; reactions turn it further. */
      spin: z.number().min(-30).max(30).default(0),
      /** A picture or looping video uploaded with the theme (its asset's id), for "image" and "video"; without one, the colours. */
      media: z.string().max(40).nullable().default(null),
      /** Darkens it under the words, 0 to 0.9: words stay readable over anything. */
      dim: z.number().min(0).max(0.9).default(0),
      /** A "shader" background (issue #297): a built-in one (SCREEN_SHADERS) or one uploaded with the theme (its asset's id), and its controls' values. */
      shader: object({
          builtIn: z.string().max(40).nullable().default(null),
          asset: z.string().max(40).nullable().default(null),
          values: z.record(z.string().max(40), z.union([z.number(), z.boolean(), z.array(z.number()).max(4)]))
            .refine((values) => Object.keys(values).length <= 40, "background.shader.values must have at most 40 entries")
            .default({}),
        })
        .prefault({}),
    })
    .prefault({}),
  title: object({
      show: z.boolean().default(true),
      when: z.enum(["first", "every"]).default("first"),
    })
    .prefault({}),
  credits: object({
      show: z.boolean().default(true),
      where: z.enum(["bottom", "top", "lower-third"]).default("bottom"),
      when: z.enum(["first", "last", "first-and-last", "every"]).default("first-and-last"),
    })
    .prefault({}),
  motion: object({
      transition: z.enum(SCREEN_TRANSITIONS).default("fade"),
      /** A slide's change, in milliseconds; between songs it takes twice as long. */
      duration: z.number().int().min(0).max(3000).default(350),
      reveal: z.enum(SCREEN_REVEALS).default("none"),
      /** Between one line, word or letter coming and the next, in milliseconds. */
      stagger: z.number().int().min(0).max(400).default(60),
    })
    .prefault({}),
  /** The chart, for the band: its chords' colour and size. */
  chords: object({
      color: color.default("#7dd3fc"),
      scale: z.number().min(0.5).max(2).default(1),
    })
    .prefault({}),
  /** Widgets placed on a grid (issue #268); none, and the words fill the screen as they always have. */
  grid: screenGridSchema(strict).nullable().default(null),
  /** The masks layer (issue #280), drawn in order. */
  masks: z.array(screenMaskSchema(strict)).max(SCREEN_MASKS_MAX).default([]),
  /** What the words are (issue #281): the lyrics, or the chord chart for the band. */
  shows: z.enum(SCREEN_CONTENT_SHOWS).default("lyrics"),
  /** How much the background answers effects (issue #281). */
  reacts: screenReactsSchema(strict).prefault({}),
  /** The template's effects (issue #281); null: none, or turned off on the screen. */
  effects: screenEffectsSchema(strict).nullable().default(null),
  });
}

/** A theme as it's kept and read: every part has its default, so `{}` is the default look; a field it doesn't know is ignored. */
export const ScreenThemeSchema = screenThemeSchema(false);
/** A theme as the API takes it (PUT/POST /screen-themes): an unknown field is refused, by name. */
export const ScreenThemeRequestSchema = screenThemeSchema(true);

export type ScreenTheme = z.output<typeof ScreenThemeSchema>;
export type ScreenThemeInput = z.input<typeof ScreenThemeSchema>;

/** The look a screen has without a theme: white words on black, as before themes. */
export const DEFAULT_SCREEN_THEME: ScreenTheme = ScreenThemeSchema.parse({});

/**
 * A theme as a client reads it: what it says over the defaults; a part it
 * can't read falls back to that part's default, and anything else - not a
 * theme at all - to the default look. Never throws.
 */
export function resolveScreenTheme(input: unknown): ScreenTheme {
  if (!input || typeof input !== "object") return DEFAULT_SCREEN_THEME;
  const whole = ScreenThemeSchema.safeParse(input);
  if (whole.success) return whole.data;
  // Part by part: a bad colour in the background keeps the rest of the theme.
  const parts = input as Record<string, unknown>;
  const theme: Record<string, unknown> = {};
  for (const key of Object.keys(ScreenThemeSchema.shape)) {
    if (key === "$schema" || parts[key] === undefined) continue;
    if (key === "grid") {
      theme.grid = resolveGrid(parts.grid);
      continue;
    }
    if (key === "effects") {
      theme.effects = parts.effects === null ? null : resolveEffects(parts.effects);
      continue;
    }
    // A mask it can't read is left out, the others stay.
    if (key === "masks") {
      theme.masks = Array.isArray(parts.masks) ? parts.masks.flatMap((one) => {
        const mask = ScreenMaskSchema.safeParse(one);
        return mask.success ? [mask.data] : [];
      }).slice(0, SCREEN_MASKS_MAX) : [];
      continue;
    }
    const one = ScreenThemeSchema.shape[key as keyof typeof ScreenThemeSchema.shape].safeParse(parts[key]);
    if (one.success) theme[key] = one.data;
  }
  return ScreenThemeSchema.parse(theme);
}

/** Effects as a client reads them (issue #281): a reaction it can't read (a trigger from a later version) is left out, the others stay. Never throws. */
export function resolveEffects(input: unknown): z.output<ReturnType<typeof screenEffectsSchema>> {
  const schema = screenEffectsSchema(false);
  const whole = schema.safeParse(input && typeof input === "object" ? input : {});
  if (whole.success) return whole.data;
  const raw = input as Record<string, unknown>;
  const reaction = schema.shape.reactions.unwrap().element;
  const reactions = Array.isArray(raw.reactions)
    ? raw.reactions.flatMap((one) => {
        const read = reaction.safeParse(one);
        return read.success ? [read.data] : [];
      })
    : [];
  const text = schema.shape.text.safeParse(raw.text);
  return schema.parse({ reactions: reactions.slice(0, SCREEN_REACTIONS_MAX), ...(text.success ? { text: text.data } : {}) });
}

/** A grid as a client reads it: a widget it can't read (a kind from a newer client) leaves its cells empty, the rest stay. */
export function resolveGrid(input: unknown): ScreenTheme["grid"] {
  if (!input || typeof input !== "object") return null;
  const { widgets, ...rest } = input as Record<string, unknown>;
  const grid = screenGridSchema(false).safeParse({ ...rest, widgets: [] });
  if (!grid.success) return null;
  const read = Array.isArray(widgets) ? widgets.flatMap((one) => {
    const widget = ScreenWidgetSchema.safeParse(one);
    return widget.success ? [widget.data] : [];
  }) : [];
  return { ...grid.data, widgets: read.slice(0, 32) };
}

/** The widgets that show the song (issue #280): on the content layer unless they say otherwise; the others are overlays. */
const CONTENT_WIDGETS: ScreenWidgetKind[] = ["stage", "current-slide", "next-slide", "current-section", "next-section", "song-structure", "song", "next-song", "current-item", "next-item"];

/** The layer a widget is on (issue #280): its own, else its kind's. */
export function screenWidgetLayer(widget: Pick<ScreenWidget, "kind"> & { layer?: ScreenWidget["layer"] }): "content" | "overlays" {
  return widget.layer ?? (CONTENT_WIDGETS.includes(widget.kind) ? "content" : "overlays");
}

/** A theme's base colour (issue #280): its own, else its background's first. */
export function screenBaseColor(theme: Pick<ScreenTheme, "base" | "background">): string {
  return theme.base.color ?? theme.background.colors[0] ?? "#000000";
}

/** A widget's cells kept inside its grid: what a client draws, whatever the template says. */
export function placeScreenWidget(widget: Pick<ScreenWidget, "x" | "y" | "w" | "h">, grid: Pick<NonNullable<ScreenTheme["grid"]>, "columns" | "rows">) {
  const x = Math.min(widget.x, grid.columns - 1);
  const y = Math.min(widget.y, grid.rows - 1);
  return { x, y, w: Math.max(1, Math.min(widget.w, grid.columns - x)), h: Math.max(1, Math.min(widget.h, grid.rows - y)) };
}

/** A widget of a kind, where it's put, with its defaults. */
export function newScreenWidget(kind: ScreenWidgetKind, place: { x: number; y: number; w: number; h: number }, id: string, input: Omit<ScreenWidgetInput, "id" | "kind" | "x" | "y" | "w" | "h"> = {}): ScreenWidget {
  return ScreenWidgetSchema.parse({ ...input, id, kind, ...place });
}

/** Ready-made grids to start a layout from (issue #268): their names are in the locale files (`screens.editor.layouts.<id>`). */
export const SCREEN_LAYOUT_PRESETS: { id: string; grid: ScreenTheme["grid"] }[] = [
  { id: "words", grid: null },
  {
    id: "words-clock",
    grid: screenGridSchema(false).parse({
      widgets: [
        { id: "stage", kind: "stage", x: 0, y: 0, w: 12, h: 12 },
        { id: "clock", kind: "clock", x: 9, y: 0, w: 3, h: 1, style: { opacity: 0.4, radius: 1 } },
      ],
    }),
  },
  {
    id: "stage-display",
    grid: screenGridSchema(false).parse({
      black: "words",
      widgets: [
        { id: "current", kind: "current-slide", x: 0, y: 0, w: 8, h: 7 },
        { id: "next", kind: "next-slide", x: 0, y: 7, w: 8, h: 3, style: { color: "#a3a3a3" } },
        { id: "clock", kind: "clock", x: 8, y: 0, w: 4, h: 2, options: { seconds: true } },
        { id: "countdown", kind: "countdown", x: 8, y: 2, w: 4, h: 4, style: { opacity: 0.5, background: "#1f2937" } },
        { id: "song", kind: "song", x: 8, y: 6, w: 4, h: 2 },
        { id: "next-song", kind: "next-song", x: 8, y: 8, w: 4, h: 2, style: { color: "#a3a3a3" } },
        { id: "message", kind: "message", x: 0, y: 10, w: 12, h: 2, style: { background: "#b91c1c", opacity: 0.9, color: "#ffffff" } },
      ],
    }),
  },
];

/** A built-in look to start from, picked as it is or copied and changed. */
export interface ScreenThemeTemplate {
  id: string;
  /** Its name and what it's for, as the app's locale files word them: `screens.templates.<id>`. */
  theme: ScreenTheme;
}

const template = (id: string, theme: ScreenThemeInput): ScreenThemeTemplate => ({ id, theme: ScreenThemeSchema.parse(theme) });

/**
 * The built-in themes: the default ("classic"), and looks for a room, a
 * concert, a stream, a stage monitor. Their names and descriptions are in
 * the locale files (`screens.templates.<id>`).
 */
export const SCREEN_THEME_TEMPLATES: ScreenThemeTemplate[] = [
  template("classic", {}),
  template("concert", {
    text: { font: "geometric", weight: 800, upperCase: true, effect: "glow", letterSpacing: 0.02 },
    lines: { before: 0, after: 1, contextStyle: "blur" },
    background: { kind: "aurora", colors: ["#05010f", "#6d28d9", "#db2777", "#0ea5e9"], reactive: true, motion: 0.7, dim: 0.15 },
    motion: { transition: "blur", duration: 500, reveal: "words", stagger: 70 },
  }),
  template("chapel", {
    text: { font: "elegant", weight: 500, effect: "shadow", lineHeight: 1.3 },
    lines: { before: 0, after: 0, contextStyle: "hidden" },
    background: { kind: "gradient", colors: ["#1c1206", "#3b2a14", "#0d0905"], motion: 0.2 },
    title: { when: "first" },
    motion: { transition: "fade", duration: 700, reveal: "lines", stagger: 180 },
  }),
  template("sunrise", {
    text: { font: "rounded", weight: 700, effect: "shadow" },
    lines: { before: 1, after: 1, contextStyle: "small" },
    background: { kind: "waves", colors: ["#1e1b4b", "#f97316", "#facc15", "#ec4899"], reactive: true, motion: 0.5, dim: 0.25 },
    motion: { transition: "rise", duration: 450, reveal: "words", stagger: 50 },
  }),
  template("starlight", {
    text: { font: "serif", weight: 600, effect: "glow", lineHeight: 1.25 },
    lines: { before: 1, after: 1, contextStyle: "blur" },
    background: { kind: "particles", colors: ["#020617", "#1e3a8a", "#e0f2fe"], reactive: true, motion: 0.4 },
    motion: { transition: "zoom", duration: 600, reveal: "glow", stagger: 90 },
  }),
  template("spotlight", {
    text: { font: "display", weight: 400, upperCase: true, effect: "none", letterSpacing: 0.04, lineHeight: 1.05 },
    lines: { before: 0, after: 0 },
    background: { kind: "spotlight", colors: ["#000000", "#fef3c7"], reactive: true, motion: 0.6 },
    motion: { transition: "scale", duration: 400, reveal: "letters", stagger: 25 },
  }),
  template("stream", {
    text: { font: "sans", weight: 700, effect: "outline", size: 5.5 },
    lines: { before: 0, after: 0 },
    layout: { position: "lower-third", margin: 4 },
    background: { kind: "color", colors: ["#000000"] },
    title: { show: false },
    credits: { where: "top", when: "first" },
    motion: { transition: "slide", duration: 300, reveal: "none" },
  }),
  template("minimal", {
    text: { font: "sans", weight: 500, align: "left", effect: "none", lineHeight: 1.25 },
    lines: { before: 1, after: 2, contextStyle: "dim" },
    layout: { position: "center", margin: 8 },
    background: { kind: "color", colors: ["#0a0a0a"] },
    motion: { transition: "fade", duration: 250, reveal: "typewriter", stagger: 18 },
  }),
  template("stage-display", {
    text: { font: "condensed", weight: 700, effect: "none", lineHeight: 1.05 },
    lines: { before: 0, after: 0 },
    layout: { margin: 2 },
    background: { kind: "color", colors: ["#000000"] },
    title: { show: false },
    credits: { show: false },
    motion: { transition: "cut", duration: 0, reveal: "none" },
    grid: SCREEN_LAYOUT_PRESETS.find((one) => one.id === "stage-display")!.grid,
  }),
  template("stage-monitor", {
    text: { font: "condensed", weight: 700, upperCase: true, effect: "none", size: 9, lineHeight: 1.05 },
    lines: { group: "section", before: 0, after: 0, contextStyle: "dim" },
    layout: { position: "top", margin: 3 },
    background: { kind: "color", colors: ["#000000"] },
    title: { when: "every" },
    credits: { show: false },
    motion: { transition: "cut", duration: 0, reveal: "none" },
    chords: { color: "#facc15", scale: 1.2 },
  }),
];

export function screenThemeTemplate(id: string | null | undefined): ScreenThemeTemplate | undefined {
  return SCREEN_THEME_TEMPLATES.find((one) => one.id === id);
}

/** A colour's relative luminance (WCAG 2), for contrast. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** The contrast between two colours (WCAG 2): 1 to 21; 4.5 is enough for text, 3 for large text. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((light! + 0.05) / (dark! + 0.05)) * 100) / 100;
}

/**
 * The lowest contrast between a theme's words and what's under them (the
 * background's colours, darkened by `dim`; a picture or video counts as
 * mid-grey, as it could be anything): an editor warns under 4.5. An
 * outline, shadow or glow helps words over a moving background, so they
 * count as half again.
 */
export function screenThemeContrast(theme: ScreenTheme): number {
  const { kind, colors, dim } = theme.background;
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const hex = (channels: number[]) => `#${channels.map((one) => Math.round(Math.max(0, Math.min(255, one))).toString(16).padStart(2, "0")).join("")}`;
  const base = rgb(colors[0]!);
  // A gradient's colours are all under the words; a moving background's others are soft lights over its base (at most 45% of them).
  const under =
    kind === "image" || kind === "video"
      ? // A picture or a video could be anything: mid-grey under the words, unless it's darkened.
        [base, [128, 128, 128]]
      : kind === "color"
      ? [base]
      : kind === "gradient"
        ? colors.map(rgb)
        : [base, ...colors.slice(1).map((one) => rgb(one).map((channel, i) => base[i]! + (channel - base[i]!) * 0.45))];
  const lowest = Math.min(...under.map((channels) => contrastRatio(theme.text.color, hex(channels.map((channel) => channel * (1 - dim))))));
  return theme.text.effect === "none" ? lowest : Math.round(Math.min(21, lowest * 1.5) * 100) / 100;
}

/** What kind of part a pass is, for a background that warms up in a chorus: from its label. */
export function sectionEnergy(label: string | null | undefined): "low" | "mid" | "high" {
  const text = (label ?? "").toLowerCase();
  // A build-up first: a pre-chorus isn't the chorus yet.
  if (/bridge|pont|pre-?chorus|pré-?refrain|build|montée/.test(text)) return "mid";
  if (/chorus|refrain|refrão|estribillo|coro|tag|climax/.test(text)) return "high";
  return "low";
}
