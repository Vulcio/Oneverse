import { describe, expect, it } from "vite-plus/test";
import { passkeyRpId, sharedCookieDomain, signInOrigins } from "./auth-domains.js";

describe("sharedCookieDomain", () => {
  it("is the parent both apps share", () => {
    expect(sharedCookieDomain("api.songverse.one", "songverse.one")).toBe("songverse.one");
    expect(sharedCookieDomain("api.songverse.one", "app.songverse.one")).toBe("songverse.one");
  });
  it("is unset when both are on one host (local dev)", () => {
    expect(sharedCookieDomain("localhost", "localhost")).toBeUndefined();
  });
  it("refuses hosts with no common parent", () => {
    expect(() => sharedCookieDomain("api.example.com", "songverse.one")).toThrow(/one parent domain/);
  });
});

describe("passkeyRpId", () => {
  it("stays songverse.one whether the web app is on the root domain or app.songverse.one", () => {
    expect(passkeyRpId("api.songverse.one", "songverse.one")).toBe("songverse.one");
    expect(passkeyRpId("api.songverse.one", "app.songverse.one")).toBe("songverse.one");
  });
  it("is the host itself in local dev", () => {
    expect(passkeyRpId("localhost", "localhost")).toBe("localhost");
  });
});

describe("with Planiverse (issue #241)", () => {
  it("is the parent the API and both web apps share", () => {
    expect(sharedCookieDomain("api.songverse.one", "app.songverse.one", "plan.songverse.one")).toBe("songverse.one");
    expect(passkeyRpId("api.songverse.one", "app.songverse.one", "plan.songverse.one")).toBe("songverse.one");
  });
  it("narrows to what all of them share", () => {
    expect(sharedCookieDomain("api.eu.songverse.one", "app.eu.songverse.one", "plan.songverse.one")).toBe("songverse.one");
  });
  it("refuses a web app on another domain", () => {
    expect(() => sharedCookieDomain("api.songverse.one", "app.songverse.one", "planiverse.app")).toThrow(/one parent domain/);
  });
  it("is unset when all are on one host (local dev)", () => {
    expect(sharedCookieDomain("localhost", "localhost", "localhost")).toBeUndefined();
  });
});

describe("with Oneverse (issue #303)", () => {
  const apps = { songverse: "https://songverse.top", planiverse: "https://planiverse.top/", oneverse: "https://oneverse.top" };
  it("signs in at Oneverse only, so the apps can be on domains of their own", () => {
    const origins = signInOrigins(apps);
    expect(origins).toEqual(["https://oneverse.top"]);
    const hosts = origins.map((origin) => new URL(origin).hostname);
    expect(sharedCookieDomain("api.oneverse.top", ...hosts)).toBe("oneverse.top");
    expect(passkeyRpId("api.oneverse.top", ...hosts)).toBe("oneverse.top");
  });
  it("signs in in the apps without it", () => {
    expect(signInOrigins({ ...apps, oneverse: null })).toEqual(["https://songverse.top", "https://planiverse.top"]);
    expect(signInOrigins({ songverse: "http://localhost:3000", planiverse: null, oneverse: null })).toEqual(["http://localhost:3000"]);
  });
});
