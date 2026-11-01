import type { ProviderMatch } from "@oneverse/core";
import { PROVIDER_TIMEOUT_MS } from "./provider-timeout.js";

/** Where Deezer's API is; pointed elsewhere only by the e2e suites. */
const apiBase = () => (process.env.DEEZER_API_URL ?? "https://api.deezer.com").replace(/\/$/, "");
/** Albums looked up for their release date (Deezer's search doesn't say): its limit is 50 requests in 5 seconds. */
const MAX_ALBUMS = 10;

interface DeezerTrack {
  id: number;
  title: string;
  link?: string;
  release_date?: string;
  /** Seconds. */
  duration?: number;
  /** On a track looked up by its ID only, 0 when Deezer doesn't know. */
  bpm?: number;
  isrc?: string;
  artist?: { name?: string };
  album?: { id: number; title?: string; cover_medium?: string; cover_xl?: string; release_date?: string };
}

async function get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  const url = `${apiBase()}${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ""}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Deezer answered ${res.status}`);
  const body = (await res.json()) as T & { error?: { message?: string } };
  // Deezer reports errors (a quota, an unknown ID) with a 200.
  if (body.error) throw new Error(`Deezer: ${body.error.message ?? "error"}`);
  return body;
}

const quoted = (text: string) => `"${text.replace(/"/g, " ")}"`;

function toMatch(track: DeezerTrack, releaseDate: string | null): ProviderMatch {
  return {
    title: track.title,
    artist: track.artist?.name ?? null,
    album: track.album?.title ?? null,
    releaseDate,
    artworkUrl: track.album?.cover_xl ?? null,
    thumbnailUrl: track.album?.cover_medium ?? null,
    ...(track.isrc && { isrc: track.isrc }),
    tempo: track.bpm && track.bpm > 0 ? Math.round(track.bpm * 10) / 10 : null,
    durationSeconds: track.duration && track.duration > 0 ? Math.round(track.duration) : null,
    source: { provider: "deezer", id: String(track.id), url: track.link ?? `https://www.deezer.com/track/${track.id}` },
  };
}

/**
 * Deezer (issue #22): its public API, no key. Its search doesn't give
 * release dates, so the first few albums found are looked up for theirs.
 */
export async function deezerSearch(title: string, artist?: string | null): Promise<ProviderMatch[]> {
  let { data = [] } = await get<{ data?: DeezerTrack[] }>("/search", {
    q: artist ? `track:${quoted(title)} artist:${quoted(artist)}` : `track:${quoted(title)}`,
    limit: "15",
  });
  // A strict search finds nothing for a slightly different artist name: the title and artist as words, then.
  if (data.length === 0 && artist) ({ data = [] } = await get<{ data?: DeezerTrack[] }>("/search", { q: `${title} ${artist}`, limit: "15" }));
  const albumIds = [...new Set(data.map((track) => track.album?.id).filter((id): id is number => !!id))].slice(0, MAX_ALBUMS);
  const dates = new Map<number, string | null>();
  await Promise.all(
    albumIds.map(async (id) => {
      const album = await get<{ release_date?: string }>(`/album/${id}`).catch(() => null);
      dates.set(id, album?.release_date ?? null);
    }),
  );
  return data.map((track) => toMatch(track, (track.album && dates.get(track.album.id)) || null));
}

/** One track, looked up again when it's chosen. */
export async function deezerTrack(id: string): Promise<ProviderMatch> {
  if (!/^\d+$/.test(id)) throw new Error("Not a Deezer track ID");
  const track = await get<DeezerTrack>(`/track/${id}`);
  return toMatch(track, track.album?.release_date ?? track.release_date ?? null);
}
