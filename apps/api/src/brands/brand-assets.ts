import type { BrandAssetKind } from "@songverse/core";
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

/**
 * What an upload is, for a brand (issue #279): a still logo (a picture), an
 * animated one (a video, or an animated picture), a background (a picture or
 * a video), a font (by its name's extension); null when it's none of these.
 * Never an SVG: it couldn't be shown (send-file.ts sends it as a download,
 * so it can't run script) and the server doesn't render vector input
 * (image.service.ts) - the web app turns one into a PNG before sending it.
 */
export function brandAssetType(kind: BrandAssetKind, mimeType: string, filename: string): { mimeType: string; limit: number } | null {
  const type = mimeType.split(";")[0]!.trim().toLowerCase();
  if (kind === "font") {
    const font = FONT_TYPES[filename.split(".").pop()?.toLowerCase() ?? ""];
    return font ? { mimeType: font, limit: BRAND_ASSET_LIMITS.font } : null;
  }
  if (VIDEO_TYPES.has(type) && (kind === "background" || kind.includes("animated"))) return { mimeType: type, limit: BRAND_ASSET_LIMITS.video };
  if (kind === "background") return BACKGROUND_PICTURE_TYPES.has(type) ? { mimeType: type, limit: BRAND_ASSET_LIMITS.image } : null;
  if (kind.includes("animated")) return ANIMATED_PICTURE_TYPES.has(type) ? { mimeType: type, limit: BRAND_ASSET_LIMITS.image } : null;
  return STILL_TYPES.has(type) ? { mimeType: type, limit: BRAND_ASSET_LIMITS.image } : null;
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
