import { barAt, barsLength, metronomeForSong, recordingBeatPosition, recordingSecondsAt, type ChartBar } from "@oneverse/core";
import { startMetronome, stopMetronome, useMetronome } from "#/lib/metronome-engine";
import { pauseStems, playLoadedStems, setStemLoop, useStems, type StemState } from "#/lib/stem-engine";
import { unlockSyncAudio } from "#/lib/sync-client";

/** What the chord grid plays: the song's stems when they're loaded, else the click at the song's tempo. */
export type GridPlaySource = "stems" | "click";

export interface GridPlayer {
  /** What Play plays; null when there's nothing to play (no stems, no tempo). */
  source: GridPlaySource | null;
  playing: boolean;
  /** Following Sync play's leader: their name; play and seek are theirs. */
  following: string | null;
  /** Plays from the top, or where the stems are; stops what plays. */
  toggle: () => void;
  /** Plays from bar `bar`'s first beat (a jump while playing). */
  playFrom: (bar: number) => void;
  /** Loops bars `first` to `last` (the stems only), or stops looping (null). */
  loop: (range: { first: number; last: number } | null) => void;
  /** The bars looped now, if any. */
  looped: { first: number; last: number } | null;
  /** Loops need the stems: a recording's time to loop through. */
  canLoop: boolean;
}

/** Where in the recording a position among the bars is heard: its own beats and bars when found (issue #299), else its tempo from its first beat. */
function secondsAt(beat: NonNullable<StemState["beat"]>, bars: readonly ChartBar[], position: number): number {
  const mapped = beat.map ? recordingSecondsAt(beat.map, position, bars) : null;
  return Math.max(0, mapped ?? beat.firstBeat + (position * 60) / beat.tempo);
}

function positionAt(beat: NonNullable<StemState["beat"]>, bars: readonly ChartBar[], seconds: number): number {
  const mapped = beat.map ? recordingBeatPosition(beat.map, seconds, bars) : null;
  return mapped ?? ((seconds - beat.firstBeat) * beat.tempo) / 60;
}

/**
 * Playing a song from its chord grid (issue #238): Play, a tap on a bar to
 * play from there, and bars looped. The stems when the page has loaded them
 * (the recording's beats place each bar), else the metronome at the song's
 * tempo from that bar. Following Sync play's leader, it's theirs.
 */
export function useGridPlayer(songId: string, bars: readonly ChartBar[], song: { tempo: number | null; timeSignature?: { numerator: number; denominator: number } | null }): GridPlayer {
  const stems = useStems();
  const metronome = useMetronome();
  const stemsHere = stems.songVersionId === songId && stems.beat ? stems.beat : null;
  const source: GridPlaySource | null = stemsHere ? "stems" : song.tempo ? "click" : null;
  const following = stems.following ?? metronome.following;
  const stemsPlaying = stems.songVersionId === songId && stems.playing;
  const clickPlaying = metronome.playing && metronome.songId === songId;
  const playing = stemsPlaying || clickPlaying;

  const click = (from: number) => {
    if (song.tempo) startMetronome(metronomeForSong(metronome.settings, { tempo: song.tempo, timeSignature: song.timeSignature ?? null }), songId, from);
  };
  const toggle = () => {
    if (following) return unlockSyncAudio();
    if (playing) {
      if (stemsPlaying) pauseStems();
      if (clickPlaying) stopMetronome();
      return;
    }
    if (source === "stems") playLoadedStems(songId);
    else click(0);
  };
  const playFrom = (bar: number) => {
    const target = bars[bar];
    if (following || !target) return;
    if (stemsHere) {
      // One thing at a time: the song's click, started from the bars row, stops for the recording.
      if (clickPlaying) stopMetronome();
      // Outside the loop: no longer looping (seekStems drops it).
      playLoadedStems(songId, secondsAt(stemsHere, bars, target.start));
    } else click(target.start);
  };
  const loop = (range: { first: number; last: number } | null) => {
    if (following || !stemsHere) return;
    if (!range) return setStemLoop(null);
    const first = bars[Math.min(range.first, range.last)];
    const last = bars[Math.max(range.first, range.last)];
    if (!first || !last) return;
    const start = secondsAt(stemsHere, bars, first.start);
    setStemLoop({ start, end: secondsAt(stemsHere, bars, last.start + last.beats) });
    if (clickPlaying) stopMetronome();
    if (!stems.playing) playLoadedStems(songId, start);
  };
  // The loop's bars: where its start and end fall.
  let looped: GridPlayer["looped"] = null;
  if (stemsHere && stems.loop) {
    const length = barsLength(bars);
    const first = barAt(bars, Math.min(Math.max(0, positionAt(stemsHere, bars, stems.loop.start) + 1e-3), length - 1e-3));
    const last = barAt(bars, Math.min(Math.max(0, positionAt(stemsHere, bars, stems.loop.end) - 1e-3), length - 1e-3));
    if (first && last) looped = { first: first.bar, last: last.bar };
  }
  return { source, playing, following, toggle, playFrom, loop, looped, canLoop: !!stemsHere && !following };
}
