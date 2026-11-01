import { foldForMatch, isVariant, matchTier } from "../metadata/rank.js";
import type { MetadataMatch } from "../schemas/metadata.js";
import { songProviderSourceId, type SongProviderRating, type SongProviderSongSummary } from "./index.js";

/** One chart of a song, at one Song provider (issues #157, #369). */
export interface ChordVersion {
  providerId: string;
  providerName: string;
  /** The provider's own ID for the song. */
  songId: string;
  /** The version's ID at the provider, sent back for its chart; null: the song's only chart. */
  versionId: string | null;
  name: string | null;
  key: string | null;
  capo: number | null;
  author: string | null;
  rating: SongProviderRating | null;
  /** Where the provider got it from, when it gathers charts from elsewhere. */
  source: { name: string; url: string | null } | null;
  url: string | null;
}

/**
 * A song found by Find chords: the same song at every provider that has it,
 * its versions best rated first, and the same song at the music services
 * (`match`, merged as Auto detect does, with the providers' own sources
 * added), or null when none of them has it.
 */
export interface ChordSong {
  title: string;
  artists: string[];
  album: string | null;
  releaseDate: string | null;
  language: string | null;
  thumbnailUrl: string | null;
  versions: ChordVersion[];
  match: MetadataMatch | null;
}

/** A chosen version's chart, as ChordPro, with what its provider says of it. */
export interface ChordContent {
  providerId: string;
  providerName: string;
  id: string;
  versionId: string | null;
  versionName: string | null;
  title: string;
  artists: string[];
  writers: string[];
  key: string | null;
  capo: number | null;
  tempo: number | null;
  timeSignature: string | null;
  ccli: string | null;
  copyright: string | null;
  rights: string | null;
  /** Where the version comes from, when its provider gathered it from elsewhere. */
  source: { name: string; url: string | null } | null;
  url: string | null;
  /** ChordPro: what the song's chart is read from. */
  content: string;
}

/**
 * A rating weighed by how many gave it (a Bayesian average, towards 3 out
 * of 5 as if 5 people had said so): one 5-star vote doesn't come before a
 * thousand 4.7s. No rating sorts after every rating.
 */
export function ratingScore(rating: SongProviderRating | null): number {
  if (!rating) return -1;
  const count = rating.count ?? 1;
  return (rating.value * count + 3 * 5) / (count + 5);
}

/** A song's versions, as Find chords lists them: those it lists, or its one chart. */
function versionsOf(provider: { id: string; name: string }, song: SongProviderSongSummary): ChordVersion[] {
  const base = { providerId: provider.id, providerName: provider.name, songId: song.id };
  if (song.versions.length)
    return song.versions.map((version) => ({
      ...base,
      versionId: version.id,
      name: version.name || null,
      key: version.key ?? song.key,
      capo: version.capo,
      author: version.author || null,
      rating: version.rating,
      source: version.source ? { name: version.source.name, url: version.source.url } : null,
      url: version.url ?? song.url,
    }));
  if (!song.hasContent) return [];
  return [{ ...base, versionId: null, name: null, key: song.key, capo: null, author: null, rating: null, source: null, url: song.url }];
}

const songKey = (title: string, artists: string[]) => `${foldForMatch(title)}|${foldForMatch(artists[0] ?? "")}`;
const isProviderSource = (provider: string) => provider === "song_providers";

/**
 * The same song at the music services: the best-ranked match with its
 * title, and its artist when the song credits one - never a karaoke or
 * cover the song isn't - or null. Its sources then include the provider's
 * song, so looking it up combines both.
 */
function serviceMatch(song: ChordSong, matches: MetadataMatch[]): MetadataMatch | null {
  const wanted = song.artists.length ? 4 : 3;
  const found = matches.find(
    (match) => match.sources.some((source) => !isProviderSource(source.provider)) && matchTier(match, song.title, song.artists[0]) >= wanted && !isVariant(match, song.title),
  );
  if (!found) return null;
  const first = song.versions[0]!;
  const sources = found.sources.filter((source) => !isProviderSource(source.provider));
  return {
    ...found,
    sources: [...sources, { provider: "song_providers", id: songProviderSourceId(first.providerId, first.songId), url: first.url ?? "", name: first.providerName }],
  };
}

/**
 * Find chords' results (issue #369): every provider's songs, in the
 * providers' order and each one's own, the same song from several (same
 * title and first artist) one row with all their versions - best rated
 * first, then as the providers listed them - and each row paired with the
 * music services' match, when one fits.
 */
export function chordSongs(answers: { provider: { id: string; name: string }; songs: SongProviderSongSummary[] }[], matches: MetadataMatch[] = []): ChordSong[] {
  const rows: ChordSong[] = [];
  const byKey = new Map<string, ChordSong>();
  for (const { provider, songs } of answers) {
    for (const song of songs) {
      const versions = versionsOf(provider, song);
      if (!versions.length) continue;
      const key = songKey(song.title, song.artists);
      const same = byKey.get(key);
      if (same) {
        same.versions.push(...versions);
        same.album ??= song.album;
        same.releaseDate ??= song.releaseDate;
        same.thumbnailUrl ??= song.thumbnailUrl ?? song.artworkUrl;
        continue;
      }
      const row: ChordSong = {
        title: song.title,
        artists: song.artists,
        album: song.album,
        releaseDate: song.releaseDate,
        language: song.language,
        thumbnailUrl: song.thumbnailUrl ?? song.artworkUrl,
        versions,
        match: null,
      };
      rows.push(row);
      byKey.set(key, row);
    }
  }
  for (const row of rows) {
    // Stable: equal scores keep the providers' order.
    row.versions.sort((a, b) => ratingScore(b.rating) - ratingScore(a.rating));
    row.match = serviceMatch(row, matches);
    if (row.match) {
      row.album ??= row.match.album;
      row.releaseDate ??= row.match.releaseDate;
      row.thumbnailUrl ??= row.match.thumbnailUrl ?? row.match.artworkUrl;
    }
  }
  return rows;
}
