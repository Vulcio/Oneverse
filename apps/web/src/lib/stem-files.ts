import { beatsPerTempoUnit, defaultTempoUnit, filesForSource, isTake, multitracksOf, STEM_PARTS, TIME_SIGNATURE_PATTERN, transposesPart, type Attachment, type TempoUnit, type BeatLevel, type CueSection, type StemPart, type BeatMap } from "@oneverse/core";
import type { ReactNode } from "react";

/**
 * What the stem player plays and shows, without its audio (`stem-engine.ts`,
 * issue #427): a song as a page hands it over, its tracks and the player's
 * state, which of a song's files play, and what's worked out from them.
 * Nothing here keeps anything: the same answer for the same files.
 */

/** A file the player plays: a stem (with its part), or a whole recording (null) when a song has no stems. */
export type StemFile = Attachment & { stemPart: StemPart | null };

/** A song's stems as a page offers them to the player. */
export interface StemSong {
  songVersionId: string;
  title: string;
  /** Its artists, one line, and its image (issue #173): the lock screen's Now Playing. */
  artist?: string | null;
  imageUrl?: string | null;
  /** The page to come back to: the song's, or its page in a set. */
  returnTo: string;
  stems: StemFile[];
  /** The file's bytes; `onProgress` hears them arrive, when the source can tell. */
  load: (file: Attachment, onProgress?: (received: number, total: number | null) => void) => Promise<Blob>;
  /** The song's tempo and time signature, for the metronome with the recording (issue #100); its recording's own tempo comes first. */
  tempo?: number | null;
  /** The note the song's tempo counts (issue #377); left out, its time signature's default. */
  tempoUnit?: TempoUnit | null;
  timeSignature?: { numerator: number; denominator: number } | null;
  /** The version's own metronome pattern (issue #384); left out, the player's. */
  metronomeBeats?: BeatLevel[] | null;
  /** Which of the song's multitracks `stems` are (issue #123): null its original stems. */
  multitrackId?: string | null;
  /** The song's multitracks, for the player to offer the others. */
  multitracks?: MultitrackChoice[];
  /** Its whole recording (issue #182), offered with them; `multitrackId` is RECORDING_CHOICE while it's what plays. */
  recording?: { name: string } | null;
  /** Playing the whole recording: the multitrack to switch to (null: the original stems); undefined when there's none. */
  upgrade?: string | null;
  /** Where the choice of multitrack is remembered: the song, or the song in a set (issue #127). */
  choiceKey?: string;
  /** Transposed by this many semitones as it plays (issue #129); `transposeParts` says, by file, which parts are (#135) - else all but the drums and cues. */
  transpose?: number;
  transposeParts?: Record<string, boolean>;
  /** Played this much slower or faster, in its key (issue #139); 1 as recorded. */
  speed?: number;
  /** The song's own key: what the stems are in when they don't say (for the key they're transposed to). */
  songKey?: string | null;
  /** The key the page plays the song in (a set's): with nothing chosen, the stems are transposed to it. */
  targetKey?: string | null;
  /** What plays (issue #366): the master, the stems, or the stems with the takes - shared with Sync play's followers. Left out: as the files say. */
  source?: "MASTER" | "STEMS" | "TAKES";
  /** Switches what plays (issue #366) from the player's own list: to the master, or to the stems (with the takes when the song has them). */
  switchSource?: (to: "MASTER" | "STEMS") => void;
  /** What plays, chosen in the dock (Practice, issue #390). */
  sourceControl?: ReactNode;
  /** The page has the metronome (its tempo pill, issue #390): no click button in the minimised dock. */
  clickInPage?: boolean;
  /** Loaded as the page opens (issue #366): when the person chose this (or it's one quick file). Left out: true. */
  prefetch?: boolean;
  /** The song's sections and the order they're sung in (issue #110): what cue points name and place. */
  cueSections?: { sections: CueSection[]; flow: string[] };
  /** Recording a part from the player (issue #127): what the recorder needs; left out where it can't (offline). */
  record?: {
    attachments: Attachment[];
    songKey?: string;
    setlist?: { id: string; name: string } | null;
    onSaved: () => void;
  };
}

