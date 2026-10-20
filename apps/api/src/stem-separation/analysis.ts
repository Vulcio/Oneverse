import { cuesFromSections, parseKey, type CuePoint, type DetectedDetail, type SongDocumentV2 } from "@songverse/core";
import type { DemucsAnalysis } from "./demucs-client.js";

/** Below this, what the analysis says is left out (issue #175). */
export const MIN_CONFIDENCE = 0.5;

/** The recording details a separation's stems start with: the recording's own, else the analysis's. */
export interface SourceDetails {
  recordingKey: string | null;
  recordingTempo: number | null;
  recordingTimeSignature: string | null;
  recordingFirstBeat: number | null;
  recordingFreeIntro: boolean;
  /** The recording's beats and bars (issue #299): empty when it has none. */
  recordingBeats: number[];
  recordingDownbeats: number[];
  cuePoints: CuePoint[] | null;
}

/** The most beats kept: four hours at 300 BPM would be 72,000; a song is far fewer. */
const MAX_BEATS = 20_000;
/** Times in seconds, strictly increasing and within a file's length; null when they aren't. */
function times(list: unknown): number[] | null {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BEATS) return null;
  const out: number[] = [];
  for (const one of list) {
    if (typeof one !== "number" || !Number.isFinite(one) || one < 0 || one > 4 * 60 * 60 || (out.length > 0 && one <= out.at(-1)!)) return null;
    out.push(Math.round(one * 1000) / 1000);
  }
  return out;
}

const sure = (confidence: number | undefined) => confidence === undefined || confidence >= MIN_CONFIDENCE;

/**
 * The stems' details (issue #175): each the recording's where it has one -
 * never replaced by a guess - else what the analysis found, if it's sure
 * enough and reads as one; those listed in `detected` until confirmed.
 * Sections are placed on the song's own (cuesFromSections).
 */
export function detailsWithAnalysis(source: SourceDetails, analysis: DemucsAnalysis | null | undefined, song: Pick<SongDocumentV2, "sections" | "flow"> | null): SourceDetails & { detected: DetectedDetail[] } {
  const details = { ...source };
  const detected: DetectedDetail[] = [];
  if (!analysis) return { ...details, detected };

  const key = analysis.key?.name?.trim();
  if (details.recordingKey === null && key && sure(analysis.key?.confidence) && parseKey(key)) {
    details.recordingKey = key;
    detected.push("key");
  }
  const bpm = analysis.tempo?.bpm;
  if (details.recordingTempo === null && typeof bpm === "number" && bpm >= 20 && bpm <= 400 && sure(analysis.tempo?.confidence)) {
    details.recordingTempo = Math.round(bpm * 10) / 10;
    detected.push("tempo");
  }
  const meter = analysis.time_signature;
  if (
    details.recordingTimeSignature === null &&
    meter &&
    Number.isInteger(meter.numerator) &&
    meter.numerator! >= 1 &&
    meter.numerator! <= 16 &&
    [2, 4, 8, 16].includes(meter.denominator ?? 0) &&
    sure(meter.confidence)
  ) {
    details.recordingTimeSignature = `${meter.numerator}/${meter.denominator}`;
    detected.push("timeSignature");
  }
  const first = analysis.first_beat;
  if (details.recordingFirstBeat === null && typeof first === "number" && first >= 0 && first <= 600) {
    details.recordingFirstBeat = Math.round(first * 1000) / 1000;
    detected.push("firstBeat");
  }
  // The recording's beats and bars (issue #299), as a pair, when it's sure of them and none were set by hand.
  const beats = times(analysis.beats);
  const downbeats = times(analysis.downbeats);
  if (details.recordingBeats.length === 0 && beats && beats.length >= 2 && downbeats && sure(analysis.beats_confidence ?? undefined) && downbeats.every((one) => beats.includes(one))) {
    details.recordingBeats = beats;
    details.recordingDownbeats = downbeats;
    detected.push("beats");
    // No steady beat before the first downbeat: the click waits for it (issue #178).
    if (analysis.intro_free === true && !details.recordingFreeIntro && detected.includes("firstBeat")) details.recordingFreeIntro = true;
  }
  if (!details.cuePoints?.length && song && analysis.sections?.length) {
    const found = analysis.sections.flatMap((section) => (typeof section.start === "number" && typeof section.label === "string" ? [{ start: section.start, label: section.label }] : []));
    const cues = cuesFromSections(found, song);
    if (cues.length > 0) {
      details.cuePoints = cues;
      detected.push("sections");
    }
  }
  return { ...details, detected };
}
