import { ISF_MAX_SOURCE, type ScreenThemeAssetKind } from "@oneverse/core";
import { isValidAddress, signAddress } from "../common/utils/signed-address.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The end of the next day (UTC): the same address all day, so a screen keeps its background cached. */
const expiry = (now: number) => (Math.floor(now / DAY_MS) + 2) * DAY_MS;
const apiOrigin = () => new URL(process.env.AUTH_URL ?? "http://localhost:3001").origin;

/** The largest of each kind a theme takes. */
export const SCREEN_THEME_ASSET_LIMITS = { image: 15 * 1024 * 1024, video: 150 * 1024 * 1024, font: 5 * 1024 * 1024, shader: ISF_MAX_SOURCE } as const;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const SHADER_EXTENSIONS = new Set(["fs", "frag", "glsl", "isf"]);
const FONT_TYPES: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };

/**
 * What an upload is, for a theme (issue #194): a background picture or video
 * by its type, a font or an ISF shader (issue #297, kept as plain text) by
 * its name's extension (browsers name these inconsistently); null when it's
 * none of them. Never trusted to be shown
 * as anything but these types (send-file.ts).
 */
export function screenThemeAssetType(kind: ScreenThemeAssetKind, mimeType: string, filename: string): { mimeType: string; limit: number } | null {
  const type = mimeType.split(";")[0]!.trim().toLowerCase();
  if (kind === "media") {
    if (IMAGE_TYPES.has(type)) return { mimeType: type, limit: SCREEN_THEME_ASSET_LIMITS.image };
    if (VIDEO_TYPES.has(type)) return { mimeType: type, limit: SCREEN_THEME_ASSET_LIMITS.video };
    return null;
  }
  if (kind === "shader") return SHADER_EXTENSIONS.has(filename.split(".").pop()?.toLowerCase() ?? "") ? { mimeType: "text/plain", limit: SCREEN_THEME_ASSET_LIMITS.shader } : null;
  const font = FONT_TYPES[filename.split(".").pop()?.toLowerCase() ?? ""];
  return font ? { mimeType: font, limit: SCREEN_THEME_ASSET_LIMITS.font } : null;
}

/** A theme file's address: signed and expiring, handed out with the theme to whoever may see it (and to its screens). */
export function screenThemeAssetUrl(assetId: string, storageKey: string, now = Date.now()): string {
  const expires = expiry(now);
  const query = new URLSearchParams({ expires: String(expires), signature: signAddress("screen-theme-assets", `${assetId}.${storageKey}`, expires) });
  return `${apiOrigin()}/screen-themes/assets/${encodeURIComponent(assetId)}?${query}`;
}

export function isValidScreenThemeAssetSignature(assetId: string, storageKey: string, expires: string | undefined, given: string | undefined, now = Date.now()): boolean {
  return isValidAddress("screen-theme-assets", `${assetId}.${storageKey}`, expires, given, now);
}

/** A theme's files as clients get them: by id, with their address. */
export function presentScreenThemeAssets(assets: { id: string; kind: string; storageKey: string; mimeType: string; filename: string }[]) {
  return assets.map((asset) => ({ id: asset.id, kind: asset.kind as ScreenThemeAssetKind, mimeType: asset.mimeType, filename: asset.filename, url: screenThemeAssetUrl(asset.id, asset.storageKey) }));
}
