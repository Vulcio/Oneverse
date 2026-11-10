import { describe, expect, it } from "vite-plus/test";
import { findArrangementProblems, type ArrangementDocumentV2 } from "../schemas/arrangement-document-v2.js";
import { chartSeconds, newArrangementDocument, renderChart, type RenderedPass } from "../song-document/render.js";
import { songDocumentFromText } from "../song-document/text.js";
import { barSeconds, chartBars, positionAtSeconds, scrollStops, secondsAtPosition } from "../song-document/bars.js";

const song = songDocumentFromText(null, {
  content:
    "{start_of_verse}\n[G]Amazing [Gmaj7]grace how [D/F#]sweet\n[Em]That saved a [C]wretch\n{end_of_verse}\n\n{start_of_chorus}\n[C]My chains are [G]gone\n{end_of_chorus}\n\n{chorus: Final chorus}\n",
  format: "CHORDPRO",
  defaults: { key: "G", tempo: 72 },
});
const [verse] = song.sections;
const chordOf = (s: number, l: number, c: number) => song.sections[s]!.lines[l]!.chords[c]!;
const labels = (pass: RenderedPass) => pass.lines.map((line) => line.chords.map((chord) => chord.label).join(" "));

let n = 0;
const arrangement = (change: (doc: ArrangementDocumentV2) => void = () => {}) => {
  const doc = newArrangementDocument(song, "sv_1", () => `ai_${++n}`);
  change(doc);
  return doc;
};

describe("renderChart", () => {
  it("draws the song as written, in the order it's sung", () => {
    const chart = renderChart(song);
    expect(chart.passes.map((pass) => pass.section.type)).toEqual(["verse", "chorus", "chorus"]);
    expect(chart.passes[2]!.label).toBe("Final chorus");
    expect(labels(chart.passes[0]!)).toEqual(["G Gmaj7 D/F#", "Em C"]);
    expect(chart).toMatchObject({ key: "G", capo: null, tempo: 72 });
    expect(chart.passes.every((pass) => !pass.differs && pass.problems.length === 0)).toBe(true);
  });

  it("a new arrangement starts as the song's order, with its own IDs", () => {
    const doc = arrangement();
    expect(doc.items.map((item) => item.sectionId)).toEqual(song.flow.map((item) => item.sectionId));
    expect(doc.items.map((item) => item.label ?? null)).toEqual([null, null, "Final chorus"]);
    expect(doc.items.every((item) => item.id.startsWith("ai_") && item.overrides.length === 0)).toBe(true);
    expect(doc.songRevision).toBe(song.revision);
  });

  it("transposes by the arrangement's key and the set's on top, and key changes add up from there", () => {
    const doc = arrangement((d) => {
      d.defaults.transposeSteps = 2;
      d.items[2]!.keyChange = { steps: 1, key: "Bb" };
    });
    const chart = renderChart(song, doc, { transposeSteps: -1 });
    expect(chart.key).toBe("Ab");
    expect(labels(chart.passes[0]!)).toEqual(["Ab Abmaj7 Eb/G", "Fm Db"]);
    expect(chart.passes[2]).toMatchObject({ keyChange: "A", key: "A" });
    expect(labels(chart.passes[2]!)).toEqual(["D A"]);
  });

  it("applies a pass's overrides - written in the song's key - and marks the pass", () => {
    const verseLine = verse!.lines[0]!;
    const doc = arrangement((d) => {
      d.defaults.transposeSteps = 2;
      d.items[0]!.overrides = [
        { type: "chord", chordId: chordOf(0, 0, 1).id, raw: "Bm" },
        { type: "hide_chord", chordId: chordOf(0, 0, 2).id },
        { type: "hide_line", lineId: verse!.lines[1]!.id },
        { type: "insert_line", afterLineId: verseLine.id, line: { id: "ins_line_1", kind: "lyric", text: "Oh", chords: [{ id: "ins_chd_1", at: 0, raw: "C" }] } },
        { type: "lyric", lineId: verseLine.id, text: "Amazing love", chordPositions: { [chordOf(0, 0, 1).id]: 8 } },
        { type: "performance_note", lineId: verseLine.id, note: "Softly" },
      ];
    });
    const pass = renderChart(song, doc).passes[0]!;
    expect(pass.differs).toBe(true);
    expect(pass.lines.map((line) => line.text)).toEqual(["Amazing love", "Oh"]);
    expect(pass.lines[0]).toMatchObject({ note: "Softly", lyricChanged: true });
    expect(pass.lines[0]!.chords).toEqual([
      { id: chordOf(0, 0, 0).id, at: 0, label: "A", sounding: "A", fretted: "A", family: "major", key: "A", replaced: false },
      { id: chordOf(0, 0, 1).id, at: 8, label: "C#m", sounding: "C#m", fretted: "C#m", family: "minor", key: "A", replaced: true },
    ]);
    expect(pass.lines[1]).toMatchObject({ inserted: true, chords: [{ id: "ins_chd_1", label: "D" }] });
    // The same section on another pass is untouched.
    expect(renderChart(song, doc).passes[1]!.differs).toBe(false);
  });

  it("a line added after a hidden line shows where it was; a note can go on an added line", () => {
    const [first, second] = verse!.lines;
    const doc = arrangement((d) => {
      d.items[0]!.overrides = [
        { type: "hide_line", lineId: first!.id },
        { type: "insert_line", afterLineId: first!.id, line: { id: "ins_line_2", kind: "lyric", text: "Instead", chords: [] } },
        { type: "performance_note", lineId: "ins_line_2", note: "Spoken" },
      ];
    });
    const pass = renderChart(song, doc).passes[0]!;
    expect(pass.lines.map((line) => line.text)).toEqual(["Instead", second!.text]);
    expect(pass.lines[0]!.note).toBe("Spoken");
    expect(pass.problems).toEqual([]);
    expect(findArrangementProblems(doc, song)).toEqual([]);
  });

  it("shows what no longer matches the song, and draws the rest", () => {
    const doc = arrangement((d) => {
      d.items[1]!.overrides = [
        { type: "hide_chord", chordId: "chd_gone" },
        { type: "performance_note", lineId: "line_gone", note: "?" },
      ];
    });
    const pass = renderChart(song, doc).passes[1]!;
    expect(pass.problems).toEqual(["chord chd_gone not found", "line line_gone not found"]);
    expect(labels(pass)).toEqual(["C G"]);
  });

  it("the player's view: hidden chords, simpler chords, no bass notes, capo shapes, solfège", () => {
    const doc = arrangement((d) => {
      d.defaults.capo = 2;
    });
    const hiddenGmaj7 = { hiddenChordIds: [chordOf(0, 0, 1).id] };
    expect(labels(renderChart(song, doc, { preferences: hiddenGmaj7 }).passes[0]!)[0]).toBe("G D/F#");
    expect(labels(renderChart(song, doc, { preferences: { simplifyChords: true, hideBassNotes: true } }).passes[0]!)[0]).toBe("G G D");
    // Capo 2 in G: the guitarist plays F shapes.
    expect(labels(renderChart(song, doc, { capoDisplay: "shapes" }).passes[0]!)).toEqual(["F Fmaj7 C/E", "Dm Bb"]);
    expect(labels(renderChart(song, doc, { notation: "solfege" }).passes[1]!)).toEqual(["Do Sol"]);
    expect(renderChart(song, doc).capo).toBe(2);
    // The song's own capo is a suggestion: used only when the arrangement sets none.
    expect(renderChart(song, null, { suggestedCapo: 5, capoDisplay: "shapes" }).capo).toBe(5);
    expect(renderChart(song, doc, { suggestedCapo: 5 }).capo).toBe(2);
  });
});

