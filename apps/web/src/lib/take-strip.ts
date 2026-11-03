/**
 * The take as it's recorded, drawn around a playhead (issue #365): what the
 * microphone heard to its left, what's coming in the other parts to its
 * right. In columns of COLUMN seconds, each the loudest moment in it (0-1).
 */
export const COLUMN = 0.05;

const cache = new WeakMap<AudioBuffer, Float32Array>();

/** A part's loudest moment in each column, all channels; worked out once per part. */
export function columnPeaks(buffer: AudioBuffer): Float32Array {
  const known = cache.get(buffer);
  if (known) return known;
  const size = Math.max(1, Math.round(buffer.sampleRate * COLUMN));
  const peaks = new Float32Array(Math.ceil(buffer.length / size));
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      const value = Math.abs(data[i]!);
      const column = (i / size) | 0;
      if (value > peaks[column]!) peaks[column] = value;
    }
  }
  cache.set(buffer, peaks);
  return peaks;
}

/** What the parts together reach in `count` columns from `from` s (summed, at most 1); nothing before 0:00. */
export function peaksAhead(buffers: AudioBuffer[], from: number, count: number): Float32Array {
  const result = new Float32Array(count);
  const first = Math.floor(from / COLUMN);
  for (const buffer of buffers) {
    const peaks = columnPeaks(buffer);
    for (let k = 0; k < count; k++) {
      const column = first + k;
      if (column >= 0 && column < peaks.length) result[k] = Math.min(1, result[k]! + peaks[column]!);
    }
  }
  return result;
}
