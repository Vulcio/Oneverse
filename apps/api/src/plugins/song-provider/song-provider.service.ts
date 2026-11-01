import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import {
  readSongDocument,
  readSongProviderSourceId,
  songProviderSourceId,
  songToChordPro,
  type ProviderMatch,
  type SongProviderHook,
  type SongProviderSong,
  type SongProviderSongSummary,
} from "@oneverse/core";
import { SongProviderError, endpointUrl, songProviderArtistPicture, songProviderContent, songProviderSearch, songProviderSong } from "./song-provider-client.js";
import { activeSources, noteOutcome, sourceById, type ActiveSongProvider } from "./song-provider-sources.js";

/** A song with chords and lyrics, found at a Song provider (Find chords). */
export interface ChordSearchResult {
  providerId: string;
  providerName: string;
  id: string;
  title: string;
  artists: string[];
  key: string | null;
  language: string | null;
  thumbnailUrl: string | null;
  url: string | null;
}

/** A chosen song's chart, as ChordPro, with what the provider says of it. */
export interface ChordContent {
  providerId: string;
  providerName: string;
  id: string;
  title: string;
  artists: string[];
  writers: string[];
  key: string | null;
  tempo: number | null;
  timeSignature: string | null;
  ccli: string | null;
  copyright: string | null;
  rights: string | null;
  url: string | null;
  /** ChordPro: what the song's chart is read from. */
  content: string;
}

const SEARCH_LIMIT = 15;

/** A provider's song as a metadata match: the provider's own name kept on its source. */
function matchOf(provider: ActiveSongProvider, song: SongProviderSongSummary | SongProviderSong): ProviderMatch {
  const full = song as Partial<SongProviderSong>;
  return {
    title: song.title,
    artist: song.artists.length ? song.artists.join(", ") : null,
    album: song.album,
    releaseDate: song.releaseDate,
    artworkUrl: song.artworkUrl,
    thumbnailUrl: song.thumbnailUrl ?? song.artworkUrl,
    isrc: full.isrc ? full.isrc.replace(/-/g, "").toUpperCase() : null,
    composers: full.writers?.length ? full.writers : undefined,
    tempo: full.tempo ?? null,
    durationSeconds: full.durationSeconds ?? null,
    source: {
      provider: "song_providers",
      id: songProviderSourceId(provider.id, song.id),
      url: song.url ?? endpointUrl(provider.apiUrl, `/songs/${encodeURIComponent(song.id)}`),
      name: provider.name,
    },
  };
}

/**
 * The built-in Song provider plugin's hooks (issue #157): each asks the
 * servers chosen for it, at once; one that fails or is slow is left out,
 * its error kept for Admin, rather than failing the search.
 */
@Injectable()
export class SongProviderService {
  private readonly logger = new Logger(SongProviderService.name);

  /** Every server's answer for a hook; failures logged and kept as that server's. */
  private async fromEach<T>(hook: SongProviderHook, ask: (provider: ActiveSongProvider) => Promise<T>): Promise<{ answers: { provider: ActiveSongProvider; value: T }[]; failed: ActiveSongProvider[]; asked: number }> {
    const providers = await activeSources(hook);
    const settled = await Promise.allSettled(providers.map(ask));
    const answers: { provider: ActiveSongProvider; value: T }[] = [];
    const failed: ActiveSongProvider[] = [];
    settled.forEach((outcome, index) => {
      const provider = providers[index]!;
      if (outcome.status === "fulfilled") {
        answers.push({ provider, value: outcome.value });
        void noteOutcome(provider.id, null);
      } else {
        failed.push(provider);
        const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        this.logger.warn(`Song provider ${provider.name} (${hook}): ${message}`);
        void noteOutcome(provider.id, message);
      }
    });
    return { answers, failed, asked: providers.length };
  }

  /** Song info or artwork matches, for Auto detect and the artwork search; throws only when every server failed. */
  async searchMatches(hook: "songInfo" | "artwork", title: string, artist?: string | null): Promise<ProviderMatch[]> {
    const { answers, asked } = await this.fromEach(hook, (provider) => songProviderSearch(provider, { title, ...(artist && { artist }), limit: SEARCH_LIMIT }));
    if (asked > 0 && answers.length === 0) throw new Error("No song provider answered");
    return answers.flatMap(({ provider, value }) => value.map((song) => matchOf(provider, song)));
  }

