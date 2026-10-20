import "../zod-config.js";
import { z } from "zod";
import { SCREEN_FONTS } from "../screens/theme.js";

/**
 * Brand kits (issue #279): an organisation's or a team's logos, colours,
 * fonts, backgrounds and links, for templates and widgets to use. What a
 * brand holds is described here once: the API checks it, clients read it
 * with readBrand.
 */

/** A brand's logo slots (one file each) and its other files (several). Their names are in the locale files (`brands.assetKinds.<kind>`). */
export const BRAND_LOGO_KINDS = ["logo", "logo-light", "logo-dark", "logomark", "logo-animated", "logo-animated-light", "logo-animated-dark", "logomark-animated"] as const;
export const BRAND_ASSET_KINDS = [...BRAND_LOGO_KINDS, "background", "font"] as const;
export type BrandLogoKind = (typeof BRAND_LOGO_KINDS)[number];
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];
/** Animated logos: a video (with its transparency, WebM) or an animated picture (GIF, WebP, APNG). */
export const isAnimatedLogoKind = (kind: BrandAssetKind) => kind.includes("animated");

/** Where its fonts are used: headings, text, and the lyrics on screens. */
export const BRAND_FONT_ROLES = ["heading", "body", "lyrics"] as const;
export type BrandFontRole = (typeof BRAND_FONT_ROLES)[number];

/** The social networks a brand can link to; "other" for any other address. */
export const BRAND_SOCIAL_NETWORKS = ["instagram", "facebook", "youtube", "tiktok", "x", "threads", "linkedin", "spotify", "other"] as const;
export type BrandSocialNetwork = (typeof BRAND_SOCIAL_NETWORKS)[number];

/** A brand's colours' suggested names (`brands.colorNames.<name>`), the first ones a new brand gets. */
export const BRAND_STARTER_COLORS = [
  { id: "primary", name: "Primary", light: "#4f46e5", dark: "#818cf8" },
  { id: "secondary", name: "Secondary", light: "#0f766e", dark: "#5eead4" },
  { id: "accent", name: "Accent", light: "#d97706", dark: "#fbbf24" },
  { id: "background", name: "Background", light: "#ffffff", dark: "#0b0b0f" },
  { id: "text", name: "Text", light: "#111827", dark: "#f3f4f6" },
] as const;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a colour is written #rrggbb");
const address = (field: string) => z.string().trim().max(500).regex(/^https?:\/\/\S+$/i, `${field} must be an address starting with https://`);

export const BrandColorSchema = z.strictObject({
  /** Kept when it's renamed: templates refer to a colour by it. */
  id: z.string().regex(/^[a-z0-9-]{1,40}$/, "a colour's id is lower-case letters, digits and dashes"),
  name: z.string().trim().min(1, "a colour's name must not be empty").max(40),
  /** On a light background, and on a dark one. */
  light: color,
  dark: color,
});
export type BrandColor = z.infer<typeof BrandColorSchema>;

/** A font: one of the built-in ones, or one of the brand's uploaded fonts by its file's id. */
export const BrandFontSchema = z.union([z.strictObject({ family: z.enum(SCREEN_FONTS) }), z.strictObject({ assetId: z.string().min(1).max(40) })]);
export type BrandFont = z.infer<typeof BrandFontSchema>;

export const BrandFontsSchema = z.strictObject({
  heading: BrandFontSchema.nullable().optional(),
  body: BrandFontSchema.nullable().optional(),
  lyrics: BrandFontSchema.nullable().optional(),
});
export type BrandFonts = Partial<Record<BrandFontRole, BrandFont | null>>;

export const BrandSocialSchema = z.strictObject({ network: z.enum(BRAND_SOCIAL_NETWORKS), url: address("a social profile") });
export type BrandSocial = z.infer<typeof BrandSocialSchema>;

export const BrandWhatsAppGroupSchema = z.strictObject({
  name: z.string().trim().min(1, "a WhatsApp group's name must not be empty").max(80),
  url: address("a WhatsApp group's link"),
  purpose: z.string().trim().max(200).default(""),
});
export type BrandWhatsAppGroup = z.infer<typeof BrandWhatsAppGroupSchema>;

/** What a brand holds besides its name and files, as stored. */
export interface BrandContent {
  colors: BrandColor[];
  fonts: BrandFonts;
  website: string | null;
  socials: BrandSocial[];
  whatsapp: BrandWhatsAppGroup[];
}

/**
 * A stored brand's colours, fonts and links, read safely (issue #279): an
 * entry that can't be read is left out, the rest kept - a field written by a
 * later version doesn't break an older client.
 */
export function readBrand(stored: { colors?: unknown; fonts?: unknown; website?: unknown; socials?: unknown; whatsapp?: unknown }): BrandContent {
  const list = <T>(value: unknown, schema: z.ZodType<T>, most: number): T[] =>
    (Array.isArray(value) ? value : []).flatMap((one) => {
      const read = schema.safeParse(one);
      return read.success ? [read.data] : [];
    }).slice(0, most);
  const fonts: BrandFonts = {};
  const storedFonts = stored.fonts && typeof stored.fonts === "object" ? (stored.fonts as Record<string, unknown>) : {};
  for (const role of BRAND_FONT_ROLES) {
    const read = BrandFontSchema.safeParse(storedFonts[role]);
    if (read.success) fonts[role] = read.data;
  }
  const website = typeof stored.website === "string" && /^https?:\/\/\S+$/i.test(stored.website) ? stored.website : null;
  return {
    colors: list(stored.colors, BrandColorSchema, BRAND_LIMITS.colors),
    fonts,
    website,
    socials: list(stored.socials, BrandSocialSchema, BRAND_LIMITS.socials),
    whatsapp: list(stored.whatsapp, BrandWhatsAppGroupSchema, BRAND_LIMITS.whatsapp),
  };
}

/** How many of each a brand holds. */
export const BRAND_LIMITS = { colors: 24, socials: 12, whatsapp: 12, backgrounds: 40, fonts: 12 } as const;

/** A brand's colour by its id, for the light or the dark side; null when it has none by that id. */
export function brandColor(colors: BrandColor[], id: string, side: "light" | "dark" = "dark"): string | null {
  return colors.find((one) => one.id === id)?.[side] ?? null;
}

/** A new colour's id: from its name, made unique among the brand's. */
export function brandColorId(name: string, taken: string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "color";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}
