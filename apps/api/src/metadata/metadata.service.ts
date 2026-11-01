import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import {
  METADATA_CAPABILITIES,
  METADATA_PROVIDER_NAMES,
  METADATA_PROVIDERS,
  PROVIDER_CAPABILITIES,
  rankMetadataMatches,
  type MetadataCapability,
  type MetadataMatch,
  type MetadataProviderKey,
  type MetadataSource,
  type LinkCandidate,
  type LinkSearchServices,
  type ProviderMatch,
  type StreamingLinkType,
} from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import { decryptSecret, encryptSecret } from "@oneverse/secret-crypto";
import { artworkAtSize, itunesLookup, itunesSearch, type ITunesSong } from "../artwork/itunes.js";
import { MusicBrainzService } from "../musicbrainz/musicbrainz.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SongProviderService } from "../plugins/song-provider/song-provider.service.js";
import { readyHooks } from "../plugins/song-provider/song-provider-sources.js";
import { deezerArtistPicture } from "../artists/artist-sources.js";
import { appleMusicArtistPicture, appleMusicSearch, appleMusicSong, musicKitKeyProblem, type AppleMusicAuth, type MusicKitCredentials } from "./apple-music-api.js";
import { deezerSearch, deezerTrack } from "./deezer.provider.js";
import { spotifyArtistPicture, spotifySearch, spotifyTrack, type SpotifyCredentials } from "./spotify-api.js";
import { youtubeSearch } from "./youtube-api.js";

/** How long a search waits on a provider (MusicBrainz's queue included) before going on without it. */
const SEARCH_WAIT_MS = 15000;

export type ProviderCapabilities = Record<MetadataCapability, boolean>;

export interface MetadataProviderSetting {
  key: MetadataProviderKey;
  name: string;
  /** What it's asked for (issue #89): only what it can do is ever on. */
  capabilities: ProviderCapabilities;
  /** What it can do. */
  supports: MetadataCapability[];
  /** What it can do with the keys it has now: Spotify needs its app, Apple Music's artist pictures its API. */
  ready: ProviderCapabilities;
}

/** A song's artwork to choose from, from one of the providers allowed to give it (issue #89). */
export interface ArtworkCandidate {
  provider: MetadataProviderKey;
  title: string;
  artist: string;
  album: string | null;
  releaseDate: string | null;
  /** The artwork, full size (what gets stored). */
  artworkUrl: string;
  /** A small one, to choose from. */
  thumbnailUrl: string;
}

export interface EffectiveMetadataSettings {
  /** Every provider, in the order they're asked. */
  providers: MetadataProviderSetting[];
  source: "database" | "env" | "default";
  /** The Apple Music API's MusicKit key (issue #87) - never the private key itself, only whether the database has one. */
  appleMusic: {
    /** What signs requests: a key (saved here, or env vars), else a developer token address, else nothing (iTunes Search). */
    source: "database" | "env" | "tokenUrl" | "none";
    teamId: string | null;
    keyId: string | null;
    hasDatabasePrivateKey: boolean;
    /** The developer token address (saved here, or APPLE_MUSIC_TOKEN_URL), used while there's no key. */
    tokenUrl: string | null;
    tokenUrlSource: "database" | "env" | "none";
    /** The storefront searched (Song artwork's country, kept there). */
    country: string;
  };
  /** Spotify's developer app (issue #89): never the secret, only whether the database has one. */
  spotify: {
    source: "database" | "env" | "none";
    clientId: string | null;
    hasDatabaseSecret: boolean;
    market: string;
    marketSource: "database" | "env" | "default";
  };
  /** The contact MusicBrainz is told in the User-Agent. */
  musicbrainz: { contact: string; source: "database" | "env" | "default" };
  /** The YouTube Data API's key (issue #169): never the key, only whether the database has one. */
  youtube: { source: "database" | "env" | "none"; hasDatabaseKey: boolean };
}

export interface SaveSpotifyInput {
  clientId?: string;
  /** Left out, the one saved stays. */
  clientSecret?: string;
  market?: string;
}

export interface SaveAppleMusicInput {
  teamId?: string;
  keyId?: string;
  /** The .p8 file's text; left out, the one saved stays. */
  privateKey?: string;
  /** An address handing out developer tokens, until there's a key. */
  tokenUrl?: string;
}

export interface MetadataSearchResult {
  matches: MetadataMatch[];
  /** Providers that were asked and didn't answer. */
  unavailable: MetadataProviderKey[];
}

