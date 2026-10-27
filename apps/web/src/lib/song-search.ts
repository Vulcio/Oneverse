import { foldSearchWords, keptSongReferences, onlineOrKept, parseLyricsQuery, searchKeptEntries, searchKeptLyrics, searchKeptSongs, SONGBOOK_HIT_LIMITS, songbookReferences, type LyricsMatch, type SongbookEntryHit } from "@oneverse/core";
import { useEffect, useState } from "react";
import { apiClient } from "#/lib/api-client";
import { artistNames } from "#/lib/artists";
import { deviceStorage } from "#/lib/offline-data";

/** A song found: by the library's search online, among the kept sets offline. */
export interface FoundSong {
  id: string;
  title: string;
  versionName: string | null;
  artists: string | null;
  /** Where it is in the player's songbooks, abbreviations first (issue #213). */
  references: string[];
}
/** A song found by its words (issue #221), with the line. */
export interface FoundLyrics {
  id: string;
  title: string;
  versionName: string | null;
  match: LyricsMatch;
}

// Show more (issue #213): more of each group of numbers.
const MORE_LIMITS = { exact: 50, prefix: 100, contains: 100 };
const DEBOUNCE_MS = 200;

export interface SongSearchOptions {
  /** In the songs' words too (issue #221). */
  inLyrics: boolean;
  /** More of each group of songbook numbers (Show more). */
  moreEntries?: boolean;
  /** Only songs that can go in this set (issue #328: its Add songs); online only, as adding is. */
  addableTo?: string;
  limit?: number;
}

/**
 * Songs as the search box finds them (issues #48, #213, #221, #328): by the
 * library's search (title, subtitle, version, artist, CCLI - ignoring case,
 * accents and punctuation), by songbook number ("HY 42", "42") and, when
 * asked, by their words - a moment after typing stops; offline, among the
 * songs and songbooks kept on the device. The search box and a set's Add
 * songs both search with this, so they find the same songs.
 */
export function useSongSearch(query: string, { inLyrics, moreEntries = false, addableTo, limit = 8 }: SongSearchOptions) {
  const [songs, setSongs] = useState<FoundSong[]>([]);
  const [entries, setEntries] = useState<SongbookEntryHit[]>([]);
  const [lyrics, setLyrics] = useState<FoundLyrics[]>([]);
  const [searching, setSearching] = useState(false);
  const q = foldSearchWords(query);
  const lyricsQuery = inLyrics ? parseLyricsQuery(query) : null;
  const lyricsKey = lyricsQuery ? JSON.stringify(lyricsQuery) : "";
  // Offline, only where the songs found needn't go in a set.
  const orKept = <T,>(online: () => Promise<T>, kept: () => Promise<T>) => (addableTo ? online() : onlineOrKept(online, kept));

  useEffect(() => {
    if (!lyricsKey) {
      setLyrics([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      orKept<FoundLyrics[]>(
        async () =>
          (await apiClient.listSongVersions({ q: query.trim(), in: "lyrics", pageSize: limit, sort: "title", addableTo })).items.flatMap((song) =>
            song.lyricsMatch ? [{ id: song.id, title: song.title, versionName: song.versionName, match: song.lyricsMatch }] : [],
          ),
        // Offline: the kept songs' words, matched the same way.
        async () =>
          (await searchKeptLyrics(deviceStorage(), query, limit)).map((song) => ({ id: song.songVersionId, title: song.title, versionName: song.versionName, match: song.lyricsMatch })),
      )
        .then((found) => current && setLyrics(found))
        .catch(() => current && setLyrics([]));
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [lyricsKey, addableTo]);

  useEffect(() => {
    if (!q) {
      setSongs([]);
      setEntries([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let current = true;
    const timer = setTimeout(() => {
      orKept<FoundSong[]>(
        async () =>
          (await apiClient.listSongVersions({ q: query.trim(), pageSize: limit, sort: "title", references: true, addableTo })).items.map((song) => ({
            id: song.id,
            title: song.title,
            versionName: song.versionName,
            artists: artistNames(song.artists),
            references: song.songbookReferences ?? [],
          })),
        // Offline: the songs kept on the device, on their own or in kept sets (issues #50, #52).
        async () =>
          Promise.all(
            (await searchKeptSongs(deviceStorage(), query, limit)).map(async ({ songVersionId, title, versionName, artists }) => ({
              id: songVersionId,
              title,
              versionName,
              artists,
              references: await keptSongReferences(deviceStorage(), songVersionId),
            })),
          ),
      )
        .then((found) => current && setSongs(found))
        .catch(() => current && setSongs([]))
        .finally(() => current && setSearching(false));
      // "HY 42", "42": songbook entries by reference (issue #48); offline, in kept songbooks.
      if (songbookReferences(query).length === 0) setEntries([]);
      else
        orKept(
          () => apiClient.searchSongbookEntries(query.trim(), moreEntries, addableTo),
          () => searchKeptEntries(deviceStorage(), query, moreEntries ? MORE_LIMITS : SONGBOOK_HIT_LIMITS),
        )
          .then((hits) => current && setEntries(hits))
          .catch(() => current && setEntries([]));
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [q, query, moreEntries, addableTo]);

  return { q, lyricsQuery, songs, entries, lyrics, searching };
}
