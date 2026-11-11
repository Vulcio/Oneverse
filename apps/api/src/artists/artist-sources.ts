import { providerFetch } from "../metadata/provider-timeout.js";
/**
 * Where artists' pictures and bios come from (issue #86): Deezer for the
 * picture, Wikipedia (found through MusicBrainz and Wikidata) for the bio.
 * No keys. Each address can be pointed elsewhere by the e2e suites.
 */
const deezerBase = () => (process.env.DEEZER_API_URL ?? "https://api.deezer.com").replace(/\/$/, "");
const wikidataApi = () => process.env.WIKIDATA_API_URL ?? "https://www.wikidata.org/w/api.php";
/** A Wikipedia's address, {lang} standing for the language. */
const wikipediaBase = (language: string) => (process.env.WIKIPEDIA_URL ?? "https://{lang}.wikipedia.org").replace("{lang}", language).replace(/\/$/, "");
/** Wikimedia asks API clients to say who they are. */
const userAgent = () => `Songverse/0.1.0 (${process.env.MUSICBRAINZ_CONTACT ?? "https://songverse.one"})`;

export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

async function getJson<T>(url: string): Promise<T> {
  const res = await providerFetch(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" } });
  if (res.status === 404) throw Object.assign(new Error("Not found"), { status: 404 });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return (await res.json()) as T;
}

export interface FoundPicture {
  /** The picture, full size (1000px). */
  url: string;
  /** The artist's page there, to credit it. */
  pageUrl: string;
}

/** The artist's picture on Deezer: one named exactly so (ignoring case and accents), with a picture of its own. */
export async function deezerArtistPicture(name: string): Promise<FoundPicture | null> {
  const { data = [] } = await getJson<{ data?: { id: number; name: string; link?: string; picture_xl?: string }[]; error?: unknown }>(
    `${deezerBase()}/search/artist?${new URLSearchParams({ q: name, limit: "5" })}`,
  );
  const wanted = fold(name);
  const artist = data.find((a) => fold(a.name) === wanted);
  // Deezer's stand-in for an artist without a picture has no image hash: ".../images/artist//1000x1000...".
  if (!artist?.picture_xl || artist.picture_xl.includes("/artist//")) return null;
  return { url: artist.picture_xl, pageUrl: artist.link ?? `https://www.deezer.com/artist/${artist.id}` };
}

/** The Wikipedia article titles of a Wikidata item, by language. */
export async function wikipediaTitles(wikidataId: string, languages: string[]): Promise<Record<string, string>> {
  const query = new URLSearchParams({
    action: "wbgetentities",
    ids: wikidataId,
    props: "sitelinks",
    sitefilter: languages.map((language) => `${language}wiki`).join("|"),
    format: "json",
  });
  const body = await getJson<{ entities?: Record<string, { sitelinks?: Record<string, { title?: string }> }> }>(`${wikidataApi()}?${query}`);
  const sitelinks = body.entities?.[wikidataId]?.sitelinks ?? {};
  const titles: Record<string, string> = {};
  for (const language of languages) {
    const title = sitelinks[`${language}wiki`]?.title;
    if (title) titles[language] = title;
  }
  return titles;
}

export interface FoundBio {
  text: string;
  /** The article, to credit it (the text is CC BY-SA). */
  sourceUrl: string;
}

/** A Wikipedia article's summary - its first paragraph - or null for a missing or disambiguation page. */
export async function wikipediaSummary(language: string, title: string): Promise<FoundBio | null> {
  try {
    const body = await getJson<{ type?: string; extract?: string; content_urls?: { desktop?: { page?: string } } }>(
      `${wikipediaBase(language)}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    );
    const text = body.extract?.trim();
    if (!text || body.type === "disambiguation") return null;
    return { text, sourceUrl: body.content_urls?.desktop?.page ?? `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` };
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}
