import { metronomeForSong, type MetronomeSettings } from "@oneverse/core";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { getMetronomeState, ownMetronomeSettings, playMetronomeOn, stopMetronome, useMetronome } from "#/lib/metronome-engine";
import { isAudible, useStems } from "#/lib/stem-engine";

/**
 * The metronome with the recording (issue #100): while it's on, the
 * metronome plays the stems' beat - their recording's tempo (or the
 * song's), its first beat where the recording's falls - and follows their
 * play, pause and seek. It clicks from 0:00 on that beat's grid (issue
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
    const own = metronomeForSong(ownMetronomeSettings(), { tempo: beat.tempo * speed, timeSignature: beat.timeSignature });
    const plan = recordingClickPlan(own, beat);
    playMetronomeOn({
      settings: plan.settings,
      playing: true,
      // The song's bar 1 on the recording's first beat; the bars before it from 0:00, or a count-in.
      anchorEpoch: stems.anchor.epoch + ((beat.firstBeat - stems.anchor.position) / speed) * 1000,
      anchorPosition: plan.anchorPosition,
    });
  }, [anchorKey]);
}
