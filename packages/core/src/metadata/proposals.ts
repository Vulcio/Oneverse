import type { MetadataMatch } from "../schemas/metadata.js";
import { foldForMatch, isVariant, matchTier } from "./rank.js";

/**
 * What a match can fill in on a song (issue #352), in the order the review
 * shows them. The providers don't say a song's key or time signature: those
 * stay the chart's (or the audio analysis's).
 */
export const SONG_INFO_FIELDS = ["title", "artists", "writers", "album", "year", "isrc", "tempo", "duration", "artwork"] as const;
export type SongInfoField = (typeof SONG_INFO_FIELDS)[number];

/** The song as it is, for the fields a match can fill. */
export interface SongInfoCurrent {
  title: string;
  artists: string[];
  /** Everyone credited with writing it: writers, composers and lyricists. */
  writers: string[];
  album: string | null;
  year: number | null;
  isrc: string | null;
  tempo: number | null;
  durationSeconds: number | null;
  /** Whether the song has an image of its own already. */
  hasImage: boolean;
}

export type SongInfoValue = string | string[] | number | boolean | null;

/** One field a match would change: as it is, as the match has it, and whether it's ticked to start with. */
export interface SongInfoProposal {
  field: SongInfoField;
  current: SongInfoValue;
  proposed: SongInfoValue;
  /** Ticked to start with: the song has nothing there. Something it has is never replaced unless asked. */
  fillsEmpty: boolean;
}

const blank = (value: SongInfoValue): boolean =>
  value === null || value === false || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);

const same = (a: SongInfoValue, b: SongInfoValue): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((name, i) => foldForMatch(name) === foldForMatch(b[i]!));
  if (typeof a === "string" && typeof b === "string") return foldForMatch(a) === foldForMatch(b) && a.trim().length > 0;
  return a === b;
};

/** "1998-05-01" → 1998. */
const yearOf = (date: string | null): number | null => {
  const year = date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
  return year && year >= 1000 && year <= 9999 ? year : null;
};

/**
 * What `match` would change on a song (issue #352): every field where it
 * has something the song doesn't, or something else. A field the match
 * says nothing about, or says the same, isn't listed. Only the empty ones
 * start ticked: nothing the song has is overwritten without asking.
 */
export function songInfoProposals(current: SongInfoCurrent, match: MetadataMatch): SongInfoProposal[] {
  const proposed: Record<SongInfoField, [SongInfoValue, SongInfoValue]> = {
    title: [current.title, match.title?.trim() || null],
    artists: [current.artists, match.artist?.trim() ? [match.artist.trim()] : null],
    writers: [current.writers, match.composers?.length ? match.composers : null],
    album: [current.album, match.album?.trim() || null],
    year: [current.year, yearOf(match.releaseDate)],
    isrc: [current.isrc, match.isrc?.replace(/[-\s]/g, "").toUpperCase() || null],
    tempo: [current.tempo, match.tempo ? Math.round(match.tempo) : null],
    duration: [current.durationSeconds, match.durationSeconds ?? null],
    artwork: [current.hasImage, match.artworkUrl ? true : null],
  };
  const proposals: SongInfoProposal[] = [];
  for (const field of SONG_INFO_FIELDS) {
    const [now, next] = proposed[field];
    if (blank(next)) continue;
    // A song with an image always lists the artwork: it's the match's, not the same picture.
    if (field !== "artwork" && same(now, next)) continue;
    proposals.push({ field, current: now, proposed: next, fillsEmpty: blank(now) });
  }
  return proposals;
}

/**
 * The match to take without asking (bulk imports, issue #352): the first
 * one, when it's the song as released with the same title and artist.
 * Nothing without an artist to tell one "Amazing Grace" from another.
 */
export function confidentMatch(matches: MetadataMatch[], title: string, artist: string | null | undefined): MetadataMatch | null {
  const [first] = matches;
  if (!first || !artist?.trim()) return null;
  return matchTier(first, title, artist) === 4 && !isVariant(first, title) ? first : null;
}
