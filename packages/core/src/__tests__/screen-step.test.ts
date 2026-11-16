import { describe, expect, it } from "vite-plus/test";
import { screenStepKey, stepPresenting } from "../screens/step.js";

const items = [
  { id: "a", slides: 2 },
  { id: "empty", slides: 0 },
  { id: "b", slides: 3 },
];
const at = (itemId: string, slide: number, black = false) => ({ itemId, slide, black });

describe("stepPresenting (issue #195)", () => {
  it("goes through an item's slides, then the next item's, skipping items with none", () => {
    expect(stepPresenting(items, at("a", 0), "next")).toEqual(at("a", 1));
    expect(stepPresenting(items, at("a", 1), "next")).toEqual(at("b", 0));
    expect(stepPresenting(items, at("b", 0), "previous")).toEqual(at("a", 1));
  });

  it("stays put at either end", () => {
    expect(stepPresenting(items, at("b", 2), "next")).toEqual(at("b", 2));
    expect(stepPresenting(items, at("a", 0), "previous")).toEqual(at("a", 0));
    expect(stepPresenting(items, at("b", 1), "next-item")).toEqual(at("b", 1));
  });

  it("jumps between items", () => {
    expect(stepPresenting(items, at("a", 1), "next-item")).toEqual(at("b", 0));
    expect(stepPresenting(items, at("b", 2), "previous-item")).toEqual(at("a", 0));
  });

  it("starts at the set's first slide when nothing, or an unknown item, is presented", () => {
    expect(stepPresenting(items, null, "next")).toEqual(at("a", 0));
    expect(stepPresenting(items, at("gone", 4), "previous")).toEqual(at("a", 0));
    expect(stepPresenting([{ id: "x", slides: 0 }], null, "next")).toBeNull();
  });

  it("goes black and back; from black, next shows the slide that was black", () => {
    expect(stepPresenting(items, at("b", 1), "black")).toEqual(at("b", 1, true));
    expect(stepPresenting(items, at("b", 1, true), "black")).toEqual(at("b", 1));
    expect(stepPresenting(items, at("b", 1, true), "next")).toEqual(at("b", 1));
  });

  it("keeps a slide past an item's end (the item shortened) inside it", () => {
    expect(stepPresenting(items, at("a", 9), "previous")).toEqual(at("a", 0));
  });
});

describe("screenStepKey", () => {
  it("reads remotes', keyboards' and clickers' keys", () => {
    expect(["ArrowRight", "ArrowDown", "PageDown"].map(screenStepKey)).toEqual(["next", "next", "next"]);
    expect(["ArrowLeft", "ArrowUp", "PageUp"].map(screenStepKey)).toEqual(["previous", "previous", "previous"]);
    expect(screenStepKey("ChannelUp")).toBe("next-item");
    expect(screenStepKey("ChannelDown")).toBe("previous-item");
    expect(screenStepKey("b")).toBe("black");
    expect(screenStepKey("GoBack")).toBe("black");
    expect(screenStepKey("x")).toBeNull();
  });
});
