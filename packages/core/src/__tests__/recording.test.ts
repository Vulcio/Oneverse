import { describe, expect, it } from "vite-plus/test";
import { harmonyLetter, hasSound, partKind, speedCorrection, stemPartFromFilename, stemSpeed, transposesPart, type StemPart } from "../index.js";
import { alignTake, clapDelayFrom, clickTimes, encodeWav, mergeTake, multitracksOf, punchInAt, recordingPlan, roundTripFrom, spliceTake } from "../index.js";

describe("multitracks (issue #123)", () => {
  const file = (filename: string, stemPart: string | null, multitrackId: string | null, createdAt: string, multitrackName: string | null = null, type = "AUDIO") =>
    ({ type, filename, stemPart, multitrackId, multitrackName, createdAt }) as Parameters<typeof multitracksOf>[0][number];

  it("groups a song's parts: its original stems first, then the others as they were started; whole recordings and other files in none", () => {
    const groups = multitracksOf([
      file("b-vocals.wav", "VOCALS", "mtlater0001", "2026-03-01T00:00:00Z", "Acoustic"),
      file("drums.mp3", "DRUMS", null, "2026-01-01T00:00:00Z"),
      file("vocals.mp3", "VOCALS", null, "2026-01-01T00:00:00Z"),
      file("a-guitar.wav", "GUITAR", "mtearly0001", "2026-02-01T00:00:00Z"),
      file("b-drums.wav", "DRUMS", "mtlater0001", "2026-02-15T00:00:00Z"),
      file("whole-song.mp3", null, null, "2026-01-01T00:00:00Z"),
      file("chart.pdf", null, null, "2026-01-01T00:00:00Z", null, "PDF"),
    ]);
    expect(groups.map((group) => [group.id, group.name, group.files.map((f) => f.filename).join()])).toEqual([
      [null, null, "vocals.mp3,drums.mp3"],
      ["mtearly0001", null, "a-guitar.wav"],
      ["mtlater0001", "Acoustic", "b-vocals.wav,b-drums.wav"],
    ]);
  });
});

