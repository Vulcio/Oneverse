import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { MusicBrainzRecordingMatch, MusicBrainzWorkMatch, ProviderMatch } from "@oneverse/core";
import { MusicBrainzClientService, MusicBrainzRequestError } from "./musicbrainz-client.service.js";

/** Only a genuine upstream 404 means "doesn't exist" - anything else (a
 * network failure, or a 503 that outlasted our retries) is transient and
 * must not be reported as if the record were missing. */
function rethrowLookupFailure(err: unknown, notFoundMessage: string): never {
  if (err instanceof MusicBrainzRequestError && err.status === 404) {
    throw new NotFoundException(notFoundMessage);
  }
  throw asServiceError();
}

function asServiceError(): ServiceUnavailableException {
  return new ServiceUnavailableException("MusicBrainz is temporarily unavailable — try again in a moment");
}

interface MbArtistCredit {
  name: string;
}

interface MbRelease {
  title: string;
  date?: string;
  status?: string;
}

interface MbRecording {
  id: string;
  title: string;
  score?: number;
  "artist-credit"?: MbArtistCredit[];
  releases?: MbRelease[];
  "first-release-date"?: string;
  /** Milliseconds. */
  length?: number | null;
}

interface MbRecordingSearchResponse {
  recordings?: MbRecording[];
}

interface MbWork {
  id: string;
  title: string;
  score?: number;
  languages?: string[];
  iswcs?: string[];
}

interface MbWorkSearchResponse {
  works?: MbWork[];
}

// MusicBrainz's Lucene-based search syntax treats these characters as
// operators - a raw title/artist containing one (e.g. `Wake Up (Reprise)`)
// would otherwise break the query or silently narrow the match.
// See https://musicbrainz.org/doc/MusicBrainz_API/Search#Lucene_query_syntax
function escapeLucene(value: string): string {
  return value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
}

function artistCreditName(credits?: MbArtistCredit[]): string | null {
  if (!credits || credits.length === 0) return null;
  return credits.map((c) => c.name).join(" & ");
}

function mapRecording(recording: MbRecording): MusicBrainzRecordingMatch {
  const release = recording.releases?.[0];
  return {
    mbid: recording.id,
    title: recording.title,
    artist: artistCreditName(recording["artist-credit"]),
    releaseTitle: release?.title ?? null,
    releaseDate: release?.date ?? null,
    score: recording.score ?? 100,
    sourceUrl: `https://musicbrainz.org/recording/${recording.id}`,
  };
}

/**
 * The release a recording first came out on: the earliest dated one, an
 * official release over a promotion or bootleg of the same date - not the
 * first listed, often a later compilation (issue #22).
 */
function firstRelease(recording: MbRecording): MbRelease | undefined {
  const dated = (recording.releases ?? []).filter((release) => release.date);
  const official = (release: MbRelease) => (release.status === "Official" ? 0 : 1);
  dated.sort((a, b) => a.date!.slice(0, 4).localeCompare(b.date!.slice(0, 4)) || official(a) - official(b) || a.date!.localeCompare(b.date!));
  return dated[0] ?? recording.releases?.[0];
}

/** A recording as a metadata match (issue #22): its first release, not its first listed. */
function metadataMatch(recording: MbRecording): ProviderMatch {
  const release = firstRelease(recording);
  return {
    title: recording.title,
    artist: artistCreditName(recording["artist-credit"]),
    album: release?.title ?? null,
    releaseDate: recording["first-release-date"] || release?.date || null,
    artworkUrl: null,
    thumbnailUrl: null,
    durationSeconds: recording.length && recording.length > 0 ? Math.round(recording.length / 1000) : null,
    source: { provider: "musicbrainz", id: recording.id, url: `https://musicbrainz.org/recording/${recording.id}` },
  };
}

function mapWork(work: MbWork): MusicBrainzWorkMatch {
  return {
    mbid: work.id,
    title: work.title,
    iswc: work.iswcs?.[0] ?? null,
    language: work.languages?.[0] ?? null,
    score: work.score ?? 100,
    sourceUrl: `https://musicbrainz.org/work/${work.id}`,
  };
}

@Injectable()
export class MusicBrainzService {
  constructor(private readonly client: MusicBrainzClientService) {}

