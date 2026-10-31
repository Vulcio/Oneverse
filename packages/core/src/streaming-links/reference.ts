/**
 * A song's reference recording (issue #346): a pasted address, read for the
 * service it's on, the video's or track's ID there, and where it starts
 * (YouTube's "t=1m30s" or "t=90"). Any other https address is kept as OTHER.
 */
import { parseStreamingLink, type StreamingIdentifierType } from "./parser.js";

export const SONG_LINK_SERVICES = ["YOUTUBE", "SPOTIFY", "APPLE_MUSIC", "DEEZER", "OTHER"] as const;
export type SongLinkService = (typeof SONG_LINK_SERVICES)[number];

export interface ReferenceLink {
  service: SongLinkService;
  /** The ID on its service; null for OTHER. */
  value: string | null;
  /** The address to open: rebuilt from the ID where it can be. */
  url: string;
  /** Where the address says to start, in seconds. */
  startSeconds: number | null;
}

const HOSTS: [RegExp, StreamingIdentifierType][] = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/, "YOUTUBE"],
  [/(^|\.)spotify\.com$/, "SPOTIFY"],
  [/(^|\.)music\.apple\.com$/, "APPLE_MUSIC"],
  [/(^|\.)deezer\.com$/, "DEEZER"],
];

/** "90", "90s", "1m30s", "1h2m3s" as seconds; null when it's none of those. */
export function readStartTime(input: string | null | undefined): number | null {
  if (!input) return null;
  if (/^\d+s?$/.test(input)) return Number.parseInt(input, 10);
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(input);
  if (!parts || !parts[0]) return null;
  return Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
}

/** The pasted address as a reference link; null when it isn't an http(s) address. */
export function readReferenceLink(input: string): ReferenceLink | null {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(withScheme)) return null;
  const url = new URL(withScheme);
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return null;
  const host = url.hostname.toLowerCase();
  const service = HOSTS.find(([pattern]) => pattern.test(host))?.[1];
  const startSeconds = readStartTime(url.searchParams.get("t") ?? url.searchParams.get("start"));
  if (service) {
    // A YouTube "embed/ID" or "shorts/ID" address has its ID in the path.
    const embedded = service === "YOUTUBE" ? /^\/(?:embed|shorts|live)\/([\w-]{6,})/.exec(url.pathname)?.[1] : undefined;
    const parsed = parseStreamingLink(service, embedded ? `https://www.youtube.com/watch?v=${embedded}` : url.toString());
    // Recognised only when an ID came out of it, not the address itself.
    if (parsed.value !== url.toString() && parsed.value !== trimmed) return { service, value: parsed.value, url: parsed.sourceUrl, startSeconds };
  }
  return { service: "OTHER", value: null, url: url.toString(), startSeconds };
}
