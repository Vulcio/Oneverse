import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const counts = new Map<string, number>();
let down = false;
vi.mock("../jobs/redis.js", () => ({
  redis: () => ({
    incr: async (key: string) => {
      if (down) throw new Error("Redis is down");
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts.get(key);
    },
    pexpire: async () => 1,
  }),
}));
vi.mock("../security/security-settings.js", () => ({ getEffectiveSecuritySettings: async () => ({ trustedProxies: 1 }) }));

const { CLIENT_ADDRESS_HEADER, authRateLimitStorage, markClientAddress } = await import("./auth-rate-limit.js");

describe("authRateLimitStorage", () => {
  beforeEach(() => {
    counts.clear();
    down = false;
  });

  it("allows `max` requests a window, then refuses with the seconds left", async () => {
    const rule = { window: 60, max: 3 };
    for (let i = 0; i < 3; i++) expect((await authRateLimitStorage.consume("1.2.3.4|/sign-in/email", rule)).allowed).toBe(true);
    const refused = await authRateLimitStorage.consume("1.2.3.4|/sign-in/email", rule);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfter).toBeGreaterThan(0);
    expect(refused.retryAfter).toBeLessThanOrEqual(60);
    // Another address has its own count.
    expect((await authRateLimitStorage.consume("5.6.7.8|/sign-in/email", rule)).allowed).toBe(true);
  });

  it("doesn't refuse anyone when Redis can't be reached", async () => {
    down = true;
    expect(await authRateLimitStorage.consume("1.2.3.4|/sign-in/email", { window: 10, max: 0 })).toEqual({ allowed: true, retryAfter: null });
  });
});

describe("markClientAddress", () => {
  const request = (forwarded: string | undefined, socket = "::ffff:10.0.0.2") => ({ headers: { "x-forwarded-for": forwarded, [CLIENT_ADDRESS_HEADER]: "6.6.6.6" } as Record<string, string | undefined>, socket: { remoteAddress: socket } });

  it("takes the address the trusted proxy saw, not one the client wrote in", async () => {
    const req = request("6.6.6.6, 203.0.113.9");
    await markClientAddress(req as never);
    expect(req.headers[CLIENT_ADDRESS_HEADER]).toBe("203.0.113.9");
  });

  it("falls back to the connection's address, without IPv4's IPv6 wrapping", async () => {
    const req = request(undefined);
    await markClientAddress(req as never);
    expect(req.headers[CLIENT_ADDRESS_HEADER]).toBe("10.0.0.2");
  });
});
