import type { LiveSessionState } from "@oneverse/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CloudLink, type LinkSocket } from "../cloud-link.js";

const LIVE: LiveSessionState = {
  sessionId: "ses_1",
  epoch: 0,
  rev: 3,
  leader: { id: "u_ana", name: "Ana", device: "d:u_ana:tab" },
  metronome: null,
  stems: null,
  itemId: "item_1",
  presenting: { itemId: "item_1", slide: 1, black: false },
  presentingRev: 1,
  presenters: [],
  screens: null,
};

/** A socket the test answers for the cloud. */
class FakeSocket implements LinkSocket {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  say(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  types() {
    return this.sent.map((one) => one.type);
  }
}

describe("CloudLink", () => {
  let sockets: FakeSocket[];
  let link: CloudLink;
  const latest = () => sockets.at(-1)!;
  const PULSE = { id: "scr_1", name: "Stage Pulse", mode: "LYRICS", setId: "set_1", pulse: true };
  async function online(screen: Record<string, unknown> = PULSE) {
    latest().open();
    await Promise.resolve();
    latest().say({ type: "screen", screen });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    link = new CloudLink({
      apiUrl: "https://api.example.test",
      nodeId: "pulse-node1",
      roomUrl: "http://192.168.1.20:8788",
      token: async () => "token",
      outageMs: 10_000,
      open: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    link.start();
  });
  afterEach(() => {
    link.stop();
    vi.useRealTimers();
  });

  it("signs in by its own token, on the set the cloud put it on, and mirrors its session", async () => {
    await online();
    expect(link.setId).toBe("set_1");
    expect(latest().sent).toEqual([{ type: "screen", token: "token" }, { type: "mirror", room: "http://192.168.1.20:8788" }, { type: "pass" }]);
    latest().say({ type: "pass", setId: "set_1", pass: "x.y", key: "cloud-key", expiresAt: 1 });
    expect(link.passKey).toBe("cloud-key");
    expect(link.status).toBe("online");
    latest().say({ type: "session", setId: "set_1", session: null, members: [], leading: false, canLead: true, live: LIVE });
    expect(link.engine.state).toEqual(LIVE);
  });

  it("a blip shorter than the outage changes nothing", async () => {
    await online();
    latest().say({ type: "session", setId: "set_1", session: null, members: [], leading: false, canLead: true, live: LIVE });
    latest().close();
    vi.advanceTimersByTime(600);
    await online();
    vi.advanceTimersByTime(20_000);
    expect(link.engine.runs).toBe(false);
    expect(link.status).toBe("online");
  });

  it("the cloud gone: the room runs the session; back: hands it back first, then mirrors again", async () => {
    await online();
    latest().say({ type: "session", setId: "set_1", session: null, members: [], leading: false, canLead: true, live: LIVE });
    latest().close();
    // Reconnecting fails meanwhile.
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(2_600);
      latest().close();
    }
    expect(link.status).toBe("room");
    expect(link.engine.state).toMatchObject({ epoch: 1, authority: "pulse:pulse-node1" });
    link.engine.command({ userId: "u_ana", name: "Ana", device: "d:u_ana:tab", canLead: true, canOperate: false }, { id: "room-0001", op: { kind: "present", presenting: { itemId: "item_1", slide: 2, black: false }, basedOn: 1 } });

    vi.advanceTimersByTime(10_000);
    await online();
    expect(latest().types()).toEqual(["screen", "handback"]);
    expect(latest().sent[1]).toMatchObject({ handback: { sessionId: "ses_1", epoch: 1, state: { presenting: { slide: 2 } }, record: [{ origin: "pulse:pulse-node1" }] } });
    expect(link.status).toBe("room");
    latest().say({ type: "handedBack", sessionId: "ses_1", epoch: 2, rev: 5 });
    expect(link.engine.runs).toBe(false);
    expect(latest().types().slice(-2)).toEqual(["mirror", "pass"]);
    expect(link.status).toBe("online");
  });

  it("the cloud kept its own session: Pulse follows it", async () => {
    await online();
    latest().say({ type: "session", setId: "set_1", session: null, members: [], leading: false, canLead: true, live: LIVE });
    latest().close();
    vi.advanceTimersByTime(10_000);
    expect(link.engine.runs).toBe(true);
    await online();
    latest().say({ type: "error", code: "stale", message: "The cloud's session isn't the one the room ran" });
    expect(link.engine.runs).toBe(false);
    expect(link.status).toBe("online");
  });

  it("put on another set (the next event at its location): that set's session, from the start", async () => {
    await online();
    latest().say({ type: "session", setId: "set_1", session: null, members: [], leading: false, canLead: false, live: LIVE });
    const told: (string | null)[] = [];
    link.onSet((setId) => told.push(setId));
    latest().say({ type: "screen", screen: { ...PULSE, setId: "set_2" } });
    expect(told).toEqual(["set_2"]);
    expect(link.setId).toBe("set_2");
    expect(link.engine.state).toBeNull();
    expect(latest().types().slice(-2)).toEqual(["mirror", "pass"]);
    // The old set's session no longer reaches it.
    latest().say({ type: "session", setId: "set_1", session: null, members: [], leading: false, canLead: false, live: LIVE });
    expect(link.engine.state).toBeNull();
  });

  it("with no set on it, it waits online without mirroring; it pings so the cloud can move it", async () => {
    await online({ ...PULSE, setId: null });
    expect(link.status).toBe("online");
    expect(latest().types()).toEqual(["screen"]);
    vi.advanceTimersByTime(30_000);
    expect(latest().types()).toEqual(["screen", "ping"]);
  });

  it("a screen's token: told to pair it as a Pulse, and nothing done", async () => {
    const lines: string[] = [];
    link.stop();
    link = new CloudLink({ apiUrl: "https://api.example.test", nodeId: "pulse-node1", token: async () => "token", log: (line) => lines.push(line), open: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; } });
    link.start();
    await online({ ...PULSE, pulse: undefined });
    expect(link.setId).toBeNull();
    expect(lines.some((line) => line.includes("not a Pulse's"))).toBe(true);
  });
});