const isProvider = (key: unknown): key is MetadataProviderKey => (METADATA_PROVIDERS as readonly unknown[]).includes(key);

/** A provider's capabilities as saved: `enabled` (issue #22's lists) is song info; a capability not said is on. */
function capabilitiesOf(key: MetadataProviderKey, saved: { [name: string]: unknown }, on: boolean): ProviderCapabilities {
  const supports = PROVIDER_CAPABILITIES[key];
  const said = (capability: MetadataCapability) =>
    saved[capability] !== undefined ? saved[capability] !== false : capability === "songInfo" && saved.enabled !== undefined ? saved.enabled !== false : on;
  return Object.fromEntries(METADATA_CAPABILITIES.map((capability) => [capability, supports.includes(capability) && said(capability)])) as ProviderCapabilities;
}

/** Every provider once, in the order listed, then those left out (off). */
function complete(listed: { key: MetadataProviderKey; capabilities: ProviderCapabilities }[]): { key: MetadataProviderKey; capabilities: ProviderCapabilities }[] {
  const seen = new Set<MetadataProviderKey>();
  const providers: { key: MetadataProviderKey; capabilities: ProviderCapabilities }[] = [];
  for (const entry of listed) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    providers.push(entry);
  }
  for (const key of METADATA_PROVIDERS) if (!seen.has(key)) providers.push({ key, capabilities: capabilitiesOf(key, {}, false) });
  return providers;
}

function withTimeout<T>(promise: Promise<T>, provider: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${provider} took too long`)), SEARCH_WAIT_MS)),
  ]);
}

function appleMatch(song: ITunesSong): ProviderMatch | null {
  if (!song.trackId || !song.trackName) return null;
  return {
    title: song.trackName,
    artist: song.artistName ?? null,
    album: song.collectionName ?? null,
    releaseDate: song.releaseDate?.slice(0, 10) ?? null,
    artworkUrl: song.artworkUrl100 ? artworkAtSize(song.artworkUrl100, "800x800bb") : null,
    thumbnailUrl: song.artworkUrl100 ? artworkAtSize(song.artworkUrl100, "200x200bb") : null,
    source: { provider: "apple_music", id: String(song.trackId), url: song.trackViewUrl ?? `https://music.apple.com/song/${song.trackId}` },
  };
}

/**
 * Metadata providers (issue #22): Auto detect's search across MusicBrainz,
 * Apple Music and Deezer - whichever the admin has on, in their order -
 * merged and ranked (`rankMetadataMatches`), and a chosen match looked up
 * again from each of its sources.
 */