/** A multitrack as the player lists it. */
export interface MultitrackChoice {
  id: string | null;
  name: string | null;
  parts: number;
  /** The set it was recorded for (issue #127). */
  setlistId: string | null;
}

export interface StemTrack {
  id: string;
  /** Null: a whole recording, played when the song has no stems. */
  part: StemPart | null;
  /** Its own name for the part (issue #131), shown instead of the part's. */
  partName: string | null;
  /** Who recorded it, when it isn't the viewer (issue #131). */
  by: string | null;
  /** Who recorded it, the viewer too - on a multitrack's layer, or when the parts come from more than one person (issue #142): their avatar on its button. */
  recorder?: { name: string; avatarUrl: string | null } | null;
  /** The viewer uploaded or recorded it. */
  mine?: boolean;
  /** Kept as uploaded (issue #145): no actions, no one's badge. */
  locked?: boolean;
  /** The viewer can record into it, merge it or delete it (issue #142). */
  canChange?: boolean;
  filename: string;
  /** 1, 2… when two files are the same part ("Guitar 1"), else 0. */
  number: number;
  /** The waveform, 0-1 per slice: the server's while it downloads (issue #388), then the decoded audio's; null until either. */
  peaks: number[] | null;
  /** Its length (s), once known (its stored waveform says, else decoding): a take shorter than the rest draws as long as it is. */
  length: number;
  /** Decoded, so it plays (issue #388): until then a waveform shown is the server's, filling in as it downloads. */
  ready?: boolean;
  /** How much of its file has downloaded, 0-1 (issue #388). */
  downloaded?: number;
  /** Recorded this many semitones above the multitrack (issue #135). */
  offset: number;
  /** The take just recorded in the player (issue #134), not kept yet. */
  take?: boolean;
  failed: boolean;
  /** Failed because the file has nothing in it (a take where the microphone gave nothing). */
  empty?: boolean;
}

export interface StemState {
  /** What's loaded: which song, and which files (a part reassigned is another set of stems). */
  key: string | null;
  songVersionId: string | null;
  /** Which of its multitracks is loaded (issue #123); null its original stems. */
  multitrackId: string | null;
  title: string;
  returnTo: string;
  /** "ready" once every part that's heard has arrived (issue #366): Play starts them together; the muted ones join in as they arrive - `complete` once they all have. */
  status: "idle" | "loading" | "ready" | "error";
  /** Every file has arrived (or failed): what recording a part over them needs. */
  complete: boolean;
  /** What plays (issue #366), as the page chose it; null: as the files say. */
  source: "MASTER" | "STEMS" | "TAKES" | null;
  /** From the press on Play to the first sound (ms, issue #366), for the last start that had to load or wake the audio; null before. */
  firstSoundMs: number | null;
  /** How much of the stems has downloaded, 0-1, while loading. */
  downloaded: number;
  tracks: StemTrack[];
  playing: boolean;
  position: number;
  duration: number;
  muted: ReadonlySet<string>;
  soloed: ReadonlySet<string>;
  /** Each part's volume (issue #140), 0-1, by file; 1 when not set. */
  volumes: Readonly<Record<string, number>>;
  /** The song whose dock is on screen, if any: elsewhere a playing song gets the floating button. */
  docked: string | null;
  /** Playing: recording position `position` (s) heard at `epoch` on the device's clock (ms) - what Sync play shares (issue #100). */
  anchor: { epoch: number; position: number } | null;
  /** Following Sync play's leader: their name; play, pause and seek are theirs. */
  following: string | null;
  /** Following, but the browser hasn't let it make a sound yet: a press will (unlockStemsAudio). */
  audioBlocked: boolean;
  /** Transposed by this many semitones (issue #129); by file, which parts are, when not as their part says (#135). */
  transpose: number;
  transposeParts: Record<string, boolean>;
  /** Transposing couldn't start here (no AudioWorklet, say): it plays as recorded. */
  transposeFailed: boolean;
  /**
   * Played this much slower or faster (issue #139), in its key: 1 as
   * recorded. Positions and durations stay the recording's time; the audio
   * clock runs `speed` times slower or faster through it.
   */
  speed: number;
  /**
   * The recording's beat: its tempo, time signature and where its first
   * beat falls (s), for the metronome with it; `freeIntro` when what comes
   * before is played freely (issue #178); `map`, its own beats and bars when
   * they were found (issue #299). Null without a tempo.
   */
  beat: { tempo: number; timeSignature: { numerator: number; denominator: number } | null; firstBeat: number; freeIntro: boolean; map: BeatMap | null; metronomeBeats?: BeatLevel[] | null } | null;
  /** Played over and over (issue #162): from `start` to `end` (s, the recording's time); null: through to the end. */
  loop: { start: number; end: number } | null;
}

