import { hzToMidi, noteName, octaveOf, parseNoteName } from "./notes.js";
import { findTuning, TUNINGS, type InstrumentId, type Tuning } from "../chords/shapes.js";

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

/** A chord diagrams' tuning (issue #355) as the tuner lists it: the same ID, its strings named (in flats when it's tuned down). */
function tunerTuningOf(tuning: Tuning): TunerTuning {
  const flats = tuning.id === "half-step-down";
  return { id: tuning.id, strings: tuning.strings.map((midi) => `${noteName(midi, flats)}${octaveOf(midi)}`) };
}

// The tuner's own names for tunings before it shared the chord diagrams' (kept on devices).
const OLD_TUNER_IDS: Record<string, string> = { dropD: "drop-d", openG: "open-g", openD: "open-d", openE: "open-e", halfDown: "half-step-down", fullDown: "whole-step-down", lowG: "low-g" };

/**
 * The guitar and ukulele tunings are the chord diagrams' (TUNINGS), so a song's
 * tuning is one the tuner knows; a player's own ("custom:...") is tuned to as well.
 */
export const TUNER_INSTRUMENTS: TunerInstrument[] = [
  { id: "chromatic", tunings: [] },
  { id: "guitar", tunings: TUNINGS.guitar.map((tuning) => tunerTuningOf(tuning)) },
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
  { id: "ukulele", tunings: TUNINGS.ukulele.map((tuning) => tunerTuningOf(tuning)) },
  { id: "violin", tunings: [{ id: "standard", strings: ["G3", "D4", "A4", "E5"] }] },
  { id: "viola", tunings: [{ id: "standard", strings: ["C3", "G3", "D4", "A4"] }] },
  { id: "cello", tunings: [{ id: "standard", strings: ["C2", "G2", "D3", "A3"] }] },
];

export function tunerInstrument(id: string | null | undefined): TunerInstrument {
  return TUNER_INSTRUMENTS.find((instrument) => instrument.id === id) ?? TUNER_INSTRUMENTS[0]!;
}

/** The tuning of `instrument` by id (a player's own too, on a guitar or a ukulele), else its first; null for chromatic. */
export function tunerTuning(instrument: TunerInstrument, id: string | null | undefined): TunerTuning | null {
  const wanted = id ? (OLD_TUNER_IDS[id] ?? id) : id;
  const listed = instrument.tunings.find((tuning) => tuning.id === wanted);
  if (listed) return listed;
  if (wanted && (instrument.id === "guitar" || instrument.id === "ukulele")) {
    const own = findTuning(instrument.id as InstrumentId, wanted);
    if (own) return tunerTuningOf(own);
  }
  return instrument.tunings[0] ?? null;
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
