import { beatTempoUnit, clickGrid, clicksBetween, metronomeForSong, type MetronomeClick, type MetronomeSettings } from "@oneverse/core";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { getMetronomeState, ownMetronomeSettings, playMetronomeWithRecording, stopMetronome, useMetronome } from "#/lib/metronome-engine";
import { stemsMetronomeHost, useStems } from "#/lib/stem-engine";
import { isAudible, type StemState } from "#/lib/stem-files";

/**
 * The metronome with the recording (issue #100): while it's on, the
 * metronome plays the stems' beat - their recording's tempo (or the
 * song's), its first beat where the recording's falls, each click on the
 * recording's own beats where it has a beat map (issue #448) - and follows
 * their play, pause, seek and loop, scheduled on their audio clock. It clicks from 0:00 on that beat's grid (issue
 * #178), not only from the first beat; a recording whose beginning is
 * played freely gets the count-in before its first beat instead, as does
 * the metronome set to count in only. When leading Sync play, that
 * metronome is shared like any other.
 */

/**
 * How the metronome plays the recording's beat (issue #178), its tempo and
 * time signature already in `settings`: the position of the first beat
 * (bar 1) and the settings to play. Before that first beat, whole bars back
 * to 0:00 on the same grid, without a count-in (that's for recording); or,
 * for a free intro or a metronome that only counts in, the count-in.
 */
export function recordingClickPlan(settings: MetronomeSettings, beat: { tempo: number; firstBeat: number; freeIntro: boolean }) {
  if (beat.freeIntro || settings.countInOnly) return { settings, anchorPosition: settings.countIn * settings.numerator };
  // Seconds a bar lasts at the recording's own tempo (its first beat is in the recording's time).
  const bar = (60 / beat.tempo) * settings.numerator;
  const bars = beat.firstBeat > 0 ? Math.ceil(beat.firstBeat / bar - 1e-6) : 0;
  return { settings: { ...settings, countIn: 0 }, anchorPosition: bars * settings.numerator };
}

/** The player's metronome on the recording's beat: their sound and pattern, the recording's tempo (times `speed`) and time signature, the version's pattern first. */
export function recordingClickSettings(own: MetronomeSettings, beat: NonNullable<StemState["beat"]>, speed = 1): MetronomeSettings {
  // A recording's tempo counts its time signature's beats (issue #377).
  return metronomeForSong(own, { tempo: beat.tempo * speed, tempoUnit: beatTempoUnit(beat.timeSignature?.denominator ?? own.denominator), timeSignature: beat.timeSignature, beats: beat.metronomeBeats });
}

/**
 * Where the metronome's positions (the plan's: its first beat at
 * `anchorPosition`) fall in the recording, and back (issue #448): on the
 * recording's own beats when it has a beat map, so the click stays with a
 * band that drifts; a steady grid from its first beat otherwise.
 */
export function recordingClickTimes(beat: NonNullable<StemState["beat"]>, anchorPosition: number) {
  const grid = clickGrid({ tempo: beat.tempo, firstBeat: beat.firstBeat, map: beat.map });
  return {
    secondsAt: (position: number) => grid.secondsAt(position - anchorPosition),
    positionAt: (seconds: number) => grid.beatAt(seconds) + anchorPosition,
  };
}

/**
 * The clicks the metronome plays with the recording from `from` to `to`
 * (s, in the recording's time), at the level each sounds (issue #410: the
 * Tracks view's metronome lane): the plan above, on the recording's beats.
 */
export function recordingClicksBetween(own: MetronomeSettings, beat: NonNullable<StemState["beat"]>, from: number, to: number): { at: number; level: MetronomeClick["level"]; countIn: boolean }[] {
  const plan = recordingClickPlan(recordingClickSettings(own, beat), beat);
  const times = recordingClickTimes(beat, plan.anchorPosition);
  const start = times.positionAt(from);
  const end = times.positionAt(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  return clicksBetween(plan.settings, Math.max(0, start), end).map((click) => ({ at: times.secondsAt(click.position), level: click.level, countIn: click.countIn }));
}

/**
 * The recording's bar line nearest `seconds` (issue #448), when one is
 * within half a bar: where a section's loop starts and ends, so it loops
 * whole bars and the click carries on across the seam. Its detected
 * downbeats when it has a beat map, else bars of its time signature from
 * its first beat. `seconds` as it is otherwise.
 */
export function barLineNear(beat: NonNullable<StemState["beat"]> | null, seconds: number): number {
  if (!beat || !(beat.tempo > 0) || !Number.isFinite(seconds)) return seconds;
  const numerator = beat.timeSignature?.numerator ?? 4;
  const lines = beat.map?.downbeats.filter(Number.isFinite) ?? [];
  const grid = clickGrid({ tempo: beat.tempo, firstBeat: beat.firstBeat, map: beat.map });
  const bar = Math.round(grid.beatAt(seconds) / numerator);
  const candidates = [...lines, grid.secondsAt(bar * numerator)].filter((line) => line >= 0);
  const best = candidates.reduce((near, line) => (Math.abs(line - seconds) < Math.abs(near - seconds) ? line : near), Number.POSITIVE_INFINITY);
  const half = ((60 / beat.tempo) * numerator) / 2;
  return Math.abs(best - seconds) <= half ? best : seconds;
}

let on = false;
const listeners = new Set<() => void>();

export function setRecordingClick(next: boolean) {
  on = next;
  for (const listener of listeners) listener();
  if (!next && getMetronomeState().playing && !getMetronomeState().following) stopMetronome();
}

export function useRecordingClick(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => on,
    () => false,
  );
}

/** In the app, once: keeps the metronome on the stems' beat while it's on. */
export function useRecordingClickBridge() {
  const asked = useRecordingClick();
  const stems = useStems();
  // Slowed or sped up (issue #139), the click stem is silent: the metronome plays its beat instead, while it's heard.
  const standsIn = stems.speed !== 1 && stems.tracks.some((track) => track.part === "CLICK" && isAudible(stems, track.id));
  const enabled = asked || standsIn;
  const was = useRef(false);
  const metronome = useMetronome();
  const beat = stems.beat;
  const speed = stems.speed;
  const anchorKey = JSON.stringify([enabled, asked, stems.playing, stems.anchor, beat, speed, stems.following, metronome.following]);
  useEffect(() => {
    const before = was.current;
    was.current = enabled;
    if (!enabled) {
      // Standing in for the click stem no more.
      if (before && !asked && getMetronomeState().playing && !getMetronomeState().following) stopMetronome();
      return;
    }
    if (metronome.following || stems.following) return;
    if (!stems.playing || !stems.anchor || !beat) {
      if (getMetronomeState().playing) stopMetronome();
      return;
    }
    // Slower or faster (issue #139): the beat at the speed the stems play.
    const plan = recordingClickPlan(recordingClickSettings(ownMetronomeSettings(), beat, speed), beat);
    // On the stems' own clock and through their mix (issue #448): locked to them, on the recording's beats.
    const host = stemsMetronomeHost(recordingClickTimes(beat, plan.anchorPosition));
    if (!host) return;
    playMetronomeWithRecording(
      {
        settings: plan.settings,
        playing: true,
        // The song's bar 1 on the recording's first beat; the bars before it from 0:00, or a count-in.
        anchorEpoch: stems.anchor.epoch + ((beat.firstBeat - stems.anchor.position) / speed) * 1000,
        anchorPosition: plan.anchorPosition,
      },
      host,
    );
  }, [anchorKey]);
}
