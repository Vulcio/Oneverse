import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { SetCopy } from "../set-copy.js";

const COPY = { set: { id: "set_1" }, songs: [{ item: { id: "item_1" } }], notes: { song_1: { notes: ["mine"] } }, version: "v1" };
const current = (set: unknown) => Response.json({ screen: { id: "scr_1" }, set });

function cloud(answers: (Response | Error)[]) {
  const asked: string[] = [];
  const fetch = (async (url: string) => {
    asked.push(url);
    const answer = answers.shift()!;
    if (answer instanceof Error) throw answer;
    return answer;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, asked };
}

describe("SetCopy", () => {
  it("keeps the set it's on as the screens show it, without anyone's notes, on disk for after a restart", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "pulse-"));
    const { fetch, asked } = cloud([current(COPY)]);
    const copy = new SetCopy({ apiUrl: "https://api.example.test/", token: async () => "token", dataDir, fetch });
    expect(await copy.refresh()).toBe(true);
    expect(asked).toEqual(["https://api.example.test/screens/current"]);
    expect(copy.of("set_1")).toEqual({ ...COPY, notes: {} });
    expect(copy.of("set_2")).toBeNull();
    const restarted = new SetCopy({ apiUrl: "https://api.example.test", token: async () => "token", dataDir });
    await restarted.load();
    expect(restarted.of("set_1")?.version).toBe("v1");
  });

  it("on another set: that one's copy; with none on it, the last one kept", async () => {
    const { fetch } = cloud([current(COPY), current({ ...COPY, set: { id: "set_2" }, version: "v1" }), current(null)]);
    const copy = new SetCopy({ apiUrl: "https://api.example.test", token: async () => "token", fetch });
    await copy.refresh();
    expect(await copy.refresh()).toBe(true);
    expect(copy.of("set_2")?.set.id).toBe("set_2");
    expect(await copy.refresh()).toBe(false);
    expect(copy.of("set_2")).not.toBeNull();
  });

  it("the cloud unreachable, or the same version: the copy kept as it was", async () => {
    const { fetch } = cloud([current(COPY), current(COPY), new Error("offline"), new Response("", { status: 503 })]);
    const copy = new SetCopy({ apiUrl: "https://api.example.test", token: async () => "token", fetch });
    await copy.refresh();
    expect(await copy.refresh()).toBe(false);
    expect(await copy.refresh()).toBe(false);
    expect(await copy.refresh()).toBe(false);
    expect(copy.current?.version).toBe("v1");
  });
});
