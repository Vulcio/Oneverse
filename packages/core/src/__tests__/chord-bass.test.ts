import { describe, expect, test } from "vite-plus/test";
import { chordBassOptions } from "../chords/chord.js";

const chords = (raw: string, key?: string | null) => chordBassOptions(raw, key).map((one) => `${one.chord}:${one.role}`);

describe("a chord's bass notes (issue #228)", () => {
  test("root position, then the inversions, spelled from the chord", () => {
    expect(chords("C").slice(0, 3)).toEqual(["C:root", "C/E:third", "C/G:fifth"]);
    expect(chords("D").slice(0, 3)).toEqual(["D:root", "D/F#:third", "D/A:fifth"]);
    expect(chords("Bb").slice(0, 3)).toEqual(["Bb:root", "Bb/D:third", "Bb/F:fifth"]);
    expect(chords("F#m").slice(0, 3)).toEqual(["F#m:root", "F#m/A:third", "F#m/C#:fifth"]);
    expect(chords("Ab").slice(0, 3)).toEqual(["Ab:root", "Ab/C:third", "Ab/Eb:fifth"]);
  });

  test("a seventh has a 3rd inversion; the bass written is replaced, the rest of the symbol kept", () => {
    expect(chords("G7/B")).toEqual(["G7:root", "G7/B:third", "G7/D:fifth", "G7/F:seventh"]);
    expect(chords("Cmaj7")[3]).toBe("Cmaj7/B:seventh");
    expect(chords("Bm7b5")).toEqual(["Bm7b5:root", "Bm7b5/D:third", "Bm7b5/F:fifth", "Bm7b5/A:seventh"]);
    expect(chords("(C)")[1]).toBe("(C/E):third");
  });

  test("then the key's other notes, walking up from the chord's root", () => {
    expect(chords("C", "G").slice(3)).toEqual(["C/D:key", "C/F#:key", "C/A:key", "C/B:key"]);
    expect(chords("G", "G").slice(3)).toEqual(["G/A:key", "G/C:key", "G/E:key", "G/F#:key"]);
    expect(chords("F", "F").slice(3).map((one) => one.split(":")[0])).toEqual(["F/G", "F/Bb", "F/D", "F/E"]);
  });

  test("sus and power chords, and something that isn't a chord", () => {
    expect(chords("Dsus4")).toEqual(["Dsus4:root", "Dsus4/G:third", "Dsus4/A:fifth"]);
    expect(chords("E5")).toEqual(["E5:root", "E5/B:fifth"]);
    expect(chordBassOptions("N.C.")).toEqual([]);
    expect(chordBassOptions("hello")).toEqual([]);
  });
});
