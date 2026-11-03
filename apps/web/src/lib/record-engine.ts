import type { Attachment } from "@oneverse/core";
import { Recorder, type Beat, type Take } from "#/lib/recorder";
import { downloadOnce } from "#/lib/song-files";
import {
  directStemsOutput,
  getStemState,
  isAudible,
  pauseStems,
  playStems,
  seekStems,
  setStemsTake,
  stemBuffer,
  stemMono,
  stemsAudioContext,
  stemsZeroAt,
  TAKE_ID,
  toggleStemMute,
  type StemSong,
} from "#/lib/stem-engine";

/**
 * What the recording screen records with (issue #365), one way or the
 * other, so it's the same screen everywhere:
 *
 * - "own": a context of its own, playing the multitrack's parts and the
 *   click (Recorder): from the song's page, and for a new multitrack.
 * - "player": the stem player's clock and mix, its mutes, solos and
 *   transposition (issue #134): from the player, where the multitrack is
 *   loaded. The click is the player's own (with the recording).
 *
 * Both start a take from a time in the multitrack after a count-in, say
 * where it is, stop it, play takes back with the rest, and give the part a
 * take replaces (to splice into).
 */
export interface RecordEngine {
  kind: "own" | "player";
  recorder: Recorder;
  /** The parts that can be heard while recording (own); the player's are its tracks. */
  parts: Attachment[];
  /** Starts a take from `from` s, after `lead` s of count-in; resolves with the multitrack's 0:00 on the audio clock. */
  start(options: { from: number; lead: number; beat: Beat | null; click: boolean; heard: Set<string>; replace: string | null }): Promise<number>;
  /** Where the take is, in the multitrack (s): negative or before `from` in the count-in. */
  position(zeroAt: number): number;
  /** Ends the take. */
  stop(zeroAt: number): Promise<Take>;
  /** The part a take replaces, mono on this clock, to splice into. */
  base(id: string): Float32Array | null;
  /** Plays `samples` (a take, from the multitrack's 0:00) with the rest from `from`; null plays the rest alone. */
  play(
    samples: Float32Array | null,
    options: {
      from: number;
      beat: Beat | null;
      click: boolean;
      heard: Set<string>;
      replace: string | null;
      name: string;
      part: Attachment["stemPart"];
    },
  ): Promise<void>;
  stopPlaying(): void;
  /** What's heard with the take, decoded: drawn ahead of the playhead while recording. */
  ahead(heard: Set<string>, replace: string | null): AudioBuffer[];
  /** Whether it's playing back now. */
  playing(): boolean;
  close(): void;
}

/** A recorder on a context of its own, with the multitrack's parts decoded to play along with. */
export async function openOwnEngine(songVersionId: string, files: Attachment[]): Promise<RecordEngine> {
  const recorder = await Recorder.open();
  return ownEngine(recorder, songVersionId, files);
}

async function ownEngine(recorder: Recorder, songVersionId: string, files: Attachment[]): Promise<RecordEngine> {
  const loaded = await Promise.all(
    files.map(async (file) => ({
      id: file.id,
      blob: await downloadOnce(songVersionId, file).catch(() => null),
    })),
  );
  await recorder.setBacking(loaded.filter((file): file is { id: string; blob: Blob } => file.blob !== null));
  const parts = files.filter((file) => recorder.backingIds.includes(file.id));
  let playingUntil = 0;
  return {
    kind: "own",
    recorder,
    parts,
    async start({ from, lead, beat, click, heard, replace }) {
      return recorder.start({
        beat,
        lead,
        from,
        click,
        heard,
        stopAt: replace ? new Map([[replace, from]]) : undefined,
        preroll: true,
      });
    },
    position: (zeroAt) => recorder.positionOf(zeroAt),
    stop: (zeroAt) => recorder.finish(zeroAt),
    base: (id) => recorder.monoOf(id),
    async play(samples, { from, beat, click, heard, replace }) {
      const replaced = replace ? new Map([[replace, 0]]) : undefined;
      const take = samples ?? new Float32Array(1);
      recorder.preview(take, {
        beat,
        click,
        heard,
        nudge: 0,
        from,
        stopAt: replaced,
      });
      const longest = Math.max(take.length / recorder.context.sampleRate, ...parts.filter((part) => heard.has(part.id)).map((part) => recorder.backingDuration(part.id)));
      playingUntil = recorder.context.currentTime + Math.max(0, longest - from) + 0.2;
    },
    stopPlaying() {
      playingUntil = 0;
      recorder.stopPlaying();
    },
    ahead: (heard, replace) => parts.filter((part) => heard.has(part.id) && part.id !== replace).flatMap((part) => recorder.backingBuffer(part.id) ?? []),
    playing: () => recorder.context.currentTime < playingUntil,
    close: () => recorder.close(),
  };
}

/**
 * A recorder on the stem player's clock (issue #134): the take is recorded
 * over the player's own mix, from where it's asked, the part it replaces
 * muted while it's heard.
 */
export async function openPlayerEngine(song: StemSong): Promise<RecordEngine> {
  const context = stemsAudioContext();
  if (!context) throw new Error("stems not loaded");
  directStemsOutput();
  void context.resume();
  const recorder = await Recorder.open(context);
  // Parts muted for the take they're replaced by, given back on close.
  const mutedHere = new Set<string>();
  const mute = (id: string | null) => {
    for (const muted of [...mutedHere]) {
      if (muted !== id) {
        toggleStemMute(muted);
        mutedHere.delete(muted);
      }
    }
    if (id && !getStemState().muted.has(id)) {
      toggleStemMute(id);
      mutedHere.add(id);
    }
  };
  return {
    kind: "player",
    recorder,
    parts: [],
    async start({ from, lead, replace }) {
      mute(replace);
      await setStemsTake(null);
      pauseStems();
      seekStems(Math.max(0, from - lead));
      recorder.startCapture();
      await playStems(song);
      return stemsZeroAt() ?? 0;
    },
    position: () => getStemState().position,
    async stop(zeroAt) {
      pauseStems();
      return recorder.finish(zeroAt);
    },
    base: (id) => stemMono(id),
    async play(samples, { from, replace, name, part }) {
      mute(replace);
      pauseStems();
      await setStemsTake(
        samples
          ? {
              samples,
              part: part ?? "OTHER",
              partName: null,
              name,
              offset: getStemState().transpose,
            }
          : null,
      );
      seekStems(Math.max(0, from));
      await playStems(song);
    },
    stopPlaying: () => pauseStems(),
    ahead(_heard, replace) {
      const now = getStemState();
      return now.tracks.filter((track) => track.id !== TAKE_ID && track.id !== replace && isAudible(now, track.id)).flatMap((track) => stemBuffer(track.id) ?? []);
    },
    playing: () => getStemState().playing,
    close() {
      pauseStems();
      mute(null);
      void setStemsTake(null);
      recorder.close();
    },
  };
}