describe("chartSeconds", () => {
  it("is the song's duration when it has one", () => {
    expect(chartSeconds(renderChart(song), 245)).toBe(245);
  });

  it("otherwise its bars at each pass's tempo: two a sung line, a bar a chord", () => {
    // The verse's first line has three chords (three bars), the other three lines two: 9 bars of 4 beats at 72 BPM.
    expect(chartSeconds(renderChart(song))).toBeCloseTo((9 * 4 * 60) / 72);
    // A 3/4 bar is three beats; no tempo is 90 BPM.
    const waltz = songDocumentFromText(null, { content: "[G]One\n[D]Two\n", format: "CHORDPRO", defaults: { timeSignature: { numerator: 3, denominator: 4 } } });
    expect(chartSeconds(renderChart(waltz))).toBeCloseTo((2 * 6 * 60) / 90);
  });
});

describe("autoscroll's pace (issue #414)", () => {
  const chart = renderChart(song);
  const bars = chartBars(chart, song);

  it("gives each bar its time, stretched to the song's duration", () => {
    expect(barSeconds(chart, bars)).toEqual(bars.map(() => (4 * 60) / 72));
    const stretched = barSeconds(chart, bars, 90);
    expect(stretched.reduce((sum, one) => sum + one, 0)).toBeCloseTo(90);
    expect(stretched[0]).toBeCloseTo(10);
  });

  it("goes from seconds to beats and back", () => {
    const seconds = barSeconds(chart, bars, 90);
    expect(positionAtSeconds(bars, seconds, 0)).toBe(0);
    expect(positionAtSeconds(bars, seconds, 15)).toBeCloseTo(6);
    expect(positionAtSeconds(bars, seconds, 500)).toBe(36);
    expect(secondsAtPosition(bars, seconds, 6)).toBeCloseTo(15);
    expect(secondsAtPosition(bars, seconds, 36)).toBeCloseTo(90);
  });

  it("stops at each line in turn", () => {
    const stops = scrollStops(bars);
    expect(stops.map((stop) => [stop.passIndex, stop.start, stop.beats])).toEqual([
      [0, 0, 12],
      [0, 12, 8],
      [1, 20, 8],
      [2, 28, 8],
    ]);
    expect(stops[0]!.lineId).toBe(song.sections[0]!.lines[0]!.id);
  });
});