describe("recording a part (issue #123)", () => {
  it("a new multitrack starts with a bar of count-in; an existing one gets a bar before its first beat", () => {
    expect(recordingPlan({ tempo: 120, beatsPerBar: 4, firstBeat: null })).toEqual({ firstBeat: 2, lead: 0 });
    expect(recordingPlan({ tempo: 120, beatsPerBar: 4, firstBeat: 0.5 })).toEqual({ firstBeat: 0.5, lead: 1.5 });
    expect(recordingPlan({ tempo: 120, beatsPerBar: 3, firstBeat: 4 })).toEqual({ firstBeat: 4, lead: 0 });
  });

  it("clicks on every beat from the count-in, the first of each bar accented", () => {
    expect(clickTimes({ tempo: 120, beatsPerBar: 4, firstBeat: 0.5, from: -1.5, to: 2.5 })).toEqual([
      { at: -1.5, accent: true, level: "accent" },
      { at: -1, accent: false, level: "normal" },
      { at: -0.5, accent: false, level: "normal" },
      { at: 0, accent: false, level: "normal" },
      { at: 0.5, accent: true, level: "accent" },
      { at: 1, accent: false, level: "normal" },
      { at: 1.5, accent: false, level: "normal" },
      { at: 2, accent: false, level: "normal" },
      { at: 2.5, accent: true, level: "accent" },
    ]);
  });

  it("the click follows the metronome's pattern (issue #384): a group's first beat medium, a muted one silent but in the count-in", () => {
    const clicks = clickTimes({ tempo: 120, beatsPerBar: 6, firstBeat: 0, from: -3, to: 2.5, levels: ["accent", "normal", "mute", "medium", "normal", "normal"] });
    expect(clicks.map((click) => `${click.at}:${click.level}`)).toEqual(["-3:accent", "-2.5:normal", "-2:normal", "-1.5:medium", "-1:normal", "-0.5:normal", "0:accent", "0.5:normal", "1.5:medium", "2:normal", "2.5:normal"]);
  });

  it("a take lines up with the timeline: shifted by the round trip, silence before the first sample", () => {
    const captured = Float32Array.from({ length: 10 }, (_, i) => i + 1);
    // 10 samples a second; 0:00 played at 1.0 s, captured from 1.1 s, heard back 0.3 s later.
    expect([...alignTake(captured, { sampleRate: 10, capturedAt: 1.1, zeroAt: 1, delay: 0.3 })]).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect([...alignTake(captured, { sampleRate: 10, capturedAt: 1.5, zeroAt: 1, delay: 0.3, length: 4 })]).toEqual([0, 0, 1, 2]);
  });

  it("a WAV file: header, then 16-bit samples", () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 0.5]), 48000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4), ...wav.slice(8, 12))).toBe("RIFFWAVE");
    expect([view.getUint32(24, true), view.getUint16(22, true), view.getUint32(40, true)]).toEqual([48000, 1, 8]);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 16383]);
  });

  it("the round trip from clicks played and heard back; nothing when they weren't heard", () => {
    const sampleRate = 1000;
    const captured = new Float32Array(3000).map(() => (Math.random() - 0.5) * 0.004);
    const played = [0.5, 1.2, 2.0];
    // Each heard 87 ms after it was played, from a capture starting at 0.1 s.
    for (const at of played) for (let i = 0; i < 20; i++) captured[Math.round((at + 0.087 - 0.1) * sampleRate) + i] = 0.4 * (i % 2 ? -1 : 1);
    expect(roundTripFrom(captured, { sampleRate, capturedAt: 0.1, playedAt: played })).toBeCloseTo(0.087, 3);
    expect(roundTripFrom(new Float32Array(3000), { sampleRate, capturedAt: 0.1, playedAt: played })).toBeNull();
  });
});

