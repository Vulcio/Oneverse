/**
 * What a recording's analysis said of what it found (issue #452), kept on
 * the stems so someone can check it: how sure it was of each detail, and
 * what else it might be (Songverse Sonic's API 1.11 `alternatives`, plus a
 * value it was too unsure of to use) - offered as one-tap choices. A tempo
 * counts the time signature's own note, as the recording's does.
 */
import { parseKey } from "../music-keys/transpose.js";

export type CheckedDetail = "key" | "tempo" | "timeSignature" | "firstBeat";

export interface RecordingAlternative<T> {
  value: T;
  /** 0 to 1, on the scale of the detail's confidence and below it; not a probability. */
  score: number;
}

export interface RecordingAnalysis {
  /** How sure it was of what it found, 0 to 1, where it said ("beats" covers the first beat). */
  confidence?: Partial<Record<"key" | "tempo" | "timeSignature" | "beats", number>>;
  /** What else each detail might be, the likeliest first. */
  alternatives?: {
    key?: RecordingAlternative<string>[];
    tempo?: RecordingAlternative<number>[];
    timeSignature?: RecordingAlternative<string>[];
    firstBeat?: RecordingAlternative<number>[];
  };
  /** What someone told it when it was asked again (issue #452): those details are theirs, not guesses. */
  hints?: { timeSignature?: string; tempo?: number; firstBeat?: number };
}

/** At most this many alternatives per detail. */
export const MAX_ALTERNATIVES = 4;

const score = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** A time signature as "6/8": 1 to 16 over 2, 4, 8 or 16. */
export function isRecordingTimeSignature(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(value);
  return Boolean(match && Number(match[1]) >= 1 && Number(match[1]) <= 16 && [2, 4, 8, 16].includes(Number(match[2])));
}

const VALUE: Record<CheckedDetail, (value: unknown) => string | number | null> = {
  key: (value) => (typeof value === "string" && value.length <= 12 && parseKey(value) ? value : null),
  tempo: (value) => (typeof value === "number" && value >= 20 && value <= 400 ? round(value, 1) : null),
  timeSignature: (value) => (isRecordingTimeSignature(value) ? value : null),
  firstBeat: (value) => (typeof value === "number" && value >= 0 && value <= 600 ? round(value, 3) : null),
};

/** A detail's alternatives from a stored or received list: each valid, none twice, at most MAX_ALTERNATIVES, the likeliest first. */
function alternatives(detail: CheckedDetail, list: unknown): RecordingAlternative<string | number>[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const out: RecordingAlternative<string | number>[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const value = VALUE[detail]((item as { value?: unknown }).value);
    const given = (item as { score?: unknown }).score;
    if (value === null || !score(given) || out.some((one) => one.value === value)) continue;
    out.push({ value, score: round(given, 3) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.length > 0 ? out.slice(0, MAX_ALTERNATIVES) : undefined;
}

/** A recording's analysis check from what a row holds: only what reads as one; null when nothing does. */
export function readRecordingAnalysis(stored: unknown): RecordingAnalysis | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const raw = stored as Record<string, unknown>;
  const out: RecordingAnalysis = {};
  if (raw.confidence && typeof raw.confidence === "object") {
    const confidence: NonNullable<RecordingAnalysis["confidence"]> = {};
    for (const detail of ["key", "tempo", "timeSignature", "beats"] as const) {
      const value = (raw.confidence as Record<string, unknown>)[detail];
      if (score(value)) confidence[detail] = round(value, 3);
    }
    if (Object.keys(confidence).length > 0) out.confidence = confidence;
  }
  if (raw.alternatives && typeof raw.alternatives === "object") {
    const found: Record<string, unknown> = {};
    for (const detail of ["key", "tempo", "timeSignature", "firstBeat"] as const) {
      const list = alternatives(detail, (raw.alternatives as Record<string, unknown>)[detail]);
      if (list) found[detail] = list;
    }
    if (Object.keys(found).length > 0) out.alternatives = found as RecordingAnalysis["alternatives"];
  }
  if (raw.hints && typeof raw.hints === "object") {
    const hints: NonNullable<RecordingAnalysis["hints"]> = {};
    const given = raw.hints as Record<string, unknown>;
    const timeSignature = VALUE.timeSignature(given.timeSignature);
    const tempo = VALUE.tempo(given.tempo);
    const firstBeat = VALUE.firstBeat(given.firstBeat);
    if (typeof timeSignature === "string") hints.timeSignature = timeSignature;
    if (typeof tempo === "number") hints.tempo = tempo;
    if (typeof firstBeat === "number") hints.firstBeat = firstBeat;
    if (Object.keys(hints).length > 0) out.hints = hints;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** How a confidence reads to someone checking it: sure, fairly sure, or a guess. */
export function surenessOf(confidence: number | undefined): "sure" | "fairly" | "guess" | null {
  if (confidence === undefined) return null;
  if (confidence >= 0.8) return "sure";
  if (confidence >= 0.5) return "fairly";
  return "guess";
}
