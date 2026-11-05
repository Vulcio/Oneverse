import { describe, expect, test } from "vite-plus/test";
import { readRecordingChords } from "../recording/chords.js";

describe("a recording's chords (issue #393)", () => {
  test("kept in order, without the stretches with no chord, the bass only when it isn't the root", () => {
    expect(
      readRecordingChords([
        { start: 0, end: 0.42, label: "N" },
        { start: 0.42, end: 3.7404, root: 7, quality: "maj", label: "G" },
        { start: 3.7404, end: 7, root: 4, quality: "min7", bass: 4, label: "E:min7" },
        { start: 7, end: 10, root: 0, quality: "maj", bass: 4, label: "C/3" },
      ]),
    ).toEqual([
      { start: 0.42, end: 3.74, root: 7, quality: "maj" },
      { start: 3.74, end: 7, root: 4, quality: "min7" },
      { start: 7, end: 10, root: 0, quality: "maj", bass: 4 },
    ]);
  });

  test("all or nothing: one bad chord and none are kept", () => {
    const good = { start: 0, end: 1, root: 0, quality: "maj" };
    for (const bad of [
      { start: 0.5, end: 2, root: 7, quality: "maj" }, // overlaps
      { start: 1, end: 2, root: 12, quality: "maj" }, // no such pitch class
      { start: 1, end: 2, root: 7, quality: "maj9" }, // a quality it doesn't know
      { start: 2, end: 1.5, root: 7, quality: "maj" }, // ends before it starts
      { start: 1, end: Number.NaN, root: 7, quality: "maj" },
      { start: 1, end: 2, root: 7, quality: "maj", bass: -1 },
    ]) {
      expect(readRecordingChords([good, bad])).toBeNull();
    }
    expect(readRecordingChords([])).toBeNull();
    expect(readRecordingChords([{ start: 0, end: 5, label: "N" }])).toBeNull();
    expect(readRecordingChords("C G Am F")).toBeNull();
  });
});
