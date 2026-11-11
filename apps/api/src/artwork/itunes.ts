import { providerFetch } from "../metadata/provider-timeout.js";
/** Where the iTunes Search API is; pointed elsewhere only by the e2e suites. */
export const itunesBase = () => (process.env.ITUNES_SEARCH_URL ?? "https://itunes.apple.com").replace(/\/$/, "");

/** A song, as Apple Music's search and lookup describe it. */
export interface ITunesSong {
  wrapperType?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
}

async function get(path: string, query: Record<string, string>): Promise<ITunesSong[]> {
  const res = await providerFetch(`${itunesBase()}${path}?${new URLSearchParams(query)}`);
  if (!res.ok) throw new Error(`Apple Music answered ${res.status}`);
  const { results = [] } = (await res.json()) as { results?: ITunesSong[] };
  return results.filter((result) => !result.wrapperType || result.wrapperType === "track");
}

/** Songs matching `term` in a storefront (`country`, two letters). */
export const itunesSearch = (term: string, country: string, limit = 15) => get("/search", { term, entity: "song", limit: String(limit), country });

/** One song by its track ID, or null. */
export const itunesLookup = async (id: string, country: string) => (await get("/lookup", { id, country })).find((song) => String(song.trackId) === id) ?? null;

/** Apple serves its artwork at any size by address: this one, from the 100px thumbnail's. */
export const artworkAtSize = (url100: string, size: string) => url100.replace(/\d+x\d+bb(?=\.\w+$)/, size);
