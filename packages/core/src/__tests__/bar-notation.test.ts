import { describe, expect, test } from "vite-plus/test";
import { readBarNotation } from "../chords-over-lyrics/bar-notation.js";
import { detectImportFormat } from "../import-detection/detect-format.js";
import { barLinesFromRhythm } from "../song-document/bar-lines.js";
import { songFromText } from "../song-document/text.js";

/** Each bar's chords as "G:1", by name. */
function barsOf(section: ReturnType<typeof songFromText>["sections"][number]) {
  const names = new Map(section.lines.flatMap((line) => line.chords.map((chord) => [chord.id, chord.raw])));
  return section.rhythm?.bars.map((bar) => bar.chords.map((chord) => `${names.get(chord.chordId)}:${chord.beat}`).join(" ")) ?? null;
}

describe("bar notation (issue #344)", () => {
  test("a bar per cell, its chord on the first beat", () => {
    expect(readBarNotation("| G | C | D | G |")).toEqual({
      chords: ["G", "C", "D", "G"],
      bars: [0, 1, 2, 3].map((index) => ({ chords: [{ index, beat: 1 }] })),
    });
  });

  test("beat marks place the chords; repeat signs are bar lines; x2 plays it twice", () => {
    const notation = readBarNotation("||: Em . . . | C . D . :|| x2")!;
    expect(notation.chords).toEqual(["Em", "C", "D", "Em", "C", "D"]);
    expect(notation.bars.map((bar) => bar.chords.map((chord) => chord.beat))).toEqual([[1], [1, 3], [1], [1, 3]]);
  });

  test("% carries one chord on, and plays several again; unmarked chords are spread over the bar", () => {
    const notation = readBarNotation("| G | % | C D | % |")!;
    expect(notation.chords).toEqual(["G", "C", "D", "C", "D"]);
    expect(notation.bars.map((bar) => bar.chords.map((chord) => chord.beat))).toEqual([[1], [], [1, 3], [1, 3]]);
  });

  test("not bar notation: words between the bar lines, or no bar line first", () => {
    expect(readBarNotation("| this is | not chords |")).toBeNull();
    expect(readBarNotation("G | C |")).toBeNull();
    expect(readBarNotation("| |")).toBeNull();
  });

  test("an instrumental written in bars is imported with them, in either format", () => {
    for (const [text, format] of [
      ["Intro\n| G | C | D | G |", "CHORDS_OVER_LYRICS"],
      ["{start_of_intro}\n| [G] | [C] | [D] | [G] |\n{end_of_intro}", "CHORDPRO"],
    ] as const) {
      const [intro] = songFromText(text, format, { mergeRepeats: true }).sections;
      expect(intro!.type).toBe("intro");
      expect(intro!.lines.map((line) => [line.text, line.chords.map((chord) => chord.raw)])).toEqual([["", ["G", "C", "D", "G"]]]);
      expect(barsOf(intro!)).toEqual(["G:1", "C:1", "D:1", "G:1"]);
      // The editor shows a bar line before each chord.
      expect(barLinesFromRhythm(intro!)[intro!.lines[0]!.id]!.map((mark) => mark.chordsBefore)).toEqual([0, 1, 2, 3]);
    }
  });

  test("bars among words: a line of chords alone, without a rhythm", () => {
    const [verse] = songFromText("{start_of_verse}\n[G]Words\n| G | C |\n{end_of_verse}", "CHORDPRO").sections;
    expect(verse!.rhythm).toBeNull();
    expect(verse!.lines.map((line) => line.chords.map((chord) => chord.raw))).toEqual([["G"], ["G", "C"]]);
  });

  test("a line of chords alone keeps its spacing (chords over lyrics)", () => {
    const [section] = songFromText("Interlude\nG     C     D", "CHORDS_OVER_LYRICS").sections;
    expect(section!.lines.map((line) => line.chords.map((chord) => chord.at))).toEqual([[0, 6, 12]]);
  });

  test("bar notation counts as chords when the format is guessed", () => {
    expect(detectImportFormat("Intro\n| G | C | D | G |\n\nVerse\nG    C\nwords here")).toBe("CHORDS_OVER_LYRICS");
  });
});