describe("recording, step 2 (issue #127)", () => {
  it("a punch-in from a bar: that bar's start, with a bar of count-in", () => {
    expect(punchInAt({ tempo: 120, beatsPerBar: 4, firstBeat: 0.5, fromBar: 3 })).toEqual({ from: 4.5, lead: 2 });
    expect(punchInAt({ tempo: 120, beatsPerBar: 4, firstBeat: 0.5, fromBar: 1 })).toEqual({ from: 0, lead: 1.5 });
  });

  it("a punch-in keeps the old take up to the seam, crossfades, then the new one", () => {
    const old = new Float32Array(10).fill(1);
    const take = new Float32Array(12).fill(0.5);
    const spliced = spliceTake(old, take, 4, 2);
    expect([...spliced]).toEqual([1, 1, 1, 1, 0.875, 0.625, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    // A take shorter than the seam: the old one up to it.
    expect(spliceTake(old, new Float32Array(2), 4).length).toBe(4);
  });

  it("the delay from claps along with the clicks: their median lateness, an early clap counted too", () => {
    const sampleRate = 1000;
    const captured = new Float32Array(6000).map(() => (Math.random() - 0.5) * 0.004);
    const played = [0.5, 1.1, 1.7, 2.3, 2.9, 3.5];
    const late = [0.21, 0.19, 0.2, 0.25, 0.18, 0.2];
    played.forEach((at, i) => {
      for (let k = 0; k < 15; k++) captured[Math.round((at + late[i]!) * sampleRate) + k] = 0.5 * (k % 2 ? -1 : 1);
    });
    expect(clapDelayFrom(captured, { sampleRate, capturedAt: 0, playedAt: played })).toBeCloseTo(0.2, 2);
    expect(clapDelayFrom(new Float32Array(6000), { sampleRate, capturedAt: 0, playedAt: played })).toBeNull();
  });
});

describe("transposing the stems (issue #129)", () => {
  it("every part but the drums and cues, unless asked for all", () => {
    expect(["VOCALS", "BASS", "DRUMS", "CLICK", null].map((part) => transposesPart(part as StemPart | null))).toEqual([true, true, false, false, true]);
    expect(transposesPart("DRUMS", true)).toBe(true);
  });
});

describe("parts named for harmonies (issue #131)", () => {
  it("a harmony's voice from a file's name; the bass singers', not the instrument", () => {
    expect(["Grace - Soprano.wav", "alto.mp3", "Ténor harmony.opus", "Harmony - bass.wav", "Baryton.wav", "Bass.mp3", "Harmonies.mp3"].map(stemPartFromFilename)).toEqual([
      "HARMONY_SOPRANO",
      "HARMONY_ALTO",
      "HARMONY_TENOR",
      "HARMONY_BASS",
      "HARMONY_BASS",
      "BASS",
      "BACKING_VOCALS",
    ]);
  });

  it("each part a voice, an instrument or cues; harmonies lettered", () => {
    expect(["VOCALS", "HARMONY_ALTO", "BACKING_VOCALS", "GUITAR", "OTHER", "CLICK"].map((part) => partKind(part as StemPart))).toEqual(["VOICE", "VOICE", "VOICE", "INSTRUMENT", "INSTRUMENT", "CUES"]);
    expect(["HARMONY_SOPRANO", "HARMONY_BASS", "VOCALS", null].map((part) => harmonyLetter(part as StemPart | null))).toEqual(["S", "B", null, null]);
  });
});

describe("a take with sound in it (issue #134)", () => {
  it("silence throughout, or next to nothing, has none", () => {
    expect(hasSound(new Float32Array(48000), 48000)).toBe(false);
    expect(hasSound(Float32Array.from({ length: 1000 }, () => 0.5), 48000)).toBe(false);
    const take = new Float32Array(48000);
    take[20000] = 0.01;
    expect(hasSound(take, 48000)).toBe(true);
  });
});

describe("sections merged into one take (issue #141)", () => {
  it("a section replaces only the time it covers, crossfaded in and out; the rest kept", () => {
    const base = new Float32Array(12).fill(1);
    const take = new Float32Array(8).fill(0.5);
    expect([...mergeTake(base, take, 2, 2)]).toEqual([1, 1, 0.875, 0.625, 0.5, 0.5, 0.625, 0.875, 1, 1, 1, 1]);
  });

  it("without a base: silence either side, nothing faded; a section past the base's end lengthens it", () => {
    const take = Float32Array.from({ length: 6 }, (_, i) => i + 1);
    expect([...mergeTake(null, take, 3)]).toEqual([0, 0, 0, 4, 5, 6]);
    expect(mergeTake(new Float32Array(4), take, 3).length).toBe(6);
  });

  it("sections recorded one after another all stay", () => {
    const first = mergeTake(null, Float32Array.from({ length: 4 }, () => 0.25), 0, 1);
    const both = mergeTake(first, Float32Array.from({ length: 10 }, () => 0.75), 6, 1);
    // Crossfaded over a sample into what was there (silence), either end.
    expect([...both]).toEqual([0.25, 0.25, 0.25, 0.25, 0, 0, 0.375, 0.75, 0.75, 0.375]);
  });
});

describe("the stems' speed (issue #139)", () => {
  it("kept to 50-150%, by 5%", () => {
    expect([0.8, 0.83, 0.2, 3, Number.NaN, "1", 1.249].map(stemSpeed)).toEqual([0.8, 0.85, 0.5, 1.5, 1, 1, 1.25]);
  });
  it("the pitch played at a speed brought back: an octave up at half speed", () => {
    expect(speedCorrection(1)).toBe(0);
    expect(speedCorrection(0.5)).toBe(12);
    expect(speedCorrection(0.8)).toBeCloseTo(3.863, 3);
  });
});
