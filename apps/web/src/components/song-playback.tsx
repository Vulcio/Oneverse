import { metronomeForSong, playbackSourcesOf, playsFiles, resolvePlaybackSource, type Attachment, type PlaybackSource } from "@oneverse/core";
import { AudioLines, Ban, Layers, Metronome, Mic, Square, TvMinimalPlay, Users } from "lucide-react";
import { useContext, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { BeatLights } from "#/components/metronome";
import { StemDock } from "#/components/stem-dock";
import { StemDockSlot } from "#/components/stem-dock-slot";
import { YouTubeDock } from "#/components/youtube-dock";
import { Button } from "@oneverse/ui/components/button";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { cn } from "@oneverse/ui/lib/utils";
import { startMetronome, stopMetronome, useMetronome, useMetronomeBeat } from "#/lib/metronome-engine";
import { usePlaybackChoice, type PlaybackStore } from "#/lib/playback";
import { getStemState, pauseStems, playStems, RECORDING_CHOICE, sourceFilesOf, useChosenMultitrack, type StemSong } from "#/lib/stem-engine";
import { publishPlayback, unlockSyncAudio, useSync } from "#/lib/sync-client";
import { pauseYouTube, useYouTube } from "#/lib/youtube-player";

const ICONS: Record<PlaybackSource, typeof AudioLines> = {
  MASTER: AudioLines,
  YOUTUBE: TvMinimalPlay,
  STEMS: Layers,
  TAKES: Mic,
  METRONOME: Metronome,
  NONE: Ban,
};

export interface SongPlaybackProps {
  songVersionId: string;
  title: string;
  /** The page to come back to. */
  returnTo: string;
  /** The song's files (the API's, or the device's copy offline), and how to load one. */
  attachments: Attachment[];
  load: StemSong["load"];
  /** Its video: the version's reference recording, else the song's own (issue #346). */
  youtube: { id: string; start?: number | null } | null;
  tempo: number | null | undefined;
  timeSignature: { numerator: number; denominator: number } | null | undefined;
  /** Where the person's choice is kept. */
  store: PlaybackStore;
  /** A song of a set: its multitrack comes first, and Sync play's leader chooses for everyone. */
  set?: { id: string; itemId: string; name: string } | null;
  /** The version's multitrack (issue #346). */
  versionMultitrackId?: string | null;
  /** Where the choice of multitrack is remembered (issue #127). */
  choiceKey?: string;
  /** What the stem player needs besides (issues #110, #127, #129). */
  stems?: Pick<StemSong, "songKey" | "targetKey" | "cueSections" | "record">;
  /** False: nothing docked (Edit mode, say); the control still shows. */
  docked?: boolean;
}

/**
 * What plays with a song (issue #366): one control - the master, the
 * video, the stems, the stems with the takes, the metronome, or nothing -
 * and what it chose, docked at the bottom. The person's choice is kept on
 * their account; Sync play's leader's, for the set's song, comes first for
 * everyone. Nothing heavy is loaded until it's chosen: the stems the person
 * didn't pick wait for Play. Returns the control, for the page's toolbar,
 * and the dock.
 */
export function useSongPlayback(props: SongPlaybackProps): { control: ReactNode; dock: ReactNode; source: PlaybackSource } {
  const { t } = useTranslation();
  const { chosen, choose } = usePlaybackChoice(props.store);
  const sync = useSync();
  const inSet = !!props.set && sync.setId === props.set.id && sync.status === "on";
  const leaders = inSet && props.set ? (sync.session?.playback?.[props.set.itemId] ?? null) : null;
  // The leader's own choice is theirs to change: it's the one they make.
  const leaderChose = !!leaders && !sync.leading;
  const material = { files: props.attachments, youtube: !!props.youtube, tempo: props.tempo };
  const offered = playbackSourcesOf(material);
  const multitrack = useChosenMultitrack(props.choiceKey ?? props.songVersionId);
  // A multitrack (or the recording) chosen on this device before there was this control: still what plays.
  const deviceChose = multitrack === undefined ? null : multitrack === RECORDING_CHOICE ? "MASTER" : "TAKES";
  const source = resolvePlaybackSource(material, leaders, chosen, deviceChose);

  // Another source taking over while the song plays: from where it was (issue #366).
  const takeOver = useRef<number | null>(null);
  const change = (next: PlaybackSource) => {
    if (next === source) return;
    const stems = getStemState();
    takeOver.current = stems.playing && stems.songVersionId === props.songVersionId ? stems.position : null;
    if (takeOver.current !== null && !playsFiles(next)) pauseStems();
    choose(next);
    // Leading Sync play: for everyone in the set.
    if (inSet && sync.leading && props.set) publishPlayback(props.set.itemId, next);
  };

  const control = (
    <label className={cn("relative flex h-9 shrink-0 items-center", leaderChose && "opacity-80")} title={leaderChose ? t("playback.leaderChose", { name: sync.session?.leader.name ?? "" }) : t("playback.label")}>
      <span className="pointer-events-none absolute left-2.5 flex items-center text-muted-foreground">
        {(() => {
          const Icon = ICONS[source];
          return <Icon className="size-4" aria-hidden />;
        })()}
      </span>
      <NativeSelect
        className="h-9 max-w-52 pl-8"
        value={source}
        disabled={leaderChose}
        onChange={(event) => change(event.target.value as PlaybackSource)}
        aria-label={t("playback.label")}
        data-testid="playback-source"
        data-chosen={chosen ?? ""}
        data-leader={leaders ?? ""}
      >
        {offered.map((option) => (
          <option key={option} value={option}>
            {t(`playback.sources.${option}`)}
          </option>
        ))}
      </NativeSelect>
      {leaderChose ? <Users className="ml-1.5 size-4 text-muted-foreground" aria-label={t("playback.leaderChose", { name: sync.session?.leader.name ?? "" })} data-testid="playback-leader" /> : null}
    </label>
  );

  // Loaded as the page opens: what plays, chosen or by default - the master when there's one, so
  // stems nobody chose aren't fetched until they are.
  const prefetch = true;
  const files = playsFiles(source) ? sourceFilesOf(props.attachments, source as "MASTER" | "STEMS" | "TAKES", multitrack, props.set?.id, props.versionMultitrackId) : null;
  const song: StemSong | null =
    files && files.stems.length > 0
      ? {
          songVersionId: props.songVersionId,
          title: props.title,
          returnTo: props.returnTo,
          ...files,
          load: props.load,
          tempo: props.tempo,
          timeSignature: props.timeSignature,
          choiceKey: props.choiceKey,
          prefetch,
          // The player's own list and its Multitrack button switch what plays, as this control does.
          switchSource: (to) => change(to === "MASTER" ? "MASTER" : offered.includes("TAKES") ? "TAKES" : "STEMS"),
          ...props.stems,
        }
      : null;

  // The new source's files, from where the old one was.
  const songKey = song ? song.stems.map((file) => file.id).join() : "";
  useEffect(() => {
    const from = takeOver.current;
    takeOver.current = null;
    if (from === null || !song) return;
    void playStems(song, from);
  }, [songKey]);

  // One thing plays at a time: the video and the song's metronome stop when it moves on.
  const yt = useYouTube();
  const metronome = useMetronome();
  useEffect(() => {
    if (source !== "YOUTUBE" && yt.playing && yt.video?.songVersionId === props.songVersionId) pauseYouTube();
    if (source !== "METRONOME" && metronome.playing && metronome.songId === metronomeId(props) && !metronome.following) stopMetronome();
    const engine = getStemState();
    if (!playsFiles(source) && engine.playing && engine.songVersionId === props.songVersionId && !engine.following) pauseStems();
  }, [source]);

  const docked = props.docked !== false;
  const dock = !docked ? null : song ? (
    <StemDock song={song} />
  ) : source === "YOUTUBE" && props.youtube ? (
    <YouTubeDock video={{ songVersionId: props.songVersionId, videoId: props.youtube.id, start: props.youtube.start ?? null, title: props.title, returnTo: props.returnTo }} />
  ) : source === "METRONOME" ? (
    <MetronomeDock id={metronomeId(props)} title={props.title} tempo={props.tempo} timeSignature={props.timeSignature} />
  ) : null;

  return { control, dock, source };
}

/** What the song's metronome is started as: the set's item, or the song. */
function metronomeId(props: Pick<SongPlaybackProps, "songVersionId" | "set">): string {
  return props.set?.itemId ?? props.songVersionId;
}

/**
 * Just the metronome (issue #366), docked as the stems are: Play starts it
 * at the song's tempo and time signature, its beat lit; the sound and
 * pattern are the player's, from the Metronome page.
 */
function MetronomeDock({ id, title, tempo, timeSignature }: { id: string; title: string; tempo: number | null | undefined; timeSignature: { numerator: number; denominator: number } | null | undefined }) {
  const slot = useContext(StemDockSlot);
  const { t } = useTranslation();
  const metronome = useMetronome();
  const beat = useMetronomeBeat();
  const mine = metronome.playing && metronome.songId === id;
  const following = metronome.following;
  const settings = tempo ? metronomeForSong(metronome.settings, { tempo, timeSignature }) : metronome.settings;
  const press = () => {
    if (following) return unlockSyncAudio();
    if (mine) return stopMetronome();
    const pressed = performance.now();
    startMetronome(settings, id);
    // For the end-to-end suites: from the press to the first click being scheduled (issue #366).
    const w = window as unknown as { songverseMetronomeStart?: { firstSoundMs: number } };
    w.songverseMetronomeStart = { firstSoundMs: Math.round(performance.now() - pressed) };
  };
  const dock = (
    <section className="border-t bg-background shadow-[0_-4px_12px_-8px_rgb(0_0_0/0.3)]" aria-label={t("playback.sources.METRONOME")} data-testid="metronome-dock" data-state={mine ? "playing" : "idle"}>
      <div className="mx-auto flex w-full items-center gap-3 pt-2 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] sm:pb-2 md:px-6">
        <Button type="button" size="icon" className="size-10 shrink-0 rounded-full" onClick={press} aria-pressed={mine} aria-label={mine ? t("metronome.stop") : t("stems.play")} data-testid="metronome-dock-play">
          {mine ? <Square /> : <Metronome />}
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{tempo ? `${tempo} BPM` : t("metronome.noTempo")}</span>
        <BeatLights settings={mine ? metronome.settings : settings} beat={mine ? beat : null} size="small" />
      </div>
    </section>
  );
  return slot ? createPortal(dock, slot) : null;
}