/** A song's stems in the player's order: by part, then by name - all of them, whatever multitrack. */
export function stemsOf(attachments: Attachment[]): (Attachment & { stemPart: StemPart })[] {
  return attachments
    .filter((file): file is Attachment & { stemPart: StemPart } => file.type === "AUDIO" && file.stemPart !== null)
    .sort((a, b) => STEM_PARTS.indexOf(a.stemPart) - STEM_PARTS.indexOf(b.stemPart) || a.filename.localeCompare(b.filename));
}

/** The choice of the song's whole recording (issue #182), rather than one of its multitracks: kept, and shared in Sync play, as a multitrack's id is. */
export const RECORDING_CHOICE = "recording";

/** A song's whole recording (issue #66): its latest audio file that's neither a stem nor part of a multitrack; null when it has none. */
export function wholeRecordingOf(attachments: Attachment[]): Attachment | null {
  const [latest] = attachments.filter((file) => file.type === "AUDIO" && file.stemPart === null && !file.multitrackId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return latest ?? null;
}

/**
 * What the player plays for a song (issues #66, #123, #182): the
 * multitrack asked for (or its whole recording, RECORDING_CHOICE); with
 * nothing asked for, its whole recording when it has one - one file, quick
 * to load - else its first multitrack (its original stems when it has
 * them); or nothing. `strict`: only what was asked for (Sync play follows
 * the leader's, not another).
 */
export function playableOf(attachments: Attachment[], multitrackId?: string | null, strict = false): StemFile[] {
  // One with only other takes has nothing to play.
  const multitracks = multitracksOf(attachments).filter((multitrack) => multitrack.files.length > 0);
  const recording = wholeRecordingOf(attachments);
  if (multitrackId === RECORDING_CHOICE && recording) return [recording];
  if (multitrackId === undefined && recording) return [recording];
  const chosen = multitrackId === undefined ? undefined : multitracks.find((multitrack) => multitrack.id === multitrackId);
  if (chosen) return chosen.files;
  if (strict && multitrackId) return [];
  if (multitracks[0]) return multitracks[0].files;
  return recording ? [recording] : [];
}

/** A song's files for the player: the chosen multitrack's (see chooseMultitrack), and the others to offer. */
export function stemFilesOf(
  attachments: Attachment[],
  multitrackId: string | null | undefined,
  /** On a set's song page (issue #127): with nothing chosen, the multitrack recorded for that set. */
  setlistId?: string,
  /** The version's multitrack (issue #346): with nothing chosen and none recorded for the set, it plays. */
  versionMultitrackId?: string | null,
): Pick<StemSong, "stems" | "multitrackId" | "multitracks" | "recording" | "upgrade"> {
  const multitracks = multitracksOf(attachments)
    .filter((multitrack) => multitrack.files.length > 0)
    .map((multitrack) => ({ id: multitrack.id, name: multitrack.name, parts: multitrack.files.length, setlistId: multitrack.setlistId }));
  // On a set's page, the multitrack recorded for that set rather than the song's first.
  const forSet = setlistId ? multitracks.find((multitrack) => multitrack.setlistId === setlistId) : undefined;
  const recording = wholeRecordingOf(attachments);
  // The version's own (issue #346), when the song still has it.
  const forVersion = versionMultitrackId ? multitracks.find((multitrack) => multitrack.id === versionMultitrackId) : undefined;
  // Nothing chosen: the set's multitrack (unless there's a whole recording), then the version's, then the song's own.
  const fallback = !recording && forSet ? forSet.id : forVersion ? forVersion.id : undefined;
  const stems = playableOf(attachments, multitrackId === undefined ? fallback : multitrackId);
  const playingRecording = !!recording && stems.length === 1 && stems[0]?.id === recording.id;
  return {
    stems,
    multitrackId: playingRecording ? RECORDING_CHOICE : (stems[0]?.multitrackId ?? null),
    multitracks,
    recording: recording ? { name: recording.filename } : null,
    // Playing the recording (issue #182): the multitrack a press switches to - the set's, else the first.
    upgrade: playingRecording && multitracks.length > 0 ? (forSet ?? multitracks[0]!).id : undefined,
  };
}

/**
 * A song's files for what plays (issue #366): its whole recording for
 * MASTER; for STEMS and TAKES the multitrack chosen (or the set's, the
 * version's, the first) among those that have something for it - the
 * takes left out for STEMS.
 */
export function sourceFilesOf(
  attachments: Attachment[],
  source: "MASTER" | "STEMS" | "TAKES",
  multitrackId: string | null | undefined,
  setlistId?: string,
  versionMultitrackId?: string | null,
): Pick<StemSong, "stems" | "multitrackId" | "multitracks" | "recording" | "upgrade" | "source"> {
  const recording = wholeRecordingOf(attachments);
  const all = multitracksOf(attachments).filter((multitrack) => multitrack.files.length > 0);
  const listed = (list: typeof all) => list.map((multitrack) => ({ id: multitrack.id, name: multitrack.name, parts: filesForSource(multitrack.files, source).length, setlistId: multitrack.setlistId }));
  const preferred = (list: typeof all) =>
    list.find((multitrack) => multitrack.id === multitrackId) ??
    (setlistId ? list.find((multitrack) => multitrack.setlistId === setlistId) : undefined) ??
    (versionMultitrackId ? list.find((multitrack) => multitrack.id === versionMultitrackId) : undefined) ??
    list[0];
  if (source === "MASTER") {
    // Its multitracks listed beside it, and the one a press switches to (issue #182).
    const upgrade = preferred(all);
    return { stems: recording ? [recording] : [], multitrackId: RECORDING_CHOICE, multitracks: listed(all), recording: recording ? { name: recording.filename } : null, upgrade: upgrade ? upgrade.id : undefined, source };
  }
  // STEMS: the multitracks with stems of their own, not just takes.
  const offered = all.filter((multitrack) => source === "TAKES" || multitrack.files.some((file) => !isTake(file)));
  const chosen = preferred(offered);
  return {
    stems: chosen ? (filesForSource(chosen.files, source) as StemFile[]) : [],
    multitrackId: chosen?.id ?? null,
    multitracks: listed(offered),
    recording: recording ? { name: recording.filename } : null,
    source,
  };
}

export function stemKey(song: Pick<StemSong, "songVersionId" | "stems">): string {
  return `${song.songVersionId}|${song.stems.map((stem) => `${stem.id}:${stem.stemPart}`).join()}`;
}

/** Tracks as listed before anything is decoded. */
export function tracksOf(stems: StemFile[]): StemTrack[] {
  // Who recorded the parts, the locked stems (issue #145) aside: theirs is the song's.
  const uploaders = new Set(stems.filter((stem) => !stem.locked).map((stem) => stem.uploadedBy?.id ?? null));
  return stems.map((stem) => {
    // Two of a part are numbered ("Guitar 1"), unless they're named.
    const same = stems.filter((other) => other.stemPart === stem.stemPart && !other.partName);
    return {
      id: stem.id,
      part: stem.stemPart,
      partName: stem.partName || null,
      by: stem.mine === false ? (stem.uploadedBy?.displayName ?? null) : null,
      recorder: stem.uploadedBy && !stem.locked && (stem.multitrackId || uploaders.size > 1) ? { name: stem.uploadedBy.displayName, avatarUrl: stem.uploadedBy.avatarUrl ?? null } : null,
      mine: stem.mine,
      locked: !!stem.locked,
      canChange: stem.canChange,
      filename: stem.filename,
      number: !stem.partName && same.length > 1 ? same.indexOf(stem) + 1 : 0,
      peaks: null,
      length: 0,
      offset: stem.pitchOffset ?? 0,
      failed: false,
      ready: false,
      downloaded: 0,
    };
  });
}

export function isAudible(current: Pick<StemState, "muted" | "soloed">, id: string): boolean {
  return current.soloed.size > 0 ? current.soloed.has(id) : !current.muted.has(id);
}

/** Whether a part is moved when transposing (issue #135): as chosen for it, else as its part says. */
export function isTransposed(current: Pick<StemState, "transposeParts">, track: Pick<StemTrack, "id" | "part">): boolean {
  return current.transposeParts[track.id] ?? transposesPart(track.part);
}

/** A fader's position (0-1) as a gain: squared, so its travel sounds even (half way is about -12 dB). */
export function volumeGain(volume: number): number {
  return Math.max(0, Math.min(1, volume)) ** 2;
}

/** The recording's beat, from its first file (the stems share it) and the song. */
export function beatOf(song: Pick<StemSong, "stems" | "tempo" | "tempoUnit" | "timeSignature" | "metronomeBeats">): StemState["beat"] {
  const first = song.stems[0];
  const tempo = first?.recordingTempo ?? songBeatTempo(song);
  if (!tempo) return null;
  return {
    tempo,
    timeSignature: timeSignatureOf(first?.recordingTimeSignature) ?? song.timeSignature ?? null,
    firstBeat: first?.recordingFirstBeat ?? 0,
    freeIntro: song.stems.some((stem) => stem.recordingFreeIntro),
    map: (first?.recordingBeats?.length ?? 0) >= 2 && first?.recordingDownbeats?.length ? { beats: first.recordingBeats!, downbeats: first.recordingDownbeats } : null,
    metronomeBeats: song.metronomeBeats ?? null,
  };
}

/**
 * The song's tempo in its time signature's beats, as a recording's is
 * counted: its own counts its note (issue #377), so a 6/8 song's 71
 * quarters are 142 eighths (issue #384).
 */
export function songBeatTempo(song: Pick<StemSong, "tempo" | "tempoUnit" | "timeSignature">): number | null {
  if (!song.tempo) return null;
  return Math.round(song.tempo * beatsPerTempoUnit(song.tempoUnit ?? defaultTempoUnit(song.timeSignature), song.timeSignature?.denominator ?? 4) * 100) / 100;
}

/** "6/8" as numbers; null when there's none or it doesn't read. */
export function timeSignatureOf(text: string | null | undefined): { numerator: number; denominator: number } | null {
  const match = text ? TIME_SIGNATURE_PATTERN.exec(text) : null;
  return match ? { numerator: Number(match[1]), denominator: Number(match[2]) } : null;
}

/** The take just recorded, as a track, until it's kept or dropped. */
export const TAKE_ID = "__take";

/** How long the loaded song lasts (s): its decoded parts' longest, else - while they download - what their stored waveforms say (issue #388). */
export function shownDuration(current: Pick<StemState, "duration" | "tracks">): number {
  if (current.duration > 0) return current.duration;
  return current.tracks.reduce((longest, track) => Math.max(longest, track.length), 0);
}
