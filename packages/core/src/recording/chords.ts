/**
 * A recording's chords (issue #393), as Songverse Sonic's analysis found
 * them (its API 1.7, `analysis.chords`): when each starts and ends, in
 * seconds from the recording's start, its root and bass as pitch classes
 * (0 = C … 11 = B) so the app spells them in the song's key, and its
 * quality. Stretches without a chord are left out. They are suggestions:
 * the server gives no confidence for them.
 */

export const RECORDING_CHORD_QUALITIES = ["maj", "min", "dim", "aug", "min6", "maj6", "min7", "minmaj7", "maj7", "7", "dim7", "hdim7", "sus2", "sus4"] as const;
export type RecordingChordQuality = (typeof RECORDING_CHORD_QUALITIES)[number];

export interface RecordingChord {
  start: number;
  end: number;
  root: number;
  quality: RecordingChordQuality;
  /** Left out when it's the root. */
  bass?: number;
}

/** The most kept: a chord a second for four hours. */
const MAX_CHORDS = 14_400;
const MAX_SECONDS = 4 * 60 * 60;
const QUALITIES = new Set<string>(RECORDING_CHORD_QUALITIES);

const pitchClass = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 11;
const time = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_SECONDS;
const ms = (value: number) => Math.round(value * 1000) / 1000;

/**
 * A recording's chords from what a server or a stored row says: in order,
 * not overlapping, each part valid - else null, never a partial list (as
 * beats are). Stretches without a chord ("N") are dropped; an empty list
 * is null too.
 */
export function readRecordingChords(list: unknown): RecordingChord[] | null {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CHORDS) return null;
  const out: RecordingChord[] = [];
  let last = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") return null;
    const { start, end, root, quality, bass, label } = item as Record<string, unknown>;
    if (!time(start) || !time(end) || end <= start || start < last - 0.0005) return null;
    last = end;
    if (label === "N" && root === undefined) continue;
    if (!pitchClass(root) || typeof quality !== "string" || !QUALITIES.has(quality)) return null;
    if (bass !== undefined && bass !== null && !pitchClass(bass)) return null;
    const chord: RecordingChord = { start: ms(start), end: ms(end), root, quality: quality as RecordingChordQuality };
    if (pitchClass(bass) && bass !== root) chord.bass = bass;
    out.push(chord);
  }
  return out.length > 0 ? out : null;
}
