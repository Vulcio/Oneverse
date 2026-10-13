import { parseLyricsQuery, resolveTranslation, type LocaleValue, type LyricsMatch, type SongSort, type SongVersionSummary, type Tag } from "@songverse/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ListFilter, Loader2, Quote, Search, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { filtersOf, parseLibrarySearch, sameFilters, SORTS, type LibrarySearch } from "./-library-search";
import { useColumnPrefs, useLibraryColumns } from "./-columns";
import { ColumnsMenu } from "./-columns-menu";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent } from "@songverse/ui/components/card";
import { DataTable } from "@songverse/ui/components/data-table";
import { Input } from "@songverse/ui/components/input";
import { ConfirmButton } from "#/components/confirm-button";
import { LanguageSelect } from "#/components/language-select";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { refreshSmartLists, useSmartLists } from "#/lib/smart-lists";
import { useInLyrics } from "#/lib/lyrics-search";
import { LyricsSnippet } from "#/components/lyrics-snippet";

const PAGE_SIZE = 50;

/** Where a song opened from this list came from, for the sidebar to list it (issue #80): the list's search, less its page. */
function fromOf(search: LibrarySearch): { from?: string } {
  const params = new URLSearchParams(
    Object.entries({ ...search, page: undefined })
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, String(value)]),
  );
  return params.size ? { from: params.toString() } : {};
}

/** Pages loaded at once when the address says a later one (reloaded, or back to the list): up to 10, 500 songs. */
const MAX_PAGES_AT_ONCE = 10;

export const Route = createFileRoute("/_protected/library/songs")({
  validateSearch: parseLibrarySearch,
  // The page reached isn't what's listed (issue #150): scrolling on doesn't load it all again.
  loaderDeps: ({ search }) => ({ ...search, page: undefined }),
  loader: async ({ deps, location }) => {
    // `list` only names the page; the filters are the rest.
    const query = { ...filtersOf(deps), favorites: deps.favorites };
    // Every page up to the one the address says, so it opens where it was left.
    const pages = Math.min(MAX_PAGES_AT_ONCE, Math.max(1, (location.search as LibrarySearch).page ?? 1));
    const [loaded, tags] = await Promise.all([
      Promise.all(Array.from({ length: pages }, (_, index) => apiClient.listSongVersions({ ...query, page: index + 1, pageSize: PAGE_SIZE }))),
      apiClient.listTags().catch(() => [] as Tag[]),
    ]);
    const songs = { items: loaded.flatMap((page) => page.items), total: loaded[0]?.total ?? 0, pages };
    return { songs, tags };
  },
  component: LibraryIndex,
});

