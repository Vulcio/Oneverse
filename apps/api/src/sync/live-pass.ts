import { LIVE_PASS_MS, livePassPayloadPart, type LivePassPayload } from "@oneverse/core";
import { createPrivateKey, createPublicKey, hkdfSync, sign, type KeyObject } from "node:crypto";
import { isIP } from "node:net";
import { isPublicAddress } from "../security/outside-address.js";

/**
 * The cloud's key for passes to Oneverse Pulse (issue #247, core's
 * live/pass.ts): an Ed25519 key derived from BETTER_AUTH_SECRET, so it
 * needs no setting of its own and is the same on every API instance. Pulse
 * is sent its public half with each pass it asks for, and checks passes with
 * it offline. A new BETTER_AUTH_SECRET makes a new key: passes signed with
 * the old one stop working once Pulse has heard the new one.
 */
let keys: { privateKey: KeyObject; publicKey: string; secret: string } | null = null;

// An Ed25519 private key's PKCS #8 wrapping, before its 32-byte seed.
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

function liveKeys() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  if (keys?.secret === secret) return keys;
  const seed = Buffer.from(hkdfSync("sha256", secret, "oneverse", "live-pass-ed25519", 32));
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: "der", type: "pkcs8" });
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  keys = { privateKey, publicKey: spki.subarray(spki.length - 32).toString("base64url"), secret };
  return keys;
}

/** The public key passes are checked with (Ed25519, raw, base64url). */
export function livePassKey(): string {
  return liveKeys().publicKey;
}

/** A pass for `who` in the set, from now for LIVE_PASS_MS. */
export function issueLivePass(who: Omit<LivePassPayload, "v" | "iat" | "exp">, now = Date.now()): { pass: string; expiresAt: number } {
  const payload: LivePassPayload = { v: 1, ...who, iat: now, exp: now + LIVE_PASS_MS };
  const part = livePassPayloadPart(payload);
  return { pass: `${part}.${sign(null, Buffer.from(part), liveKeys().privateKey).toString("base64url")}`, expiresAt: payload.exp };
}

/**
 * Pulse's address on the venue's network (issue #247), as it says it when it
 * mirrors a set: the set's devices are sent there with their pass when the
 * cloud's gone, so it must be one on a local network - a private, loopback or
 * link-local IP, or a .local name - never an address on the internet a pass
 * could be sent off to. Its origin, or null when it isn't one.
 */
export function pulseRoomAddress(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 300) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const local = isIP(host) ? !isPublicAddress(host) : /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/i.test(host);
  return local ? url.origin : null;
}
