import type { BrandAssetKind } from "@oneverse/core";
import { isValidAddress, signAddress } from "../common/utils/signed-address.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The end of the next day (UTC): the same address all day, so a screen keeps a logo cached. */
const expiry = (now: number) => (Math.floor(now / DAY_MS) + 2) * DAY_MS;
const apiOrigin = () => new URL(process.env.AUTH_URL ?? "http://localhost:3001").origin;

/** The largest of each kind a brand takes. */
export const BRAND_ASSET_LIMITS = { image: 15 * 1024 * 1024, video: 150 * 1024 * 1024, font: 5 * 1024 * 1024 } as const;

const STILL_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const ANIMATED_PICTURE_TYPES = new Set(["image/gif", "image/webp", "image/png", "image/apng"]);
const BACKGROUND_PICTURE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const FONT_TYPES: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };
const extension = (filename: string) => filename.split(".").pop()?.toLowerCase() ?? "";

/** What a stored file has to go through before it's kept: an SVG cleaned, a Lottie animation checked (brand-files.ts). */
export type BrandFileCheck = "svg" | "lottie" | null;

/**
 * What an upload is, for a brand (issues #279, #295): a still logo (a
 * picture, or an SVG), an animated one (a video, an animated picture, an
 * animated SVG or a Lottie animation), a background (a picture or a video), a
 * font (by its name's extension); null when it's none of these. An SVG is
 * cleaned and a Lottie animation checked before they're kept (`check`).
 */
export function brandAssetType(kind: BrandAssetKind, mimeType: string, filename: string): { mimeType: string; limit: number; check: BrandFileCheck } | null {
  const type = mimeType.split(";")[0]!.trim().toLowerCase();
  if (kind === "font") {
    const font = FONT_TYPES[extension(filename)];
    return font ? { mimeType: font, limit: BRAND_ASSET_LIMITS.font, check: null } : null;
  }
  const animated = kind.includes("animated");
  if (kind !== "background" && (type === "image/svg+xml" || extension(filename) === "svg")) return { mimeType: "image/svg+xml", limit: BRAND_ASSET_LIMITS.image, check: "svg" };
  if (animated && (type === "application/json" || extension(filename) === "json")) return { mimeType: "application/json", limit: BRAND_ASSET_LIMITS.image, check: "lottie" };
  if (VIDEO_TYPES.has(type) && (kind === "background" || animated)) return { mimeType: type, limit: BRAND_ASSET_LIMITS.video, check: null };
  if (kind === "background") return BACKGROUND_PICTURE_TYPES.has(type) ? { mimeType: type, limit: BRAND_ASSET_LIMITS.image, check: null } : null;
  if (animated) return ANIMATED_PICTURE_TYPES.has(type) ? { mimeType: type, limit: BRAND_ASSET_LIMITS.image, check: null } : null;
  return STILL_TYPES.has(type) ? { mimeType: type, limit: BRAND_ASSET_LIMITS.image, check: null } : null;
}

/** A brand file's address: signed and expiring, handed out with the brand to whoever may use it (and later to screens). */
export function brandAssetUrl(assetId: string, storageKey: string, now = Date.now()): string {
  const expires = expiry(now);
  const query = new URLSearchParams({ expires: String(expires), signature: signAddress("brand-assets", `${assetId}.${storageKey}`, expires) });
  return `${apiOrigin()}/brands/assets/${encodeURIComponent(assetId)}?${query}`;
}

export function isValidBrandAssetSignature(assetId: string, storageKey: string, expires: string | undefined, given: string | undefined, now = Date.now()): boolean {
  return isValidAddress("brand-assets", `${assetId}.${storageKey}`, expires, given, now);
}

/** A brand's files as clients get them: by id, with their address. */
export function presentBrandAssets(assets: { id: string; kind: string; name: string | null; storageKey: string; mimeType: string; filename: string; sizeBytes: number }[]) {
  return assets.map((asset) => ({ id: asset.id, kind: asset.kind as BrandAssetKind, name: asset.name, mimeType: asset.mimeType, filename: asset.filename, sizeBytes: asset.sizeBytes, url: brandAssetUrl(asset.id, asset.storageKey) }));
}