function LibraryIndex() {
  const { t, i18n } = useTranslation();
  const { songs, tags } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { session } = Route.useRouteContext();
  const columns = useLibraryColumns(session.userId);
  // Which columns show, in what order (issue #150), on this device.
  const [columnPrefs, setColumnPrefs] = useColumnPrefs();
  const columnVisibility = Object.fromEntries(columnPrefs.columns.map((column) => [column.id, column.shown]));
  const columnOrder = ["title", ...columnPrefs.columns.map((column) => column.id)];

  // More as it scrolls (issue #150): the next page appended, the address following.
  const [more, setMore] = useState<SongVersionSummary[]>([]);
  const [pages, setPages] = useState(songs.pages);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    setMore([]);
    setPages(songs.pages);
  }, [songs]);
  const items = useMemo(() => {
    const seen = new Set(songs.items.map((song) => song.id));
    return [...songs.items, ...more.filter((song) => !seen.has(song.id))];
  }, [songs, more]);
  const hasMore = items.length < songs.total;
  const loading = useRef<SongVersionSummary[] | null>(null);
  async function loadMore() {
    if (loadingMore || !hasMore) return;
    const from = songs.items;
    loading.current = from;
    setLoadingMore(true);
    try {
      const next = pages + 1;
      const page = await apiClient.listSongVersions({ ...filtersOf(search), favorites: search.favorites, page: next, pageSize: PAGE_SIZE });
      // Another search since: not this one's.
      if (loading.current !== from) return;
      setMore((before) => [...before, ...page.items]);
      setPages(next);
      // The address says how far, without loading anything again: back to the list, it's all there.
      const url = new URL(window.location.href);
      url.searchParams.set("page", String(next));
      window.history.replaceState(window.history.state, "", url);
    } finally {
      if (loading.current === from) setLoadingMore(false);
    }
  }
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  });
  const [query, setQuery] = useState(search.q ?? "");
  // Following the address (a smart list opened from the sidebar, say).
  useEffect(() => setQuery(search.q ?? ""), [search.q]);

  // Search as you type, a moment after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (q === (search.q ?? "")) return;
    const timer = setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, q: q || undefined, page: undefined }), replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, search.q, navigate]);

  const sort = search.sort ?? "updatedAt";
  const desc = (search.dir ?? (sort === "updatedAt" || sort === "createdAt" ? "desc" : "asc")) === "desc";
  const lists = useSmartLists();
  const list = search.list ? lists.find((candidate) => candidate.id === search.list) : undefined;
  const filtered = Object.keys(filtersOf({ ...search, sort: undefined, dir: undefined })).length > 0 || !!search.favorites;
  const setFilter = (change: Partial<LibrarySearch>) => void navigate({ search: (prev) => ({ ...prev, ...change, page: undefined }) });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          {list ? <ListFilter className="size-5 text-muted-foreground" aria-hidden /> : null}
          {list?.name ?? (search.favorites ? t("library.home.favorites") : t("nav.songs"))}
        </h1>
        <Button render={<Link to="/library/new" />}>{t("library.addASong")}</Button>
      </div>


      <SmartListBar search={search} filtered={filtered} />

      {songs.total === 0 && !filtered ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">{t("library.noSongsYet")}</CardContent>
        </Card>
      ) : (
        <Card className="gap-0 p-0">
          <div className="px-4 pt-4 pb-3">
            <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("library.searchPlaceholder")}
                aria-label={t("library.searchPlaceholder")}
                className="pl-9"
              />
            </div>
            <InLyricsToggle />
            <LanguageSelect
              value={search.language ?? ""}
              onChange={(language) => setFilter({ language: language || undefined })}
              allowEmpty
              emptyLabel={t("library.allLanguages")}
              className="w-auto"
            />
            <NativeSelect value={search.tagId ?? ""} onChange={(event) => setFilter({ tagId: event.target.value || undefined })} aria-label={t("library.filterTag")}>
              <option value="">{t("library.allTags")}</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {resolveTranslation(tag.label, tag.translations, i18n.language as LocaleValue)}
                </option>
              ))}
            </NativeSelect>
            <Button
              type="button"
              variant={search.favorites ? "default" : "outline"}
              aria-pressed={!!search.favorites}
              onClick={() => setFilter({ favorites: search.favorites ? undefined : true })}
            >
              <Star className={search.favorites ? "fill-current" : undefined} />
              {t("library.home.favoritesFilter")}
            </Button>
            <span className="sm:ml-auto">
              <ColumnsMenu prefs={columnPrefs} onChange={setColumnPrefs} />
            </span>
            {search.artist ? (
              <span className="flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-sm" data-testid="artist-filter">
                {t("library.byArtist", { name: search.artist })}
                <button type="button" className="rounded-full p-0.5 hover:bg-background" onClick={() => setFilter({ artist: undefined })} aria-label={t("library.clearArtist")}>
                  <X className="size-3.5" />
                </button>
              </span>
            ) : null}
            </div>
          </div>
          <LyricsResults search={search} listed={items} />
          <DataTable
            columns={columns}
            data={items}
            columnVisibility={columnVisibility}
            columnOrder={columnOrder}
            emptyMessage={t("library.noMatches")}
            sorting={[{ id: sort, desc }]}
            onSortingChange={(next) => {
              const first = next[0];
              void navigate({
                search: (prev) => ({
                  ...prev,
                  sort: first && (SORTS as string[]).includes(first.id) ? (first.id as SongSort) : undefined,
                  dir: first ? (first.desc ? "desc" : "asc") : undefined,
                  page: undefined,
                }),
              });
            }}
            onRowClick={(version) => void navigate({ to: "/library/$songVersionId", params: { songVersionId: version.id }, search: fromOf(search) })}
          />
          {/* Near the end, the next ones come (issue #150); the button for a keyboard, or a list too short to scroll. */}
          <div ref={sentinel} className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
            <span data-testid="library-range">{t("library.range", { from: items.length ? 1 : 0, to: items.length, total: songs.total })}</span>
            {hasMore ? (
              <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()} data-testid="library-more">
                {loadingMore ? <Loader2 className="animate-spin" /> : null}
                {t("library.showMore")}
              </Button>
            ) : null}
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * Saving the current filters as a smart list (issue #58); on a smart list,
 * saving changes to it, renaming it or deleting it.
 */
function SmartListBar({ search, filtered }: { search: LibrarySearch; filtered: boolean }) {
  const { t } = useTranslation();
  const navigate = Route.useNavigate();
  const lists = useSmartLists();
  const list = search.list ? lists.find((candidate) => candidate.id === search.list) : undefined;
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = list ? !sameFilters(list.filters, search) : false;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refreshSmartLists();
      setNaming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!list && !filtered) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="smart-list-bar">
      {naming ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            void run(async () => {
              if (naming === "rename" && list) {
                await apiClient.updateSmartList(list.id, { name: trimmed });
              } else {
                const created = await apiClient.createSmartList(trimmed, filtersOf(search));
                void navigate({ search: { ...filtersOf(search), list: created.id } });
              }
            });
          }}
        >
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus aria-label={t("library.smartListName")} placeholder={t("library.smartListName")} className="w-56" />
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            {t("library.saveSmartList")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setNaming(null)}>
            {t("library.cancel")}
          </Button>
        </form>
      ) : list ? (
        <>
          {changed ? (
            <Button size="sm" disabled={busy} onClick={() => void run(async () => void (await apiClient.updateSmartList(list.id, { filters: filtersOf(search) })))}>
              {t("library.updateSmartList")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setName(list.name);
              setNaming("rename");
            }}
          >
            {t("library.renameSmartList")}
          </Button>
          <ConfirmButton
            label={t("library.deleteSmartList")}
            confirmLabel={t("library.confirmDeleteSmartList")}
            busyLabel={t("library.deleting")}
            cancelLabel={t("library.cancel")}
            busy={busy}
            onConfirm={() =>
              void run(async () => {
                await apiClient.deleteSmartList(list.id);
                void navigate({ search: {} });
              })
            }
          />
        </>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setName("");
            setNaming("new");
          }}
        >
          <ListFilter />
          {t("library.saveAsSmartList")}
        </Button>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/** In the songs' words too (issue #221): the same choice as the search box's, on this device. */
