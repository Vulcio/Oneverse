import { describe, expect, test } from "vite-plus/test";
import { chordShapes, customTuningFromNames, customTuningId, findTuning, isTuningId, shapeText, TUNINGS, tunedInstrument } from "../chords/shapes.js";
import { UpdateUserSchema } from "../requests/accounts.js";

describe("tunings (issue #355)", () => {
  test("every built-in tuning has its instrument's number of strings, and a unique ID", () => {
    for (const [instrument, tunings] of Object.entries(TUNINGS)) {
      expect(new Set(tunings.map((one) => one.id)).size).toBe(tunings.length);
      for (const tuning of tunings) expect(tuning.strings).toHaveLength(instrument === "guitar" ? 6 : 4);
    }
  });

  test("a tuning of one's own: written with its octaves, read back, named by its notes", () => {
    const id = customTuningId("guitar", ["C2", "G2", "D3", "G3", "B3", "D4"]);
    expect(id).toBe("custom:C2-G2-D3-G3-B3-D4");
    expect(findTuning("guitar", id)).toEqual({ id, name: "CGDGBD", strings: [36, 43, 50, 55, 59, 62], knownShapes: false });
    expect(isTuningId("guitar", id!)).toBe(true);
  });

  test("flats are written as sharps; the same strings as a built-in tuning are that tuning", () => {
    expect(customTuningId("guitar", ["Eb2", "Ab2", "Db3", "Gb3", "Bb3", "Eb4"])).toBe("custom:D#2-G#2-C#3-F#3-A#3-D#4");
    expect(findTuning("guitar", "custom:D#2-G#2-C#3-F#3-A#3-D#4")?.id).toBe("half-step-down");
  });

  test("the wrong number of strings, a note it can't read, or one out of range: not a tuning", () => {
    expect(customTuningId("guitar", ["D2", "A2", "D3", "G3"])).toBeNull();
    expect(customTuningId("ukulele", ["G4", "C4", "E4", "H4"])).toBeNull();
    expect(customTuningId("guitar", ["D0", "A2", "D3", "G3", "B3", "E4"])).toBeNull();
    expect(isTuningId("guitar", "custom:D2-A2")).toBe(false);
    expect(isTuningId("guitar", "custom:d2-a2-d3-g3-b3-e4")).toBe(false);
    expect(isTuningId("guitar", "nashville")).toBe(false);
  });

  test("written as players write them, without octaves: each string nearest its standard one", () => {
    expect(customTuningFromNames("guitar", "C G D G B D")).toBe("custom:C2-G2-D3-G3-B3-D4");
    expect(customTuningFromNames("guitar", "DADF#AD")).toBe("custom:D2-A2-D3-F#3-A3-D4");
    expect(customTuningFromNames("guitar", "d, a, d, g, a, d")).toBe("custom:D2-A2-D3-G3-A3-D4");
    expect(customTuningFromNames("guitar", "Eb Ab Db Gb Bb Eb")).toBe("custom:D#2-G#2-C#3-F#3-A#3-D#4");
    expect(customTuningFromNames("ukulele", "A D F# B")).toBe("custom:A4-D4-F#4-B4");
    expect(customTuningFromNames("guitar", "D A D G")).toBeNull();
    expect(customTuningFromNames("guitar", "D A D G B E please")).toBeNull();
  });

  test("older preset names still read; anything unknown is standard", () => {
    expect(findTuning("guitar", "drop_d")?.id).toBe("drop-d");
    expect(findTuning("guitar", "standard_guitar")?.id).toBe("standard");
    expect(tunedInstrument("guitar", "nonsense").tuning.id).toBe("standard");
  });

  test("shapes are worked out for a tuning of one's own: D in open D is the open strings", () => {
    const openD = customTuningId("guitar", ["D2", "A2", "D3", "F#3", "A3", "D4"])!;
    expect(findTuning("guitar", openD)?.id).toBe("open-d");
    expect(shapeText(chordShapes("D", "guitar", 1, "open-d")[0]!)).toBe("000000");
    const own = customTuningId("guitar", ["C2", "G2", "D3", "G3", "B3", "D4"])!;
    expect(chordShapes("G", "guitar", 1, own)[0]!.notes.every((note) => [7, 11, 2].includes(note % 12))).toBe(true);
  });

  test("a player's tuning, as an account setting: a built-in one or their own", () => {
    expect(UpdateUserSchema.safeParse({ guitarTuning: "open-e" }).success).toBe(true);
    expect(UpdateUserSchema.safeParse({ guitarTuning: "custom:C2-G2-D3-G3-B3-D4" }).success).toBe(true);
    const wrong = UpdateUserSchema.safeParse({ guitarTuning: "custom:C2" });
    expect(wrong.success).toBe(false);
    expect(wrong.error?.issues[0]?.message).toBe("guitarTuning must be a guitar tuning");
  });
});
