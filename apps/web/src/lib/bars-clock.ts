import { recordingBeatPosition, type ChartBar } from "@oneverse/core";
import { useMemo } from "react";
import { useMetronome } from "#/lib/metronome-engine";
import { deviceNow } from "#/lib/output-clock";
import { useStems } from "#/lib/stem-engine";

/** What the bars follow: the song's stems, the metronome started for it, or the Sync leader's. */
export type BarsSource = "stems" | "click" | "leader";

export interface BarsClock {
  source: BarsSource | null;
  /** Where the music is now, in beats from the song's start (negative in the count-in); null when nothing plays. A new one when what it follows changes. */
  position: (() => number) | null;
}

/**
 * Where the music is among a song's bars (issue #238), for the bars row and
 * the chord grid: the stems when they play this song (their recording's own
 * beats and bars, issue #299, else its tempo and first beat), else the
 * metronome started for it or the Sync leader's, else nothing. Read it frame
 * by frame rather than rendering again.
 */
export function useBarsClock(songId: string, bars: readonly ChartBar[]): BarsClock {
  const metronome = useMetronome();
  const stems = useStems();
  const stemsHere = stems.songVersionId === songId && stems.playing && stems.anchor && stems.beat ? { anchor: stems.anchor, beat: stems.beat, speed: stems.speed } : null;
  const clickHere = metronome.playing && metronome.anchor && (metronome.songId === songId || metronome.following) ? { anchor: metronome.anchor, settings: metronome.settings } : null;
  const source: BarsSource | null = stemsHere ? "stems" : clickHere ? (metronome.following ? "leader" : "click") : null;
  const position = useMemo(() => {
    if (stemsHere) {
      const { anchor, beat, speed } = stemsHere;
      return () => {
        const seconds = anchor.position + ((deviceNow() - anchor.epoch) / 1000) * speed;
        // The recording's own beats and bars when they were found (issue #299), else its tempo from its first beat.
        const mapped = beat.map ? recordingBeatPosition(beat.map, seconds, bars) : null;
        return mapped ?? ((seconds - beat.firstBeat) * beat.tempo) / 60;
      };
    }
    if (clickHere) {
      const { anchor, settings } = clickHere;
      return () => anchor.position + (deviceNow() - anchor.epoch) / 1000 / (60 / settings.tempo) - settings.countIn * settings.numerator;
    }
    return null;
  }, [bars, stemsHere?.anchor, stemsHere?.beat, stemsHere?.speed, clickHere?.anchor, clickHere?.settings]);
  return { source, position };
}