function InLyricsToggle() {
  const { t } = useTranslation();
  const [inLyrics, setInLyrics] = useInLyrics();
  return (
    <Button type="button" variant={inLyrics ? "default" : "outline"} aria-pressed={inLyrics} onClick={() => setInLyrics(!inLyrics)} data-testid="library-in-lyrics">
      <Quote />
      {t("search.inLyrics")}
    </Button>
  );
}

const LYRICS_SHOWN = 20;

/**
 * Songs found by their words (issue #221), above the list: each with the
 * line found, opening at it; a song the list already has by its title isn't
 * repeated. With the other filters, as the list has them.
 */
function LyricsResults({ search, listed }: { search: LibrarySearch; listed: SongVersionSummary[] }) {
  const { t } = useTranslation();
  const [inLyrics] = useInLyrics();
  const terms = inLyrics && search.q ? parseLyricsQuery(search.q) : null;
  const key = terms ? JSON.stringify({ ...filtersOf(search), favorites: search.favorites }) : "";
  const [found, setFound] = useState<(SongVersionSummary & { lyricsMatch: LyricsMatch })[]>([]);
  useEffect(() => {
    setFound([]);
    if (!key) return;
    let current = true;
    apiClient
      .listSongVersions({ ...filtersOf(search), favorites: search.favorites, in: "lyrics", sort: "title", dir: "asc", pageSize: LYRICS_SHOWN })
      .then((page) => current && setFound(page.items.flatMap((song) => (song.lyricsMatch ? [{ ...song, lyricsMatch: song.lyricsMatch }] : []))))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [key]);
  const ids = new Set(listed.map((song) => song.id));
  const shown = found.filter((song) => !ids.has(song.id));
  if (!inLyrics || !search.q) return null;
  return (
    <div className="border-t px-4 py-3" data-testid="library-lyrics">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Quote className="size-3.5" aria-hidden />
        {t("search.lyrics")}
      </p>
      {!terms ? (
        <p className="text-xs text-muted-foreground">{t("search.lyricsTooShort")}</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("library.noLyricsMatches")}</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((song) => (
            <li key={song.id}>
              <Link
                to="/library/$songVersionId"
                params={{ songVersionId: song.id }}
                search={song.lyricsMatch.lineId ? { line: song.lyricsMatch.lineId } : {}}
                className="flex min-w-0 flex-col rounded-md px-2 py-1.5 hover:bg-accent sm:flex-row sm:items-baseline sm:gap-3"
                data-testid="library-lyrics-song"
              >
                <span className="shrink-0 text-sm font-medium">{song.versionName ? `${song.title} — ${song.versionName}` : song.title}</span>
                <LyricsSnippet match={song.lyricsMatch} className="min-w-0 truncate text-xs text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
