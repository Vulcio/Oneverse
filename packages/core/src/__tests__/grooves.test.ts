import { describe, expect, it } from "vite-plus/test";
import { GROOVE_DRUMS, GROOVE_STYLES, GROOVE_VARIANTS, defaultGrooveVariant, grooveBar, grooveHits, groovesFor } from "../grooves/index.js";

describe("groove library", () => {
  it("has unique ids, and every row is a bar long, of known drums and marks", () => {
    expect(new Set(GROOVE_STYLES.map((style) => style.id)).size).toBe(GROOVE_STYLES.length);
    for (const style of GROOVE_STYLES) {
      for (const rows of [...GROOVE_VARIANTS.map((variant) => style.variants[variant]), style.fill]) {
        expect(Object.keys(rows).length).toBeGreaterThan(0);
        for (const [drum, row] of Object.entries(rows)) {
          expect(GROOVE_DRUMS, style.id).toContain(drum);
          expect(row, `${style.id} ${drum}`).toMatch(new RegExp(`^[Xxo.]{${style.steps}}$`));
        }
      }
      // Steps spread evenly over the bar's beats.
      expect(style.steps % style.timeSignature.numerator, style.id).toBe(0);
    }
  });

  it("offers the styles of a time signature, 4/4 without one", () => {
    expect(groovesFor({ numerator: 6, denominator: 8 }).map((style) => style.id)).toEqual(["ballad-6-8", "rock-6-8"]);
    expect(groovesFor(null).map((style) => style.id)).toContain("pop-rock");
    expect(groovesFor({ numerator: 7, denominator: 8 })).toEqual([]);
  });

  it("picks a variation by section", () => {
    expect(defaultGrooveVariant("verse")).toBe("simple");
    expect(defaultGrooveVariant("chorus")).toBe("full");
    expect(defaultGrooveVariant("bridge")).toBe("halfTime");
    expect(defaultGrooveVariant("intro")).toBe("light");
  });

  it("reads hits with their velocity", () => {
    expect(grooveHits({ kick: "x...", snare: "..X.", hihat: "o..." }, 4)).toEqual([
      { drum: "kick", step: 0, velocity: 92 },
      { drum: "hihat", step: 0, velocity: 46 },
      { drum: "snare", step: 2, velocity: 118 },
    ]);
  });
});

describe("grooveBar", () => {
  const four = { numerator: 4, denominator: 4 };
  const bar = (barInPass: number, barsInPass: number, index: number) => ({ barInPass, barsInPass, index, beats: 4 });

  it("plays the section's variation, a crash as a later section starts, the fill on its last bar", () => {
    const groove = { styleId: "pop-rock", variant: "full", fill: true };
    expect(grooveBar(groove, bar(0, 4, 0), four)?.rows.crash).toBeUndefined();
    const first = grooveBar(groove, bar(0, 4, 8), four)!;
    expect(first.rows.crash).toBe("X...............");
    expect(first.rows.hihat?.[0]).toBe(".");
    expect(grooveBar(groove, bar(1, 4, 9), four)?.fill).toBe(false);
    const last = grooveBar(groove, bar(3, 4, 11), four)!;
    expect(last.fill).toBe(true);
    expect(last.rows.snare).toBe("....X...x.x.xxXX");
    expect(grooveBar({ ...groove, fill: false }, bar(3, 4, 11), four)?.fill).toBe(false);
  });

  it("plays nothing without a groove, for an unknown style or variation, or in another time signature", () => {
    expect(grooveBar(null, bar(0, 4, 0), four)).toBeNull();
    expect(grooveBar({ styleId: "nope", variant: "full" }, bar(0, 4, 0), four)).toBeNull();
    expect(grooveBar({ styleId: "pop-rock", variant: "loud" }, bar(0, 4, 0), four)).toBeNull();
    expect(grooveBar({ styleId: "pop-rock", variant: "full" }, bar(0, 4, 0), { numerator: 6, denominator: 8 })).toBeNull();
    expect(grooveBar({ styleId: "pop-rock", variant: "full" }, { ...bar(0, 4, 0), beats: 2 }, four)).toBeNull();
  });
});
