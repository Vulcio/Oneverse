import { shiftDownbeats } from "./chord-bars.js";
import type { BeatMap } from "../song-document/bars.js";

/**
 * Where the metronome's beats fall in a recording (issue #448): beat 0 on
 * its first beat (bar 1), in seconds of the recording, and back. With a
 * beat map each beat is the recording's own, so a band that drifts a little
 * keeps the click with it: smoothed over its neighbours (a beat or two a few
 * ms off, as older analyses had, doesn't make the click stumble), and moved
 * as a whole so beat 0 is exactly the first beat. Before the map's first beat
 * and past its last, the grid goes on at the tempo of the beats nearest. With
 * no map (or one that disagrees with the first beat by more than a quarter
 * beat: a first beat set by hand), a steady grid at `tempo`.
 */
export interface ClickGrid {
  /** The recording's time (s) of beat `beat` (fractional for subdivisions, negative before bar 1). */
  secondsAt(beat: number): number;
  /** The beat at `seconds` of the recording: the inverse. */
  beatAt(seconds: number): number;
}

/** Beats each side a beat is smoothed over. */
const SMOOTH = 6;

export function clickGrid(beat: { tempo: number; firstBeat: number; map: BeatMap | null }): ClickGrid {
  const each = 60 / beat.tempo;
  const steady: ClickGrid = {
    secondsAt: (n) => beat.firstBeat + n * each,
    beatAt: (seconds) => (seconds - beat.firstBeat) / each,
  };
  const times = smoothedBeats(beat.map, beat.firstBeat, each);
  if (!times) return steady;
  const last = times.length - 1;
  const head = (times[Math.min(SMOOTH, last)]! - times[0]!) / Math.min(SMOOTH, last);
  const tail = (times[last]! - times[Math.max(0, last - SMOOTH)]!) / Math.min(SMOOTH, last);
  return {
    secondsAt(n) {
      if (!Number.isFinite(n)) return Number.NaN;
      if (n <= 0) return times[0]! + n * head;
      if (n >= last) return times[last]! + (n - last) * tail;
      const i = Math.floor(n);
      return times[i]! + (n - i) * (times[i + 1]! - times[i]!);
    },
    beatAt(seconds) {
      if (!Number.isFinite(seconds)) return Number.NaN;
      if (seconds <= times[0]!) return (seconds - times[0]!) / head;
      if (seconds >= times[last]!) return last + (seconds - times[last]!) / tail;
      let low = 0;
      let high = last;
      while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (times[middle]! <= seconds) low = middle;
        else high = middle;
      }
      return low + (seconds - times[low]!) / (times[low + 1]! - times[low]!);
    },
  };
}

/** The map's beats from the first beat on, smoothed, beat 0 on the first beat; null when there's no map to follow. */
function smoothedBeats(map: BeatMap | null, firstBeat: number, each: number): number[] | null {
  const beats = (map?.beats ?? []).filter(Number.isFinite);
  if (beats.length < 4 || !(each > 0)) return null;
  for (let i = 1; i < beats.length; i++) if (!(beats[i]! > beats[i - 1]!)) return null;
  let start = 0;
  for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i]! - firstBeat) < Math.abs(beats[start]! - firstBeat)) start = i;
  if (Math.abs(beats[start]! - firstBeat) > each / 4) return null;
  const own = beats.slice(start);
  if (own.length < 4) return null;
  // Each beat where a gentle curve through its neighbours puts it (a parabola: a band speeding up
  // or slowing down is followed, one beat a few ms off is not).
  const smoothed = own.map((_, i) => {
    const from = Math.max(0, i - SMOOTH);
    const to = Math.min(own.length - 1, i + SMOOTH);
    // Least squares on x = k - i: y = a + b x + c x^2, so the beat is `a`.
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
    for (let k = from; k <= to; k++) {
      const x = k - i;
      const y = own[k]!;
      s0 += 1;
      s1 += x;
      s2 += x * x;
      s3 += x * x * x;
      s4 += x * x * x * x;
      t0 += y;
      t1 += x * y;
      t2 += x * x * y;
    }
    const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s2 * s3) + s2 * (s1 * s3 - s2 * s2);
    if (Math.abs(det) < 1e-9) return own[i]!;
    return (t0 * (s2 * s4 - s3 * s3) - s1 * (t1 * s4 - t2 * s3) + s2 * (t1 * s3 - t2 * s2)) / det;
  });
  for (let i = 1; i < smoothed.length; i++) if (!(smoothed[i]! > smoothed[i - 1]!)) return null;
  const shift = firstBeat - smoothed[0]!;
  return smoothed.map((time) => time + shift);
}

/**
 * A recording's beat moved by hand (issue #448): `seconds` moves everything
 * (the analysis heard the beats a little early or late), `beats` moves the
 * bars that many beats later (negative: earlier) while the beats stay - its
 * 1 was found on another beat of the bar. With no map, only the first beat
 * moves, a beat being `60 / tempo`. Nothing goes before 0:00: a bar that
 * would is left out, and a first beat stays at 0 or after.
 */
export function shiftRecordingBeat(
  beat: { tempo: number; firstBeat: number; map: BeatMap | null },
  shift: { seconds?: number; beats?: number },
): { firstBeat: number; map: BeatMap | null } {
  const seconds = shift.seconds ?? 0;
  const bars = Math.round(shift.beats ?? 0);
  const ms = (time: number) => Math.round(time * 1000) / 1000;
  const each = 60 / beat.tempo;
  if (!beat.map || beat.map.beats.filter(Number.isFinite).length < 2) {
    return { firstBeat: Math.max(0, ms(beat.firstBeat + seconds + bars * each)), map: beat.map };
  }
  let beats = beat.map.beats.filter(Number.isFinite);
  // A beat before the first, for the bars to move back onto.
  for (let k = 0; k < -bars; k++) {
    const before = beats[0]! - (beats[1]! - beats[0]!);
    if (before < -seconds - 0.0005) break;
    beats = [before, ...beats];
  }
  const moved = shiftDownbeats({ beats, downbeats: beat.map.downbeats }, bars);
  const out = (list: readonly number[]) => list.map((time) => ms(time + seconds)).filter((time) => time >= 0);
  const downbeats = out(moved.downbeats);
  if (downbeats.length === 0) return { firstBeat: Math.max(0, ms(beat.firstBeat + seconds)), map: beat.map };
  const first = downbeats[0]!;
  // Listed from the first beat on, as the analysis gives them.
  const kept = out(beats).filter((time) => time >= first);
  return { firstBeat: first, map: { beats: kept, downbeats } };
}
