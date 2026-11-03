import { hzToMidi, parseNoteName } from "./notes.js";

/**
 * Instruments and their tunings for the tuner (issue #3): the open strings,
 * low to high. Chromatic has none: any note.
 */
export interface TunerTuning {
  id: string;
  strings: string[];
}

export interface TunerInstrument {
  id: string;
  tunings: TunerTuning[];
}

export const TUNER_INSTRUMENTS: TunerInstrument[] = [
  { id: "chromatic", tunings: [] },
  {
    id: "guitar",
    tunings: [
      { id: "standard", strings: ["E2", "A2", "D3", "G3", "B3", "E4"] },
      { id: "dropD", strings: ["D2", "A2", "D3", "G3", "B3", "E4"] },
      { id: "dadgad", strings: ["D2", "A2", "D3", "G3", "A3", "D4"] },
      { id: "openG", strings: ["D2", "G2", "D3", "G3", "B3", "D4"] },
      { id: "openD", strings: ["D2", "A2", "D3", "F#3", "A3", "D4"] },
      { id: "openE", strings: ["E2", "B2", "E3", "G#3", "B3", "E4"] },
      { id: "halfDown", strings: ["Eb2", "Ab2", "Db3", "Gb3", "Bb3", "Eb4"] },
      { id: "fullDown", strings: ["D2", "G2", "C3", "F3", "A3", "D4"] },
    ],
  },
  {
    id: "bass",
    tunings: [
      { id: "standard4", strings: ["E1", "A1", "D2", "G2"] },
      { id: "standard5", strings: ["B0", "E1", "A1", "D2", "G2"] },
      { id: "standard6", strings: ["B0", "E1", "A1", "D2", "G2", "C3"] },
      { id: "dropD4", strings: ["D1", "A1", "D2", "G2"] },
      { id: "dropA5", strings: ["A0", "E1", "A1", "D2", "G2"] },
    ],
  },
  {
    id: "ukulele",
    tunings: [
      { id: "standard", strings: ["G4", "C4", "E4", "A4"] },
      { id: "lowG", strings: ["G3", "C4", "E4", "A4"] },
      { id: "baritone", strings: ["D3", "G3", "B3", "E4"] },
    ],
  },
  { id: "violin", tunings: [{ id: "standard", strings: ["G3", "D4", "A4", "E5"] }] },
  { id: "viola", tunings: [{ id: "standard", strings: ["C3", "G3", "D4", "A4"] }] },
  { id: "cello", tunings: [{ id: "standard", strings: ["C2", "G2", "D3", "A3"] }] },
];

export function tunerInstrument(id: string | null | undefined): TunerInstrument {
  return TUNER_INSTRUMENTS.find((instrument) => instrument.id === id) ?? TUNER_INSTRUMENTS[0]!;
}

/** The tuning of `instrument` by id, else its first; null for chromatic. */
export function tunerTuning(instrument: TunerInstrument, id: string | null | undefined): TunerTuning | null {
  return instrument.tunings.find((tuning) => tuning.id === id) ?? instrument.tunings[0] ?? null;
}

/** Which open string `hz` is being tuned to: the nearest within a semitone, else -1. */
export function nearestString(hz: number, strings: readonly string[], a4?: number): number {
  const played = hzToMidi(hz, a4);
  let best = -1;
  let distance = Infinity;
  strings.forEach((name, index) => {
    const midi = parseNoteName(name);
    if (midi === null) return;
    const away = Math.abs(played - midi);
    if (away < distance) {
      distance = away;
      best = index;
    }
  });
  return distance < 1 ? best : -1;
}
