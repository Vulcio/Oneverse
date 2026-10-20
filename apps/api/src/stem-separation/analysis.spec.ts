import { describe, expect, it } from "vite-plus/test";
import { detailsWithAnalysis, type SourceDetails } from "./analysis.js";

const none: SourceDetails = { recordingKey: null, recordingTempo: null, recordingTimeSignature: null, recordingFirstBeat: null, recordingFreeIntro: false, recordingBeats: [], recordingDownbeats: [], cuePoints: null };
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
});
