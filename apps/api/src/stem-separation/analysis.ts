import { cuesFromHints, cuesFromSections, lyricsForAnalysis, parseKey, readSongDocument, readRecordingAnalysis, readRecordingChords, type CuePoint, type DetectedDetail, type RecordingAnalysis, type RecordingChord, type SongDocumentV2 } from "@oneverse/core";
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
  /** The recording's chords (issue #393): null when it has none. */
  recordingChords: RecordingChord[] | null;
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
 * Sections are placed on the song's own: by the pass of its words the server
 * says each is (`passes`, issue #450), else by their labels (cuesFromSections).
 */
export function detailsWithAnalysis(
  source: SourceDetails,
  analysis: DemucsAnalysis | null | undefined,
  song: Pick<SongDocumentV2, "sections" | "flow"> | null,
  passes: readonly string[] = [],
): SourceDetails & { detected: DetectedDetail[] } {
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
  // Its chords (issue #393): suggestions, kept when the recording has none of its own.
  const chords = details.recordingChords === null ? readRecordingChords(analysis.chords) : null;
  if (chords) {
    details.recordingChords = chords;
    detected.push("chords");
  }
  if (!details.cuePoints?.length && song && analysis.sections?.length) {
    const found = analysis.sections.flatMap((section) => (typeof section.start === "number" && typeof section.label === "string" ? [{ start: section.start, label: section.label, hint: section.hint }] : []));
    const hinted = passes.length > 0 ? cuesFromHints(found, passes, song) : [];
    const cues = hinted.length > 0 ? hinted : cuesFromSections(found, song);
    if (cues.length > 0) {
      details.cuePoints = cues;
      detected.push("sections");
    }
  }
  return { ...details, detected };
}

/** The song's words for the analysis (issue #450), and the section each pass sings; null without any, or too long for the server (64 KB). */
export function wordsOfSong(documentJson: unknown): { text: string; passes: string[] } | null {
  try {
    const words = documentJson ? lyricsForAnalysis(readSongDocument(documentJson)) : null;
    return words && Buffer.byteLength(words.text) <= 64 * 1024 ? words : null;
  } catch {
    return null;
  }
}

/**
 * What's sent with a recording analysed again (issue #452): what someone
 * says now, and what they had confirmed - bar 1, and the time signature when
 * it isn't what changes; the tempo when neither the time signature nor it
 * changes (another time signature counts another note).
 */
export function hintsFor(
  stem: { detected: string[]; recordingTimeSignature: string | null; recordingTempo: number | null; recordingFirstBeat: number | null },
  said: { timeSignature?: string | null; tempo?: number | null; firstBeat?: number | null },
): NonNullable<RecordingAnalysis["hints"]> {
  const confirmed = (detail: DetectedDetail) => !stem.detected.includes(detail);
  return (
    readRecordingAnalysis({
      hints: {
        timeSignature: said.timeSignature ?? (confirmed("timeSignature") && stem.recordingTimeSignature ? stem.recordingTimeSignature : undefined),
        tempo: said.tempo ?? (!said.timeSignature && confirmed("tempo") && stem.recordingTempo !== null ? stem.recordingTempo : undefined),
        firstBeat: said.firstBeat ?? (confirmed("firstBeat") && stem.recordingFirstBeat !== null ? stem.recordingFirstBeat : undefined),
      },
    })?.hints ?? {}
  );
}

/**
 * Why a recording is analysed again without new hints (issue #452), kept
 * with them: "asked", its sections placed again from the words on request
 * (replacing those on the stems); "words", words added to the song since it
 * was separated without any (only sections still guesses are replaced).
 */
export type SectionsAgain = "asked" | "words";
export function sectionsAgainOf(hints: unknown): SectionsAgain | null {
  const value = hints && typeof hints === "object" ? (hints as { sections?: unknown }).sections : null;
  return value === "asked" || value === "words" ? value : null;
}

/**
 * What the analysis said of what it found, for someone to check it (issue
 * #452): how sure it was, and what else each detail might be - its
 * alternatives, after a value it was too unsure of to use - with the hints
 * it was given. Null when it said nothing of the kind.
 */
export function recordingAnalysisOf(analysis: DemucsAnalysis | null | undefined, hints?: RecordingAnalysis["hints"]): RecordingAnalysis | null {
  if (!analysis) return hints ? readRecordingAnalysis({ hints }) : null;
  const confidence = {
    key: analysis.key?.confidence,
    tempo: analysis.tempo?.confidence,
    timeSignature: analysis.time_signature?.confidence,
    beats: analysis.beats_confidence ?? undefined,
  };
  const given = analysis.alternatives ?? {};
  const meter = (one: { numerator?: number; denominator?: number } | null | undefined) => (one?.numerator && one.denominator ? `${one.numerator}/${one.denominator}` : null);
  // A value too unsure to be used (below MIN_CONFIDENCE) is still worth offering, first.
  const unsure = <T>(value: T | null | undefined, sureness: number | undefined) => (value !== null && value !== undefined && sureness !== undefined && !sure(sureness) ? [{ value, score: sureness }] : []);
  return readRecordingAnalysis({
    confidence,
    alternatives: {
      key: [...unsure(analysis.key?.name?.trim(), confidence.key), ...(given.key ?? []).map((one) => ({ value: one.name, score: one.score }))].filter((one) => typeof one.value === "string" && parseKey(one.value)),
      tempo: [...unsure(analysis.tempo?.bpm, confidence.tempo), ...(given.tempo ?? []).map((one) => ({ value: one.bpm, score: one.score }))],
      timeSignature: [...unsure(meter(analysis.time_signature), confidence.timeSignature), ...(given.time_signature ?? []).map((one) => ({ value: meter(one), score: one.score }))],
      firstBeat: (given.first_beat ?? []).map((one) => ({ value: one.start, score: one.score })),
    },
    hints,
  });
}
