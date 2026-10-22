import { z } from "zod";

/**
 * A pass to a set's live session on Oneverse Pulse (issue #247, brice
 * 2026-10-22): while the cloud's there, it signs one for each person in the
 * set, on their device, with what they may do in it, for a few hours. The
 * link to Pulse's own page carries it, and Pulse checks it with the cloud's
 * public key, without the internet: the same rights in the room as in the
 * cloud, nothing to sign in to again. `<payload>.<signature>`, both
 * base64url; the signature is Ed25519's over the payload's bytes.
 */
export const LivePassPayloadSchema = z.object({
  v: z.literal(1),
  /** Who. */
  sub: z.string().max(64),
  name: z.string().max(200),
  setId: z.string().max(64),
  /** Their device, as the session holds it (`d:<userId>:<deviceId>`). */
  device: z.string().max(200),
  /** Can edit the set: leads it, runs its screens. */
  canLead: z.boolean(),
  /** Runs screens by a role. */
  canOperate: z.boolean(),
  /** Issued and expires at (ms, the cloud's clock). */
  iat: z.number(),
  exp: z.number(),
});
export type LivePassPayload = z.infer<typeof LivePassPayloadSchema>;

/** How long a pass lasts: a service and its rehearsal, with room. Devices ask for a new one well before. */
export const LIVE_PASS_MS = 12 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The bytes a pass's signature is over: its payload part, as sent. */
export function livePassPayloadPart(payload: LivePassPayload): string {
  return base64url(encoder.encode(JSON.stringify(payload)));
}

/**
 * What a pass lets its holder do, checked against the cloud's public key
 * (`key`: Ed25519, raw, base64url) at `now`, for `setId`; null when it's
 * not one the cloud signed, has expired, or is for another set.
 */
export async function verifyLivePass(pass: string, key: string, setId: string, now: number): Promise<LivePassPayload | null> {
  const [payloadPart, signaturePart, extra] = pass.split(".");
  if (!payloadPart || !signaturePart || extra !== undefined || pass.length > 4096) return null;
  const raw = fromBase64url(key);
  const signature = fromBase64url(signaturePart);
  const bytes = fromBase64url(payloadPart);
  if (!raw || !signature || !bytes) return null;
  try {
    const publicKey = await globalThis.crypto.subtle.importKey("raw", raw as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    if (!(await globalThis.crypto.subtle.verify({ name: "Ed25519" }, publicKey, signature as BufferSource, encoder.encode(payloadPart)))) return null;
    const parsed = LivePassPayloadSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    if (!parsed.success || parsed.data.setId !== setId || parsed.data.exp <= now) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
