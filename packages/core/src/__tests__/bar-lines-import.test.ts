import { describe, expect, test } from "vite-plus/test";
import { isChordsOnly } from "../chords/chord-token.js";
import { barLinesFromRhythm } from "../song-document/bar-lines.js";
import { songDocumentFromText, songFromText } from "../song-document/text.js";
import { parseSongDocumentV2 } from "../schemas/song-document-v2.js";

type Section = ReturnType<typeof songFromText>["sections"][number];

/** Each bar's chords as "G:1", by name. */
function barsOf(section: Section) {
  const names = new Map(section.lines.flatMap((line) => line.chords.map((chord) => [chord.id, chord.raw])));
  return section.rhythm?.bars.map((bar) => bar.chords.map((chord) => `${names.get(chord.chordId)}:${chord.beat}`).join(" ")) ?? null;
}

const words = (section: Section) => section.lines.map((line) => [line.text, line.chords.map((chord) => `${chord.raw}@${chord.at}`).join(" ")]);

describe("bar lines over the words (issue #460)", () => {
  const chart = ["Verse 1", "|C#m        B          |E/G#       A", " Je veux te louer      Seigneur de tout"].join("\n");

  test("a line of chords with bar lines is a chord line", () => {
    expect(isChordsOnly("|C#m    B     |E/G#    A")).toBe(true);
    expect(isChordsOnly("C#m |B |E")).toBe(true);
    expect(isChordsOnly("|this is| words")).toBe(false);
  });

  for (const format of ["CHORDS_OVER_LYRICS", "CHORDPRO"] as const) {
    test(`chords over their words, each bar line starting a bar (${format})`, () => {
      const [verse] = songFromText(chart, format, { mergeRepeats: true }).sections;
      // The chords sit over their words; the bar lines aren't chords.
      expect(words(verse!)).toEqual([[" Je veux te louer      Seigneur de tout", "C#m@1 B@12 E/G#@23 A@35"]]);
      // Two bars: the chord after "|" on beat 1, the bar shared evenly, as a lead sheet means it.
      expect(barsOf(verse!)).toEqual(["C#m:1 B:3", "E/G#:1 A:3"]);
      // The Editor shows the bar lines where they were written.
      expect(barLinesFromRhythm(verse!)[verse!.lines[0]!.id]!.map((mark) => mark.at)).toEqual([1, 23]);
    });
  }

  test("a bar line in the middle of the chords, words before the first: a bar of their own", () => {
    const [section] = songFromText("G         |C       D\nAmazing grace how sweet the", "CHORDS_OVER_LYRICS").sections;
    expect(barsOf(section!)).toEqual(["G:1", "C:1 D:3"]);
  });

  test("a closing bar line, then the next line's: one bar line", () => {
    const [section] = songFromText("|G      C     |\nAmazing grace how\n|D      G     |\nsweet the sound", "CHORDS_OVER_LYRICS").sections;
    expect(barsOf(section!)).toEqual(["G:1 C:3", "D:1 G:3"]);
  });

  test("in 3/4, a bar has three beats", () => {
    const [section] = songFromText("{time: 3/4}\n|G         C   |D\nAmazing grace how sweet", "CHORDPRO").sections;
    expect(barsOf(section!)).toEqual(["G:1 C:3", "D:1"]);
  });

  test("without a time signature in the text, bars of the song's", () => {
    const doc = songDocumentFromText({ $schema: "song-document/v2", revision: 1, defaults: { timeSignature: { numerator: 3, denominator: 4 } }, sections: [], flow: [] }, { content: "|G         C   |D\nAmazing grace how sweet", format: "CHORDS_OVER_LYRICS" });
    expect(barsOf(doc.sections[0]!)).toEqual(["G:1 C:3", "D:1"]);
  });

  test("bars of chords alone, under a heading, stay an instrumental's bars", () => {
    const [intro, verse] = songFromText("Intro\n| G . C . | D . . . |\n\nVerse\n|G      C\nAmazing grace", "CHORDS_OVER_LYRICS").sections;
    expect(barsOf(intro!)).toEqual(["G:1 C:3", "D:1"]);
    expect(words(verse!)).toEqual([["Amazing grace", "G@0 C@8"]]);
    expect(barsOf(verse!)).toEqual(["G:1 C:3"]);
  });

  test("a line without bar lines among lines with them: a bar per chord", () => {
    const [section] = songFromText("|G      C\nAmazing grace\nD        G\nhow sweet the", "CHORDS_OVER_LYRICS").sections;
    expect(barsOf(section!)).toEqual(["G:1 C:3", "D:1", "G:1"]);
  });

  test("inline ChordPro: [|] is a bar line", () => {
    const [section] = songFromText("{start_of_verse}\n[|][G]Amazing [C]grace [|][D]how sweet\n{end_of_verse}", "CHORDPRO").sections;
    expect(words(section!)).toEqual([["Amazing grace how sweet", "G@0 C@8 D@14"]]);
    expect(barsOf(section!)).toEqual(["G:1 C:3", "D:1"]);
  });

  test("a verse number dropped moves the bar lines with the chords", () => {
    const [verse] = songFromText("Verse 2\n  |G      |C\n2. Amazing grace", "CHORDS_OVER_LYRICS", { mergeRepeats: true }).sections;
    expect(words(verse!)).toEqual([["Amazing grace", "G@0 C@8"]]);
    expect(barLinesFromRhythm(verse!)[verse!.lines[0]!.id]!.map((mark) => mark.at)).toEqual([0, 8]);
  });

  test("the song's text replaced keeps its bars, pointing at the IDs the lines took back", () => {
    const first = songDocumentFromText(null, { content: chart, format: "CHORDS_OVER_LYRICS" });
    const again = songDocumentFromText(first, { content: chart.replace("tout", "tout mon coeur"), format: "CHORDS_OVER_LYRICS" });
    const [verse] = again.sections;
    expect(verse!.lines[0]!.id).toBe(first.sections[0]!.lines[0]!.id);
    expect(barsOf(verse!)).toEqual(["C#m:1 B:3", "E/G#:1 A:3"]);
    expect(() => parseSongDocumentV2(again)).not.toThrow();
  });
});

describe("ChordPro grid sections (issue #460)", () => {
  test("a grid's bars, with its shape, margins, end bar, shared beats and repeated bars", () => {
    const text = [
      '{start_of_grid shape="1+4x2+4"}',
      "Intro || G . . . | C~D . . . | %% | |",
      "      | Em . D . |. to the verse",
      "{end_of_grid}",
    ].join("\n");
    const [grid] = songFromText(text, "CHORDPRO").sections;
    expect(grid!.type).toBe("instrumental");
    expect(grid!.label).toBeNull();
    expect(barsOf(grid!)).toEqual(["G:1", "C:1 D:1.5", "", "C:1 D:1.5", "Em:1 D:3"]);
  });

  test("first and second endings are bar lines, read as written", () => {
    const [grid] = songFromText("{start_of_grid}\n|: G . . . |1 C . . . :|2 D . . . |.\n{end_of_grid}", "CHORDPRO").sections;
    expect(barsOf(grid!)).toEqual(["G:1", "C:1", "D:1"]);
  });
});
