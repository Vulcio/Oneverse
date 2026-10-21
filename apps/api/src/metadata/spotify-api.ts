import { createHash } from "node:crypto";
import type { ProviderMatch } from "@oneverse/core";
import { PROVIDER_TIMEOUT_MS } from "./provider-timeout.js";

/** The most results a search asks for: Spotify refuses more than 10 from an app in development mode (issue #90). */
const SEARCH_LIMIT = "10";
/** Where Spotify's Web API and its token service are; pointed elsewhere only by the e2e suites. */
const apiBase = () => (process.env.SPOTIFY_API_URL ?? "https://api.spotify.com").replace(/\/$/, "");
const accountsBase = () => (process.env.SPOTIFY_ACCOUNTS_URL ?? "https://accounts.spotify.com").replace(/\/$/, "");

/** A Spotify developer app (issue #89): its client ID and secret, and the market (country) searched. */
export interface SpotifyCredentials {
  clientId: string;
  clientSecret: string;
  market: string;
}

export class SpotifyApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const tokens = new Map<string, { token: string; expiresAt: number }>();
const cacheKey = (credentials: SpotifyCredentials) => createHash("sha256").update(`${credentials.clientId}\n${credentials.clientSecret}`).digest("hex");

/** An app token (the Client Credentials flow: no user signs in), reused until a minute before it runs out. */
async function appToken(credentials: SpotifyCredentials, now = Date.now()): Promise<string> {
  const key = cacheKey(credentials);
  const cached = tokens.get(key);
  if (cached && cached.expiresAt - now > 60 * 1000) return cached.token;
  const res = await fetch(`${accountsBase()}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (res.status === 400 || res.status === 401) throw new SpotifyApiError(res.status, "Spotify refused the client ID and secret");
  if (!res.ok) throw new SpotifyApiError(res.status, `Spotify answered ${res.status}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new SpotifyApiError(502, "Spotify didn't answer with a token");
  tokens.set(key, { token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

async function get<T>(path: string, credentials: SpotifyCredentials, retried = false): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { Authorization: `Bearer ${await appToken(credentials)}` },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (res.status === 401 && !retried) {
    // Its token ran out early: a new one, once.
    tokens.delete(cacheKey(credentials));
    return get(path, credentials, true);
  }
  if (!res.ok) {
    // Spotify says why: {"error": {"status": 400, "message": "Invalid limit"}}.
    const said = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
    const why = said ? `: ${said}` : "";
    if (res.status === 401 || res.status === 403) throw new SpotifyApiError(res.status, `Spotify refused the app${why}. Check its client ID and secret, and what the app may do`);
    throw new SpotifyApiError(res.status, `Spotify answered ${res.status}${why}`);
  }
  return (await res.json()) as T;
}

interface SpotifyImage {
  url: string;
  width?: number | null;
}

interface SpotifyTrack {
  id: string;
  name: string;
  artists?: { name: string }[];
  album?: { name?: string; release_date?: string; images?: SpotifyImage[] };
  external_ids?: { isrc?: string };
  external_urls?: { spotify?: string };
}

/** The largest image, and a small one (the smallest at least 200px wide) to choose from. */
function images(list: SpotifyImage[] | undefined): { large: string | null; small: string | null } {
  const sorted = [...(list ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const small = [...sorted].reverse().find((image) => (image.width ?? 0) >= 200) ?? sorted[0];
  return { large: sorted[0]?.url ?? null, small: small?.url ?? null };
}

function toMatch(track: SpotifyTrack): ProviderMatch {
  const { large, small } = images(track.album?.images);
  return {
    title: track.name,
    artist: track.artists?.map((artist) => artist.name).join(", ") || null,
    album: track.album?.name ?? null,
    releaseDate: track.album?.release_date ?? null,
    artworkUrl: large,
    thumbnailUrl: small,
    isrc: track.external_ids?.isrc ?? null,
    source: { provider: "spotify", id: track.id, url: track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}` },
  };
}

const quoted = (text: string) => `"${text.replace(/"/g, " ")}"`;

/** Tracks matching a title and artist (a looser search when the strict one finds nothing). */
export async function spotifySearch(title: string, artist: string | null | undefined, credentials: SpotifyCredentials): Promise<ProviderMatch[]> {
  const search = async (q: string) =>
    (await get<{ tracks?: { items?: SpotifyTrack[] } }>(`/v1/search?${new URLSearchParams({ q, type: "track", limit: SEARCH_LIMIT, market: credentials.market })}`, credentials)).tracks?.items ?? [];
  let found = await search(artist ? `track:${quoted(title)} artist:${quoted(artist)}` : `track:${quoted(title)}`);
  if (found.length === 0 && artist) found = await search(`${title} ${artist}`);
  return found.map(toMatch);
}

/** One track by its ID, or null. */
export async function spotifyTrack(id: string, credentials: SpotifyCredentials): Promise<ProviderMatch | null> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return null;
  try {
    return toMatch(await get<SpotifyTrack>(`/v1/tracks/${id}?${new URLSearchParams({ market: credentials.market })}`, credentials));
  } catch (err) {
    if (err instanceof SpotifyApiError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

/** An artist's picture: one named exactly so (ignoring case and accents), with images. */
export async function spotifyArtistPicture(name: string, credentials: SpotifyCredentials): Promise<{ url: string; pageUrl: string } | null> {
  const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  const body = await get<{ artists?: { items?: { id: string; name: string; images?: SpotifyImage[]; external_urls?: { spotify?: string } }[] } }>(
    `/v1/search?${new URLSearchParams({ q: name, type: "artist", limit: SEARCH_LIMIT, market: credentials.market })}`,
    credentials,
  );
  const artist = body.artists?.items?.find((a) => fold(a.name) === fold(name));
  const { large } = images(artist?.images);
  if (!artist || !large) return null;
  return { url: large, pageUrl: artist.external_urls?.spotify ?? `https://open.spotify.com/artist/${artist.id}` };
}
