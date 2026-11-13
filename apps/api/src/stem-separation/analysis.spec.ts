import { describe, expect, it } from "vite-plus/test";
import { detailsWithAnalysis, recordingAnalysisOf, type SourceDetails } from "./analysis.js";

const none: SourceDetails = { recordingKey: null, recordingTempo: null, recordingTimeSignature: null, recordingFirstBeat: null, recordingFreeIntro: false, recordingBeats: [], recordingDownbeats: [], recordingChords: null, cuePoints: null };
const song = {
  sections: [
    { id: "sec_v", type: "verse", label: null, showLabel: true, lines: [] },
    { id: "sec_c", type: "chorus", label: null, showLabel: true, lines: [] },
  ],
  flow: [
    { id: "fi_v", sectionId: "sec_v" },
    { id: "fi_c", sectionId: "sec_c" },
  ],
} as never;
const analysis = {
  tempo: { bpm: 72.06, confidence: 0.9 },
  first_beat: 0.4204,
  time_signature: { numerator: 4, denominator: 4, confidence: 0.8 },
  key: { name: "G", confidence: 0.7 },
  sections: [
    { start: 0, label: "start" },
    { start: 8.3, label: "verse" },
    { start: 40.1, label: "chorus" },
  ],
};

describe("detailsWithAnalysis", () => {
  it("fills in what the recording lacks, each marked detected", () => {
    expect(detailsWithAnalysis(none, analysis, song)).toEqual({
      recordingKey: "G",
      recordingTempo: 72.1,
      recordingTimeSignature: "4/4",
      recordingFirstBeat: 0.42,
      recordingFreeIntro: false,
      recordingBeats: [],
      recordingDownbeats: [],
      recordingChords: null,
      cuePoints: [
        { at: 8.3, sectionId: "sec_v" },
        { at: 40.1, sectionId: "sec_c" },
      ],
      detected: ["key", "tempo", "timeSignature", "firstBeat", "sections"],
    });
  });

  it("never replaces what the recording has", () => {
    const own = { ...none, recordingKey: "A", recordingTempo: 80, cuePoints: [{ at: 1, sectionId: "sec_v" }] };
    const result = detailsWithAnalysis(own, analysis, song);
    expect(result.recordingKey).toBe("A");
    expect(result.recordingTempo).toBe(80);
    expect(result.cuePoints).toEqual([{ at: 1, sectionId: "sec_v" }]);
    expect(result.detected).toEqual(["timeSignature", "firstBeat"]);
  });

  it("leaves out what it isn't sure of, or what doesn't read", () => {
    const result = detailsWithAnalysis(none, { key: { name: "G", confidence: 0.3 }, tempo: { bpm: 900 }, time_signature: { numerator: 4, denominator: 3 } }, song);
    expect(result).toEqual({ ...none, detected: [] });
    expect(detailsWithAnalysis(none, { key: { name: "Q#" } }, song).detected).toEqual([]);
  });

  it("without an analysis, the recording's as they are", () => {
    expect(detailsWithAnalysis(none, undefined, song)).toEqual({ ...none, detected: [] });
  });

  // Issue #299: the recording's beats and bars, as a pair, when the analysis is sure of them.
  const beats = { beats: [0.42, 1.2504, 2.08, 2.91, 3.74], downbeats: [0.42, 3.74], beats_confidence: 0.8 };
  it("keeps the beats and bars it's sure of, marked detected", () => {
    const found = detailsWithAnalysis(none, { ...analysis, ...beats }, song);
    expect(found.recordingBeats).toEqual([0.42, 1.25, 2.08, 2.91, 3.74]);
    expect(found.recordingDownbeats).toEqual([0.42, 3.74]);
    expect(found.detected).toContain("beats");
  });
  it("leaves out beats it isn't sure of, or that don't read", () => {
    for (const wrong of [
      { ...beats, beats_confidence: 0.3 },
      { ...beats, beats: [0.42, 0.42, 1] },
      { ...beats, downbeats: [0.5] },
      { ...beats, beats: [0.42] },
      { ...beats, downbeats: null },
    ]) {
      const found = detailsWithAnalysis(none, { ...analysis, ...wrong }, song);
      expect(found.recordingBeats).toEqual([]);
      expect(found.detected).not.toContain("beats");
    }
  });
  it("keeps the recording's own beats, and a free intro only with a detected first beat", () => {
    const own = { ...none, recordingBeats: [1, 2], recordingDownbeats: [1] };
    expect(detailsWithAnalysis(own, { ...analysis, ...beats }, song).recordingBeats).toEqual([1, 2]);
    expect(detailsWithAnalysis(none, { ...analysis, ...beats, intro_free: true }, song).recordingFreeIntro).toBe(true);
    expect(detailsWithAnalysis({ ...none, recordingFirstBeat: 1 }, { ...analysis, ...beats, intro_free: true }, song).recordingFreeIntro).toBe(false);
  });

  // Issue #393: the recording's chords, suggestions, as the server found them.
  it("keeps the chords the server found, marked detected, unless the recording has its own", () => {
    const chords = [
      { start: 0, end: 0.5, label: "N" },
      { start: 0.5, end: 2.5, root: 7, quality: "maj", label: "G" },
      { start: 2.5, end: 4.5, root: 4, quality: "min", label: "E:min" },
    ];
    const found = detailsWithAnalysis(none, { chords }, song);
    expect(found.recordingChords).toEqual([
      { start: 0.5, end: 2.5, root: 7, quality: "maj" },
      { start: 2.5, end: 4.5, root: 4, quality: "min" },
    ]);
    expect(found.detected).toContain("chords");
    const own = [{ start: 0, end: 1, root: 0, quality: "maj" as const }];
    expect(detailsWithAnalysis({ ...none, recordingChords: own }, { chords }, song).recordingChords).toBe(own);
    expect(detailsWithAnalysis(none, { chords: [chords[1], { ...chords[2], root: 13 }] }, song).recordingChords).toBeNull();
  });

  it("places the sections by the pass of the song's words the server says each is (issue #450), the labels aside", () => {
    const hinted = {
      sections: [
        { start: 0, label: "intro" },
        { start: 8.3, label: "chorus", hint: 0, name: "Verse" },
        { start: 40.1, label: "verse", hint: 1, name: "Chorus" },
      ],
    };
    expect(detailsWithAnalysis(none, hinted, song, ["sec_v", "sec_c"]).cuePoints).toEqual([
      { at: 8.3, sectionId: "sec_v" },
      { at: 40.1, sectionId: "sec_c" },
    ]);
    // Without the passes sent (an older server, or none sent), by their labels.
    expect(detailsWithAnalysis(none, hinted, song).cuePoints).toEqual([
      { at: 8.3, sectionId: "sec_c" },
      { at: 40.1, sectionId: "sec_v" },
    ]);
  });
});

