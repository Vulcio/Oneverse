import type { LinkCandidate } from "@oneverse/core";
import { PROVIDER_TIMEOUT_MS } from "./provider-timeout.js";

/** Where the YouTube Data API is; pointed elsewhere only by the e2e suites. */
const apiBase = () => (process.env.YOUTUBE_API_URL ?? "https://www.googleapis.com/youtube/v3").replace(/\/$/, "");

export class YouTubeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface SearchItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }> };
}

/** YouTube gives titles HTML-escaped ("Don&#39;t"). */
function unescape(text: string): string {
  return text.replace(/&(#\d+|#x[\da-f]+|amp|quot|lt|gt|apos);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
    return { amp: "&", quot: '"', lt: "<", gt: ">", apos: "'" }[lower] ?? entity;
  });
}

/**
 * Videos for a song (issue #169): the YouTube Data API's search, a few
 * results. Each search costs 100 of the key's 10,000 daily units.
 */
export async function youtubeSearch(title: string, artist: string | null | undefined, apiKey: string, limit = 8): Promise<LinkCandidate[]> {
  const params = new URLSearchParams({ part: "snippet", type: "video", maxResults: String(limit), q: [title, artist].filter(Boolean).join(" "), key: apiKey });
  const res = await fetch(`${apiBase()}/search?${params}`, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  if (res.status === 400 || res.status === 403) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string; errors?: { reason?: string }[] } } | null;
    const reason = body?.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded") throw new YouTubeApiError(429, "YouTube's daily quota for this key is used up - try again tomorrow");
    throw new YouTubeApiError(res.status, `YouTube refused the API key${body?.error?.message ? `: ${body.error.message}` : ""}`);
  }
  if (!res.ok) throw new YouTubeApiError(res.status, `YouTube answered ${res.status}`);
  const body = (await res.json()) as { items?: SearchItem[] };
  return (body.items ?? []).flatMap((item) => {
    const id = item.id?.videoId;
    if (!id || !item.snippet?.title) return [];
    const thumbnails = item.snippet.thumbnails ?? {};
    return [
      {
        title: unescape(item.snippet.title),
        artist: item.snippet.channelTitle ? unescape(item.snippet.channelTitle) : null,
        album: null,
        thumbnailUrl: thumbnails.medium?.url ?? thumbnails.default?.url ?? null,
        url: `https://www.youtube.com/watch?v=${id}`,
      },
    ];
  });
}
