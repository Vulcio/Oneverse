import { describe, expect, it } from "vite-plus/test";
import { LIVE_PASS_MS, livePassPayloadPart, verifyLivePass, type LivePassPayload } from "../live/pass.js";

const PAYLOAD: LivePassPayload = { v: 1, sub: "u_ana", name: "Ana", setId: "set_1", device: "d:u_ana:tab", canLead: true, canOperate: false, iat: 1_000, exp: 1_000 + LIVE_PASS_MS };
const b64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64url");

async function cloud() {
  const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const key = b64(await crypto.subtle.exportKey("raw", keys.publicKey));
  const sign = async (payload: LivePassPayload) => {
    const part = livePassPayloadPart(payload);
    return `${part}.${b64(await crypto.subtle.sign({ name: "Ed25519" }, keys.privateKey, new TextEncoder().encode(part)))}`;
  };
  return { key, sign };
}

describe("verifyLivePass", () => {
  it("a pass the cloud signed: who, on which device, and what they may do", async () => {
    const { key, sign } = await cloud();
    expect(await verifyLivePass(await sign(PAYLOAD), key, "set_1", 2_000)).toEqual(PAYLOAD);
  });

  it("not one that's expired, for another set, changed, or signed by someone else", async () => {
    const { key, sign } = await cloud();
    const pass = await sign(PAYLOAD);
    expect(await verifyLivePass(pass, key, "set_1", PAYLOAD.exp)).toBeNull();
    expect(await verifyLivePass(pass, key, "set_2", 2_000)).toBeNull();
    const [, signature] = pass.split(".");
    const promoted = `${livePassPayloadPart({ ...PAYLOAD, canOperate: true })}.${signature}`;
    expect(await verifyLivePass(promoted, key, "set_1", 2_000)).toBeNull();
    const other = await cloud();
    expect(await verifyLivePass(await other.sign(PAYLOAD), key, "set_1", 2_000)).toBeNull();
    expect(await verifyLivePass("not a pass", key, "set_1", 2_000)).toBeNull();
    expect(await verifyLivePass(`${pass}.more`, key, "set_1", 2_000)).toBeNull();
  });
});
