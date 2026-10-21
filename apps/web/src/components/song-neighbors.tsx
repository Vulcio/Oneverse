import { keptSongbook, onlineOrKept } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { deviceStorage } from "#/lib/offline-data";
import { useSmartLists } from "#/lib/smart-lists";
import { filtersOf, parseLibrarySearch } from "#/routes/_protected/library/-library-search";

interface Neighbors {
  position: number;
  total: number;
  previous: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
  list: string;
}

/**
 * Previous and next on a song's page (issue #84), in the list it was
 * opened from - Songs as searched, your favorites, a smart list, an
 * artist's songs (`from`), or a songbook (`songbook`) - and where it is in
 * it. Nothing when the song wasn't opened from a list, or isn't in it.
 */
export function SongNeighborsBar({ songVersionId, from, songbook }: { songVersionId: string; from?: string; songbook?: string }) {
  const { t } = useTranslation();
  const smartLists = useSmartLists();
  const [found, setFound] = useState<Neighbors | null>(null);
  const source = from ? parseLibrarySearch(Object.fromEntries(new URLSearchParams(from))) : null;
  const listName = source
    ? ((source.list ? smartLists.find((list) => list.id === source.list)?.name : undefined) ??
      (source.favorites ? t("library.home.favorites") : source.artist ? t("library.byArtist", { name: source.artist }) : t("nav.songs")))
    : "";

  useEffect(() => {
    let cancelled = false;
    setFound(null);
    if (songbook) {
      onlineOrKept(
        () => apiClient.getSongbook(songbook),
        () => keptSongbook(deviceStorage(), songbook),
      )
        .then((book) => {
          const entries = book?.entries ?? [];
          const at = entries.findIndex((entry) => entry.songVersionId === songVersionId);
          if (cancelled || !book || at < 0) return;
          const song = (i: number) => (entries[i] ? { id: entries[i]!.songVersionId, title: [entries[i]!.entryCode, entries[i]!.songVersionTitle].filter(Boolean).join(". ") } : null);
          setFound({ position: at + 1, total: entries.length, previous: song(at - 1), next: song(at + 1), list: book.name });
        })
        .catch(() => {});
    } else if (from) {
      const search = parseLibrarySearch(Object.fromEntries(new URLSearchParams(from)));
      apiClient
        .getSongNeighbors(songVersionId, { ...filtersOf(search), ...(search.favorites && { favorites: true }) })
        .then((result) => {
          if (!cancelled && result.position) setFound({ position: result.position, total: result.total, previous: result.previous, next: result.next, list: "" });
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [songVersionId, from, songbook]);

  if (!found) return null;
  const search = songbook ? { songbook } : { from };
  const neighbor = (song: { id: string; title: string } | null, direction: "previous" | "next") =>
    song ? (
      <Link
        to="/library/$songVersionId"
        params={{ songVersionId: song.id }}
        search={search}
        aria-label={t(direction === "previous" ? "nav.previousSong" : "nav.nextSong", { title: song.title })}
        className={`flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 text-muted-foreground hover:text-foreground ${direction === "next" ? "justify-end text-right" : ""}`}
      >
        {direction === "previous" ? <ChevronLeft className="size-4 shrink-0" /> : null}
        <span className="truncate">{song.title}</span>
        {direction === "next" ? <ChevronRight className="size-4 shrink-0" /> : null}
      </Link>
    ) : (
      <span className="flex-1" />
    );

  return (
    <nav className="-mt-2 mb-4 flex items-center gap-3 border-b pb-2 text-sm" aria-label={t("nav.inList")} data-testid="song-neighbors">
      {neighbor(found.previous, "previous")}
      <span className="shrink-0 text-xs text-muted-foreground" data-testid="song-position">
        {t("nav.positionInList", { position: found.position, total: found.total, list: found.list || listName })}
      </span>
      {neighbor(found.next, "next")}
    </nav>
  );
}
