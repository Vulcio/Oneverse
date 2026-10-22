import { describe, expect, it } from "vite-plus/test";
import { LiveEngine, LiveHandbackSchema, liveHandedBack } from "../live/engine.js";
import type { LiveActor, LiveSessionState } from "../live/index.js";

const ANA: LiveActor = { userId: "u_ana", name: "Ana", device: "d:u_ana:tab", canLead: true, canOperate: false };
const BEN: LiveActor = { userId: "u_ben", name: "Ben", device: "d:u_ben:phone", canLead: false, canOperate: false };

const CLOUD: LiveSessionState = {
  sessionId: "ses_1",
  epoch: 0,
  rev: 7,
  leader: { id: ANA.userId, name: ANA.name, device: ANA.device },
  metronome: null,
  stems: null,
  itemId: "item_1",
  presenting: { itemId: "item_1", slide: 2, black: false },
  presentingRev: 4,
  presenters: [],
  screens: null,
};

const next = (slide: number, basedOn: number) => ({ kind: "present" as const, presenting: { itemId: "item_1", slide, black: false }, basedOn });

describe("LiveEngine", () => {
  it("follows the cloud, and refuses commands while the cloud runs the session", () => {
    const engine = new LiveEngine("node1", () => 1000);
    engine.mirror(CLOUD);
    expect(engine.state).toBe(CLOUD);
    expect(engine.command(ANA, { id: "cmd-00000001", op: next(3, 4) })).toMatchObject({ type: "error", code: "forbidden" });
    expect(engine.handBack()).toBeNull();
  });

  it("takes over one epoch up, applies the room's commands once, and keeps their record", () => {
    const engine = new LiveEngine("node1", () => 1000);
    engine.mirror(CLOUD);
    expect(engine.takeOver()).toBe(true);
    expect(engine.state).toMatchObject({ sessionId: "ses_1", epoch: 1, authority: "pulse:node1", rev: 7 });
    // The cloud's session doesn't move the room's any more.
    engine.mirror({ ...CLOUD, rev: 99 });
    expect(engine.state?.rev).toBe(7);

    expect(engine.command(ANA, { id: "cmd-00000001", epoch: 1, op: next(3, 4) })).toEqual({ type: "ack", id: "cmd-00000001", rev: 8 });
    // A resend: answered again, applied once.
    expect(engine.command(ANA, { id: "cmd-00000001", epoch: 1, op: next(3, 4) })).toEqual({ type: "ack", id: "cmd-00000001", rev: 8 });
    // Decided from the cloud's epoch: load it again.
    expect(engine.command(ANA, { id: "cmd-00000002", epoch: 0, op: next(4, 5) })).toMatchObject({ type: "error", code: "epoch" });
    // Who may, as in the cloud.
    expect(engine.command(BEN, { id: "cmd-00000003", op: next(4, 5) })).toMatchObject({ type: "error", code: "forbidden" });
    expect(engine.state?.presenting?.slide).toBe(3);

    const handback = engine.handBack();
    expect(handback).toMatchObject({ sessionId: "ses_1", epoch: 1, authority: "pulse:node1" });
    expect(handback?.record).toEqual([{ rev: 8, epoch: 1, at: 1000, userId: "u_ana", deviceId: "d:u_ana:tab", origin: "pulse:node1", op: next(3, 4) }]);
    expect(LiveHandbackSchema.safeParse(handback).success).toBe(true);
  });

  it("can't take over a session it never had", () => {
    expect(new LiveEngine("node1").takeOver()).toBe(false);
  });

  it("a session the room ended is handed back as ended", () => {
    const engine = new LiveEngine("node1", () => 1000);
    engine.mirror(CLOUD);
    engine.takeOver();
    expect(engine.command(ANA, { id: "cmd-00000001", op: { kind: "end" } })).toEqual({ type: "ack", id: "cmd-00000001", rev: 8 });
    expect(engine.state).toBeNull();
    const handback = engine.handBack();
    expect(handback?.state).toBeNull();
    expect(handback?.record.map((one) => one.op.kind)).toEqual(["end"]);
    engine.handedBack();
    expect(engine.runs).toBe(false);
  });
});

describe("liveHandedBack", () => {
  function roomHandback() {
    const engine = new LiveEngine("node1", () => 1000);
    engine.mirror(CLOUD);
    engine.takeOver();
    engine.command(ANA, { id: "cmd-00000001", op: next(3, 4) });
    return LiveHandbackSchema.parse(engine.handBack());
  }

  it("the room wins: its state, one epoch up, the cloud's again, past every revision either side reached", () => {
    // The cloud went on meanwhile, for a phone still talking to it.
    const cloud = { ...CLOUD, rev: 12, presenting: { itemId: "item_1", slide: 6, black: false }, presentingRev: 9 };
    const taken = liveHandedBack(cloud, roomHandback());
    expect(taken?.session).toMatchObject({ sessionId: "ses_1", epoch: 2, authority: "cloud", rev: 13, presentingRev: 10, presenting: { slide: 3 } });
  });

  it("not over another session, nor twice", () => {
    const handback = roomHandback();
    expect(liveHandedBack({ ...CLOUD, sessionId: "ses_2" }, handback)).toBeNull();
    expect(liveHandedBack(null, handback)).toBeNull();
    expect(liveHandedBack({ ...CLOUD, epoch: 2 }, handback)).toBeNull();
  });

  it("ended in the room: ended", () => {
    expect(liveHandedBack(CLOUD, { ...roomHandback(), state: null })).toEqual({ session: null });
  });
});
