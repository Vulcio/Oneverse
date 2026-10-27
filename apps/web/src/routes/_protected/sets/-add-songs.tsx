import { formatSongbookReference, type LyricsMatch, type SetlistDetail } from "@oneverse/core";
import { Quote } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Input } from "@oneverse/ui/components/input";
import { cn } from "@oneverse/ui/lib/utils";
import { apiClient } from "#/lib/api-client";
import { artistNames } from "#/lib/artists";
import { useInLyrics } from "#/lib/lyrics-search";
import { useSongSearch, type FoundSong } from "#/lib/song-search";
import { LyricsSnippet } from "#/components/lyrics-snippet";
import { TextItemDialog } from "#/components/set-text-item";
import { PassageItemDialog } from "#/components/set-passage-item";
import { useAddSongToSet } from "#/components/set-team-access";

const LIMIT = 20;

/** A song that could go in the set, as listed. */
interface Candidate {
  key: string;
  id: string;
  label: string;
  detail: string | null;
  /** Its number in a songbook, when found by it ("HY 42"). */
  reference?: string;
  lyrics?: LyricsMatch;
}

const label = (song: { title: string; versionName: string | null }) => (song.versionName ? `${song.title} — ${song.versionName}` : song.title);
const fromSong = (song: FoundSong): Candidate => ({
  key: `song-${song.id}`,
  id: song.id,
  label: label(song),
  detail: [song.artists, song.references.slice(0, 2).join(" · ")].filter(Boolean).join(" · ") || null,
});

/**
 * Search box listing songs that can go in this set - found as the search box
 * finds them (issue #328: title, artist, songbook number, CCLI, in lyrics);
 * with no query, the most recently edited ones.
 */
export function AddSongs({ set, onAdded }: { set: SetlistDetail; onAdded: (set: SetlistDetail) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [inLyrics, setInLyrics] = useInLyrics();
  const { q, songs, entries, lyrics, searching } = useSongSearch(query, { inLyrics, addableTo: set.id, limit: LIMIT });
  const [recent, setRecent] = useState<FoundSong[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // One of your own songs in a team's set: shared with the team or moved to it as it's added (issue #331).
  const { add, addingId, error: addError, dialog } = useAddSongToSet(set, onAdded);
  const error = loadError ?? addError;

  // Nothing typed: the songs edited last.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .listSongVersions({ addableTo: set.id, pageSize: 8, references: true })
      .then((page) =>
        !cancelled &&
        setRecent(page.items.map((song) => ({ id: song.id, title: song.title, versionName: song.versionName, artists: artistNames(song.artists), references: song.songbookReferences ?? [] }))),
      )
      .catch((err: unknown) => !cancelled && setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [set.id]);

  // Songbook numbers first, then the songs, then those found by their words - each song once.
  const seen = new Set<string>();
  const once = (candidate: Candidate) => !seen.has(candidate.id) && !!seen.add(candidate.id);
  const results: Candidate[] | null = !q
    ? recent && recent.map(fromSong)
    : [
        ...entries.map((entry) => ({ key: `entry-${entry.songbookId}-${entry.entryCode}`, id: entry.songVersionId, label: entry.title, detail: entry.abbreviation ? entry.songbookName : null, reference: formatSongbookReference(entry) })),
        ...songs.map(fromSong),
        ...lyrics.map((found) => ({ key: `lyrics-${found.id}`, id: found.id, label: label(found), detail: null, lyrics: found.match })),
      ].filter(once);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("sets.searchPlaceholder")}
          aria-label={t("sets.searchPlaceholder")}
        />
        <button
          type="button"
          onClick={() => setInLyrics(!inLyrics)}
          aria-pressed={inLyrics}
          title={t("search.inLyrics")}
          className={cn(
            "flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium [&_svg]:size-3.5",
            inLyrics ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          data-testid="set-search-in-lyrics"
        >
          <Quote aria-hidden />
          <span className="hidden sm:inline">{t("search.inLyrics")}</span>
          <span className="sr-only sm:hidden">{t("search.inLyrics")}</span>
        </button>
      </div>
      {set.teamId ? <p className="text-xs text-muted-foreground">{t("sets.teamSongsOnly")}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {results === null || (q && searching && results.length === 0) ? null : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("sets.noResults")}</p>
      ) : (
        <ul className="flex flex-col divide-y" data-testid="set-song-results">
          {results.map((song) => (
            <li key={song.key} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {song.reference ? <span className="mr-1.5 font-normal text-muted-foreground tabular-nums">{song.reference}</span> : null}
                  {song.label}
                </p>
                {song.lyrics ? <LyricsSnippet match={song.lyrics} className="block truncate text-xs text-muted-foreground" /> : null}
                {song.detail ? <p className="truncate text-xs text-muted-foreground">{song.detail}</p> : null}
              </div>
              <Button size="sm" variant="outline" disabled={addingId !== null} onClick={() => void add(song.id, song.label)}>
                {t("sets.add")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </div>
  );
}

/** Slides of text for the screens (issue #305): a welcome, a reading, announcements. */
export function AddText({ set, onAdded }: { set: SetlistDetail; onAdded: (set: SetlistDetail) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-xs text-muted-foreground">{t("sets.text.addHint")}</p>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="set-add-text">
        {t("sets.text.add")}
      </Button>
      {open ? <TextItemDialog open={open} onOpenChange={setOpen} text={null} onSave={async (text) => onAdded(await apiClient.addSetlistItem(set.id, { text }))} /> : null}
    </div>
  );
}

/** A Bible passage for the screens (issue #301): an imported Bible and a reference. */
export function AddPassage({ set, onAdded }: { set: SetlistDetail; onAdded: (set: SetlistDetail) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-xs text-muted-foreground">{t("sets.passage.addHint")}</p>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="set-add-passage">
        {t("sets.passage.add")}
      </Button>
      {open ? <PassageItemDialog open={open} onOpenChange={setOpen} passage={null} onSave={async (passage, screenTemplate) => onAdded(await apiClient.addSetlistItem(set.id, { passage, ...(screenTemplate && { screenTemplate }) }))} /> : null}
    </div>
  );
}
