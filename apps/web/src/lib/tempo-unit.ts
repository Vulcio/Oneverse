import { defaultTempoUnit, TIME_SIGNATURE_PATTERN, type TempoUnit } from "@oneverse/core";

/** A tempo note's words in the locale files (issue #377): "1/4." is `metronome.unit_4d`. */
export function tempoUnitKey(unit: TempoUnit): `metronome.unit_${string}` {
  return `metronome.unit_${unit.slice(2).replace(".", "d")}`;
}

/** "71 BPM", with its note when it isn't a quarter: "71 BPM · 1/4." */
export function tempoText(tempo: number, unit: TempoUnit | null | undefined, timeSignature?: { numerator: number; denominator: number } | null): string {
  const note = unit ?? defaultTempoUnit(timeSignature);
  return note === "1/4" ? `${tempo} BPM` : `${tempo} BPM · ${note}`;
}

/** The note a song's tempo counts when it doesn't say, from its time signature as typed ("6/8"). */
export function usualTempoUnit(timeSignature: string): TempoUnit {
  const match = TIME_SIGNATURE_PATTERN.exec(timeSignature.trim());
  return defaultTempoUnit(match ? { numerator: Number(match[1]), denominator: Number(match[2]) } : null);
}
