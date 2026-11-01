import { createHash, createPrivateKey, sign } from "node:crypto";
import type { ProviderMatch } from "@oneverse/core";
import { PROVIDER_TIMEOUT_MS } from "./provider-timeout.js";

/** Where the Apple Music API is; pointed elsewhere only by the e2e suites. */
const apiBase = () => (process.env.APPLE_MUSIC_API_URL ?? "https://api.music.apple.com").replace(/\/$/, "");
/** A developer token lasts this long (Apple allows up to six months); a new one is made before it runs out. */
const TOKEN_LIFETIME_S = 12 * 60 * 60;

/** A MusicKit key (issue #87): the Apple Developer team, the key's ID and its private key (the .p8 file's text). */
export interface MusicKitCredentials {
  teamId: string;
  keyId: string;
  privateKey: string;
}

/** Why a key can't be used, or null: it must be a P-256 private key, as MusicKit's are. */
export function musicKitKeyProblem(privateKey: string): string | null {
  try {
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return "A MusicKit key is an EC P-256 key (the .p8 file)";
    return null;
  } catch {
    return "That isn't a private key: paste the whole .p8 file, BEGIN and END lines included";
  }
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const tokens = new Map<string, { token: string; expiresAt: number }>();

/** A developer token: a JWT signed with the key (ES256), reused until an hour before it runs out. */
export function developerToken(credentials: MusicKitCredentials, now = Date.now()): string {
  const cacheKey = createHash("sha256").update(`${credentials.teamId}\n${credentials.keyId}\n${credentials.privateKey}`).digest("hex");
  const cached = tokens.get(cacheKey);
  if (cached && cached.expiresAt - now > 60 * 60 * 1000) return cached.token;
  const issuedAt = Math.floor(now / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "ES256", kid: credentials.keyId }))}.${base64url(
    JSON.stringify({ iss: credentials.teamId, iat: issuedAt, exp: issuedAt + TOKEN_LIFETIME_S }),
  )}`;
  // JWTs want the raw r||s signature, not DER.
  const signature = sign("sha256", Buffer.from(unsigned), { key: createPrivateKey(credentials.privateKey), dsaEncoding: "ieee-p1363" });
  const token = `${unsigned}.${base64url(signature)}`;
  tokens.set(cacheKey, { token, expiresAt: (issuedAt + TOKEN_LIFETIME_S) * 1000 });
  return token;
}

/**
 * How requests to the Apple Music API are signed: a MusicKit key of one's
 * own, or - a stopgap until there is one - a developer token fetched from
 * an address that hands them out (it answers `{ "token": "eyJ…" }`).
 */
export type AppleMusicAuth = { kind: "key"; credentials: MusicKitCredentials } | { kind: "tokenUrl"; url: string };

const fetchedTokens = new Map<string, { token: string; expiresAt: number }>();

/** When a JWT runs out (its `exp`), or null when it doesn't say. */
function jwtExpiry(token: string): number | null {
  try {
    const { exp } = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as { exp?: unknown };
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * A developer token from `url`, kept until a minute before it runs out (the
 * JWT's own expiry; else the `cache_ttl_seconds` it came with, or two
 * minutes), so the address is asked about once a month rather than on every
 * search.
 */
export async function fetchedToken(url: string, now = Date.now()): Promise<string> {
  const cached = fetchedTokens.get(url);
  if (cached && cached.expiresAt - now > 60 * 1000) return cached.token;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`The developer token address answered ${res.status}`);
  const body = (await res.json().catch(() => null)) as { token?: unknown; cache_ttl_seconds?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new Error("The developer token address didn't answer with a token");
  const ttl = typeof body?.cache_ttl_seconds === "number" ? body.cache_ttl_seconds * 1000 : 2 * 60 * 1000;
  fetchedTokens.set(url, { token, expiresAt: jwtExpiry(token) ?? now + ttl });
  return token;
}

/** Forgets a fetched token Apple refused, so the next request fetches a new one. */
export const forgetFetchedToken = (url: string) => fetchedTokens.delete(url);

const tokenFor = (auth: AppleMusicAuth) => (auth.kind === "key" ? Promise.resolve(developerToken(auth.credentials)) : fetchedToken(auth.url));

interface AppleMusicSong {
  id: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    releaseDate?: string;
    isrc?: string;
    composerName?: string;
    durationInMillis?: number;
    url?: string;
    artwork?: { url?: string };
  };
}

export class AppleMusicApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string, auth: AppleMusicAuth, retried = false): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { Authorization: `Bearer ${await tokenFor(auth)}` },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) {
    // A fetched token may have been replaced early: a new one, once.
    if (auth.kind === "tokenUrl" && !retried) {
      forgetFetchedToken(auth.url);
      return get(path, auth, true);
    }
    throw new AppleMusicApiError(
      res.status,
      auth.kind === "key" ? "Apple Music refused the MusicKit key: check the team ID, key ID and private key" : "Apple Music refused the developer token from that address",
    );
  }
  if (!res.ok) throw new AppleMusicApiError(res.status, `Apple Music answered ${res.status}`);
  return (await res.json()) as T;
}

/** "Joel Houston, Matt Crocker & Salomon Ligthelm" as names. */
const composersOf = (composerName?: string) =>
  (composerName ?? "")
    .split(/\s*,\s*|\s+&\s+/)
    .map((name) => name.trim())
    .filter(Boolean);

/** Apple's artwork addresses are templates: {w}x{h}, and sometimes {f} for the format. */
const artworkAt = (template: string | undefined, size: number) => template?.replace("{w}", String(size)).replace("{h}", String(size)).replace("{f}", "jpg") ?? null;

function toMatch(song: AppleMusicSong): ProviderMatch | null {
  const a = song.attributes;
  if (!a?.name) return null;
  const composers = composersOf(a.composerName);
  return {
    title: a.name,
    artist: a.artistName ?? null,
    album: a.albumName ?? null,
    releaseDate: a.releaseDate ?? null,
    artworkUrl: artworkAt(a.artwork?.url, 800),
    thumbnailUrl: artworkAt(a.artwork?.url, 200),
    isrc: a.isrc ?? null,
    durationSeconds: a.durationInMillis && a.durationInMillis > 0 ? Math.round(a.durationInMillis / 1000) : null,
    ...(composers.length > 0 && { composers }),
    // The same catalogue IDs as the iTunes Search API's track IDs.
    source: { provider: "apple_music", id: song.id, url: a.url ?? `https://music.apple.com/song/${song.id}` },
  };
}

