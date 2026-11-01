import type { MetadataMatch, MetadataSource } from "../schemas/metadata.js";

/** One provider's answer, before merging: a match with its single source. */
export interface ProviderMatch extends Omit<MetadataMatch, "sources"> {
  source: MetadataSource;
}

/** Folded for comparing: lower case, no accents, no "(Live)"-style asides or " - Single" suffixes, no punctuation. */
export function foldForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s+-\s+(single|ep|remaster(ed)?( \d{4})?|\d{4} remaster(ed)?)\s*$/, " ")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// A recording of the song that isn't the song as released: after the
// original unless the title asked for one. "Live" isn't among them - many
// worship songs first came out on a live album.
const VARIANT = /\b(karaoke|instrumental|remix|acoustic|demo|cover|tribute|backing track|playback|originally performed|made famous|in the style of|lullaby|piano version|sped up|slowed)\b/i;

/** The artists credited, one per name ("A & B", "A feat. B", "A, B"). */
function artistNames(artist: string): string[] {
  return artist
    .split(/\s*(?:,|&|\band\b|\bfeat\.?|\bft\.?|\bwith\b|\bx\b)\s*/i)
    .map(foldForMatch)
    .filter(Boolean);
}

function artistMatches(found: string | null, wanted: string): boolean {
  if (!found) return false;
  const want = foldForMatch(wanted);
  if (!want) return true;
  const whole = foldForMatch(found);
  return whole === want || artistNames(found).includes(want) || whole.includes(want) || (whole.length > 3 && want.includes(whole));
}

/**
 * How closely a match fits the title and artist looked up: 4 for both,
 * 3 for the title when no artist was given, 2 for the title alone, 1 for
 * part of the title (with the artist, or none given), 0 otherwise.
 */
export function matchTier(match: Pick<MetadataMatch, "title" | "artist">, title: string, artist?: string | null): number {
  const wanted = foldForMatch(title);
  const found = foldForMatch(match.title);
  const titleFit = found === wanted ? 2 : found && wanted && (found.includes(wanted) || wanted.includes(found)) ? 1 : 0;
  const artistFit = !artist?.trim() ? 1 : artistMatches(match.artist, artist) ? 2 : 0;
  if (titleFit === 2) return artistFit === 2 ? 4 : artistFit === 1 ? 3 : 2;
  return titleFit === 1 && artistFit >= 1 ? 1 : 0;
}

export function isVariant(match: Pick<MetadataMatch, "title">, title: string): boolean {
  return VARIANT.test(match.title) && !VARIANT.test(title);
}

/** Sortable: "1998" < "1998-05" < "1998-05-01" < none. */
const dateKey = (date: string | null) => (date && /^\d{4}/.test(date) ? date : "9999");

/** The earlier of two release dates, the more precise one on a tie of what they share. */
function earlier(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const [shortest, longest] = a.length <= b.length ? [a, b] : [b, a];
  if (longest.startsWith(shortest)) return longest;
  return a < b ? a : b;
}

/**
 * Merges the providers' matches and ranks them (issue #22): the same
 * release found by several providers is one match (same title, artist and
 * album), with the details of the provider listed first in `order` and
 * the earliest release date. Then the closest to the title and artist
 * first; among those, the song as released before its versions; then the
 * earliest release - the song's first, not a later compilation; then the
 * providers' order, and each provider's own.
 *
 * `results` is each provider's matches, best first, keyed by provider.
 */
export function rankMetadataMatches(
  results: Partial<Record<MetadataSource["provider"], ProviderMatch[]>>,
  order: MetadataSource["provider"][],
  title: string,
  artist?: string | null,
  limit = 20,
): MetadataMatch[] {
  interface Row {
    match: MetadataMatch;
    position: number;
    rank: number;
  }
  const rows: Row[] = [];
  const byKey = new Map<string, Row>();
  order.forEach((provider, position) => {
    (results[provider] ?? []).forEach((found, rank) => {
      const key = [found.title, found.artist ?? "", found.album ?? ""].map(foldForMatch).join("|");
      const same = byKey.get(key);
      if (same && !same.match.sources.some((source) => source.provider === provider)) {
        same.match.sources.push(found.source);
        same.match.releaseDate = earlier(same.match.releaseDate, found.releaseDate);
        same.match.artworkUrl ??= found.artworkUrl;
        same.match.thumbnailUrl ??= found.thumbnailUrl;
        same.match.isrc ??= found.isrc;
        if (!same.match.composers?.length && found.composers?.length) same.match.composers = found.composers;
        same.match.tempo ??= found.tempo;
        same.match.durationSeconds ??= found.durationSeconds;
        same.rank = Math.min(same.rank, rank);
        return;
      }
      const { source, ...details } = found;
      const row = { match: { ...details, sources: [source] }, position, rank };
      rows.push(row);
      if (!same) byKey.set(key, row);
    });
  });
  const scored = rows.map((row) => ({
    ...row,
    tier: matchTier(row.match, title, artist),
    variant: isVariant(row.match, title) ? 1 : 0,
    date: dateKey(row.match.releaseDate),
  }));
  scored.sort(
    (a, b) =>
      b.tier - a.tier ||
      a.variant - b.variant ||
      a.date.slice(0, 4).localeCompare(b.date.slice(0, 4)) ||
      a.date.localeCompare(b.date) ||
      a.position - b.position ||
      a.rank - b.rank,
  );
  return scored.slice(0, limit).map((row) => row.match);
}
