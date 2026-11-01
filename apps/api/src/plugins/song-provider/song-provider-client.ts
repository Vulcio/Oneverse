/**
 * One Song provider API server (issue #157, docs/song-provider-api.yaml),
 * called the way every address someone typed in is: HTTPS and a public
 * host unless the admin said it's on the same network, checked on every
 * address its name resolves to, never redirected, its answer capped in
 * size and read through core's schemas, waiting PROVIDER_TIMEOUT_MS at
 * most. A failure is a SongProviderError with a code, said as that
 * provider's own, never a crash.
 */
import {
  SongProviderArtistPictureSchema,
  SongProviderCapabilitiesSchema,
  SongProviderContentSchema,
  SongProviderErrorSchema,
  SongProviderSearchResultSchema,
  SongProviderSongSchema,
  type SongProviderArtistPicture,
  type SongProviderCapabilities,
  type SongProviderContent,
  type SongProviderSearch,
  type SongProviderSong,
  type SongProviderSongSummary,
} from "@oneverse/core";
import { fetch, type RequestInit, type Response } from "undici";
import type { z } from "zod";
import { PROVIDER_TIMEOUT_MS } from "../../metadata/provider-timeout.js";
import { checkOutsideUrl, OutsideAddressError, outsideDispatcher } from "../../security/outside-address.js";

/** The biggest answer read: a chart with its document is well under it. */
const MAX_ANSWER_BYTES = 2 * 1024 * 1024;

export type SongProviderErrorCode = "unauthorized" | "not-found" | "throttled" | "timeout" | "unreachable" | "invalid" | "error";

export class SongProviderError extends Error {
  constructor(
    readonly code: SongProviderErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface SongProviderEndpoint {
  name: string;
  apiUrl: string;
  apiKey: string | null;
  allowPrivate: boolean;
}

/** The address with /v1 and the path, whether or not the admin typed the /v1. */
export function endpointUrl(apiUrl: string, path: string): string {
  const base = apiUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${base}/v1${path}`;
}

async function readBody(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_ANSWER_BYTES) throw new SongProviderError("invalid", "Its answer is larger than it can be");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of (response.body ?? []) as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > MAX_ANSWER_BYTES) throw new SongProviderError("invalid", "Its answer is larger than it can be");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function call<S extends z.ZodType>(endpoint: SongProviderEndpoint, path: string, schema: S, init: RequestInit = {}): Promise<z.output<S>> {
  const url = endpointUrl(endpoint.apiUrl, path);
  const rules = { allowPrivate: endpoint.allowPrivate };
  let response: Response;
  try {
    checkOutsideUrl(url, rules);
    response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}) },
      redirect: "error",
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      dispatcher: outsideDispatcher(rules),
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    if (cause instanceof OutsideAddressError || error instanceof OutsideAddressError) throw new SongProviderError("unreachable", `Its address isn't allowed: ${(cause as Error).message}`);
    if (error instanceof Error && error.name === "TimeoutError") throw new SongProviderError("timeout", "It didn't answer in time");
    throw new SongProviderError("unreachable", `It couldn't be reached: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const text = await readBody(response);
  if (!response.ok) {
    let said: string | null = null;
    try {
      said = SongProviderErrorSchema.parse(JSON.parse(text)).error.message;
    } catch {
      // Not the API's error shape: the status says it.
    }
    const code: SongProviderErrorCode = response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 404 ? "not-found" : response.status === 429 ? "throttled" : "error";
    const fallback = code === "unauthorized" ? "It refused the key" : code === "not-found" ? "It doesn't have that" : code === "throttled" ? "It asked to slow down" : `It answered ${response.status}`;
    throw new SongProviderError(code, said ? `${fallback}: ${said}` : fallback);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SongProviderError("invalid", "Its answer isn't JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SongProviderError("invalid", `Its answer doesn't follow the Song provider API${issue ? ` (${issue.path.join(".") || "answer"}: ${issue.message})` : ""}`);
  }
  return parsed.data;
}

export const songProviderCapabilities = (endpoint: SongProviderEndpoint): Promise<SongProviderCapabilities> => call(endpoint, "/capabilities", SongProviderCapabilitiesSchema);

export const songProviderSearch = async (endpoint: SongProviderEndpoint, query: SongProviderSearch): Promise<SongProviderSongSummary[]> =>
  (await call(endpoint, "/search", SongProviderSearchResultSchema, { method: "POST", body: JSON.stringify(query) })).songs;

export const songProviderSong = (endpoint: SongProviderEndpoint, id: string): Promise<SongProviderSong> => call(endpoint, `/songs/${encodeURIComponent(id)}`, SongProviderSongSchema);

export const songProviderContent = (endpoint: SongProviderEndpoint, id: string): Promise<SongProviderContent> =>
  call(endpoint, `/songs/${encodeURIComponent(id)}/content`, SongProviderContentSchema);

/** An artist's picture, or null when the provider has none. */
export async function songProviderArtistPicture(endpoint: SongProviderEndpoint, name: string): Promise<SongProviderArtistPicture | null> {
  try {
    return await call(endpoint, `/artists/picture?name=${encodeURIComponent(name)}`, SongProviderArtistPictureSchema);
  } catch (error) {
    if (error instanceof SongProviderError && error.code === "not-found") return null;
    throw error;
  }
}
