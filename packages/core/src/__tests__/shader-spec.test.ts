import { describe, expect, it } from "vite-plus/test";
import { adaptShaderDrawing, advanceShaderClock, initialShaderDrawing, readIsf, readIsfValues, shaderControlValue, type ShaderDrawing } from "../screens/index.js";

describe("a shader's clock (issue #324)", () => {
  const pace = { motion: 0.5, spin: 0 };

  it("runs at the shader's own pace at motion 0.5, and stops at 0", () => {
    expect(advanceShaderClock({ time: 0, turn: 0, speed: 1 }, 1000, pace, {}).time).toBeCloseTo(1);
    expect(advanceShaderClock({ time: 3, turn: 0, speed: 1 }, 1000, { motion: 0, spin: 0 }, { movement: 1 }).time).toBe(3);
  });

  it("speeds up with movement without jumping: a frame moves it by its length times the speed", () => {
    let clock = { time: 600, turn: 0, speed: 1 };
    clock = advanceShaderClock(clock, 16, pace, { movement: 1 });
    // Ten minutes in, a full movement kick moves a frame on by 5 frames' worth, not hundreds of seconds.
    expect(clock.time - 600).toBeCloseTo(0.08);
    expect(clock.speed).toBeCloseTo(5);
  });

  it("turns at the theme's spin, faster with a rotation reaction, within one turn", () => {
    expect(advanceShaderClock({ time: 0, turn: 0, speed: 1 }, 2000, { motion: 0.5, spin: 10 }, {}).turn).toBeCloseTo(20);
    expect(advanceShaderClock({ time: 0, turn: 0, speed: 1 }, 1000, { motion: 0.5, spin: 0 }, { rotation: 0.5 }).turn).toBeCloseTo(45);
    expect(advanceShaderClock({ time: 0, turn: 350, speed: 1 }, 1000, { motion: 0.5, spin: 20 }, {}).turn).toBeCloseTo(10);
  });
});

describe("the standard controls (issue #324)", () => {
  it("are pushed by their reaction, within the shader's range", () => {
    expect(shaderControlValue("sv_brightness", 0.4, { min: 0, max: 1 }, { brightness: 1 })).toBeCloseTo(0.9);
    expect(shaderControlValue("sv_brightness", 0.8, { min: 0, max: 1 }, { brightness: 1 })).toBe(1);
    expect(shaderControlValue("sv_hue", 0, { min: 0, max: 1 }, { hue: 1 })).toBeCloseTo(1 / 3);
    expect(shaderControlValue("sv_contrast", 0.7, { min: 0, max: 1 }, { brightness: 1 })).toBe(0.7);
    expect(shaderControlValue("speed", 0.3, { min: 0, max: 2 }, { movement: 1 })).toBe(0.3);
  });

  it("take the spec's range and default when the header gives none, and are shown as controls", () => {
    const shader = readIsf('/*{"INPUTS":[{"NAME":"sv_rotation","TYPE":"float"},{"NAME":"sv_brightness","TYPE":"float","MIN":0,"MAX":2,"DEFAULT":1},{"NAME":"sv_pulse","TYPE":"float"},{"NAME":"sv_offset","TYPE":"point2D"}]}*/ void main() {}');
    if ("error" in shader) throw new Error(shader.error);
    const [rotation, brightness, pulse, offset] = shader.inputs;
    expect(rotation).toMatchObject({ standard: true, songverse: false, min: -180, max: 180, default: 0 });
    expect(brightness).toMatchObject({ standard: true, min: 0, max: 2, default: 1 });
    expect(pulse).toMatchObject({ standard: false, songverse: true });
    expect(offset).toMatchObject({ standard: true, default: [0, 0] });
    expect(readIsfValues(shader.inputs, { sv_rotation: 400, sv_pulse: 1 })).toEqual({ sv_rotation: 180, sv_brightness: 1, sv_offset: [0, 0] });
  });
});

describe("how a shader draws on a slow device (issue #324)", () => {
  it("draws less first, then smaller", () => {
    let drawing: ShaderDrawing = initialShaderDrawing();
    expect(drawing.quality).toBe(2);
    drawing = adaptShaderDrawing(drawing, 30);
    expect(drawing).toMatchObject({ quality: 1, scale: 1 });
    drawing = adaptShaderDrawing(drawing, 30);
    drawing = adaptShaderDrawing(drawing, 30);
    expect(drawing).toMatchObject({ quality: 0, scale: 0.8 });
    // Twice down in a row isn't "too slow after going up": it may go back to full later.
    expect(drawing.ceiling).toBe(2);
  });

  it("goes back to its full size first, then more, after a few good measurements", () => {
    let drawing: ShaderDrawing = { quality: 0, scale: 0.5, ceiling: 2, since: 0, rose: false };
    for (let i = 0; i < 20 && drawing.scale < 1; i++) drawing = adaptShaderDrawing(drawing, 60);
    expect(drawing).toMatchObject({ quality: 0, scale: 1 });
    drawing = adaptShaderDrawing(drawing, 60);
    expect(drawing.quality).toBe(1);
    // Then a few good measurements before the next step.
    for (let i = 0; i < 3; i++) drawing = adaptShaderDrawing(drawing, 60);
    expect(drawing.quality).toBe(1);
    drawing = adaptShaderDrawing(drawing, 60);
    expect(drawing.quality).toBe(2);
  });

  it("doesn't try again a step up that was too slow at once", () => {
    let drawing: ShaderDrawing = { quality: 1, scale: 1, ceiling: 2, since: 3, rose: false };
    drawing = adaptShaderDrawing(drawing, 60);
    expect(drawing.quality).toBe(2);
    drawing = adaptShaderDrawing(drawing, 40);
    expect(drawing).toMatchObject({ quality: 1, ceiling: 1 });
    for (let i = 0; i < 10; i++) drawing = adaptShaderDrawing(drawing, 60);
    expect(drawing.quality).toBe(1);
  });

  it("starts with a little less on a weak device", () => {
    expect(initialShaderDrawing({ cores: 2, memoryGb: 4 }).quality).toBe(1);
    expect(initialShaderDrawing({ cores: 8, memoryGb: 8 }).quality).toBe(2);
  });
});
