import { afterEach, describe, expect, it } from "vite-plus/test";
import { oneverseUrl, planiverseUrl, songverseUrl, webOrigins } from "./web-apps.js";

const saved = { WEB_URL: process.env.WEB_URL, PLANIVERSE_URL: process.env.PLANIVERSE_URL, ONEVERSE_URL: process.env.ONEVERSE_URL };
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("the web apps' addresses (issue #241)", () => {
  it("takes an address without its scheme as https", () => {
    process.env.PLANIVERSE_URL = "plan.songverse.one";
    expect(planiverseUrl()).toBe("https://plan.songverse.one");
  });
  it("keeps one with its scheme, without the trailing slash", () => {
    process.env.WEB_URL = "http://localhost:3000/";
    expect(songverseUrl()).toBe("http://localhost:3000");
  });
  it("is unset when empty", () => {
    process.env.PLANIVERSE_URL = " ";
    expect(planiverseUrl()).toBeNull();
  });
  it("names the variable when it isn't an address", () => {
    process.env.PLANIVERSE_URL = "https://exa mple";
    expect(() => webOrigins()).toThrow(/PLANIVERSE_URL must be a web address/);
  });
  it("gives both origins", () => {
    process.env.WEB_URL = "https://app.songverse.one";
    process.env.PLANIVERSE_URL = "plan.songverse.one/";
    delete process.env.ONEVERSE_URL;
    expect(webOrigins()).toEqual(["https://app.songverse.one", "https://plan.songverse.one"]);
  });
  it("adds Oneverse's when it's set (issue #303)", () => {
    process.env.WEB_URL = "https://songverse.top";
    delete process.env.PLANIVERSE_URL;
    process.env.ONEVERSE_URL = "oneverse.top";
    expect(oneverseUrl()).toBe("https://oneverse.top");
    expect(webOrigins()).toEqual(["https://songverse.top", "https://oneverse.top"]);
  });
});
