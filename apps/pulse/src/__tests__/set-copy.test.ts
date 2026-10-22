import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { SetCopy } from "../set-copy.js";

const COPY = { set: { id: "set_1" }, songs: [{ item: { id: "item_1" } }], notes: { song_1: { notes: ["mine"] } }, version: "v1" };

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
  it("keeps the set as the screens show it, without anyone's notes, on disk for after a restart", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "pulse-"));
    const { fetch, asked } = cloud([Response.json(COPY)]);
    const copy = new SetCopy({ apiUrl: "https://api.example.test/", setId: "set_1", token: async () => "token", dataDir, fetch });
    expect(await copy.refresh()).toBe(true);
    expect(asked).toEqual(["https://api.example.test/setlists/set_1/offline?for=screens"]);
    expect(copy.current).toEqual({ ...COPY, notes: {} });
    const restarted = new SetCopy({ apiUrl: "https://api.example.test", setId: "set_1", token: async () => "token", dataDir });
    await restarted.load();
    expect(restarted.current?.version).toBe("v1");
  });

  it("the cloud unreachable, or the same version: the copy kept as it was", async () => {
    const { fetch } = cloud([Response.json(COPY), Response.json(COPY), new Error("offline"), new Response("", { status: 503 })]);
    const copy = new SetCopy({ apiUrl: "https://api.example.test", setId: "set_1", token: async () => "token", fetch });
    await copy.refresh();
    expect(await copy.refresh()).toBe(false);
    expect(await copy.refresh()).toBe(false);
    expect(await copy.refresh()).toBe(false);
    expect(copy.current?.version).toBe("v1");
  });
});
