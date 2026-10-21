import { composeScreenTheme, readScreenTemplate, SCREEN_TEMPLATE_SCHEMA, screenBuiltInPart, splitScreenTheme, type ScreenPartKind, type ScreenTheme } from "@oneverse/core";
import { presentScreenThemeAssets } from "./screen-theme-assets.js";

export const ASSET_SELECT = { id: true, kind: true, storageKey: true, mimeType: true, filename: true } as const;
const PART_SELECT = { id: true, name: true, document: true, assets: { select: ASSET_SELECT, orderBy: { createdAt: "asc" } } } as const;

/** What a template is made of (issue #281): its layout, its parts (saved or built-in), and the files of a template made before parts. */
export const TEMPLATE_PARTS_SELECT = {
  document: true,
  contentBuiltIn: true,
  backgroundBuiltIn: true,
  effectsBuiltIn: true,
  contentPart: { select: PART_SELECT },
  backgroundPart: { select: PART_SELECT },
  effectsPart: { select: PART_SELECT },
  assets: { select: ASSET_SELECT, orderBy: { createdAt: "asc" } },
} as const;

type Asset = { id: string; kind: string; storageKey: string; mimeType: string; filename: string };
type Part = { id: string; name: string; document: unknown; assets: Asset[] } | null;
export interface TemplateParts {
  document: unknown;
  contentBuiltIn: string | null;
  backgroundBuiltIn: string | null;
  effectsBuiltIn: string | null;
  contentPart: Part;
  backgroundPart: Part;
  effectsPart: Part;
  assets: Asset[];
}

/** A template made before parts (issue #281): a whole screen-theme/v1 document, no parts. */
export function isWholeTheme(document: unknown): boolean {
  return !document || typeof document !== "object" || (document as { $schema?: unknown }).$schema !== SCREEN_TEMPLATE_SCHEMA;
}

/** A part as a template refers to it: its saved one, else its built-in one (a saved one deleted: the built-in classic, and no effects). */
function partOf(kind: ScreenPartKind, saved: Part, builtIn: string | null): unknown {
  if (saved) return saved.document;
  if (kind === "effects") return builtIn ? (screenBuiltInPart("effects", builtIn) ?? null) : null;
  return kind === "content" ? (screenBuiltInPart("content", builtIn) ?? screenBuiltInPart("content", "classic")) : (screenBuiltInPart("background", builtIn) ?? screenBuiltInPart("background", "classic"));
}

/** What a screen using a template draws (issue #281), effects on or off, and the files its parts refer to. */
export function templateLook(row: TemplateParts, options: { effects?: boolean } = {}): { theme: ScreenTheme; assets: ReturnType<typeof presentScreenThemeAssets> } {
  if (isWholeTheme(row.document)) return { theme: composeScreenTheme(splitScreenTheme(row.document), options), assets: presentScreenThemeAssets(row.assets) };
  const theme = composeScreenTheme(
    {
      content: partOf("content", row.contentPart, row.contentBuiltIn),
      background: partOf("background", row.backgroundPart, row.backgroundBuiltIn),
      effects: partOf("effects", row.effectsPart, row.effectsBuiltIn),
      template: row.document,
    },
    options,
  );
  return { theme, assets: presentScreenThemeAssets([...(row.contentPart?.assets ?? []), ...(row.backgroundPart?.assets ?? []), ...row.assets]) };
}

/** A template's parts as clients see them: built-in by id, or saved with its name. */
export function templateParts(row: TemplateParts) {
  const ref = (saved: Part, builtIn: string | null, fallback: string | null) => (saved ? { id: saved.id, name: saved.name } : builtIn ? { builtIn } : fallback ? { builtIn: fallback } : null);
  if (isWholeTheme(row.document)) return { content: { builtIn: "classic" }, background: { builtIn: "classic" }, effects: null };
  return {
    content: ref(row.contentPart, row.contentBuiltIn, "classic")!,
    background: ref(row.backgroundPart, row.backgroundBuiltIn, "classic")!,
    effects: ref(row.effectsPart, row.effectsBuiltIn, null),
  };
}

/** A template's own document: its tags and layout (one made before parts: its grid and masks, no tags). */
export function templateLayout(row: Pick<TemplateParts, "document">) {
  return isWholeTheme(row.document) ? splitScreenTheme(row.document).template : readScreenTemplate(row.document);
}
