import { foldForSearch, formatSongbookReference, keptSongReferences, onlineOrKept, parseLyricsQuery, partialEntryDigits, searchKeptEntries, searchKeptLyrics, searchKeptSongs, SONGBOOK_HIT_LIMITS, songbookReferences, type LyricsMatch, type SongbookEntryHit } from "@oneverse/core";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useNavigate, useRouteContext, useRouter, useRouterState } from "@tanstack/react-router";
import { BookOpen, Hash, ListEnd, ListMusic, ListPlus, Music, Quote, Search, Users, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { artistNames } from "#/lib/artists";
import { useInLyrics } from "#/lib/lyrics-search";
import { LyricsSnippet } from "#/components/lyrics-snippet";
import { useMode } from "#/lib/mode";
import { deviceStorage } from "#/lib/offline-data";
import { formatSetDate, setlistTitle } from "#/lib/setlists";
import { cn } from "@oneverse/ui/lib/utils";

const SONG_LIMIT = 8;

/** A song found: by the library's search online, among the kept sets offline. */
interface FoundSong {
  id: string;
  title: string;
  versionName: string | null;
  artists: string | null;
  /** Where it is in the player's songbooks, abbreviations first (issue #213). */
  references: string[];
}
/** A song found by its words (issue #221), with the line. */
interface FoundLyrics {
  id: string;
  title: string;
  versionName: string | null;
  match: LyricsMatch;
}
const OTHER_LIMIT = 5;
// Songbook references beside a song: the first two, then "+2".
const SHOWN_REFERENCES = 2;
// Show more (issue #213): more of each group of numbers.
const MORE_LIMITS = { exact: 50, prefix: 100, contains: 100 };
const DEBOUNCE_MS = 200;

type Kind = "entries" | "entriesPrefix" | "entriesContains" | "songs" | "lyrics" | "sets" | "songbooks" | "teams";
interface Result {
  kind: Kind;
  id: string;
  label: string;
  detail: string | null;
  open: () => void;
  /** A song's places in the player's songbooks, on the right of its row (issue #213). */
  references?: string[];
  /** A song, in Live in a set they can change (issue #199): added after the song playing, or at the end. */
  add?: (where: "next" | "end") => void;
  /** Found in the lyrics: the line, shown under the title. */
  lyrics?: LyricsMatch;
}
const ICONS: Record<Kind, LucideIcon> = { entries: Hash, entriesPrefix: Hash, entriesContains: Hash, songs: Music, lyrics: Quote, sets: ListMusic, songbooks: BookOpen, teams: Users };


/**
 * Search across songs, sets, songbooks and teams (issue #48), in the header
 * of every mode: a search box on a wide screen, a magnifying glass on a
 * phone, and Ctrl K / ⌘ K anywhere. In Live, a song opens full screen, to
 * pull up one the leader calls that isn't in the set - or, in a set they can
 * change, is added to it: next, or at the end (issue #199).
 */
export function CommandSearch() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [shortcut, setShortcut] = useState("Ctrl K");

  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setShortcut("⌘ K");
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger render={<button type="button" aria-label={t("search.label")} data-testid="command-search" className={cn(
            "flex h-8 shrink-0 items-center gap-2 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg]:size-4",
            // A search box on a wide screen, a magnifying glass on a phone.
            "w-8 justify-center md:w-56 md:justify-start md:border md:bg-background md:px-2.5 md:shadow-xs",
          )} />}>
          <Search />
          <span className="hidden flex-1 text-left md:inline">{t("search.open")}</span>
          <kbd className="hidden rounded border bg-muted px-1.5 font-sans text-[0.7rem] md:inline">{shortcut}</kbd>
        </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Popup
          className="fixed top-3 left-1/2 z-50 flex max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg sm:top-[12vh] sm:max-h-[70vh]"
        >
          <DialogPrimitive.Title className="sr-only">{t("search.label")}</DialogPrimitive.Title>
          {open ? <SearchPanel onDone={() => setOpen(false)} /> : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SearchPanel({ onDone }: { onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const { mode } = useMode();
  const { setlists, songbooks, teams } = useRouteContext({ from: "/_protected" });
  // Live, in a set they can change: its songs can be added to it from here (issue #199).
  const inSet = useRouterState({ select: (s) => /^\/sets\/([^/]+)\/live\/([^/]+)/.exec(s.location.pathname) });
  const liveSet = mode === "live" && inSet ? setlists.find((set) => set.id === inSet[1] && set.canEdit) : undefined;
  const playingItemId = inSet?.[2] ?? null;
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<FoundSong[]>([]);
  const [entries, setEntries] = useState<SongbookEntryHit[]>([]);
  const [moreEntries, setMoreEntries] = useState(false);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const q = foldForSearch(query.trim());
  // In the songs' words too (issue #221): off unless turned on, remembered on the device.
  const [inLyrics, setInLyrics] = useInLyrics();
  const [lyrics, setLyrics] = useState<FoundLyrics[]>([]);
  const lyricsQuery = inLyrics ? parseLyricsQuery(query) : null;
  const lyricsKey = lyricsQuery ? JSON.stringify(lyricsQuery) : "";

  useEffect(() => {
    if (!lyricsKey) {
      setLyrics([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      onlineOrKept<FoundLyrics[]>(
        async () =>
          (await apiClient.listSongVersions({ q: query.trim(), in: "lyrics", pageSize: SONG_LIMIT, sort: "title" })).items.flatMap((song) =>
            song.lyricsMatch ? [{ id: song.id, title: song.title, versionName: song.versionName, match: song.lyricsMatch }] : [],
          ),
        // Offline: the kept songs' words, matched the same way.
        async () =>
          (await searchKeptLyrics(deviceStorage(), query, SONG_LIMIT)).map((song) => ({ id: song.songVersionId, title: song.title, versionName: song.versionName, match: song.lyricsMatch })),
      )
        .then((found) => current && setLyrics(found))
        .catch(() => current && setLyrics([]));
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [lyricsKey]);

  // Songs from the library's own search (title, subtitle, version, artist, CCLI), a moment after typing stops.
  useEffect(() => {
    if (!q) {
      setSongs([]);
      setEntries([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let current = true;
    const timer = setTimeout(() => {
      onlineOrKept<FoundSong[]>(
        async () =>
          (await apiClient.listSongVersions({ q: query.trim(), pageSize: SONG_LIMIT, sort: "title", references: true })).items.map((song) => ({
            id: song.id,
            title: song.title,
            versionName: song.versionName,
            artists: artistNames(song.artists),
            references: song.songbookReferences ?? [],
          })),
        // Offline: the songs kept on the device, on their own or in kept sets (issues #50, #52).
        async () =>
          Promise.all(
            (await searchKeptSongs(deviceStorage(), query, SONG_LIMIT)).map(async ({ songVersionId, title, versionName, artists }) => ({
              id: songVersionId,
              title,
              versionName,
              artists,
              references: await keptSongReferences(deviceStorage(), songVersionId),
            })),
          ),
      )
        .then((found) => current && setSongs(found))
        .catch(() => current && setSongs([]))
        .finally(() => current && setSearching(false));
      // "HY 42", "42": songbook entries by reference (issue #48); offline, in kept songbooks.
      if (songbookReferences(query).length === 0) setEntries([]);
      else
        onlineOrKept(
          () => apiClient.searchSongbookEntries(query.trim(), moreEntries),
          () => searchKeptEntries(deviceStorage(), query, moreEntries ? MORE_LIMITS : SONGBOOK_HIT_LIMITS),
        )
          .then((hits) => current && setEntries(hits))
          .catch(() => current && setEntries([]));
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [q, query, moreEntries]);
  // Another search: the first of each group of numbers again.
  useEffect(() => setMoreEntries(false), [q]);

  const results = useMemo(() => {
    const go = (open: () => void) => () => {
      onDone();
      open();
    };
    // In Live, a song opens full screen; × comes back here (or wherever an earlier one was opened from).
    // At a line, from a lyrics search (issue #221).
    const openSong = (id: string, line?: string | null) => {
      const at = line ? { line } : {};
      if (mode !== "live") return navigate({ to: "/library/$songVersionId", params: { songVersionId: id }, search: at });
      const location = router.state.location;
      const from = /^\/library\/[^/]+\/live\/?$/.test(location.pathname) ? (location.search as { back?: string }).back : location.href;
      return navigate({ to: "/library/$songVersionId/live", params: { songVersionId: id }, search: { ...(from && { back: from }), ...at } });
    };
    const matches = (...texts: (string | null | undefined)[]) => texts.some((text) => text && foldForSearch(text).includes(q));
    // Added to the set: the set's pages and Live's "Next" reload; the song playing stays.
    const addToSet = (songVersionId: string) =>
      liveSet
        ? (where: "next" | "end") => {
            setAdding(true);
            setAddError(null);
            apiClient
              .addSetlistItem(liveSet.id, { songVersionId, ...(where === "next" && playingItemId && { afterItemId: playingItemId }) })
              .then(async () => {
                onDone();
                await router.invalidate();
              })
              .catch((error: unknown) => setAddError(error instanceof Error ? error.message : String(error)))
              .finally(() => setAdding(false));
          }
        : undefined;
    const byKind: Result[] = [
      ...entries.map((entry) => ({
        kind: entry.match === "prefix" ? ("entriesPrefix" as const) : entry.match === "contains" ? ("entriesContains" as const) : ("entries" as const),
        id: `${entry.songbookId}-${entry.entryCode}`,
        label: `${formatSongbookReference(entry)} — ${entry.title}`,
        detail: entry.abbreviation ? entry.songbookName : null,
        open: go(() => void openSong(entry.songVersionId)),
        add: addToSet(entry.songVersionId),
      })),
      ...songs.map((song) => ({
        kind: "songs" as const,
        id: song.id,
        label: song.versionName ? `${song.title} — ${song.versionName}` : song.title,
        detail: song.artists,
        references: song.references,
        open: go(() => void openSong(song.id)),
        add: addToSet(song.id),
      })),
      // A song found by its title isn't repeated here.
      ...lyrics
        .filter((found) => !songs.some((song) => song.id === found.id))
        .map((found) => ({
          kind: "lyrics" as const,
          id: found.id,
          label: found.versionName ? `${found.title} — ${found.versionName}` : found.title,
          detail: null,
          lyrics: found.match,
          open: go(() => void openSong(found.id, found.match.lineId)),
          add: addToSet(found.id),
        })),
      ...sortSets(setlists, q)
        .filter((set) => !q || matches(setlistTitle(set, t, i18n.language), set.name, set.teamName))
        .slice(0, OTHER_LIMIT)
        .map((set) => ({
          kind: "sets" as const,
          id: set.id,
          label: setlistTitle(set, t, i18n.language),
          detail: [set.name && set.eventDate ? formatSetDate(set.eventDate, i18n.language, "short") : null, set.teamName].filter(Boolean).join(" · ") || null,
          open: go(() => void navigate({ to: "/sets/$setlistId", params: { setlistId: set.id } })),
        })),
      ...(q
        ? songbooks
            .filter((book) => matches(book.name, book.abbreviation, book.publisher))
            .slice(0, OTHER_LIMIT)
            .map((book) => ({
              kind: "songbooks" as const,
              id: book.id,
              label: book.name,
              detail: [book.abbreviation, book.publisher].filter(Boolean).join(" · ") || null,
              open: go(() => void navigate({ to: "/songbooks/$songbookId", params: { songbookId: book.id } })),
            }))
        : []),
      ...(q
        ? teams
            .filter((team) => matches(team.name, team.description))
            .slice(0, OTHER_LIMIT)
            .map((team) => ({
              kind: "teams" as const,
              id: team.id,
              label: team.name,
              detail: null,
              open: go(() => void navigate({ to: "/teams/$teamId", params: { teamId: team.id } })),
            }))
        : []),
    ];
    return byKind;
  }, [entries, songs, lyrics, setlists, songbooks, teams, q, mode, t, i18n.language, navigate, router, onDone, liveSet, playingItemId]);

  // The first result is picked as the results change.
  useEffect(() => setActive(0), [results]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(event: ReactKeyboardEvent) {
    // Alt+L: in the lyrics too, or not (by the key's place: a Mac's Option+L types "¬").
    if (event.altKey && event.code === "KeyL") setInLyrics(!inLyrics);
    else if (event.key === "ArrowDown") setActive((a) => Math.min(results.length - 1, a + 1));
    else if (event.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    // In a set: Shift+Enter plays it next (issue #199).
    else if (event.key === "Enter" && event.shiftKey && results[active]?.add) results[active].add!("next");
    else if (event.key === "Enter") results[active]?.open();
    else return;
    event.preventDefault();
  }

  const groups = (["entries", "entriesPrefix", "entriesContains", "songs", "lyrics", "sets", "songbooks", "teams"] as const)
    .map((kind) => ({ kind, items: results.map((result, index) => ({ result, index })).filter(({ result }) => result.kind === kind) }))
    .filter((group) => group.items.length > 0);

  // Show more under the last group of numbers, while a group came back full.
  const count = (match: SongbookEntryHit["match"]) => entries.filter((entry) => entry.match === match).length;
  const hasMoreEntries = !moreEntries && (count("prefix") >= SONGBOOK_HIT_LIMITS.prefix || count("contains") >= SONGBOOK_HIT_LIMITS.contains || count("exact") >= SONGBOOK_HIT_LIMITS.exact);
  const lastEntryGroup = (["entriesContains", "entriesPrefix", "entries"] as const).find((kind) => groups.some((group) => group.kind === kind));

  return (
    <>
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("search.placeholder")}
          aria-label={t("search.label")}
          role="combobox"
          aria-expanded
          aria-controls="command-search-results"
          aria-activedescendant={results[active] ? `command-result-${active}` : undefined}
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={() => setInLyrics(!inLyrics)}
          aria-pressed={inLyrics}
          title={`${t("search.inLyrics")} (Alt L)`}
          className={cn(
            "flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium [&_svg]:size-3.5",
            inLyrics ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          data-testid="search-in-lyrics"
        >
          <Quote aria-hidden />
          <span className="hidden sm:inline">{t("search.inLyrics")}</span>
          <span className="sr-only sm:hidden">{t("search.inLyrics")}</span>
        </button>
        <DialogPrimitive.Close className="rounded border px-1.5 text-xs text-muted-foreground hover:text-foreground">Esc</DialogPrimitive.Close>
      </div>
      <div ref={list} id="command-search-results" role="listbox" aria-label={t("search.label")} className="flex-1 overflow-y-auto p-2">
        {groups.map((group) => (
          <div key={group.kind} role="group" aria-label={t(`search.${group.kind}`, { number: partialEntryDigits(query)[0] ?? "" })} className="mb-2 last:mb-0" data-testid={`search-${group.kind}`}>
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
              {!q && group.kind === "sets" ? t("search.upcomingSets") : t(`search.${group.kind}`, { number: partialEntryDigits(query)[0] ?? "" })}
            </p>
            {group.items.map(({ result, index }) => {
              const Icon = ICONS[result.kind];
              return (
                <div
                  key={`${result.kind}-${result.id}`}
                  id={`command-result-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === active}
                  onMouseMove={() => setActive(index)}
                  onClick={result.open}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2 py-2", index === active && "bg-accent text-accent-foreground")}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  {result.lyrics ? (
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm">{result.label}</span>
                      <LyricsSnippet match={result.lyrics} className="truncate text-xs text-muted-foreground" />
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm">{result.label}</span>
                  )}
                  {result.detail ? <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{result.detail}</span> : null}
                  {result.references?.length ? (
                    <span className="shrink-0 text-xs font-medium whitespace-nowrap text-muted-foreground tabular-nums" data-testid="search-song-references">
                      {result.references.slice(0, SHOWN_REFERENCES).join(" · ")}
                      {result.references.length > SHOWN_REFERENCES ? ` ${t("search.moreReferences", { count: result.references.length - SHOWN_REFERENCES })}` : null}
                    </span>
                  ) : null}
                  {result.add ? (
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        disabled={adding}
                        onClick={(event) => {
                          event.stopPropagation();
                          result.add!("next");
                        }}
                        className="flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs text-foreground hover:bg-accent disabled:opacity-50 [&_svg]:size-3.5"
                        data-testid="search-play-next"
                      >
                        <ListPlus />
                        <span className="hidden sm:inline">{t("search.playNext")}</span>
                      </button>
                      <button
                        type="button"
                        disabled={adding}
                        onClick={(event) => {
                          event.stopPropagation();
                          result.add!("end");
                        }}
                        aria-label={t("search.addToEnd")}
                        title={t("search.addToEnd")}
                        className="flex h-7 items-center rounded-md border bg-background px-2 text-foreground hover:bg-accent disabled:opacity-50 [&_svg]:size-3.5"
                        data-testid="search-add-end"
                      >
                        <ListEnd />
                      </button>
                    </span>
                  ) : null}
                </div>
              );
            })}
            {/* More of the numbers starting with it or containing it, when there may be (issue #213). */}
            {group.kind === lastEntryGroup && hasMoreEntries ? (
              <button
                type="button"
                onClick={() => setMoreEntries(true)}
                className="mx-2 mt-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-accent"
                data-testid="search-entries-more"
              >
                {t("search.showMore")}
              </button>
            ) : null}
          </div>
        ))}
        {q && !searching && results.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("search.noResults", { query: query.trim() })}</p>
        ) : null}
        {inLyrics && q && !lyricsQuery ? <p className="px-2 py-1 text-xs text-muted-foreground" data-testid="search-lyrics-short">{t("search.lyricsTooShort")}</p> : null}
        {searching && songs.length === 0 ? <p className="px-2 py-2 text-xs text-muted-foreground">{t("search.searching")}</p> : null}
      </div>
      {addError ? (
        <p className="border-t px-3 py-2 text-xs text-destructive" role="alert">
          {addError}
        </p>
      ) : null}
      {mode === "live" ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">{liveSet ? t("search.liveSetHint") : t("search.liveHint")}</p> : null}
    </>
  );
}

/** Sets from the next one on (then the past, most recent first); undated ones last. */
function sortSets<T extends { eventDate: string | null }>(sets: T[], q: string): T[] {
  if (q) return sets;
  const today = new Date().toISOString().slice(0, 10);
  const rank = (set: T) => (!set.eventDate ? 2 : set.eventDate >= today ? 0 : 1);
  return [...sets].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (!a.eventDate || !b.eventDate) return 0;
    return rank(a) === 0 ? a.eventDate.localeCompare(b.eventDate) : b.eventDate.localeCompare(a.eventDate);
  });
}
