/**
 * An image from a music provider - a song's artwork (issue #85) or an
 * artist's picture (#86) - downloaded by the server: only from Apple
 * Music's, Deezer's or Spotify's image hosts over HTTPS (and, in the e2e
 * suites, their stand-ins) or a Song provider's own address (issue #157), still there after any redirect, and no bigger
 * than it may be. The one place the server fetches an address it was given
 * (issue #112: no SSRF).
 */
import { fetch as guardedFetch } from "undici";
import { PROVIDER_TIMEOUT_MS } from "../metadata/provider-timeout.js";
import { songProviderImageRules } from "../plugins/song-provider/song-provider-sources.js";
import { checkOutsideUrl, outsideDispatcher, type OutsideAddressRules } from "../security/outside-address.js";

export const MAX_PROVIDER_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_HOSTS = ["mzstatic.com", "dzcdn.net", "scdn.co"];
const MAX_REDIRECTS = 3;

/** The e2e suites' stand-ins for the providers, whose images are allowed too. */
const testOrigins = () =>
  [process.env.ITUNES_SEARCH_URL, process.env.DEEZER_API_URL, process.env.SPOTIFY_API_URL, process.env.APPLE_MUSIC_API_URL]
    .filter((url): url is string => !!url)
    .map((url) => new URL(url).origin);

/** An address the server may download a provider's image from. */
export function isProviderImageUrl(url: string | URL): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const on = (domain: string) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`);
  if (parsed.protocol === "https:" && IMAGE_HOSTS.some(on)) return true;
  return testOrigins().includes(parsed.origin);
}

export class ProviderImageError extends Error {}

/** The image's bytes, or a ProviderImageError saying why not. */
export async function fetchProviderImage(url: string): Promise<Buffer> {
  const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  // Redirects followed here, each checked before it's asked: one elsewhere is
  // refused like the address itself would be, and never requested.
  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Or a Song provider's own address (issue #157), under that server's rules: public unless the admin said otherwise.
    let rules: OutsideAddressRules | null = null;
    if (!isProviderImageUrl(url)) {
      rules = await songProviderImageRules(url);
      if (!rules) throw new ProviderImageError("Images come from Apple Music, Deezer, Spotify or a song provider only");
      try {
        checkOutsideUrl(url, rules);
      } catch (error) {
        throw new ProviderImageError(error instanceof Error ? error.message : String(error));
      }
    }
    res = rules ? ((await guardedFetch(url, { signal, redirect: "manual", dispatcher: outsideDispatcher(rules) })) as unknown as Response) : await fetch(url, { signal, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) break;
    await res.body?.cancel();
    url = new URL(location, url).toString();
    res = null;
  }
  if (!res) throw new ProviderImageError("Too many redirects");
  if (!res.ok) throw new ProviderImageError(`Couldn't download the image (${res.status})`);
  if (!(res.headers.get("content-type") ?? "").startsWith("image/")) throw new ProviderImageError("That isn't an image");
  if (Number(res.headers.get("content-length") ?? 0) > MAX_PROVIDER_IMAGE_BYTES) throw new ProviderImageError("That image is too big");
  // Read up to the limit, never more, whatever the response says of its length.
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  if (!reader) throw new ProviderImageError("That isn't an image");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PROVIDER_IMAGE_BYTES) {
      await reader.cancel();
      throw new ProviderImageError("That image is too big");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
