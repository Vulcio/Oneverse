import { describe, expect, it } from "vite-plus/test";
import { detectMpm, detectYin, nearestNote, nearestString, parseNoteName, TUNER_SENSITIVITY_GATES, TunerSession, temperamentOffsets, tunerInstrument, tunerTuning } from "../tuner/index.js";

const FRAME = 4096;
const cents = (hz: number, target: number) => 1200 * Math.log2(hz / target);

/** A string-like tone: up to eight partials below Nyquist, falling off as 1/h, with optional noise from a fixed seed. */
function tone(hz: number, sampleRate: number, { noise = 0, gain = 1 } = {}): Float32Array {
  let seed = 1;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    let sum = 0;
    for (let h = 1; h <= 8 && hz * h < sampleRate / 2; h++) sum += Math.sin((2 * Math.PI * hz * h * i) / sampleRate + h) / h;
    out[i] = gain * 0.15 * sum + noise * random();
  }
  return out;
}

const NOTES = { A0: 27.5, B0: 30.87, E1: 41.2, E2: 82.41, G3: 196, A4: 440, E5: 659.26, C6: 1046.5, A6: 1760, C7: 2093 };

describe("the tuner's detectors (issue #3)", () => {
  for (const [name, detect] of [["MPM", detectMpm], ["YIN", detectYin]] as const) {
    for (const sampleRate of [44100, 48000]) {
      it(`${name} at ${sampleRate} Hz reads A0 to C7 within 0.1 cents`, () => {
        for (const [note, hz] of Object.entries(NOTES)) {
          const { frequency } = detect(tone(hz, sampleRate), sampleRate);
          expect(frequency, note).not.toBeNull();
          expect(Math.abs(cents(frequency!, hz)), note).toBeLessThan(0.1);
        }
      });
    }

    it(`${name} never shows a wrong note in light noise`, () => {
      for (const [note, hz] of Object.entries(NOTES)) {
        if (hz < 40) continue;
        const { frequency } = detect(tone(hz, 48000, { noise: 0.03 }), 48000);
        if (frequency !== null) expect(Math.abs(cents(frequency, hz)), note).toBeLessThan(5);
      }
    });

    it(`${name}: silence is nothing; a quiet note is heard only at a high sensitivity`, () => {
      expect(detect(new Float32Array(FRAME), 48000).frequency).toBeNull();
      const quiet = tone(440, 48000, { gain: 0.03 });
      expect(detect(quiet, 48000, TUNER_SENSITIVITY_GATES.normal).frequency).toBeNull();
      expect(Math.abs(cents(detect(quiet, 48000, TUNER_SENSITIVITY_GATES.max).frequency!, 440))).toBeLessThan(0.5);
    });
  }

  it("YIN in heavy noise: the right note, not one octaves below", () => {
    for (const hz of [196, 440, 1046.5]) {
      const { frequency } = detectYin(tone(hz, 48000, { noise: 0.1 }), 48000);
      if (frequency !== null) expect(Math.abs(cents(frequency, hz))).toBeLessThan(10);
    }
  });
});

describe("the tuner's notes (issue #3)", () => {
  it("names to MIDI, octaves crossing at C", () => {
    expect(parseNoteName("A4")).toBe(69);
    expect(parseNoteName("E2")).toBe(40);
    expect(parseNoteName("Bb3")).toBe(58);
    expect(parseNoteName("Cb4")).toBe(59);
    expect(parseNoteName("B#3")).toBe(60);
    expect(parseNoteName("H2")).toBeNull();
  });

  it("the nearest note and cents, against the concert pitch", () => {
    expect(nearestNote(440)).toMatchObject({ midi: 69 });
    expect(nearestNote(445).cents).toBeCloseTo(19.56, 1);
    expect(nearestNote(432, { a4: 432 }).cents).toBeCloseTo(0, 6);
    expect(nearestNote(82.41).midi).toBe(40);
  });

  it("temperaments from the key: Just's major third is 13.7 cents flat, in G as in C", () => {
    expect(temperamentOffsets("equal").every((offset) => offset === 0)).toBe(true);
    expect(temperamentOffsets("just")[4]).toBeCloseTo(-13.69, 1);
    // B in G major (a pure third above G) reads in tune 13.7 cents below equal.
    const b = 493.88 * 2 ** (-13.69 / 1200);
    expect(nearestNote(b, { temperament: "just", tonic: 7 })).toMatchObject({ midi: 71 });
    expect(nearestNote(b, { temperament: "just", tonic: 7 }).cents).toBeCloseTo(0, 1);
    // The same B in C (its major seventh) is 2 cents off.
    expect(Math.abs(nearestNote(b, { temperament: "just", tonic: 0 }).cents)).toBeGreaterThan(1.5);
    expect(temperamentOffsets("pythagorean")[7]).toBeCloseTo(1.955, 2);
    expect(temperamentOffsets("meantone")[4]).toBeCloseTo(-13.69, 1);
  });

  it("instruments: the string being tuned, within a semitone", () => {
    const guitar = tunerTuning(tunerInstrument("guitar"), "standard")!;
    expect(nearestString(110.5, guitar.strings)).toBe(1);
    expect(nearestString(330, guitar.strings)).toBe(5);
    expect(nearestString(127, guitar.strings)).toBe(-1);
    expect(tunerTuning(tunerInstrument("chromatic"), null)).toBeNull();
    expect(tunerTuning(tunerInstrument("bass"), "dropA5")!.strings[0]).toBe("A0");
  });
});

describe("the tuner's session (issue #3)", () => {
  it("holds the last reading through a fading note, until released", () => {
    const session = new TunerSession("mpm");
    for (let i = 0; i < 3; i++) expect(session.push(tone(440, 48000), 48000).live).toBe(true);
    const faded = session.push(new Float32Array(FRAME), 48000);
    expect(faded.live).toBe(false);
    expect(Math.abs(cents(faded.hz!, 440))).toBeLessThan(0.1);
    session.release();
    expect(session.push(new Float32Array(FRAME), 48000).hz).toBeNull();
  });

  it("a new note shows at once, not after the median catches up", () => {
    const session = new TunerSession("mpm");
    for (let i = 0; i < 6; i++) session.push(tone(440, 48000), 48000);
    expect(Math.abs(cents(session.push(tone(330, 48000), 48000).hz!, 330))).toBeLessThan(0.1);
  });
});
