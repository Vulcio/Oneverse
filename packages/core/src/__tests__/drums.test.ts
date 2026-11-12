import { describe, expect, it } from "vite-plus/test";
import { songDocumentFromText } from "../song-document/text.js";
import { renderChart } from "../song-document/render.js";
import { chartBars } from "../song-document/bars.js";
import { beatLightsUp, drumsBeatAt, drumsSections, drumsWordsAt } from "../song-document/drums.js";

const SONG = `{time: 4/4}
{start_of_intro}
[G] [C]
{end_of_intro}
{start_of_verse}
[G]Amazing grace how [C]sweet the sound
[G]That saved a wretch like [D]me
{end_of_verse}
{start_of_chorus}
[C]I once was [G]lost
{end_of_chorus}
`;
const document = songDocumentFromText(null, { content: SONG, format: "CHORDPRO" });
const chart = renderChart(document);
const bars = chartBars(chart, document);

describe("the Drums view (issue #107)", () => {
  it("lists the passes with their bars and first words", () => {
    const sections = drumsSections(chart, bars);
    expect(sections.map((one) => `${one.type}:${one.bars}:${one.firstWords ?? "-"}`)).toEqual(["intro:2:-", "verse:4:Amazing grace how sweet the sound", "chorus:2:I once was lost"]);
  });

  it("finds the beat: its bar, pass and place in the bar; the count-in counts the first bar's beats", () => {
    expect(drumsBeatAt(bars, 0)).toEqual({ bar: 0, passIndex: 0, barInPass: 1, barsInPass: 2, beat: 0, beats: 4, countIn: false });
    expect(drumsBeatAt(bars, 9.5)).toMatchObject({ bar: 2, passIndex: 1, barInPass: 1, beat: 1 });
    expect(drumsBeatAt(bars, -3)).toMatchObject({ bar: null, beat: 1, countIn: true });
    expect(drumsBeatAt(bars, 1000)).toBeNull();
    expect(drumsBeatAt([], 0)).toBeNull();
  });

  it("the words around a bar: the line being sung and the next, the next section's first words at the end", () => {
    expect(drumsWordsAt(chart, bars, 2, 1)).toEqual({ now: "Amazing grace how sweet the sound", next: "That saved a wretch like me" });
    expect(drumsWordsAt(chart, bars, 5, 1)).toEqual({ now: "That saved a wretch like me", next: "I once was lost" });
    expect(drumsWordsAt(chart, bars, 0, 0)).toEqual({ now: null, next: "Amazing grace how sweet the sound" });
    expect(drumsWordsAt(chart, bars, null, 2)).toEqual({ now: "I once was lost", next: null });
  });

  it("lights every beat, the accents only, or the accents and medium beats", () => {
    expect(["accent", "medium", "normal", "mute"].map((level) => beatLightsUp(level as never, "every"))).toEqual([true, true, true, true]);
    expect(["accent", "medium", "normal", "mute"].map((level) => beatLightsUp(level as never, "accents"))).toEqual([true, false, false, false]);
    expect(["accent", "medium", "normal", "mute"].map((level) => beatLightsUp(level as never, "strong"))).toEqual([true, true, false, false]);
  });
});
