import { playsFiles, resolvePlaybackSource, type PlaybackSource } from "@oneverse/core";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "#/lib/api-client";
import { prefetchFiles, songFiles } from "#/lib/song-files";
import { sourceFilesOf } from "#/lib/stem-files";
import { chosenMultitrack } from "#/lib/stem-choices";
import { syncState } from "#/lib/sync-client";

/**
 * Where a person's choice of what plays with a song is kept (issue #366):
 * with their chart preferences on the server, as their choice of view is
 * (issue #155) - for a song of a set, as the set plays it (its
 * arrangement); else the song as written. So it follows them to their
 * other devices.
 */
export interface PlaybackStore {
  /** Names the song (and set) it's for: what the copy kept here is keyed by. */
  key: string;
  /** Known already (a set's song view carries it); else loaded. */
  initial?: PlaybackSource | null;
  load?: () => Promise<PlaybackSource | null>;
  save: (source: PlaybackSource) => Promise<unknown>;
}

export function songPlaybackStore(songVersionId: string): PlaybackStore {
  return {
    key: songVersionId,
    load: () => apiClient.getChartPreferences(songVersionId).then((preferences) => preferences.playback ?? null),
    save: (playback) => apiClient.saveChartPreferences(songVersionId, null, { playback }),
  };
}

export function setPlaybackStore(setId: string, itemId: string, initial: PlaybackSource | null | undefined): PlaybackStore {
  return { key: `${setId}/${itemId}`, initial: initial ?? null, save: (playback) => apiClient.setSetlistChartPreferences(setId, itemId, { playback }) };
}

// Chosen in this tab: back on the song, it's what it was, before the server answers.
const chosenHere = new Map<string, PlaybackSource>();

/** How long the saved choice is waited for before loading what plays without it (ms): a slow answer shouldn't hold the song back. */
const CHOICE_WAIT_MS = 1500;

/**
 * The person's choice for the song: null while there's none (or it's
 * loading). `known` once it's settled - kept here, handed over, or the
 * server answered (or took too long): until then nothing is fetched, so
 * the files of a source they didn't choose aren't loaded while their
 * choice is on its way.
 */
export function usePlaybackChoice(store: PlaybackStore): { chosen: PlaybackSource | null; known: boolean; choose: (source: PlaybackSource) => void } {
  const [chosen, setChosen] = useState<PlaybackSource | null>(() => chosenHere.get(store.key) ?? store.initial ?? null);
  const settledAt = (key: string) => chosenHere.has(key) || !store.load;
  const [known, setKnown] = useState(() => settledAt(store.key));
  // Chosen before the saved choice arrived: that one's older.
  const touched = useRef(false);
  useEffect(() => {
    touched.current = false;
    setChosen(chosenHere.get(store.key) ?? store.initial ?? null);
    if (settledAt(store.key) || !store.load) return setKnown(true);
    setKnown(false);
    let live = true;
    const waited = setTimeout(() => live && setKnown(true), CHOICE_WAIT_MS);
    store
      .load()
      .then((saved) => {
        if (live && !touched.current && saved) setChosen(saved);
      })
      .catch(() => {
        // Offline or signed out: what the song has decides.
      })
      .finally(() => {
        clearTimeout(waited);
        if (live) setKnown(true);
      });
    return () => {
      live = false;
      clearTimeout(waited);
    };
  }, [store.key]);
  const choose = (source: PlaybackSource) => {
    touched.current = true;
    chosenHere.set(store.key, source);
    setChosen(source);
    setKnown(true);
    store.save(source).catch(() => {
      // Kept for this tab; saved the next time it's chosen online.
    });
  };
  return { chosen, known, choose };
}

/**
 * Fetches the next song of a set ahead (issue #366), a moment after this
 * one opens: what plays with it for this person (or as Sync play's leader
 * chose), when that's its audio files - so Play there is quick. A video,
 * the metronome or nothing need nothing fetched.
 */
export function usePrefetchSetItem(setId: string, itemId: string | null, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !itemId) return;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        const view = await apiClient.getSetlistSong(setId, itemId).catch(() => null);
        if (!live || !view?.song) return;
        const { attachments, offline } = await songFiles(view.song.id);
        // Kept on the device already, or listed from there: nothing to fetch.
        if (!live || offline) return;
        const sync = syncState();
        const leaders = sync.setId === setId ? (sync.session?.playback?.[itemId] ?? null) : null;
        const tempo = view.arrangement?.document.defaults.tempo ?? view.song.tempo;
        const chosen = chosenHere.get(`${setId}/${itemId}`) ?? view.view.preferences?.playback ?? null;
        // A video, the metronome or nothing: nothing to fetch.
        if ((leaders ?? chosen) && !playsFiles((leaders ?? chosen)!)) return;
        // Its video isn't known here: the files decide.
        const source = resolvePlaybackSource({ files: attachments, youtube: false, tempo }, leaders, chosen);
        if (!playsFiles(source)) return;
        const files = sourceFilesOf(attachments, source as "MASTER" | "STEMS" | "TAKES", chosenMultitrack(`${view.song.id}@${setId}`), setId, view.arrangement?.multitrackId ?? null);
        await prefetchFiles(view.song.id, files.stems);
      })();
    }, 1500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [setId, itemId, enabled]);
}
