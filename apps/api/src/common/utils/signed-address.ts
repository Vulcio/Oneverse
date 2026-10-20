import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, expiring addresses (issue #112 brought them to one place): for
 * what can't send the Bearer token - an <audio src> (a file link, issue
 * #33), an <img src> (a song's or an artist's image, #85, #86), a screen
 * theme's picture, video or font, for a screen without a session (#194). The
 * signature covers what the address is for and when it stops working;
 * each use has its own key, derived from BETTER_AUTH_SECRET, so one kind
 * of address can't be passed off as another.
 */
export type SignedPurpose = "file-links" | "song-images" | "screen-theme-assets" | "brand-assets";

function key(purpose: SignedPurpose): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return createHash("sha256").update(`songverse-${purpose}:${secret}`).digest();
}

/** The signature for `subject` until `expires` (ms since the epoch). */
export function signAddress(purpose: SignedPurpose, subject: string, expires: number): string {
  return createHmac("sha256", key(purpose)).update(`${subject}.${expires}`).digest("base64url");
}

/** Whether `signature` is `subject`'s until `expires`, and that's not past. */
export function isValidAddress(purpose: SignedPurpose, subject: string, expires: string | undefined, signature: string | undefined, now = Date.now()): boolean {
  const at = Number(expires);
  if (!signature || !Number.isFinite(at) || at < now) return false;
  const expected = Buffer.from(signAddress(purpose, subject, at));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
