import { describe, expect, it } from "vite-plus/test";
import { SCREEN_BACKGROUND_THEMES, SCREEN_TEMPLATES, composeBuiltInTemplate, screenBuiltInPart, screenPresetsListed } from "../screens/index.js";

describe("the built-in presets (issue #431)", () => {
  it("lists one plain black, and keeps the others for what was saved with them", () => {
    const listed = screenPresetsListed(SCREEN_BACKGROUND_THEMES).map((one) => one.id);
    expect(listed).toContain("classic");
    for (const id of ["stream", "stage-display", "stage-monitor"]) {
      expect(listed).not.toContain(id);
      expect(screenBuiltInPart("background", id)).toEqual(screenBuiltInPart("background", "classic"));
      expect(screenPresetsListed(SCREEN_BACKGROUND_THEMES, id).map((one) => one.id)).toContain(id);
    }
  });

  it("no built-in template uses a background that isn't listed", () => {
    const listed = screenPresetsListed(SCREEN_BACKGROUND_THEMES).map((one) => one.id);
    for (const template of SCREEN_TEMPLATES) expect(listed).toContain(template.background);
  });

  it("darkens the shaders that fill the screen with colour, so the words read", () => {
    for (const id of ["drift", "turning"]) expect(composeBuiltInTemplate(id)!.background.dim).toBeGreaterThanOrEqual(0.3);
  });

  it("draws no title over the stage monitor's words, which start at the top", () => {
    expect(composeBuiltInTemplate("stage-monitor")!.title.show).toBe(false);
  });
});
