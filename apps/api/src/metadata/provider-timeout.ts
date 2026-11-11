/** How long any request to a music provider or reference site may take (Apple Music, Deezer, Spotify, iTunes, Wikipedia, Wikidata, their images). */
export const PROVIDER_TIMEOUT_MS = 8000;

/**
 * A request to an outside provider, given up after PROVIDER_TIMEOUT_MS (issue #427: the one place that
 * rule is kept, rather than a `signal` remembered at each call). What the answer means - its statuses,
 * its errors - stays with each provider's client.
 */
export function providerFetch(url: string | URL, init: Omit<RequestInit, "signal"> = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
}
