import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { Pairing } from "../pairing.js";

function cloud(answers: Response[]) {
  const asked: { url: string; body: unknown }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    asked.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return answers.shift()!;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, asked };
}
const code = (n: number) => Response.json({ pairingId: `p${n}`, code: `CODE${n}0`, secret: "s".repeat(32), expiresAt: "2026-10-23T02:00:00Z" }, { status: 201 });
const wait = async () => undefined;

describe("Pairing", () => {
  it("asks for a code as a Pulse, shows it until it's confirmed, then keeps its token for after a restart", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "pulse-"));
    const { fetch, asked } = cloud([code(1), Response.json({ pending: true }, { status: 202 }), Response.json({ token: "scr_abc", screen: { name: "Stage Pulse", kind: "PULSE" } }, { status: 201 })]);
    const pairing = new Pairing({ apiUrl: "https://api.example.test", dataDir, fetch, wait });
    expect(await pairing.current()).toBeNull();
    expect(await pairing.pair()).toBe("scr_abc");
    expect(asked[0]).toEqual({ url: "https://api.example.test/screens/pairings", body: { kind: "PULSE" } });
    expect(asked.slice(1).map((one) => one.url)).toEqual(["https://api.example.test/screens/pairings/p1/claim", "https://api.example.test/screens/pairings/p1/claim"]);
    expect(pairing.code).toBeNull();
    expect(await readFile(path.join(dataDir, "token"), "utf8")).toBe("scr_abc");
    expect((await stat(path.join(dataDir, "token"))).mode & 0o777).toBe(0o600);
    expect(await new Pairing({ apiUrl: "https://api.example.test", dataDir }).current()).toBe("scr_abc");
  });

  it("a code that expires: a new one", async () => {
    const { fetch, asked } = cloud([code(1), new Response("", { status: 410 }), code(2), Response.json({ token: "scr_def", screen: { name: "P", kind: "PULSE" } }, { status: 201 })]);
    const pairing = new Pairing({ apiUrl: "https://api.example.test", fetch, wait });
    expect(await pairing.pair()).toBe("scr_def");
    expect(asked.filter((one) => one.url.endsWith("/pairings")).length).toBe(2);
  });

  it("a token given in its environment: no pairing", async () => {
    const { fetch, asked } = cloud([]);
    const pairing = new Pairing({ apiUrl: "https://api.example.test", given: "scr_given", fetch, wait });
    expect(await pairing.pair()).toBe("scr_given");
    expect(asked).toEqual([]);
  });
});
