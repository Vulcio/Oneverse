import type { SmartListFilters, SongSort } from "@oneverse/core";

export const SORTS: SongSort[] = ["title", "updatedAt", "createdAt", "language", "publicationState"];

export interface LibrarySearch {
  q?: string;
  language?: string;
  tagId?: string;
  /** An artist's songs (issue #58): the whole name. */
  artist?: string;
  /** The smart list being looked at, if any (its filters are the rest of the search). */
  list?: string;
  /** Only the user's favorites (issue #81). */
  favorites?: boolean;
  page?: number;
  sort?: SongSort;
  dir?: "asc" | "desc";
}

// The router reads "?q=12345" (a CCLI number, say) as a number: as text it's the same search.
const text = (value: unknown): string | undefined => {
  const written = typeof value === "number" ? String(value) : value;
  return typeof written === "string" && written.trim() ? written : undefined;
};

/** A search's filters, as a smart list keeps them. */
export function filtersOf(search: LibrarySearch): SmartListFilters {
  const { q, language, tagId, artist, sort, dir } = search;
  return Object.fromEntries(Object.entries({ q, language, tagId, artist, sort, dir }).filter(([, value]) => value !== undefined)) as SmartListFilters;
}

export const sameFilters = (a: SmartListFilters, b: SmartListFilters) => JSON.stringify(filtersOf(a)) === JSON.stringify(filtersOf(b));

/** The Songs page's search, filters and page, from the address. */
export function parseLibrarySearch(search: Record<string, unknown>): LibrarySearch {
  const page = Number(search.page);
  const [q, language, tagId, artist, list] = [search.q, search.language, search.tagId, search.artist, search.list].map(text);
  return {
    ...(q && { q }),
    ...(language && { language }),
    ...(tagId && { tagId }),
    ...(artist && { artist }),
    ...(list && { list }),
    ...((search.favorites === true || search.favorites === "true") && { favorites: true }),
    ...(Number.isInteger(page) && page > 1 && { page }),
    ...(typeof search.sort === "string" && (SORTS as string[]).includes(search.sort) && { sort: search.sort as SongSort }),
    ...((search.dir === "asc" || search.dir === "desc") && { dir: search.dir }),
  };
}