/** Songs matching `term` in a storefront (two letters), through the Apple Music API. */
export async function appleMusicSearch(term: string, storefront: string, auth: AppleMusicAuth): Promise<ProviderMatch[]> {
  const query = new URLSearchParams({ term, types: "songs", limit: "25" });
  const body = await get<{ results?: { songs?: { data?: AppleMusicSong[] } } }>(`/v1/catalog/${storefront}/search?${query}`, auth);
  return (body.results?.songs?.data ?? []).map(toMatch).filter((match): match is ProviderMatch => !!match);
}

/** One song by its catalogue ID, or null. */
export async function appleMusicSong(id: string, storefront: string, auth: AppleMusicAuth): Promise<ProviderMatch | null> {
  try {
    const body = await get<{ data?: AppleMusicSong[] }>(`/v1/catalog/${storefront}/songs/${encodeURIComponent(id)}`, auth);
    const song = body.data?.[0];
    return song ? toMatch(song) : null;
  } catch (err) {
    if (err instanceof AppleMusicApiError && err.status === 404) return null;
    throw err;
  }
}

/** An artist's picture through the Apple Music API (issue #89): one named exactly so, with artwork. */
export async function appleMusicArtistPicture(name: string, storefront: string, auth: AppleMusicAuth): Promise<{ url: string; pageUrl: string } | null> {
  const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  const query = new URLSearchParams({ term: name, types: "artists", limit: "5" });
  const body = await get<{ results?: { artists?: { data?: { id: string; attributes?: { name?: string; url?: string; artwork?: { url?: string } } }[] } } }>(
    `/v1/catalog/${storefront}/search?${query}`,
    auth,
  );
  const artist = body.results?.artists?.data?.find((a) => fold(a.attributes?.name ?? "") === fold(name));
  const url = artworkAt(artist?.attributes?.artwork?.url, 1000);
  if (!artist || !url) return null;
  return { url, pageUrl: artist.attributes?.url ?? `https://music.apple.com/artist/${artist.id}` };
}
