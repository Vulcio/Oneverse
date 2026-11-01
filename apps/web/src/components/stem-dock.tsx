import { useRouter } from "@tanstack/react-router";
import { formatDuration, type StemPart } from "@oneverse/core";
import {
  ArrowUpDown,
  AudioLines,
  ChevronDown,
  ChevronUp,
  ClefBass,
  Flag,
  Drum,
  Ellipsis,
  Guitar,
  Layers,
  Loader2,
  Metronome,
  Mic,
  MicVocal,
  Minus,
  Plus,
  Music,
  Pause,
  Piano,
  Play,
  Repeat,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  SlidersHorizontal,
  UserRoundPlus,
  type LucideIcon,
} from "lucide-react";
import { useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { cueAt, sortedCues, type CuePoint, multitracksOf, semitonesBetween, transposeKey, transposesPart } from "@oneverse/core";
import { NEW_TARGET, RecorderDialog } from "#/components/recorder-dialog";
import { StemDockSlot } from "#/components/stem-dock-slot";
import { SpeedControl, speedPercent } from "#/components/speed-control";
import { StemRecordPanel } from "#/components/stem-record-panel";
import { CueEditor, SectionLane, sectionsGradient, useCueNames } from "#/components/stem-cues";
import { StemTrackActions } from "#/components/stem-track-actions";
import { Button } from "@oneverse/ui/components/button";
import { setMode } from "#/lib/mode";
import { useMultitrackName } from "#/lib/multitrack-name";
import { setRecordingClick, useRecordingClick } from "#/lib/recording-click";
import { unlockSyncAudio } from "#/lib/sync-client";
import {
  chooseMultitrack,
  RECORDING_CHOICE,
  chooseStemSpeed,
  chooseStemTranspose,
  dockStems,
  isTransposed,
  setStemsSpeed,
  setStemsTranspose,
  useChosenSpeed,
  useChosenTranspose,
  isAudible,
  pauseStems,
  playStems,
  prefetchStems,
  setStemLoop,
  stopStems,
  resetStemVolumes,
  setStemVolume,
  seekStems,
  stemKey,
  TAKE_ID,
  toggleStemMute,
  toggleStemSolo,
  tracksOf,
  undockStems,
  useStems,
  volumeGain,
  type StemSong,
  type StemTrack,
} from "#/lib/stem-engine";
import { sizedAvatarUrl } from "@oneverse/ui/lib/avatar-url";
import { cn } from "@oneverse/ui/lib/utils";

const NO_PARTS: Record<string, boolean> = {};
const COMBINED_KEY = "songverse.stems.combined";
const MIXER_KEY = "songverse.stems.mixer";
const COMBINED_SLICES = 400;

/**
 * The parts heard as one waveform (issue #137): at each moment, the
 * loudest of them there - each part as long as it is, against the longest.
 */
export function combinePeaks(tracks: (Pick<StemTrack, "peaks" | "length"> & { volume?: number })[], duration: number): number[] {
  const out = new Array<number>(COMBINED_SLICES).fill(0);
  if (!duration) return out;
  for (const track of tracks) {
    if (!track.peaks?.length || !track.length) continue;
    for (let slice = 0; slice < COMBINED_SLICES; slice++) {
      const at = ((slice + 0.5) / COMBINED_SLICES) * duration;
      if (at >= track.length) break;
      // As loud as the mixer has it (issue #140).
      const value = (track.peaks[Math.floor((at / track.length) * track.peaks.length)] ?? 0) * Math.sqrt(volumeGain(track.volume ?? 1));
      if (value > out[slice]!) out[slice] = value;
    }
  }
  return out;
}

/** Where the dock goes: the bottom of the page's column, kept in view (see AppShell). */
export { StemDockSlot };

const PART_ICONS: Record<StemPart, LucideIcon> = {
  VOCALS: MicVocal,
  // Sung harmonies (issue #131): a microphone, with the voice's letter on it.
  HARMONY_SOPRANO: Mic,
  HARMONY_ALTO: Mic,
  HARMONY_TENOR: Mic,
  HARMONY_BASS: Mic,
  BACKING_VOCALS: UserRoundPlus,
  DRUMS: Drum,
  BASS: ClefBass,
  GUITAR: Guitar,
  KEYS: Piano,
  OTHER: Ellipsis,
  CLICK: Metronome,
};

// Clear of the screen's rounded corners and the home indicator on a phone.
const EDGES = "pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:px-6";

function useTrackName() {
  const { t } = useTranslation();
  return (track: StemTrack) => track.partName || (track.part ? `${t(`stems.parts.${track.part}`)}${track.number ? ` ${track.number}` : ""}` : t("stems.fullMix"));
}

/**
 * A song's stems, docked at the bottom of its page in Practice (issue #64):
 * one row by default - play, and a round button per part to mute it -
 * expanded, a row per part with its waveform, mute and solo. The audio
 * lives in lib/stem-engine, so it plays on after the page is left.
 */
export function StemDock({ song: page }: { song: StemSong }) {
  const slot = useContext(StemDockSlot);
  const { t } = useTranslation();
  const engine = useStems();
  // Transposed (issue #129): as chosen for the song (in this set), else to the key the page plays it in.
  const transposeStore = page.choiceKey ?? page.songVersionId;
  const chosenTranspose = useChosenTranspose(transposeStore);
  const recordedKey = page.stems[0]?.recordingKey ?? page.songKey ?? null;
  const defaultSteps = recordedKey && page.targetKey ? (semitonesBetween(recordedKey, page.targetKey) ?? 0) : 0;
  const steps = chosenTranspose?.steps ?? defaultSteps;
  // Which parts are moved, when not as their part says (issue #135).
  const transposeParts = chosenTranspose?.parts ?? NO_PARTS;
  // Slower or faster, in its key (issue #139): as chosen for the song (in this set).
  const chosenSpeed = useChosenSpeed(transposeStore);
  const song: StemSong = { ...page, transpose: steps, transposeParts, speed: chosenSpeed };
  const nameOf = useTrackName();
  const key = stemKey(song);
  const active = engine.key === key;
  const tracks = active ? engine.tracks : tracksOf(song.stems);
  // A song without stems: its whole recording (issue #66).
  const whole = tracks.length === 1 && tracks[0]?.part === null;
  const playing = active && engine.playing;
  const loading = active && engine.status === "loading";
  const position = active ? engine.position : 0;
  const duration = active ? engine.duration : 0;
  const [expanded, setExpanded] = useState(false);
  // Following Sync play's leader (issue #100): play, pause and seek are theirs.
  const following = active ? engine.following : null;
  const click = useRecordingClick();
  // What the stems were recorded in (#65), when it isn't the song's; they share it.
  const recording = song.stems[0];
  const recorded = [recording?.recordingKey, recording?.recordingTempo ? `${recording.recordingTempo} BPM` : null, recording?.recordingTimeSignature].filter(Boolean).join(" · ");
  // The song's other multitracks (issue #123), and its whole recording (#182), to switch to; not while following the leader's.
  const multitracks = song.multitracks ?? [];
  const multitrackName = useMultitrackName();
  const offersRecording = !!song.recording && multitracks.length > 0;
  const switchTo = (multitrackId: string | null) => {
    // Chosen with what plays (issue #366): the recording is the master, a multitrack the stems - from where it was.
    if (song.switchSource) {
      if (multitrackId === RECORDING_CHOICE) return song.switchSource("MASTER");
      chooseMultitrack(song.choiceKey ?? song.songVersionId, multitrackId);
      if (song.source === "MASTER") song.switchSource("STEMS");
      return;
    }
    if (playing) pauseStems();
    chooseMultitrack(song.choiceKey ?? song.songVersionId, multitrackId);
  };
  const picker =
    multitracks.length + (offersRecording ? 1 : 0) > 1 && !following ? (
      <select
        className="h-8 max-w-40 min-w-0 shrink rounded-md border bg-background px-2 text-sm"
        value={song.multitrackId ?? ""}
        onChange={(event) => switchTo(event.target.value || null)}
        aria-label={t("stems.multitrack")}
        data-testid="stem-multitrack"
      >
        {offersRecording ? <option value={RECORDING_CHOICE}>{t("stems.recordingChoice")}</option> : null}
        {multitracks.map((multitrack, index) => (
          <option key={multitrack.id ?? ""} value={multitrack.id ?? ""}>
            {multitrackName(multitrack, index)}
          </option>
        ))}
      </select>
    ) : null;
  // Playing the whole recording (issue #182): the multitrack, a press away - only loaded then.
  const upgradeButton =
    song.multitrackId === RECORDING_CHOICE && song.upgrade !== undefined && !following ? (
      <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-xs" onClick={() => switchTo(song.upgrade ?? null)} data-testid="stem-switch-multitrack">
        <Layers className="size-3.5" />
        {t("stems.switchToMultitrack")}
      </Button>
    ) : null;
  // What plays, named: the recording's file, or the multitrack.
  const playingName =
    song.multitrackId === RECORDING_CHOICE || whole ? (tracks[0]?.filename ?? "") : multitrackName({ id: song.multitrackId ?? null, name: multitracks.find((multitrack) => multitrack.id === (song.multitrackId ?? null))?.name ?? null }, Math.max(0, multitracks.findIndex((multitrack) => multitrack.id === (song.multitrackId ?? null))));
  // A transposition chosen while it's loaded is heard now; following, the leader's is.
  const partsKey = JSON.stringify(transposeParts);
  useEffect(() => {
    if (active && !following) void setStemsTranspose(steps, transposeParts);
  }, [active, following, steps, partsKey]);
  const heardSteps = following && active ? engine.transpose : steps;
  const heard = following && active ? engine : { transposeParts };
  const signed = (value: number) => (value > 0 ? `+${value}` : `−${Math.abs(value)}`);
  const transposedKey = recordedKey ? transposeKey(recordedKey, heardSteps) : null;
  const transposeLabel = heardSteps === 0 ? (recordedKey ?? t("stems.transposeNone")) : transposedKey ? `${transposedKey} (${signed(heardSteps)})` : signed(heardSteps);
  const changeTranspose = (next: number, parts = transposeParts) =>
    chooseStemTranspose(transposeStore, next === defaultSteps && Object.keys(parts).length === 0 ? undefined : { steps: Math.max(-6, Math.min(6, next)), parts });
  /** A part moved or not when transposing (issue #135); its default (all but the drums and cues) isn't stored. */
  const toggleTransposed = (track: StemTrack) => {
    const next = { ...transposeParts };
    const on = !isTransposed(heard, track);
    if (on === transposesPart(track.part)) delete next[track.id];
    else next[track.id] = on;
    changeTranspose(steps, next);
  };
  // The speed chosen, heard now; following, the leader's is (issue #139).
  useEffect(() => {
    if (active && !following) void setStemsSpeed(chosenSpeed);
  }, [active, following, chosenSpeed]);
  const heardSpeed = following && active ? engine.speed : chosenSpeed;
  const changeSpeed = (next: number) => chooseStemSpeed(transposeStore, next);
  // Parts recorded while transposed (issue #135) are moved even at 0: their toggles show then too.
  const moving = heardSteps !== 0 || tracks.some((track) => track.offset !== 0);
  const transposeControl = (
    <div className="flex shrink-0 items-center" role="group" aria-label={t("stems.transpose")} data-testid="stem-transpose" data-steps={heardSteps}>
      <Button type="button" variant="ghost" size="icon" className="size-8" disabled={!!following || steps <= -6} onClick={() => changeTranspose(steps - 1)} aria-label={t("stems.transposeDown")}>
        <Minus />
      </Button>
      <span className={cn("min-w-12 text-center text-xs tabular-nums", heardSteps !== 0 && "font-semibold text-primary")} title={t("stems.transposeTitle")} data-testid="stem-transpose-label">
        {transposeLabel}
      </span>
      <Button type="button" variant="ghost" size="icon" className="size-8" disabled={!!following || steps >= 6} onClick={() => changeTranspose(steps + 1)} aria-label={t("stems.transposeUp")}>
        <Plus />
      </Button>
    </div>
  );

  // The parts combined into one waveform (issue #137), remembered on the device.
  const [combined, setCombined] = useState(false);
  useEffect(() => {
    try {
      setCombined(localStorage.getItem(COMBINED_KEY) === "true");
    } catch {
      // Storage blocked: the parts apart.
    }
  }, []);
  const combine = (next: boolean) => {
    setCombined(next);
    try {
      localStorage.setItem(COMBINED_KEY, String(next));
    } catch {
      // Remembered for this page only.
    }
  };
  const combineButton = (
    <Button
      type="button"
      variant={combined ? "secondary" : "ghost"}
      size="icon"
      className="shrink-0"
      aria-pressed={combined}
      onClick={() => combine(!combined)}
      aria-label={t("stems.combine")}
      title={t("stems.combine")}
      data-testid="stem-combine"
    >
      <Layers />
    </Button>
  );
  // The mixer (issue #140): a volume per part, remembered on the device.
  const [mixer, setMixer] = useState(false);
  useEffect(() => {
    try {
      setMixer(localStorage.getItem(MIXER_KEY) === "true");
    } catch {
      // Storage blocked: off.
    }
  }, []);
  const showMixer = (next: boolean) => {
    setMixer(next);
    try {
      localStorage.setItem(MIXER_KEY, String(next));
    } catch {
      // Remembered for this page only.
    }
  };
  const volumeOf = (track: StemTrack) => (active ? (engine.volumes[track.id] ?? 1) : 1);
  const mixerButton = (
    <Button
      type="button"
      variant={mixer ? "secondary" : "ghost"}
      size="icon"
      className="shrink-0"
      aria-pressed={mixer}
      onClick={() => showMixer(!mixer)}
      aria-label={t("stems.mixer")}
      title={t("stems.mixer")}
      data-testid="stem-mixer"
    >
      <SlidersHorizontal />
    </Button>
  );
  const mixed = active && Object.keys(engine.volumes).length > 0;
  const resetMix =
    mixer && mixed ? (
      <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs" onClick={resetStemVolumes} data-testid="stem-mixer-reset">
        <RotateCcw />
        {t("stems.resetMix")}
      </Button>
    ) : null;
  const audibleKey = tracks.map((track) => `${track.id}:${isAudible(engine, track.id)}:${track.peaks ? 1 : 0}:${volumeOf(track)}`).join();
  const combinedPeaks = useMemo(
    () => (combined ? combinePeaks(tracks.filter((track) => isAudible(engine, track.id)).map((track) => ({ ...track, volume: volumeOf(track) })), duration) : null),
    [combined, audibleKey, duration],
  );
  // Minimised (issue #162): what's heard as one waveform, where there's room.
  const compactPeaks = useMemo(
    () => (expanded || !duration ? null : combinePeaks(tracks.filter((track) => isAudible(engine, track.id)).map((track) => ({ ...track, volume: volumeOf(track) })), duration)),
    [expanded, audibleKey, duration],
  );

  // Recording a part (issues #127, #134): in the player, over its own mix, into the multitrack playing -
  // or, for a song with only a whole recording, a new multitrack (the dialog). Not while following the leader.
  const [recordPanel, setRecordPanel] = useState(false);
  // Recording into one of them (issue #142), from its row's actions.
  const [recordInto, setRecordInto] = useState<string | null>(null);
  // The recording whose actions are open (issue #142).
  const [selected, setSelected] = useState<string | null>(null);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const recordable = !!song.record && !following;
  /** One of the viewer's own parts (uploaded or recorded), loaded: record into it, merge it, delete it (someone else's are theirs, or the Audio tab's). */
  const actionable = (track: StemTrack) => recordable && !whole && !!track.mine && !!track.canChange && !track.locked && track.id !== TAKE_ID && !track.failed && !recordPanel;
  const closeRecordPanel = () => {
    setRecordPanel(false);
    setRecordInto(null);
    // Made afresh once the recorder's gone (issue #136): loaded again, ready to play and mix.
    setTimeout(() => prefetchStems(song), 0);
  };
  const recordButton = recordable ? (
    <Button
      type="button"
      variant={recordPanel ? "secondary" : "ghost"}
      size="icon"
      className="shrink-0"
      aria-pressed={recordPanel}
      // Recorded at the stems' own speed (issue #139): a take sung to them slowed wouldn't fit them at 100%.
      disabled={!recordPanel && heardSpeed !== 1}
      onClick={() => {
        if (whole) return setRecorderOpen(true);
        if (!expanded) expand(true);
        if (recordPanel) closeRecordPanel();
        else {
          setSelected(null);
          setRecordPanel(true);
        }
      }}
      aria-label={t("recorder.recordPart")}
      title={heardSpeed !== 1 && !recordPanel ? t("stems.recordAtSpeed") : t("recorder.recordPart")}
      data-testid="stem-record"
    >
      <Mic />
    </Button>
  ) : null;
  // The leader's while following; not changed while recording (a take sung to slowed stems wouldn't fit them at 100%).
  const speedLocked = !!following || recordPanel;
  const speedControl = <SpeedControl speed={heardSpeed} onChange={changeSpeed} disabled={speedLocked} />;
  const recorder =
    recorderOpen && song.record ? (
      <RecorderDialog
        songVersionId={song.songVersionId}
        songTitle={song.title}
        multitracks={multitracksOf(song.record.attachments)}
        target={NEW_TARGET}
        songTempo={song.tempo ?? null}
        songTimeSignature={song.timeSignature ? `${song.timeSignature.numerator}/${song.timeSignature.denominator}` : ""}
        songKey={song.record.songKey ?? ""}
        setlist={song.record.setlist}
        onClose={() => setRecorderOpen(false)}
        onSaved={song.record.onSaved}
      />
    ) : null;

  useEffect(() => {
    dockStems(song.songVersionId);
    return () => undockStems(song.songVersionId);
  }, [song.songVersionId]);

  // Downloaded as the page opens in Practice, so Play is usually instant - when the person chose it, or it's one quick file (issue #366).
  useEffect(() => {
    if (song.prefetch !== false) prefetchStems(song);
    // Once per set of stems (`key`); `song` is a new object on every render.
  }, [key]);

  // Minimised as a page opens (issue #182); minimised, no mixer: the parts' controls are for the expanded player.
  function expand(next: boolean) {
    setExpanded(next);
    if (!next && mixer) showMixer(false);
  }

  const play = (
    <Button
      type="button"
      size="icon"
      className={cn("size-10 shrink-0 rounded-full", engine.following && engine.audioBlocked && "animate-pulse ring-2 ring-amber-500")}
      onClick={() => (engine.following ? unlockSyncAudio() : void (playing ? pauseStems() : playStems(song)))}
      disabled={loading || (!!engine.following && !engine.audioBlocked)}
      aria-label={engine.following ? (engine.audioBlocked ? t("sync.tapToHear") : t("sync.followingShort", { name: engine.following })) : playing ? t("stems.pause") : t("stems.play")}
      title={engine.following ? t("sync.followingShort", { name: engine.following }) : undefined}
      data-testid="stem-play"
    >
      {loading ? <Loader2 className="animate-spin" /> : playing ? <Pause /> : <Play />}
    </Button>
  );
  // The metronome with the recording (issue #100): its tempo, its first beat.
  const beat = active ? engine.beat : null;
  const clickButton = following ? null : (
    <Button
      type="button"
      variant={click ? "secondary" : "ghost"}
      size="icon"
      className="shrink-0"
      aria-pressed={click}
      disabled={!beat && !click}
      onClick={() => setRecordingClick(!click)}
      aria-label={t("stems.clickWith")}
      title={beat ? t("stems.clickWithAt", { tempo: beat.tempo }) : t("stems.clickWithNoTempo")}
      data-testid="stem-click"
    >
      <Metronome />
    </Button>
  );
  // The recording's sections (issue #110): where each starts, the same on each file of the multitrack.
  const cueSections = song.cueSections?.sections ?? [];
  const savedCues = useMemo(() => sortedCues(song.stems.find((file) => file.cuePoints?.length)?.cuePoints, cueSections), [song.stems, cueSections]);
  const [draftCues, setDraftCues] = useState<CuePoint[] | null>(null);
  const cues = draftCues ?? savedCues;
  const cueNames = useCueNames();
  const playingIndex = cues.length ? cueAt(cues, position) : null;
  const playingSection = playingIndex !== null ? cueSections.find((section) => section.id === cues[playingIndex]?.sectionId) : undefined;
  // Placed by who can change every file of the multitrack (its other takes too): they share them.
  const canPlaceCues = recordable && !whole && cueSections.length > 0 && (song.record?.attachments ?? []).filter((file) => file.type === "AUDIO" && file.stemPart && (file.multitrackId ?? null) === (song.stems[0]?.multitrackId ?? null)).every((file) => file.canChange);
  const [cueEditor, setCueEditor] = useState(false);
  // Closed: the saved cues again, not the draft.
  const closeCueEditor = () => {
    setCueEditor(false);
    setDraftCues(null);
  };
  const cueButton = canPlaceCues ? (
    <Button
      type="button"
      variant={cueEditor ? "secondary" : "ghost"}
      size="icon"
      className="shrink-0"
      aria-pressed={cueEditor}
      onClick={() => {
        if (!expanded) expand(true);
        if (cueEditor) closeCueEditor();
        else setCueEditor(true);
      }}
      aria-label={t("stems.placeSections")}
      title={t("stems.placeSections")}
      data-testid="stem-cues"
    >
      <Flag />
    </Button>
  ) : null;
  const time = (
    <span className="min-w-0 shrink truncate text-xs tabular-nums text-muted-foreground" data-testid="stem-time">
      {formatDuration(position)}
      <span className="hidden sm:inline"> / {formatDuration(duration)}</span>
      {/* The section playing, from the cue points (issue #110). */}
      {playingSection ? (
        <span className="font-medium text-foreground" data-testid="stem-time-section">
          {" · "}
          {cueNames.long(playingSection)}
        </span>
      ) : null}
    </span>
  );
  // The transport (issue #162): back to the start, and - with the sections placed - from one to the next, and round one.
  const ready = active && engine.status === "ready" && !following;
  const loop = active ? engine.loop : null;
  /** The section at `at` (s): from its cue to the next one's (before the first: from 0:00 to it). */
  const sectionAt = (at: number) => {
    const index = cueAt(cues, at);
    if (index === null) return { start: 0, end: cues[0]?.at ?? duration };
    return { start: cues[index]!.at, end: cues[index + 1]?.at ?? duration };
  };
  /** To `at`, the section there looped instead if one is. */
  const goTo = (at: number) => {
    if (loop) setStemLoop(sectionAt(at));
    seekStems(at);
  };
  const previousSection = () => {
    const index = cueAt(cues, position);
    // A couple of seconds in: back to its start; else the one before's (or 0:00).
    if (index !== null && position - cues[index]!.at > 2) return goTo(cues[index]!.at);
    goTo(index === null || index === 0 ? 0 : cues[index - 1]!.at);
  };
  const nextCue = cues.find((cue) => cue.at > position + 0.05);
  const nextSection = () => {
    if (nextCue) goTo(nextCue.at);
  };
  const toggleLoop = () => setStemLoop(loop ? null : sectionAt(position));
  const stopButton = (
    <Button type="button" variant="ghost" size="icon" className="shrink-0" disabled={!ready || (!playing && position === (loop?.start ?? 0))} onClick={stopStems} aria-label={t("stems.stop")} title={`${t("stems.stop")} (0)`} data-testid="stem-stop">
      <Square />
    </Button>
  );
  const sectionControls = cues.length ? (
    <span className="flex shrink-0 items-center" data-testid="stem-sections">
      <Button type="button" variant="ghost" size="icon" disabled={!ready} onClick={previousSection} aria-label={t("stems.previousSection")} title={`${t("stems.previousSection")} ([)`} data-testid="stem-previous-section">
        <SkipBack />
      </Button>
      <Button
        type="button"
        variant={loop ? "secondary" : "ghost"}
        size="icon"
        disabled={!ready}
        aria-pressed={!!loop}
        onClick={toggleLoop}
        aria-label={t("stems.loopSection")}
        title={`${t("stems.loopSection")} (L)`}
        data-testid="stem-loop"
      >
        <Repeat />
      </Button>
      <Button type="button" variant="ghost" size="icon" disabled={!ready || !nextCue} onClick={nextSection} aria-label={t("stems.nextSection")} title={`${t("stems.nextSection")} (])`} data-testid="stem-next-section">
        <SkipForward />
      </Button>
    </span>
  ) : null;
  // On a keyboard (issue #162): [ and ] from section to section, L to loop one, 0 back to the start - not while typing.
  const keys = useRef({ previousSection, nextSection, toggleLoop, ready, hasCues: cues.length > 0 });
  keys.current = { previousSection, nextSection, toggleLoop, ready, hasCues: cues.length > 0 };
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || !target || target.closest("input, textarea, select, [contenteditable=true]")) return;
      const { previousSection, nextSection, toggleLoop, ready, hasCues } = keys.current;
      if (!ready) return;
      if (event.key === "0") stopStems();
      else if (hasCues && event.key === "[") previousSection();
      else if (hasCues && event.key === "]") nextSection();
      else if (hasCues && (event.key === "l" || event.key === "L")) toggleLoop();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const status =
    loading ? (
      <p className="text-xs text-muted-foreground" role="status">
        {t("stems.loading", { percent: Math.round(engine.downloaded * 100) })}
      </p>
    ) : active && engine.status === "ready" && !engine.complete ? (
      // Playing before every part's in (issue #366): the rest join as they arrive.
      <p className="text-xs text-muted-foreground" role="status" data-testid="stem-joining">
        {t("stems.joining", { percent: Math.round(engine.downloaded * 100) })}
      </p>
    ) : active && engine.transposeFailed ? (
      <p className="text-xs text-destructive" role="alert">
        {chosenSpeed !== 1 ? t("stems.speedFailed") : t("stems.transposeFailed")}
      </p>
    ) : active && engine.status === "error" ? (
      <p className="text-xs text-destructive" role="alert">
        {t("stems.loadFailed")}
      </p>
    ) : null;

  // The playhead line in the sections' colours (issue #110).
  const sectionsLine = duration ? sectionsGradient(cues, cueSections, duration, Math.min(1, position / duration)) : null;
  const dock = (
    <section
      className="relative border-t bg-background shadow-[0_-4px_12px_-8px_rgb(0_0_0/0.3)]"
      aria-label={t("stems.title")}
      data-testid="stem-player"
      data-state={playing ? "playing" : active ? engine.status : "idle"}
      data-complete={active && engine.complete ? "true" : "false"}
      data-view={expanded ? "expanded" : "compact"}
    >
      {/* How far through, along the top edge. */}
      {loading ? (
        <div
          className="absolute inset-x-0 top-0 h-0.5 bg-muted"
          role="progressbar"
          aria-label={t("stems.loading", { percent: Math.round(engine.downloaded * 100) })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(engine.downloaded * 100)}
          data-testid="stem-download"
        >
          <div className="h-full bg-muted-foreground/60 transition-[width]" style={{ width: `${engine.downloaded * 100}%` }} />
        </div>
      ) : (
        // The playhead: the line along the top edge, in both views - click or drag it to go there (arrow keys too).
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(position, duration)}
          disabled={!active || engine.status !== "ready" || !!following}
          onChange={(event) => seekStems(Number(event.target.value))}
          aria-label={t("stems.position")}
          aria-valuetext={`${formatDuration(position)} / ${formatDuration(duration)}`}
          className="stem-playhead"
          style={{ "--progress": duration ? `${(position / duration) * 100}%` : "0%", ...(sectionsLine ? { "--sections": sectionsLine } : {}) } as CSSProperties}
          data-testid="stem-playhead"
        />
      )}
      {expanded ? (
        <div className={cn("mx-auto flex w-full flex-col gap-2 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]", EDGES)}>
          {/* On a phone, play, the time, the tools and minimize on one line (the time giving way); the multitrack and the transposition on the next (issue #140). */}
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] sm:gap-x-3">
            <span className="flex items-center gap-1">
              {play}
              {/* The transport (issue #162). */}
              <span className="hidden sm:contents">{stopButton}</span>
            </span>
            {time}
            <div className="col-span-4 row-start-2 flex flex-wrap items-center gap-1 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:gap-2" data-testid="stem-controls">
              {sectionControls}
              {upgradeButton}
              {picker}
              {transposeControl}
              {speedControl}
              {resetMix}
            </div>
            <div className="flex shrink-0 items-center [&>button]:size-8 sm:[&>button]:size-9" data-testid="stem-tools">
              {whole ? null : combineButton}
              {whole ? null : mixerButton}
              {cueButton}
              {recordButton}
              {clickButton}
            </div>
            <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => expand(false)} aria-label={t("stems.minimize")} data-testid="stem-minimize">
              <ChevronDown />
            </Button>
          </div>
          {status}
          {cueEditor && canPlaceCues && active && engine.status === "ready" ? <CueEditor song={song} cues={cues} onChange={setDraftCues} onClose={closeCueEditor} /> : null}
          {cues.length ? <SectionLane
              cues={cues}
              sections={cueSections}
              duration={duration || Math.max(...cues.map((cue) => cue.at)) + 10}
              position={position}
              onSeek={active && engine.status === "ready" && !following ? seekStems : undefined}
              // Placing them: a handle on each, as in a video editor (issue #110).
              editing={cueEditor && canPlaceCues && active && engine.status === "ready" ? { beat: engine.beat, onMove: (index, at) => setDraftCues(cues.map((cue, i) => (i === index ? { ...cue, at } : cue))) } : null}
            /> : null}
          {recordPanel && recordable && active && engine.status === "ready" && engine.complete ? <StemRecordPanel
              song={song}
              into={recordInto}
              onClose={closeRecordPanel}
              onNewMultitrack={() => {
                setRecordPanel(false);
                setRecorderOpen(true);
              }}
            /> : null}
          {recorded ? (
            <p className="text-xs text-muted-foreground" data-testid="stem-recorded">
              {t("stems.recordedIn", { details: recorded })}
            </p>
          ) : null}
          {combined && !whole ? (
            // The parts combined (issue #137): their buttons, and one waveform of what's heard - less of the screen taken.
            <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3" data-testid="stem-combined">
              <div className="flex shrink-0 flex-wrap items-center gap-2 px-1.5 py-1">
                {tracks.map((track) => (
                  <PartButton key={track.id} track={track} name={nameOf(track)} on={isAudible(engine, track.id)} muted={engine.muted.has(track.id)} soloed={engine.soloed.has(track.id)} soloing={engine.soloed.size > 0} chip />
                ))}
              </div>
              <Waveform peaks={combinedPeaks} progress={duration ? position / duration : 0} span={1} dim={false} onSeek={active && engine.status === "ready" && !following ? (at) => seekStems(at * duration) : undefined} />
              {/* The mixer too (issue #142): each part's button and fader, compact. */}
              {mixer ? (
                <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:basis-full sm:grid-cols-2" data-testid="stem-combined-mixer">
                  {tracks.map((track) => (
                    <li key={track.id} className="flex items-center gap-2" data-testid="stem-combined-part">
                      <PartButton track={track} name={nameOf(track)} on={isAudible(engine, track.id)} muted={engine.muted.has(track.id)} soloed={engine.soloed.has(track.id)} soloing={engine.soloed.size > 0} chip />
                      <span className="w-24 shrink-0 truncate text-xs">{nameOf(track)}</span>
                      <div className="relative flex h-8 min-w-0 flex-1 items-center">
                        <Fader name={nameOf(track)} volume={volumeOf(track)} disabled={!active || engine.status !== "ready"} onChange={(volume) => setStemVolume(track.id, volume)} compact />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <ul className="-mx-1.5 flex max-h-[45vh] flex-col divide-y overflow-y-auto px-1.5">
              {tracks.map((track) => {
                const name = nameOf(track);
                const on = isAudible(engine, track.id);
                return (
                  <li key={track.id} className="flex flex-wrap items-center gap-2 py-1.5 sm:gap-3" data-testid="stem-track" data-part={track.part ?? "MIX"} data-audible={String(on)}>
                    <PartButton track={track} name={name} on={on} muted={engine.muted.has(track.id)} soloed={engine.soloed.has(track.id)} soloing={engine.soloed.size > 0} />
                    <span className={cn("w-20 shrink-0 min-w-0 sm:w-36", !on && "opacity-50")}>
                      {/* A recording the viewer can change: its name opens what can be done with it (issue #142). */}
                      {actionable(track) ? (
                        <button
                          type="button"
                          className={cn("flex max-w-full items-center gap-0.5 rounded-sm text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", selected === track.id && "text-primary underline")}
                          aria-expanded={selected === track.id}
                          onClick={() => setSelected(selected === track.id ? null : track.id)}
                          data-testid="stem-track-name"
                        >
                          <span className="truncate">{name}</span>
                          {/* Something to tap, on a phone too. */}
                          <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", selected === track.id && "rotate-180")} aria-hidden />
                        </button>
                      ) : (
                        <span className="block truncate text-sm font-medium">{name}</span>
                      )}
                      {/* Who recorded it, and the key it was sung in (issues #131, #135) - never its file's name. */}
                      {track.by || track.offset ? (
                        <span className="hidden truncate text-xs text-muted-foreground sm:block">
                          {[track.by ? t("stems.recordedBy", { name: track.by }) : null, track.offset ? t("stems.sungAt", { shift: signed(track.offset) }) : null].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                    {track.failed ? (
                      <span className="min-w-0 flex-1 text-xs text-destructive">{t(track.empty ? "stems.emptyFile" : "stems.failed", { name })}</span>
                    ) : (
                      // In the mixer (issue #140), its volume: a fader over the waveform on a phone, beside it wider; the waveform as loud.
                      <div className="relative flex min-w-0 flex-1 items-center gap-3">
                        <Waveform
                          peaks={track.peaks}
                          progress={duration ? position / duration : 0}
                          span={duration ? Math.min(1, track.length / duration) : 1}
                          dim={!on}
                          scale={Math.sqrt(volumeGain(volumeOf(track)))}
                          onSeek={active && engine.status === "ready" && !following ? (at) => seekStems(at * duration) : undefined}
                        />
                        {mixer && !whole ? <Fader name={name} volume={volumeOf(track)} disabled={!active || engine.status !== "ready"} onChange={(volume) => setStemVolume(track.id, volume)} /> : null}
                      </div>
                    )}
                    {/* Moved when transposing, or not (issue #135): the drums and cues aren't, to start with. */}
                    {moving && !whole ? (
                      <Button
                        type="button"
                        size="icon"
                        className="shrink-0"
                        variant={isTransposed(heard, track) ? "secondary" : "ghost"}
                        aria-pressed={isTransposed(heard, track)}
                        disabled={!!following}
                        aria-label={t("stems.transposePart", { part: name })}
                        title={t("stems.transposePart", { part: name })}
                        onClick={() => toggleTransposed(track)}
                        data-testid="stem-transpose-part"
                      >
                        <ArrowUpDown />
                      </Button>
                    ) : null}
                    {/* A whole recording has nothing to mute or solo against. M on wider screens, beside S as on a desk (issue #142). */}
                    {whole ? null : (
                      <>
                        <LetterButton letter="M" on={engine.muted.has(track.id)} tone="mute" className="hidden sm:flex" label={t("stems.mute", { part: name })} onClick={() => toggleStemMute(track.id)} testId="stem-mute" />
                        <LetterButton letter="S" on={engine.soloed.has(track.id)} tone="solo" label={t("stems.solo", { part: name })} onClick={() => toggleStemSolo(track.id)} testId="stem-solo" />
                      </>
                    )}
                    {selected === track.id && actionable(track) ? (
                      <div className="w-full">
                        <StemTrackActions
                          song={song}
                          track={track}
                          tracks={tracks}
                          name={name}
                          nameOf={nameOf}
                          onRecordInto={() => {
                            setSelected(null);
                            setRecordInto(track.id);
                            setRecordPanel(true);
                          }}
                          onClose={() => setSelected(null)}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <div className={cn("mx-auto flex w-full items-center gap-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-2", EDGES)}>
          {play}
          {/* The transport (issue #162), where there's room. */}
          <span className="hidden sm:contents">{stopButton}</span>
          {sectionControls ? <span className="hidden md:contents">{sectionControls}</span> : null}
          {/* What plays, by name (issue #182): no part's controls here - they're the expanded player's. */}
          <span className={cn("flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-sm", compactPeaks && "sm:max-w-56 sm:flex-none")} data-testid="stem-recording-name">
            {whole ? <AudioLines className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="truncate">{playingName}</span>
            {whole ? null : (
              <span className="shrink-0 text-xs text-muted-foreground" data-testid="stem-part-count">
                {t("stems.partCount", { count: tracks.length })}
              </span>
            )}
          </span>
          {upgradeButton}
          {/* What's heard, as one waveform (issue #162), where there's room. */}
          {compactPeaks ? (
            <div className="hidden h-8 min-w-24 flex-1 items-center sm:flex" data-testid="stem-compact-waveform">
              <Waveform peaks={compactPeaks} progress={duration ? position / duration : 0} span={1} dim={false} onSeek={ready ? (at) => seekStems(at * duration) : undefined} />
            </div>
          ) : null}
          {status ? <span className="hidden sm:block">{status}</span> : duration ? <span className="hidden sm:block">{time}</span> : null}
          {picker ? <span className="hidden sm:block">{picker}</span> : null}
          {heardSteps !== 0 ? (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary" title={t("stems.transposeTitle")} data-testid="stem-transpose-badge">
              {signed(heardSteps)}
            </span>
          ) : null}
          {heardSpeed !== 1 ? (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary" title={t("stems.speedTitle")} data-testid="stem-speed-badge">
              {speedPercent(heardSpeed)}
            </span>
          ) : null}
          {clickButton}
          <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => expand(true)} aria-label={t("stems.expand")}>
            <ChevronUp />
          </Button>
        </div>
      )}
    </section>
  );

  return slot ? (
    <>
      {createPortal(dock, slot)}
      {recorder}
    </>
  ) : null;
}

/**
 * A part's round button, its instrument's icon: tap to mute it, again to
 * bring it back. Filled while heard, hollow when muted, ringed when soloed.
 * While some parts are soloed, a tap moves this one in or out of the solo
 * instead (muting a part that isn't heard anyway would change nothing).
 */
function PartButton({
  track,
  name,
  on,
  muted,
  soloed,
  soloing,
  chip = false,
}: {
  track: StemTrack;
  name: string;
  on: boolean;
  muted: boolean;
  soloed: boolean;
  /** Some part is soloed. */
  soloing: boolean;
  chip?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = track.part ? PART_ICONS[track.part] : AudioLines;
  // Who recorded it (issue #142), on a multitrack's layer; else which of two of a part.
  const recorder = track.recorder;
  const badge = recorder ? null : track.number || null;
  return (
    <button
      type="button"
      title={track.recorder ? `${name} · ${track.recorder.name}` : name}
      aria-label={soloed ? t("stems.unsolo", { part: name }) : soloing ? t("stems.solo", { part: name }) : t("stems.mute", { part: name })}
      aria-pressed={soloing ? soloed : muted}
      onClick={() => (soloing ? toggleStemSolo(track.id) : toggleStemMute(track.id))}
      data-testid={chip ? "stem-chip" : "stem-part"}
      data-part={track.part ?? "MIX"}
      data-audible={String(on)}
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        on ? "border-primary bg-primary text-primary-foreground" : "border-dashed border-muted-foreground/50 text-muted-foreground",
        soloed && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        track.failed && "opacity-40",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {badge ? (
        <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border bg-background text-[10px] font-semibold text-foreground" aria-hidden>
          {badge}
        </span>
      ) : null}
      {recorder ? (
        <span className="absolute -right-1.5 -bottom-1.5 flex size-5 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-muted text-[9px] font-semibold text-foreground" aria-hidden data-testid="stem-recorder">
          {recorder.avatarUrl ? <img src={sizedAvatarUrl(recorder.avatarUrl, 20)} alt="" className="size-full object-cover" /> : initialsOf(recorder.name)}
        </span>
      ) : null}
    </button>
  );
}

/** Two letters of a name, for an avatar that has no picture. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** M or S on a part's row (issue #142), as on a mixing desk: solo green when on, mute amber. */
function LetterButton({ letter, on, tone, label, onClick, className, testId }: { letter: string; on: boolean; tone: "mute" | "solo"; label: string; onClick: () => void; className?: string; testId: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md border text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        on ? (tone === "solo" ? "border-primary bg-primary text-primary-foreground" : "border-amber-500 bg-amber-500 text-white") : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {letter}
    </button>
  );
}

/** A part's volume in the mixer (issue #140): 0-100%, heard as it moves. */
function Fader({ name, volume, disabled, onChange, compact = false }: { name: string; volume: number; disabled: boolean; onChange: (volume: number) => void; /** On its own, not over a waveform: as wide as its place. */ compact?: boolean }) {
  const { t } = useTranslation();
  const percent = Math.round(volume * 100);
  return (
    <>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        aria-label={t("stems.volume", { part: name })}
        aria-valuetext={`${percent}%`}
        className={cn("stem-fader", compact ? "h-8 min-w-0 flex-1" : "absolute inset-0 h-full w-full sm:static sm:h-8 sm:w-32 sm:shrink-0")}
        style={{ "--level": `${percent}%` } as CSSProperties}
        data-testid="stem-volume"
      />
      <span className="hidden w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">{percent}%</span>
    </>
  );
}

/**
 * A part's waveform, the part played in the accent colour; a click or a
 * drag seeks. Drawn as long as the part is, against the longest (`span`,
 * 0-1): a take shorter than the rest isn't stretched to look like it lasts.
 */
function Waveform({ peaks, progress, span, dim, scale = 1, onSeek }: { peaks: number[] | null; progress: number; span: number; dim: boolean; /** Drawn this high (0-1): as loud as the mixer has it. */ scale?: number; onSeek?: (at: number) => void }) {
  const clip = useId();
  const path = useMemo(
    () =>
      peaks
        ?.map((peak, i) => {
          const height = Math.max(2, peak * 92 * scale);
          return `M${i} ${(100 - height) / 2}h0.7v${height}h-0.7z`;
        })
        .join("") ?? "",
    [peaks, scale],
  );
  const width = peaks?.length ?? 1;

  function seek(event: PointerEvent<HTMLDivElement>) {
    if (!onSeek || (event.type === "pointermove" && event.buttons !== 1)) return;
    const box = event.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)));
  }

  if (!peaks) return <div className="h-px min-w-0 flex-1 bg-border" aria-hidden />;
  return (
    <div
      className={cn("relative flex h-8 min-w-0 flex-1 items-center touch-none", onSeek && "cursor-pointer", dim && "opacity-40")}
      onPointerDown={seek}
      onPointerMove={seek}
      aria-hidden
    >
      {/* After its end: nothing, a line. */}
      <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
      <svg
        viewBox={`0 0 ${width} 100`}
        preserveAspectRatio="none"
        className="relative h-8 shrink-0"
        style={{ width: `${span * 100}%` }}
        data-testid="stem-waveform"
        data-span={span.toFixed(3)}
      >
        <defs>
          <clipPath id={clip}>
            <rect x={0} y={0} width={Math.min(1, span ? progress / span : 0) * width} height={100} />
          </clipPath>
        </defs>
        <path d={path} className="fill-muted-foreground/35" />
        <path d={path} className="fill-primary" clipPath={`url(#${clip})`} />
      </svg>
    </div>
  );
}

/**
 * While stems play and their song's dock isn't on screen - another page,
 * another mode - a small button back to it, and one to pause.
 */
export function StemReturnButton() {
  const { t } = useTranslation();
  const engine = useStems();
  const router = useRouter();
  if (!engine.playing || engine.docked === engine.songVersionId) return null;
  return (
    <div
      className="fixed right-4 bottom-4 z-50 flex items-center gap-1 rounded-full border bg-background p-1 shadow-lg"
      role="region"
      aria-label={t("stems.playingElsewhere")}
      data-testid="stem-return"
    >
      <button
        type="button"
        className="flex min-w-0 items-center gap-2 rounded-full py-1.5 pr-3 pl-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => {
          setMode("practice");
          void router.navigate({ href: engine.returnTo });
        }}
        aria-label={t("stems.backToSong", { title: engine.title })}
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Music className="size-4 animate-pulse" />
        </span>
        <span className="max-w-40 truncate">{engine.title}</span>
      </button>
      {/* Following Sync play's leader: theirs to pause. */}
      {engine.following ? null : (
        <Button type="button" variant="ghost" size="icon" className="rounded-full" onClick={pauseStems} aria-label={t("stems.pause")}>
          <Pause />
        </Button>
      )}
    </div>
  );
}
