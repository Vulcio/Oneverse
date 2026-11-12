import { describe, expect, test } from "vite-plus/test";
import { clickGrid, shiftRecordingBeat } from "../index.js";

const steadyMap = (first: number, each: number, count: number, meter = 4) => {
  const beats = Array.from({ length: count }, (_, i) => Math.round((first + i * each) * 1000) / 1000);
  return { beats, downbeats: beats.filter((_, i) => i % meter === 0) };
};

describe("clickGrid", () => {
  test("no map: a steady grid from the first beat", () => {
    const grid = clickGrid({ tempo: 120, firstBeat: 1.5, map: null });
    expect(grid.secondsAt(0)).toBe(1.5);
    expect(grid.secondsAt(4)).toBeCloseTo(3.5, 9);
    expect(grid.secondsAt(-2)).toBeCloseTo(0.5, 9);
    expect(grid.beatAt(3.5)).toBeCloseTo(4, 9);
  });

  test("follows a recording that speeds up, beat by beat", () => {
    // From 100 to about 106 BPM over 64 beats.
    const beats: number[] = [0.8];
    for (let i = 1; i < 64; i++) beats.push(beats[i - 1]! + 0.6 - i * 0.0005);
    const map = { beats: beats.map((t) => Math.round(t * 1000) / 1000), downbeats: [] as number[] };
    map.downbeats = map.beats.filter((_, i) => i % 4 === 0);
    const grid = clickGrid({ tempo: 100, firstBeat: 0.8, map });
    expect(grid.secondsAt(0)).toBe(0.8);
    for (const n of [8, 31, 50, 63]) expect(Math.abs(grid.secondsAt(n) - map.beats[n]!)).toBeLessThan(0.002);
    // A steady grid at the starting tempo would be almost a second behind the band by the last beat.
    expect(0.8 + 63 * 0.6 - map.beats[63]!).toBeGreaterThan(0.9);
    expect(grid.beatAt(grid.secondsAt(37.5))).toBeCloseTo(37.5, 6);
  });

  test("a beat a few ms off doesn't make the click stumble", () => {
    const map = steadyMap(0.5, 0.5, 40);
    map.beats[10] = map.beats[10]! + 0.012;
    const grid = clickGrid({ tempo: 120, firstBeat: 0.5, map });
    expect(Math.abs(grid.secondsAt(10) - 5.5)).toBeLessThan(0.003);
  });

  test("before the first beat and past the last: the grid goes on", () => {
    const grid = clickGrid({ tempo: 120, firstBeat: 2, map: steadyMap(2, 0.5, 16) });
    expect(grid.secondsAt(-4)).toBeCloseTo(0, 6);
    expect(grid.secondsAt(20)).toBeCloseTo(12, 6);
    expect(grid.beatAt(0)).toBeCloseTo(-4, 6);
  });

  test("a first beat set by hand away from the map: the steady grid", () => {
    const grid = clickGrid({ tempo: 120, firstBeat: 3.2, map: steadyMap(2, 0.5, 16) });
    expect(grid.secondsAt(1)).toBeCloseTo(3.7, 9);
  });
});

describe("shiftRecordingBeat", () => {
  const beat = { tempo: 120, firstBeat: 1, map: steadyMap(1, 0.5, 16) };

  test("by milliseconds: everything moves", () => {
    const moved = shiftRecordingBeat(beat, { seconds: 0.02 });
    expect(moved.firstBeat).toBe(1.02);
    expect(moved.map!.beats[1]).toBe(1.52);
    expect(moved.map!.downbeats[1]).toBe(3.02);
  });

  test("by a beat: the bars move, the beats stay", () => {
    const later = shiftRecordingBeat(beat, { beats: 1 });
    expect(later.firstBeat).toBe(1.5);
    expect(later.map!.downbeats.slice(0, 2)).toEqual([1.5, 3.5]);
    expect(later.map!.beats[0]).toBe(1.5);
    const earlier = shiftRecordingBeat(beat, { beats: -1 });
    expect(earlier.firstBeat).toBe(0.5);
    expect(earlier.map!.downbeats.slice(0, 2)).toEqual([0.5, 2.5]);
    expect(earlier.map!.beats.slice(0, 2)).toEqual([0.5, 1]);
  });

  test("never before 0:00", () => {
    const atStart = { tempo: 120, firstBeat: 0, map: steadyMap(0, 0.5, 16) };
    const moved = shiftRecordingBeat(atStart, { beats: -1 });
    expect(moved.firstBeat).toBe(1.5);
    expect(shiftRecordingBeat({ tempo: 120, firstBeat: 0.01, map: null }, { seconds: -0.05 }).firstBeat).toBe(0);
  });
});