describe("recordingAnalysisOf (issue #452)", () => {
  it("keeps how sure it was and its alternatives, the likeliest first", () => {
    expect(
      recordingAnalysisOf({
        ...analysis,
        beats_confidence: 0.66,
        alternatives: {
          tempo: [{ bpm: 36.03, score: 0.4 }],
          time_signature: [
            { numerator: 3, denominator: 4, score: 0.3 },
            { numerator: 6, denominator: 8, score: 0.5 },
          ],
          first_beat: [{ start: 1.25, score: 0.2 }],
          key: [{ name: "Em", score: 0.6 }, { name: "nonsense", score: 0.5 }],
        },
      }),
    ).toEqual({
      confidence: { key: 0.7, tempo: 0.9, timeSignature: 0.8, beats: 0.66 },
      alternatives: {
        key: [{ value: "Em", score: 0.6 }],
        tempo: [{ value: 36, score: 0.4 }],
        timeSignature: [
          { value: "6/8", score: 0.5 },
          { value: "3/4", score: 0.3 },
        ],
        firstBeat: [{ value: 1.25, score: 0.2 }],
      },
    });
  });

  it("offers a value too unsure to be used, first", () => {
    const check = recordingAnalysisOf({ key: { name: "Bb", confidence: 0.3 }, alternatives: { key: [{ name: "Eb", score: 0.2 }] } });
    expect(check?.alternatives?.key).toEqual([
      { value: "Bb", score: 0.3 },
      { value: "Eb", score: 0.2 },
    ]);
    expect(detailsWithAnalysis(none, { key: { name: "Bb", confidence: 0.3 } }, null).recordingKey).toBeNull();
  });

  it("says what it was told, and nothing when nothing was said", () => {
    expect(recordingAnalysisOf({ time_signature: { numerator: 6, denominator: 8, confidence: 1 } }, { timeSignature: "6/8" })).toEqual({ confidence: { timeSignature: 1 }, hints: { timeSignature: "6/8" } });
    expect(recordingAnalysisOf({ first_beat: 0.5 })).toBeNull();
    expect(recordingAnalysisOf(null)).toBeNull();
  });
});
