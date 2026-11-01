import { multitracksOf, type MultitrackFile } from "../stems/index.js";

/**
 * What plays with a song (issue #366), one choice everywhere - the song's
 * page, Practice, a set, Live and the chord grid:
 * - MASTER: its stereo recording, one file (quick to load);
 * - YOUTUBE: its video;
 * - STEMS: a multitrack's stems, without the parts people recorded into it;
 * - TAKES: the stems with those recorded parts;
 * - METRONOME: just the click, at the song's tempo;
 * - NONE: nothing.
 */
export const PLAYBACK_SOURCES = ["MASTER", "YOUTUBE", "STEMS", "TAKES", "METRONOME", "NONE"] as const;
export type PlaybackSource = (typeof PLAYBACK_SOURCES)[number];

/** What choosing needs of a song's audio file (the API's attachment has it all). */
export interface PlaybackFile extends MultitrackFile {
  /** How it came in (issue #175): a part RECORDED in the app is a take. */
  origin?: "UPLOADED" | "SEPARATED" | "RECORDED";
}

/** What a song has to play. */
export interface PlaybackMaterial<F extends PlaybackFile = PlaybackFile> {
  files: F[];
  /** It has a video (the song's, or its version's reference recording). */
  youtube: boolean;
  /** Its tempo, when known: the metronome is offered without it, but never picked by default. */
  tempo?: number | null;
}

/** A recorded take, rather than one of the stems it was recorded over. */
export const isTake = (file: Pick<PlaybackFile, "origin">) => file.origin === "RECORDED";

/** A whole recording (issue #66): audio that's neither a stem nor part of a multitrack. */
const isMaster = (file: PlaybackFile) => file.type === "AUDIO" && file.stemPart === null && !file.multitrackId;

/** The sources a song offers, in the order they're listed; NONE always. */
export function playbackSourcesOf(material: PlaybackMaterial): PlaybackSource[] {
  const multitracks = multitracksOf(material.files).filter((multitrack) => multitrack.files.length > 0);
  const offered: PlaybackSource[] = [];
  if (material.files.some(isMaster)) offered.push("MASTER");
  if (material.youtube) offered.push("YOUTUBE");
  if (multitracks.some((multitrack) => multitrack.files.some((file) => !isTake(file)))) offered.push("STEMS");
  if (multitracks.some((multitrack) => multitrack.files.some(isTake))) offered.push("TAKES");
  offered.push("METRONOME", "NONE");
  return offered;
}

/**
 * What plays when nothing's chosen: the master (one file, the quickest to
 * load), else the stems (with the takes, when there are some), else the
 * video, else the metronome when the tempo is known, else nothing.
 */
export function defaultPlaybackSource(material: PlaybackMaterial): PlaybackSource {
  const offered = playbackSourcesOf(material);
  if (offered.includes("MASTER")) return "MASTER";
  if (offered.includes("TAKES")) return "TAKES";
  if (offered.includes("STEMS")) return "STEMS";
  if (offered.includes("YOUTUBE")) return "YOUTUBE";
  if (material.tempo) return "METRONOME";
  return "NONE";
}

/** The source that plays: the one chosen (the leader's, the person's), while the song still offers it, else the default. */
export function resolvePlaybackSource(material: PlaybackMaterial, ...chosen: (PlaybackSource | null | undefined)[]): PlaybackSource {
  const offered = playbackSourcesOf(material);
  for (const choice of chosen) if (choice && offered.includes(choice)) return choice;
  return defaultPlaybackSource(material);
}

/** Whether a source plays the song's audio files (the stem player), rather than a video, the metronome or nothing. */
export const playsFiles = (source: PlaybackSource) => source === "MASTER" || source === "STEMS" || source === "TAKES";

/**
 * A multitrack's files as a source plays them: STEMS leaves its takes out
 * (all of them, when it has nothing else: then it's TAKES that offers it).
 */
export function filesForSource<F extends PlaybackFile>(files: F[], source: PlaybackSource): F[] {
  if (source !== "STEMS") return files;
  const stems = files.filter((file) => !isTake(file));
  return stems.length > 0 ? stems : files;
}