@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly musicBrainz: MusicBrainzService,
    private readonly songProviders: SongProviderService,
  ) {}

  /**
   * The providers, in the order they're asked, with what each is asked for:
   * the database's list, else METADATA_PROVIDERS (those listed, in order,
   * for everything they can do: "musicbrainz,apple_music"), else all of
   * them for everything.
   */
  async settings(): Promise<EffectiveMetadataSettings> {
    const row = await this.prisma.client.metadataSettings.findUnique({ where: { id: "singleton" } });
    const country = await this.storefront();
    const appleMusic = { ...this.appleMusicSummary(row), country };
    const spotify = this.spotifySummary(row, country);
    const envContact = process.env.MUSICBRAINZ_CONTACT;
    const musicbrainz = row?.musicbrainzContact
      ? { contact: row.musicbrainzContact, source: "database" as const }
      : { contact: envContact || "https://songverse.one", source: envContact ? ("env" as const) : ("default" as const) };
    // The Song provider plugin (issue #157): ready for what one of its servers is asked for.
    const songProviderHooks = await readyHooks();
    const ready = (key: MetadataProviderKey): ProviderCapabilities => {
      if (key === "song_providers")
        return { songInfo: songProviderHooks.has("songInfo"), artwork: songProviderHooks.has("artwork"), artistPictures: songProviderHooks.has("artistPictures"), artistBios: false };
      const all = key !== "spotify" || spotify.source !== "none";
      const pictures = key === "apple_music" ? appleMusic.source !== "none" : all;
      return { songInfo: all, artwork: all, artistPictures: pictures, artistBios: all };
    };
    const describe = (entries: { key: MetadataProviderKey; capabilities: ProviderCapabilities }[]) =>
      complete(entries).map(({ key, capabilities }) => ({ key, name: METADATA_PROVIDER_NAMES[key], capabilities, supports: [...PROVIDER_CAPABILITIES[key]], ready: ready(key) }));
    const youtube = {
      source: row?.youtubeApiKeyEnc ? ("database" as const) : process.env.YOUTUBE_API_KEY ? ("env" as const) : ("none" as const),
      hasDatabaseKey: !!row?.youtubeApiKeyEnc,
    };
    const extra = { appleMusic, spotify, musicbrainz, youtube };
    if (row && Array.isArray(row.providers)) {
      const listed = (row.providers as { key?: unknown }[]).filter((p) => isProvider(p?.key)) as ({ key: MetadataProviderKey } & Record<string, unknown>)[];
      return { providers: describe(listed.map((p) => ({ key: p.key, capabilities: capabilitiesOf(p.key, p, true) }))), source: "database", ...extra };
    }
    const env = process.env.METADATA_PROVIDERS?.split(",").map((key) => key.trim().toLowerCase()).filter(isProvider);
    if (env?.length) return { providers: describe(env.map((key) => ({ key, capabilities: capabilitiesOf(key, {}, true) }))), source: "env", ...extra };
    return { providers: describe(METADATA_PROVIDERS.map((key) => ({ key, capabilities: capabilitiesOf(key, {}, true) }))), source: "default", ...extra };
  }

  /** Saves the providers' order and what each is asked for; any left out are added, off. */
  async saveSettings(providers: ({ key: string } & Partial<Record<MetadataCapability | "enabled", boolean>>)[]): Promise<EffectiveMetadataSettings> {
    const unknown = providers.find((p) => !isProvider(p.key));
    if (unknown) throw new BadRequestException(`Unknown metadata provider '${unknown.key}'`);
    const list = complete(providers.map((p) => ({ key: p.key as MetadataProviderKey, capabilities: capabilitiesOf(p.key as MetadataProviderKey, p, true) }))).map(
      ({ key, capabilities }) => ({ key, ...Object.fromEntries(PROVIDER_CAPABILITIES[key].map((capability) => [capability, capabilities[capability]])) }),
    );
    await this.prisma.client.metadataSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", providers: list },
      update: { providers: list },
    });
    return this.settings();
  }

  /** Back to METADATA_PROVIDERS or the default order; the providers' own settings stay. */
  async resetSettings(): Promise<EffectiveMetadataSettings> {
    await this.prisma.client.metadataSettings.updateMany({ where: { id: "singleton" }, data: { providers: Prisma.DbNull } });
    return this.settings();
  }

  /** The providers asked for `capability`, in order: on for it, and able to with the keys they have. */
  async providersFor(capability: MetadataCapability): Promise<MetadataProviderKey[]> {
    return (await this.settings()).providers.filter((p) => p.capabilities[capability] && p.ready[capability]).map((p) => p.key);
  }

  /** The Apple Music storefront (and Spotify's default market): Song artwork's country, else "us". */
  async storefront(): Promise<string> {
    const row = await this.prisma.client.artworkSettings.findUnique({ where: { id: "singleton" }, select: { country: true } });
    return row?.country || "us";
  }

  /** Saves MusicBrainz's contact (a site or an email address); empty goes back to MUSICBRAINZ_CONTACT. */
  async saveMusicBrainz(contact: string): Promise<EffectiveMetadataSettings> {
    const clean = contact.trim() || null;
    if (clean && /[()\r\n]/.test(clean)) throw new BadRequestException("A contact is a web address or an email address");
    await this.prisma.client.metadataSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", musicbrainzContact: clean }, update: { musicbrainzContact: clean } });
    return this.settings();
  }

  /**
   * Saves Spotify's developer app (issue #89), a field left out keeping its
   * value and an empty one clearing it; the secret kept encrypted.
   */
  async saveSpotify(input: SaveSpotifyInput): Promise<EffectiveMetadataSettings> {
    const clean = (value: string | undefined) => (value === undefined ? undefined : value.trim() || null);
    const clientId = clean(input.clientId);
    const clientSecret = clean(input.clientSecret);
    const market = clean(input.market)?.toUpperCase() ?? (input.market === undefined ? undefined : null);
    if (clientId && !/^[A-Za-z0-9]{16,64}$/.test(clientId)) throw new BadRequestException("A Spotify client ID is letters and digits (32 of them)");
    if (market && !/^[A-Z]{2}$/.test(market)) throw new BadRequestException("A market is two letters, like US or FR");
    const data = {
      ...(clientId !== undefined && { spotifyClientId: clientId }),
      ...(clientSecret !== undefined && { spotifyClientSecretEnc: clientSecret ? encryptSecret(clientSecret, process.env.SETTINGS_ENCRYPTION_KEY) : null }),
      ...(market !== undefined && { spotifyMarket: market }),
    };
    await this.prisma.client.metadataSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...data }, update: data });
    return this.settings();
  }

  /** Back to the SPOTIFY_* env vars (without them, Spotify isn't asked); the providers' order stays. */
  async resetSpotify(): Promise<EffectiveMetadataSettings> {
    await this.prisma.client.metadataSettings.updateMany({ where: { id: "singleton" }, data: { spotifyClientId: null, spotifyClientSecretEnc: null, spotifyMarket: null } });
    return this.settings();
  }

  async testSpotify(): Promise<{ ok: boolean; message: string }> {
    const credentials = await this.spotifyCredentials();
    if (!credentials) return { ok: false, message: "No Spotify app is set: Spotify isn't asked." };
    try {
      const found = await spotifySearch("Amazing Grace", null, credentials);
      return { ok: true, message: `Spotify answered (${found.length} songs for "Amazing Grace").` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Saves the YouTube Data API's key (issue #169), encrypted; empty clears it. */
  async saveYouTube(apiKey: string): Promise<EffectiveMetadataSettings> {
    const clean = apiKey.trim();
    if (clean && !/^[\w-]{20,100}$/.test(clean)) throw new BadRequestException("A YouTube API key is letters, digits, - and _ (39 of them)");
    const data = { youtubeApiKeyEnc: clean ? encryptSecret(clean, process.env.SETTINGS_ENCRYPTION_KEY) : null };
    await this.prisma.client.metadataSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...data }, update: data });
    return this.settings();
  }

  /** Back to YOUTUBE_API_KEY (without it, no YouTube search). */
  async resetYouTube(): Promise<EffectiveMetadataSettings> {
    await this.prisma.client.metadataSettings.updateMany({ where: { id: "singleton" }, data: { youtubeApiKeyEnc: null } });
    return this.settings();
  }

  async testYouTube(): Promise<{ ok: boolean; message: string }> {
    const apiKey = await this.youtubeApiKey();
    if (!apiKey) return { ok: false, message: "No YouTube API key is set: song links can't be searched on YouTube." };
    try {
      const found = await youtubeSearch("Amazing Grace", null, apiKey, 1);
      return { ok: true, message: `YouTube answered (${found.length ? "a video" : "no video"} for "Amazing Grace").` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** The YouTube Data API's key: the database's, else YOUTUBE_API_KEY, else none. */
  async youtubeApiKey(): Promise<string | null> {
    const row = await this.prisma.client.metadataSettings.findUnique({ where: { id: "singleton" }, select: { youtubeApiKeyEnc: true } });
    if (row?.youtubeApiKeyEnc) {
      try {
        return decryptSecret(row.youtubeApiKeyEnc, process.env.SETTINGS_ENCRYPTION_KEY);
      } catch (err) {
        this.logger.warn(`The saved YouTube API key can't be decrypted (was SETTINGS_ENCRYPTION_KEY changed?): ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }
    return process.env.YOUTUBE_API_KEY || null;
  }

  /**
   * Which services a song's links can be searched at (issue #169): Apple
   * Music and Deezer always (no key needed), Spotify with its app, YouTube
   * with its key - whatever Auto detect is set to ask.
   */
  async linkSearchServices(): Promise<LinkSearchServices> {
    const [spotify, youtube] = await Promise.all([this.spotifyCredentials(), this.youtubeApiKey()]);
    return { SPOTIFY: !!spotify, APPLE_MUSIC: true, DEEZER: true, YOUTUBE: !!youtube };
  }

  /** A song looked up at one service (issue #169), for its link: a few results, the service's own order. */
  async linkSearch(type: StreamingLinkType, title: string, artist?: string | null): Promise<LinkCandidate[]> {
    const candidate = (match: ProviderMatch): LinkCandidate => ({ title: match.title, artist: match.artist, album: match.album, thumbnailUrl: match.thumbnailUrl, url: match.source.url });
    const search = async (): Promise<LinkCandidate[]> => {
      switch (type) {
        case "SPOTIFY": {
          if (!(await this.spotifyCredentials())) throw new ServiceUnavailableException("Spotify isn't set up: an admin adds its app in Admin > Metadata");
          return (await this.searchOne("spotify", title, artist)).map(candidate);
        }
        case "APPLE_MUSIC":
          return (await this.searchOne("apple_music", title, artist)).map(candidate);
        case "DEEZER":
          return (await this.searchOne("deezer", title, artist)).map(candidate);
        case "YOUTUBE": {
          const apiKey = await this.youtubeApiKey();
          if (!apiKey) throw new ServiceUnavailableException("YouTube isn't set up: an admin adds its API key in Admin > Metadata");
          return youtubeSearch(title, artist, apiKey);
        }
      }
    };
    try {
      return (await withTimeout(search(), type)).slice(0, 8);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.warn(`${type} link search failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new ServiceUnavailableException(err instanceof Error && /quota|refused/i.test(err.message) ? err.message : "That service isn't answering - try again in a moment");
    }
  }

  /** Spotify's app: the database's (ID and secret), else SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET, else none. */
  async spotifyCredentials(): Promise<SpotifyCredentials | null> {
    const row = await this.prisma.client.metadataSettings.findUnique({ where: { id: "singleton" } });
    const market = row?.spotifyMarket || process.env.SPOTIFY_MARKET?.toUpperCase() || (await this.storefront()).toUpperCase();
    if (row?.spotifyClientId && row.spotifyClientSecretEnc) {
      try {
        return { clientId: row.spotifyClientId, clientSecret: decryptSecret(row.spotifyClientSecretEnc, process.env.SETTINGS_ENCRYPTION_KEY), market };
      } catch (err) {
        this.logger.warn(`The saved Spotify secret can't be decrypted (was SETTINGS_ENCRYPTION_KEY changed?): ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }
    const { SPOTIFY_CLIENT_ID: clientId, SPOTIFY_CLIENT_SECRET: clientSecret } = process.env;
    return clientId && clientSecret ? { clientId, clientSecret, market } : null;
  }

  private spotifySummary(
    row: { spotifyClientId: string | null; spotifyClientSecretEnc: string | null; spotifyMarket: string | null } | null,
    country: string,
  ): EffectiveMetadataSettings["spotify"] {
    const hasDatabaseSecret = !!row?.spotifyClientSecretEnc;
    const envMarket = process.env.SPOTIFY_MARKET?.toUpperCase();
    const market = row?.spotifyMarket
      ? { market: row.spotifyMarket, marketSource: "database" as const }
      : { market: envMarket || country.toUpperCase(), marketSource: envMarket ? ("env" as const) : ("default" as const) };
    if (row?.spotifyClientId && hasDatabaseSecret) return { source: "database", clientId: row.spotifyClientId, hasDatabaseSecret, ...market };
    const { SPOTIFY_CLIENT_ID: clientId, SPOTIFY_CLIENT_SECRET: clientSecret } = process.env;
    if (clientId && clientSecret) return { source: "env", clientId, hasDatabaseSecret, ...market };
    return { source: "none", clientId: row?.spotifyClientId ?? null, hasDatabaseSecret, ...market };
  }

  /**
   * Saves the MusicKit key (issue #87), a field left out keeping its value
   * and an empty one clearing it. The private key is checked, then kept
   * encrypted.
   */
  async saveAppleMusic(input: SaveAppleMusicInput): Promise<EffectiveMetadataSettings> {
    const clean = (value: string | undefined) => (value === undefined ? undefined : value.trim() || null);
    const teamId = clean(input.teamId);
    const keyId = clean(input.keyId);
    const privateKey = clean(input.privateKey);
    const tokenUrl = clean(input.tokenUrl);
    if (tokenUrl) {
      let url: URL | null = null;
      try {
        url = new URL(tokenUrl);
      } catch {
        // reported below
      }
      const local = url?.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
      if (!url || (url.protocol !== "https:" && !local)) throw new BadRequestException("A developer token address is an https:// address");
    }
    for (const [name, value] of [
      ["team ID", teamId],
      ["key ID", keyId],
    ] as const) {
      if (value && !/^[A-Z0-9]{10}$/.test(value)) throw new BadRequestException(`An Apple ${name} is 10 letters and digits, like ABCDE12345`);
    }
    let privateKeyEnc: string | null | undefined;
    if (privateKey) {
      const problem = musicKitKeyProblem(privateKey);
      if (problem) throw new BadRequestException(problem);
      privateKeyEnc = encryptSecret(privateKey, process.env.SETTINGS_ENCRYPTION_KEY);
    } else if (privateKey === null) privateKeyEnc = null;
    const data = {
      ...(teamId !== undefined && { appleMusicTeamId: teamId }),
      ...(keyId !== undefined && { appleMusicKeyId: keyId }),
      ...(privateKeyEnc !== undefined && { appleMusicPrivateKeyEnc: privateKeyEnc }),
      ...(tokenUrl !== undefined && { appleMusicTokenUrl: tokenUrl }),
    };
    await this.prisma.client.metadataSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...data }, update: data });
    return this.settings();
  }

  /** Back to the APPLE_MUSIC_* env vars, or the iTunes Search API without them; the providers' order stays. */
  async resetAppleMusic(): Promise<EffectiveMetadataSettings> {
    await this.prisma.client.metadataSettings.updateMany({
      where: { id: "singleton" },
      data: { appleMusicTeamId: null, appleMusicKeyId: null, appleMusicPrivateKeyEnc: null, appleMusicTokenUrl: null },
    });
    return this.settings();
  }

  /** Tries the key (or token address) with a search, so an admin knows it works before a song needs it. */
  async testAppleMusic(): Promise<{ ok: boolean; message: string }> {
    const auth = await this.appleMusicAuth();
    if (!auth) return { ok: false, message: "No MusicKit key or developer token address is set: Apple Music is searched through iTunes Search." };
    try {
      const found = await appleMusicSearch("Amazing Grace", await this.storefront(), auth);
      return { ok: true, message: `The Apple Music API answered (${found.length} songs for "Amazing Grace").` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * The MusicKit key in use: the database's, when it has all three parts,
   * else the APPLE_MUSIC_TEAM_ID / APPLE_MUSIC_KEY_ID /
   * APPLE_MUSIC_PRIVATE_KEY env vars, else none (iTunes Search).
   */
  async appleMusicCredentials(): Promise<MusicKitCredentials | null> {
    const row = await this.prisma.client.metadataSettings.findUnique({ where: { id: "singleton" } });
    if (row?.appleMusicTeamId && row.appleMusicKeyId && row.appleMusicPrivateKeyEnc) {
      try {
        return { teamId: row.appleMusicTeamId, keyId: row.appleMusicKeyId, privateKey: decryptSecret(row.appleMusicPrivateKeyEnc, process.env.SETTINGS_ENCRYPTION_KEY) };
      } catch (err) {
        this.logger.warn(`The saved MusicKit key can't be decrypted (was SETTINGS_ENCRYPTION_KEY changed?): ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }
    const { APPLE_MUSIC_TEAM_ID: teamId, APPLE_MUSIC_KEY_ID: keyId, APPLE_MUSIC_PRIVATE_KEY: privateKey } = process.env;
    // A key in an env var often has its line breaks written as \n.
    return teamId && keyId && privateKey ? { teamId, keyId, privateKey: privateKey.replace(/\\n/g, "\n") } : null;
  }

  /**
   * How Apple Music API requests are signed: the MusicKit key, else a token
   * from the developer token address (saved here, else
   * APPLE_MUSIC_TOKEN_URL) - a stopgap, whose tokens aren't signed by this
   * server's own Apple account - else none (iTunes Search).
   */
  async appleMusicAuth(): Promise<AppleMusicAuth | null> {
    const credentials = await this.appleMusicCredentials();
    if (credentials) return { kind: "key", credentials };
    const row = await this.prisma.client.metadataSettings.findUnique({ where: { id: "singleton" }, select: { appleMusicTokenUrl: true } });
    const url = row?.appleMusicTokenUrl || process.env.APPLE_MUSIC_TOKEN_URL;
    return url ? { kind: "tokenUrl", url } : null;
  }

  private appleMusicSummary(
    row: { appleMusicTeamId: string | null; appleMusicKeyId: string | null; appleMusicPrivateKeyEnc: string | null; appleMusicTokenUrl: string | null } | null,
  ): Omit<EffectiveMetadataSettings["appleMusic"], "country"> {
    const hasDatabasePrivateKey = !!row?.appleMusicPrivateKeyEnc;
    const tokenUrl = row?.appleMusicTokenUrl || process.env.APPLE_MUSIC_TOKEN_URL || null;
    const token = { tokenUrl, tokenUrlSource: row?.appleMusicTokenUrl ? ("database" as const) : tokenUrl ? ("env" as const) : ("none" as const) };
    if (row?.appleMusicTeamId && row.appleMusicKeyId && hasDatabasePrivateKey) {
      return { source: "database", teamId: row.appleMusicTeamId, keyId: row.appleMusicKeyId, hasDatabasePrivateKey, ...token };
    }
    const { APPLE_MUSIC_TEAM_ID: teamId, APPLE_MUSIC_KEY_ID: keyId, APPLE_MUSIC_PRIVATE_KEY: privateKey } = process.env;
    if (teamId && keyId && privateKey) return { source: "env", teamId, keyId, hasDatabasePrivateKey, ...token };
    return { source: tokenUrl ? "tokenUrl" : "none", teamId: row?.appleMusicTeamId ?? null, keyId: row?.appleMusicKeyId ?? null, hasDatabasePrivateKey, ...token };
  }

  /** Every provider asked for song info, at once; one that fails or is slow is left out rather than failing the search. */
  async search(title: string, artist?: string | null): Promise<MetadataSearchResult> {
    const order = await this.providersFor("songInfo");
    if (order.length === 0) throw new ServiceUnavailableException("No metadata provider is turned on");
    const artwork = new Set(await this.providersFor("artwork"));
    const settled = await Promise.allSettled(order.map((provider) => withTimeout(this.searchOne(provider, title, artist), provider)));
    const results: Partial<Record<MetadataProviderKey, ProviderMatch[]>> = {};
    const unavailable: MetadataProviderKey[] = [];
    settled.forEach((outcome, index) => {
      const provider = order[index]!;
      if (outcome.status === "fulfilled") results[provider] = artwork.has(provider) ? outcome.value : outcome.value.map(withoutArtwork);
      else {
        unavailable.push(provider);
        this.logger.warn(`${provider} search failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
      }
    });
    if (unavailable.length === order.length) throw new ServiceUnavailableException("The metadata providers are unavailable — try again in a moment");
    return { matches: rankMetadataMatches(results, order, title, artist), unavailable };
  }

  /**
   * A chosen match, looked up again from its sources rather than taken
   * from the client: the details of the first (in the providers' order),
   * the earliest release date, the first artwork. Sources that can't be
   * looked up are left out; none at all is an error.
   */
  async lookup(sources: Pick<MetadataSource, "provider" | "id">[]): Promise<MetadataMatch> {
    const order = (await this.settings()).providers.map((p) => p.key);
    const wanted = [...new Map(sources.map((s) => [s.provider, s])).values()].sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
    const settled = await Promise.allSettled(wanted.map((source) => withTimeout(this.lookupOne(source.provider, source.id), source.provider)));
    const artwork = new Set(await this.providersFor("artwork"));
    const found = settled.flatMap((outcome) =>
      outcome.status === "fulfilled" && outcome.value ? [artwork.has(outcome.value.source.provider) ? outcome.value : withoutArtwork(outcome.value)] : [],
    );
    if (found.length === 0) {
      const notFound = settled.every((outcome) => outcome.status === "fulfilled" || outcome.reason instanceof NotFoundException);
      if (notFound) throw new NotFoundException("That match can't be found anymore");
      throw new ServiceUnavailableException("The metadata providers are unavailable — try again in a moment");
    }
    const [first, ...others] = found;
    const { source, ...details } = first!;
    const match: MetadataMatch = { ...details, sources: [source] };
    for (const other of others) {
      match.sources.push(other.source);
      if (other.releaseDate && (!match.releaseDate || other.releaseDate.slice(0, 4) < match.releaseDate.slice(0, 4))) match.releaseDate = other.releaseDate;
      match.artworkUrl ??= other.artworkUrl;
      match.thumbnailUrl ??= other.thumbnailUrl;
      match.isrc ??= other.isrc;
      if (!match.composers?.length && other.composers?.length) match.composers = other.composers;
      match.tempo ??= other.tempo;
      match.durationSeconds ??= other.durationSeconds;
    }
    return match;
  }

  private async searchOne(provider: MetadataProviderKey, title: string, artist?: string | null, wanted: "songInfo" | "artwork" = "songInfo"): Promise<ProviderMatch[]> {
    switch (provider) {
      case "song_providers":
        return this.songProviders.searchMatches(wanted, title, artist);
      case "musicbrainz":
        return this.musicBrainz.searchMatches(title, artist);
      case "apple_music": {
        const country = await this.storefront();
        const term = [title, artist].filter(Boolean).join(" ");
        // With a MusicKit key (or a token address), the Apple Music API (issue #87): the same songs, with their ISRC and writers.
        const auth = await this.appleMusicAuth();
        if (auth) return appleMusicSearch(term, country, auth);
        return (await itunesSearch(term, country, 25)).map(appleMatch).filter((m): m is ProviderMatch => !!m);
      }
      case "deezer":
        return deezerSearch(title, artist);
      case "spotify": {
        const credentials = await this.spotifyCredentials();
        return credentials ? spotifySearch(title, artist, credentials) : [];
      }
    }
  }

  private async lookupOne(provider: MetadataProviderKey, id: string): Promise<ProviderMatch | null> {
    switch (provider) {
      case "song_providers":
        return this.songProviders.lookupMatch(id);
      case "musicbrainz":
        return this.musicBrainz.match(id);
      case "apple_music": {
        if (!/^\d+$/.test(id)) throw new NotFoundException("Not an Apple Music track ID");
        const country = await this.storefront();
        const auth = await this.appleMusicAuth();
        const found = auth ? await appleMusicSong(id, country, auth) : await itunesLookup(id, country).then((song) => song && appleMatch(song));
        if (!found) throw new NotFoundException("No such Apple Music track");
        return found;
      }
      case "deezer":
        return deezerTrack(id).catch((err: Error) => {
          throw /no data|not a deezer/i.test(err.message) ? new NotFoundException(err.message) : err;
        });
      case "spotify": {
        const credentials = await this.spotifyCredentials();
        if (!credentials) throw new NotFoundException("Spotify isn't set up");
        const found = await spotifyTrack(id, credentials);
        if (!found) throw new NotFoundException("No such Spotify track");
        return found;
      }
    }
  }

  /**
   * A song's artwork to choose from (issue #89): the matches of every
   * provider asked for album artwork, in their order, each artwork once.
   */
  async artworkCandidates(title: string, artist: string | null): Promise<ArtworkCandidate[]> {
    const { candidates, failed, asked } = await this.artworkSearch(title, artist);
    if (asked > 0 && failed.length === asked) throw new ServiceUnavailableException("The artwork providers are unavailable — try again in a moment");
    return candidates;
  }

  /**
   * The artwork search, saying which providers failed (issue #93): a song
   * whose search failed isn't one with no artwork to find.
   */
  async artworkSearch(title: string, artist: string | null): Promise<{ candidates: ArtworkCandidate[]; failed: MetadataProviderKey[]; asked: number }> {
    const order = await this.providersFor("artwork");
    const settled = await Promise.allSettled(order.map((provider) => withTimeout(this.searchOne(provider, title, artist, "artwork"), provider)));
    const seen = new Set<string>();
    const candidates: ArtworkCandidate[] = [];
    const failed: MetadataProviderKey[] = [];
    settled.forEach((outcome, index) => {
      if (outcome.status !== "fulfilled") {
        failed.push(order[index]!);
        this.logger.warn(`${order[index]} artwork search failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
        return;
      }
      for (const match of outcome.value) {
        if (!match.artworkUrl || seen.has(match.artworkUrl)) continue;
        seen.add(match.artworkUrl);
        candidates.push({
          provider: order[index]!,
          title: match.title,
          artist: match.artist ?? "",
          album: match.album,
          releaseDate: match.releaseDate,
          artworkUrl: match.artworkUrl,
          thumbnailUrl: match.thumbnailUrl ?? match.artworkUrl,
        });
      }
    });
    return { candidates, failed, asked: order.length };
  }

  /**
   * An artist's picture (issue #89): from the first provider asked for
   * artist pictures that has one - and, when none has, whether any of them
   * failed (issue #93): then there may be one after all.
   */
  async artistPicture(name: string): Promise<{ found: { provider: MetadataProviderKey; url: string; pageUrl: string } | null; failed: MetadataProviderKey[] }> {
    const failed: MetadataProviderKey[] = [];
    for (const provider of await this.providersFor("artistPictures")) {
      try {
        const found =
          provider === "deezer"
            ? await deezerArtistPicture(name)
            : provider === "spotify"
              ? await this.spotifyCredentials().then((credentials) => credentials && spotifyArtistPicture(name, credentials))
              : provider === "apple_music"
                ? await this.appleMusicAuth().then(async (auth) => auth && appleMusicArtistPicture(name, await this.storefront(), auth))
                : provider === "song_providers"
                  ? await this.songProviders.artistPicture(name)
                  : null;
        if (found) return { found: { provider, ...found }, failed };
      } catch (err) {
        failed.push(provider);
        this.logger.warn(`No picture of ${name} from ${provider}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { found: null, failed };
  }
}

/** A match from a provider not asked for album artwork: shown with its thumbnail, but its artwork isn't used. */
const withoutArtwork = (match: ProviderMatch): ProviderMatch => ({ ...match, artworkUrl: null });
