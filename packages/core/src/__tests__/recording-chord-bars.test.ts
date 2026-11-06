import { describe, expect, test } from "vite-plus/test";
import {
  chordDifferences,
  cuesFromChords,
  downbeatShift,
  recordingBars,
  recordingChordSymbol,
  recordingSteps,
  shiftDownbeats,
  suggestedSectionBars,
} from "../recording/chord-bars.js";
import type { RecordingChord, RecordingChordQuality } from "../recording/chords.js";
import type { ChartBar } from "../song-document/bars.js";

const BEAT = 0.5;
const NOTES: Record<string, number> = { C: 0, "C#": 1, D: 2, Eb: 3, E: 4, F: 5, "F#": 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

/** "Em" → its root and quality. */
function chordOf(symbol: string): { root: number; quality: RecordingChordQuality } {
  const minor = symbol.endsWith("m");
  return { root: NOTES[minor ? symbol.slice(0, -1) : symbol]!, quality: minor ? "min" : "maj" };
}

/** A recording at 120 BPM in 4/4 from 0:00: one chord per bar ("-" for none), each moved `steps` semitones. */
function recordingOf(bars: string[], steps = 0, late = 0) {
  const beats = Array.from({ length: bars.length * 4 + 1 }, (_, i) => i * BEAT);
  const downbeats = bars.map((_, i) => i * 4 * BEAT);
  const chords: RecordingChord[] = [];
  bars.forEach((symbol, i) => {
    if (symbol === "-") return;
    const { root, quality } = chordOf(symbol);
    const start = i * 4 * BEAT + late;
    const last = chords.at(-1);
    if (last && last.end === start && last.root === (root + steps) % 12 && last.quality === quality) last.end = start + 4 * BEAT;
    else chords.push({ start, end: start + 4 * BEAT, root: (root + steps + 12) % 12, quality });
  });
  return { map: { beats, downbeats }, chords };
}

/** A chart's bars, one chord on beat 1 of each, through passes of sections. */
function chartOf(passes: { sectionId: string; bars: string[] }[]): ChartBar[] {
  const out: ChartBar[] = [];
  let start = 0;
  passes.forEach((pass, passIndex) =>
    pass.bars.forEach((symbol, barInPass) => {
      const id = `${pass.sectionId}-${barInPass}`;
      out.push({
        index: out.length,
        passIndex,
        passId: `p${passIndex}`,
        sectionId: pass.sectionId,
        barInPass,
        barsInPass: pass.bars.length,
        beats: 4,
        start,
        tempo: 120,
        chords: [{ id, beat: 1, label: symbol, sounding: symbol, family: null }],
        carried: null,
        lineId: null,
        lyricAt: null,
        fromRhythm: false,
        beatAnchors: [],
      });
      start += 4;
    }),
  );
  return out;
}

const VERSE = ["G", "C", "G", "D"];
const CHORUS = ["C", "G", "D", "Em"];

describe("a recording's chords in its bars (issue #393)", () => {
  test("spelled in the song's key, moved to it", () => {
    expect(recordingChordSymbol({ root: 1, quality: "min" }, { key: "E" })).toBe("C#m");
    expect(recordingChordSymbol({ root: 1, quality: "min" }, { key: "Ab" })).toBe("Dbm");
    expect(recordingChordSymbol({ root: 0, quality: "maj", bass: 4 }, { steps: 2, key: "D" })).toBe("D/F#");
    expect(recordingChordSymbol({ root: 10, quality: "hdim7" }, { key: "F" })).toBe("Bbm7b5");
    expect(recordingChordSymbol({ root: 7, quality: "7" })).toBe("G7");
    expect(recordingSteps("E", "D")).toBe(2);
    expect(recordingSteps("C", "A")).toBe(3);
    expect(recordingSteps("C", "E")).toBe(-4);
    expect(recordingSteps("Bbm", "C")).toBe(-2);
    expect(recordingSteps(null, "C")).toBeNull();
  });

  test("each bar with the chord on each beat and where it changes, a chord found a little late still on its beat", () => {
    const { map } = recordingOf(["-", "-"]);
    const chords: RecordingChord[] = [
      { start: 0.08, end: 1.1, root: 7, quality: "maj" },
      { start: 1.1, end: 4, root: 0, quality: "maj" },
    ];
    const bars = recordingBars(map, chords);
    expect(bars.map((bar) => bar.beats)).toEqual([4, 4]);
    expect(bars[0]!.onBeats.map((chord) => chord?.root ?? null)).toEqual([7, 7, 0, 0]);
    expect(bars[0]!.changes.map((change) => [change.beat, change.chord.root])).toEqual([
      [1, 7],
      [3, 0],
    ]);
    expect(bars[1]!.changes.map((change) => [change.beat, change.chord.root])).toEqual([[1, 0]]);
    expect(recordingBars({ beats: [0], downbeats: [0] }, chords)).toEqual([]);
  });

  test("each pass placed where its chords start: an intro, an instrumental and a chorus once more than written; the key found", () => {
    // The recording is two semitones under the chart (in F, the chart in G).
    const { map, chords } = recordingOf(["-", "-", ...VERSE, ...CHORUS, "Em", "Em", ...VERSE, ...CHORUS, ...CHORUS], -2);
    const chart = chartOf([
      { sectionId: "v", bars: VERSE },
      { sectionId: "c", bars: CHORUS },
      { sectionId: "v", bars: VERSE },
      { sectionId: "c", bars: CHORUS },
    ]);
    const found = cuesFromChords(chart, recordingBars(map, chords));
    expect(found).toEqual({
      steps: 2,
      agreement: 1,
      cues: [
        { at: 4, sectionId: "v" },
        { at: 12, sectionId: "c" },
        { at: 24, sectionId: "v" },
        { at: 32, sectionId: "c" },
      ],
    });
    // Given the key, the same.
    expect(cuesFromChords(chart, recordingBars(map, chords), { steps: 2 })?.cues).toEqual(found!.cues);
  });

  test("no cues when the recording plays something else, or the chart has too few chords", () => {
    const { map, chords } = recordingOf(["A", "Bb", "C#m", "F", "Ab", "B", "D", "Eb", "A", "Bb", "C#m", "F"]);
    const chart = chartOf([
      { sectionId: "v", bars: VERSE },
      { sectionId: "c", bars: CHORUS },
      { sectionId: "v", bars: VERSE },
    ]);
    expect(cuesFromChords(chart, recordingBars(map, chords), { steps: 0 })).toBeNull();
    expect(cuesFromChords(chartOf([{ sectionId: "v", bars: VERSE }]), recordingBars(map, chords))).toBeNull();
  });

  test("a section's bars from its passes, what most of them play, spelled in the song's key", () => {
    const { map, chords } = recordingOf(["-", ...VERSE, ...CHORUS, ...VERSE.slice(0, 3), "Bm", ...CHORUS, ...VERSE], -2);
    const bars = recordingBars(map, chords);
    const cues = [
      { at: 2, sectionId: "v" },
      { at: 10, sectionId: "c" },
      { at: 18, sectionId: "v" },
      { at: 26, sectionId: "c" },
      { at: 34, sectionId: "v" },
    ];
    const suggested = suggestedSectionBars(cues, bars, { steps: 2, key: "G" });
    expect(suggested.get("v")!.map((bar) => bar.chords.map((chord) => `${chord.beat}:${chord.symbol}`).join(" "))).toEqual(["1:G", "1:C", "1:G", "1:D"]);
    expect(suggested.get("c")!.map((bar) => bar.chords[0]!.symbol)).toEqual(CHORUS);
    expect(suggested.get("v")![0]!.beats).toBe(4);
  });

  test("a chart chord the recording plays as another chord most times, marked; extensions aside", () => {
    // The chorus's last bar is C in the recording, Em in the chart; its D is a D7 there.
    const played = ["-", ...VERSE, "C", "G", "D", "C", ...VERSE, "C", "G", "D", "C"];
    const { map, chords } = recordingOf(played);
    const seventh = chords.map((chord) => (chord.root === 2 ? { ...chord, quality: "7" as const } : chord));
    const chart = chartOf([
      { sectionId: "v", bars: VERSE },
      { sectionId: "c", bars: CHORUS },
      { sectionId: "v", bars: VERSE },
      { sectionId: "c", bars: CHORUS },
    ]);
    const cues = [
      { at: 2, sectionId: "v" },
      { at: 10, sectionId: "c" },
      { at: 18, sectionId: "v" },
      { at: 26, sectionId: "c" },
    ];
    expect(chordDifferences(chart, cues, recordingBars(map, seventh), { key: "G" })).toEqual([{ chordId: "c-3", sectionId: "c", chart: "Em", recording: "C", heard: 2, differs: 2 }]);
  });

  test("the bars' 1 moved where the chords change", () => {
    // Every chord changes on beat 2: the music's 1 is a beat later.
    const { map } = recordingOf(Array.from({ length: 12 }, () => "-"));
    const roots = [7, 0, 2, 4];
    const chords: RecordingChord[] = Array.from({ length: 11 }, (_, i) => ({ start: (i * 4 + 1) * BEAT, end: ((i + 1) * 4 + 1) * BEAT, root: roots[i % 4]!, quality: "maj" as const }));
    const bars = recordingBars(map, chords);
    expect(downbeatShift(bars)).toBe(1);
    const shifted = shiftDownbeats(map, 1);
    expect(shifted.downbeats.slice(0, 3)).toEqual([0.5, 2.5, 4.5]);
    expect(downbeatShift(recordingBars(shifted, chords))).toBe(0);
    // Changes on the 1: nothing to move.
    const { map: steady, chords: onOne } = recordingOf(["G", "C", "D", "Em", "G", "C", "D", "Em", "G", "C"]);
    expect(downbeatShift(recordingBars(steady, onOne))).toBe(0);
  });
});