  /** A chosen match looked up again: the song's details from its server. */
  async lookupMatch(sourceId: string): Promise<ProviderMatch> {
    const parts = readSongProviderSourceId(sourceId);
    if (!parts) throw new NotFoundException("Not a song provider's song");
    const provider = await sourceById(parts.providerId).catch(() => {
      throw new NotFoundException("That song provider was removed");
    });
    try {
      return matchOf(provider, await songProviderSong(provider, parts.songId));
    } catch (error) {
      if (error instanceof SongProviderError && error.code === "not-found") throw new NotFoundException(`${provider.name} doesn't have that song anymore`);
      throw error;
    }
  }

  /** An artist's picture from the first server asked for pictures that has one. */
  async artistPicture(name: string): Promise<{ url: string; pageUrl: string; name: string } | null> {
    for (const provider of await activeSources("artistPictures")) {
      try {
        const found = await songProviderArtistPicture(provider, name);
        void noteOutcome(provider.id, null);
        if (found) return { url: found.url, pageUrl: found.pageUrl ?? found.url, name: provider.name };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void noteOutcome(provider.id, message);
        throw error;
      }
    }
    return null;
  }

  /** Whether any server is asked for chords, for the song content box to offer Find chords. */
  async chordsAvailable(): Promise<{ available: boolean; providers: string[] }> {
    const providers = await activeSources("chords");
    return { available: providers.length > 0, providers: providers.map((provider) => provider.name) };
  }

  /** Find chords: the songs with chords and lyrics, from every server asked for them, in their order. */
  async searchChords(title: string, artist?: string | null, language?: string | null): Promise<{ results: ChordSearchResult[]; unavailable: string[] }> {
    const { answers, failed, asked } = await this.fromEach("chords", (provider) =>
      songProviderSearch(provider, { title, ...(artist && { artist }), ...(language && { language }), limit: SEARCH_LIMIT }),
    );
    if (asked === 0) throw new ServiceUnavailableException("No song provider is set up for chords");
    if (answers.length === 0) throw new ServiceUnavailableException("The song providers are unavailable — try again in a moment");
    const results = answers.flatMap(({ provider, value }) =>
      value
        .filter((song) => song.hasContent)
        .map((song) => ({
          providerId: provider.id,
          providerName: provider.name,
          id: song.id,
          title: song.title,
          artists: song.artists,
          key: song.key,
          language: song.language,
          thumbnailUrl: song.thumbnailUrl,
          url: song.url,
        })),
    );
    return { results, unavailable: failed.map((provider) => provider.name) };
  }

  /** A chosen song's chords and lyrics, as ChordPro, with its details. */
  async chordContent(providerId: string, songId: string): Promise<ChordContent> {
    const provider = (await activeSources("chords")).find((one) => one.id === providerId);
    if (!provider) throw new NotFoundException("That song provider isn't asked for chords");
    try {
      const [song, content] = await Promise.all([songProviderSong(provider, songId), songProviderContent(provider, songId)]);
      let chart: string;
      if (content.format === "chordpro") chart = content.content;
      else {
        let document;
        try {
          document = readSongDocument(content.content);
        } catch (error) {
          throw new SongProviderError("invalid", `Its song document can't be read: ${error instanceof Error ? error.message : String(error)}`);
        }
        chart = songToChordPro(document, { title: song.title, artists: song.artists, composers: song.writers });
      }
      void noteOutcome(provider.id, null);
      return {
        providerId,
        providerName: provider.name,
        id: song.id,
        title: song.title,
        artists: song.artists,
        writers: song.writers,
        key: song.key,
        tempo: song.tempo,
        timeSignature: song.timeSignature,
        ccli: song.ccli,
        copyright: content.copyright ?? song.copyright,
        rights: content.rights,
        url: song.url,
        content: chart,
      };
    } catch (error) {
      if (error instanceof SongProviderError) {
        void noteOutcome(provider.id, error.message);
        if (error.code === "not-found") throw new NotFoundException(`${provider.name} doesn't have that song's chords`);
        throw new ServiceUnavailableException(`${provider.name}: ${error.message}`);
      }
      throw error;
    }
  }
}
