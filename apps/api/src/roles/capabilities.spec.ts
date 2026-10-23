import { describe, expect, it } from "vite-plus/test";
import { combineRoles, monthlyLimitOf } from "./capabilities.js";

const role = (overrides: Partial<Parameters<typeof combineRoles>[0][number]> = {}) => ({
  id: Math.random().toString(36).slice(2),
  canReview: false,
  canSeparateStems: false,
  canKeepLosslessAudio: false,
  canUploadAudio: false,
  canOperateScreens: false,
  canCue: false,
  stemSeparationMonthlyLimit: null,
  storageLimitMb: null,
  permissions: [],
  ...overrides,
});

describe("combineRoles", () => {
  it("allows what any role allows", () => {
    const caps = combineRoles([role({ canReview: true }), role({ canSeparateStems: true })]);
    expect(caps.canReview).toBe(true);
    expect(caps.canSeparateStems).toBe(true);
    expect(caps.canKeepLosslessAudio).toBe(false);
    expect(combineRoles([role(), role({ canKeepLosslessAudio: true })]).canKeepLosslessAudio).toBe(true);
  });

  it("gives nothing without roles", () => {
    const caps = combineRoles([]);
    expect(caps).toMatchObject({ canReview: false, canSeparateStems: false, storageLimitMb: null, permissions: [] });
  });

  it("takes the largest storage tier, even below the default", () => {
    expect(combineRoles([role({ storageLimitMb: 100 }), role({ storageLimitMb: 5000 })]).storageLimitMb).toBe(5000);
    expect(combineRoles([role({ storageLimitMb: 1 })]).storageLimitMb).toBe(1);
  });

  it("merges plugin permissions", () => {
    expect(combineRoles([role({ permissions: ["b", "a"] }), role({ permissions: ["a"] })]).permissions).toEqual(["a", "b"]);
  });
});

describe("monthlyLimitOf", () => {
  const separating = (...limits: (number | null)[]) => combineRoles(limits.map((limit) => role({ canSeparateStems: true, stemSeparationMonthlyLimit: limit })));

  it("uses the default for a role without its own", () => {
    expect(monthlyLimitOf(separating(null), 20)).toBe(20);
  });

  it("lets a role's own limit be below the default", () => {
    expect(monthlyLimitOf(separating(5), 20)).toBe(5);
  });

  it("takes the largest, a role without one counting as the default", () => {
    expect(monthlyLimitOf(separating(null, 5), 20)).toBe(20);
    expect(monthlyLimitOf(separating(null, 50), 20)).toBe(50);
    expect(monthlyLimitOf(separating(10, 30), 20)).toBe(30);
  });

  it("has no limit when the default has none and a role uses it", () => {
    expect(monthlyLimitOf(separating(null, 5), null)).toBeNull();
    expect(monthlyLimitOf(separating(5), null)).toBe(5);
  });

  it("ignores roles that don't allow separating", () => {
    const caps = combineRoles([role({ stemSeparationMonthlyLimit: 99 }), role({ canSeparateStems: true, stemSeparationMonthlyLimit: 3 })]);
    expect(monthlyLimitOf(caps, 20)).toBe(3);
  });
});