  async searchRecordings(title: string, artist?: string): Promise<MusicBrainzRecordingMatch[]> {
    try {
      const titleQuery = `recording:"${escapeLucene(title)}"`;
      if (artist) {
        // AND-ing artist onto the query is a strict match - a slightly
        // off spelling/variant zeroes out an otherwise-good title match
        // (reported as "sometimes no results" in production). Fall back
        // to a title-only search rather than surface nothing.
        const combined = await this.client.get<MbRecordingSearchResponse>("recording", {
          query: `${titleQuery} AND artist:"${escapeLucene(artist)}"`,
          limit: "10",
        });
        if (combined.recordings?.length) return combined.recordings.map(mapRecording);
      }
      const result = await this.client.get<MbRecordingSearchResponse>("recording", { query: titleQuery, limit: "10" });
      return (result.recordings ?? []).map(mapRecording);
    } catch {
      throw asServiceError();
    }
  }

  /**
   * Metadata matches for Auto detect (issue #22): more recordings than
   * searchRecordings (the song's first release is often not among the
   * best-scored ten), each with the release it first came out on.
   */
  async searchMatches(title: string, artist?: string | null): Promise<ProviderMatch[]> {
    const titleQuery = `recording:"${escapeLucene(title)}"`;
    if (artist) {
      const combined = await this.client.get<MbRecordingSearchResponse>("recording", {
        query: `${titleQuery} AND artist:"${escapeLucene(artist)}"`,
        limit: "25",
      });
      if (combined.recordings?.length) return combined.recordings.map(metadataMatch);
    }
    const result = await this.client.get<MbRecordingSearchResponse>("recording", { query: titleQuery, limit: "25" });
    return (result.recordings ?? []).map(metadataMatch);
  }

  /** One recording as a metadata match, looked up again when it's chosen. */
  async match(mbid: string): Promise<ProviderMatch> {
    try {
      return metadataMatch(await this.client.get<MbRecording>(`recording/${mbid}`, { inc: "artist-credits+releases" }));
    } catch (err) {
      rethrowLookupFailure(err, "MusicBrainz recording not found");
    }
  }

  /**
   * An artist by name (issue #86): the best-scored whose name is this one
   * (ignoring case and accents), with its Wikidata item when MusicBrainz
   * links one - the way to the right Wikipedia article, not a namesake's.
   * Null when none is named so.
   */
  async findArtist(name: string): Promise<{ mbid: string; wikidataId: string | null } | null> {
    const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
    const found = await this.client.get<{ artists?: { id: string; name: string; score?: number; aliases?: { name: string }[] }[] }>("artist", {
      query: `artist:"${escapeLucene(name)}"`,
      limit: "5",
    });
    const wanted = fold(name);
    const artist = (found.artists ?? []).find((a) => fold(a.name) === wanted || a.aliases?.some((alias) => fold(alias.name) === wanted));
    if (!artist) return null;
    const detail = await this.client.get<{ relations?: { type?: string; url?: { resource?: string } }[] }>(`artist/${artist.id}`, { inc: "url-rels" });
    const wikidata = detail.relations?.find((relation) => relation.type === "wikidata")?.url?.resource;
    return { mbid: artist.id, wikidataId: wikidata?.match(/(Q\d+)$/)?.[1] ?? null };
  }

  async searchWorks(title: string): Promise<MusicBrainzWorkMatch[]> {
    try {
      const result = await this.client.get<MbWorkSearchResponse>("work", {
        query: `work:"${escapeLucene(title)}"`,
        limit: "10",
      });
      return (result.works ?? []).map(mapWork);
    } catch {
      throw asServiceError();
    }
  }

  async getRecording(mbid: string): Promise<MusicBrainzRecordingMatch> {
    try {
      const recording = await this.client.get<MbRecording>(`recording/${mbid}`, {
        inc: "artist-credits+releases",
      });
      return mapRecording(recording);
    } catch (err) {
      rethrowLookupFailure(err, "MusicBrainz recording not found");
    }
  }

  async getWork(mbid: string): Promise<MusicBrainzWorkMatch> {
    try {
      const work = await this.client.get<MbWork>(`work/${mbid}`, {});
      return mapWork(work);
    } catch (err) {
      rethrowLookupFailure(err, "MusicBrainz work not found");
    }
  }
}
