import { describe, expect, it } from "vite-plus/test";
import { PULSE_PASS_RENEW_MS, PulseDoor } from "../live/pulse-door.js";

describe("PulseDoor", () => {
  function door() {
    let now = 1_000_000;
    let asked = 0;
    const one = new PulseDoor(() => asked++, () => now);
    return { one, asked: () => asked, wait: (ms: number) => (now += ms), at: () => now };
  }

  it("no Pulse in the set: no pass asked for, no link", () => {
    const { one, asked } = door();
    one.heard(null);
    one.heard(undefined);
    expect(asked()).toBe(0);
    expect(one.link).toBeNull();
  });

  it("a Pulse: a pass asked for once, then the link to its page with it", () => {
    const { one, asked, at } = door();
    one.heard("http://192.168.1.20:8788/");
    one.heard("http://192.168.1.20:8788/");
    expect(asked()).toBe(1);
    one.passed("payload.sig", at() + 12 * 3600_000);
    expect(one.link).toBe("http://192.168.1.20:8788/#pass=payload.sig");
  });

  it("asked again an hour on; kept through the outage; gone once expired", () => {
    const { one, asked, wait, at } = door();
    one.heard("http://pulse.local:8788");
    one.passed("a.b", at() + 2 * PULSE_PASS_RENEW_MS);
    wait(PULSE_PASS_RENEW_MS);
    one.heard("http://pulse.local:8788");
    expect(asked()).toBe(2);
    // The cloud's gone: no session comes, the link stays.
    expect(one.link).toBe("http://pulse.local:8788/#pass=a.b");
    wait(PULSE_PASS_RENEW_MS);
    expect(one.link).toBeNull();
  });

  it("the Pulse gone from the set: no link", () => {
    const { one, at } = door();
    one.heard("http://pulse.local:8788");
    one.passed("a.b", at() + 1000);
    one.heard(null);
    expect(one.link).toBeNull();
  });
});
