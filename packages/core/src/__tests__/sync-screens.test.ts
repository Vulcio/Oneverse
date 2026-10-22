import { describe, expect, it } from "vite-plus/test";
import { resumeScreens, type SyncSession } from "../sync/index.js";

const session = (screens: SyncSession["screens"]): SyncSession => ({ rev: 1, leader: { id: "leader", name: "Singer", online: true }, metronome: null, itemId: null, screens });

describe("the screens taken back after a dropped connection (issue #305)", () => {
  it("remembers how this device runs them", () => {
    const taken: string[] = [];
    expect(resumeScreens({ session: session({ id: "desk", name: "Desk", exclusive: true }), screensMine: true }, "desk", null, (control) => taken.push(control))).toBe("exclusive");
    expect(resumeScreens({ session: session({ id: "desk", name: "Desk", exclusive: false }), screensMine: true }, "desk", null, (control) => taken.push(control))).toBe("shared");
    expect(taken).toEqual([]);
  });

  it("takes them back while they wait for this person, as it had them", () => {
    const taken: string[] = [];
    expect(resumeScreens({ session: session({ id: "desk", name: "Desk", exclusive: true, online: false }), screensMine: false }, "desk", "exclusive", (control) => taken.push(control))).toBe("exclusive");
    expect(taken).toEqual(["exclusive"]);
  });

  it("forgets them once someone else has them, or nobody does", () => {
    const taken: string[] = [];
    expect(resumeScreens({ session: session({ id: "other", name: "Other", exclusive: true }), screensMine: false }, "desk", "exclusive", (control) => taken.push(control))).toBeNull();
    expect(resumeScreens({ session: session(null), screensMine: false }, "desk", "exclusive", (control) => taken.push(control))).toBeNull();
    expect(resumeScreens({ session: null }, "desk", "shared", (control) => taken.push(control))).toBeNull();
    expect(taken).toEqual([]);
  });

  it("leaves them to another device of the same person that never ran them", () => {
    const taken: string[] = [];
    expect(resumeScreens({ session: session({ id: "desk", name: "Desk", exclusive: true, online: false }), screensMine: false }, "desk", null, (control) => taken.push(control))).toBeNull();
    expect(taken).toEqual([]);
  });
});
