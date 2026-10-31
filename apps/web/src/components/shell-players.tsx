import { MetronomeReturnButton } from "#/components/metronome";
import { StemReturnButton } from "#/components/stem-dock";
import { YouTubeHost } from "#/components/youtube-dock";

/**
 * What plays on whatever page is open (issue #343): the way back to the
 * stems or the metronome playing elsewhere, and the YouTube video's frame.
 * Loaded by the shell only once something plays, so a page that plays
 * nothing doesn't load the player, its recorder and its cue editor.
 */
export default function ShellPlayers({ metronome }: { metronome: boolean }) {
  return (
    <>
      <StemReturnButton />
      {metronome ? <MetronomeReturnButton /> : null}
      <YouTubeHost />
    </>
  );
}
