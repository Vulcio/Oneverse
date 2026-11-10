import { formatSongbookReference, type LyricsMatch } from "@oneverse/core";
import { Quote } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@oneverse/ui/components/command";
import { cn } from "@oneverse/ui/lib/utils";
import { useInLyrics } from "#/lib/lyrics-search";
import { useSongSearch, type FoundSong } from "#/lib/song-search";
import { LyricsSnippet } from "#/components/lyrics-snippet";

/** A song found, as its row reads. */
export interface PickedSong {
  id: string;
  /** Title, and the version's name when it has one. */
  label: string;
}
interface Candidate extends PickedSong {
  key: string;
  detail: string | null;
  /** Its number in a songbook, when found by it ("HY 42"). */
  reference?: string;
  lyrics?: LyricsMatch;
}

const labelOf = (song: { title: string; versionName: string | null }) => (song.versionName ? `${song.title} — ${song.versionName}` : song.title);
const fromSong = (song: FoundSong): Candidate => ({
  key: `song-${song.id}`,
  id: song.id,
  label: labelOf(song),
  detail: [song.artists, song.references.slice(0, 2).join(" · ")].filter(Boolean).join(" · ") || null,
});

interface SongPickerProps {
  /** A song picked: Enter on it, a click, or its own button. */
  onPick: (song: PickedSong) => void;
  placeholder: string;
  /** What was typed, when the page keeps it (to show the song picked in the field). */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Only songs that can go in this set (issue #328). */
  addableTo?: string;
  /** The "In lyrics" switch (issue #221); without it, the words aren't searched. */
  lyrics?: boolean;
  /** Shown while nothing is typed: the songs edited last, say. */
  suggestions?: FoundSong[] | null;
  /** Songs left out: those already there. */
  exclude?: ReadonlySet<string>;
  /** At the end of each row: an Add button, say. A click on it picks the row. */
  action?: (song: PickedSong) => ReactNode;
  /** Said when nothing matches. */
  empty: string;
  /** The results are put away: a song is picked, and shown in the field. */
  closed?: boolean;
  disabled?: boolean;
  limit?: number;
  autoFocus?: boolean;
  id?: string;
  className?: string;
  /** Test ids: the field's, the list's, each row's. */
  testIds?: { input?: string; list?: string; item?: string; lyrics?: string };
}

/**
 * Finding a song to do something with (issue #424): add it to a set, put it
 * in a songbook, attach a file to it. One field and one list everywhere, on
 * the header search's own search (`useSongSearch`: title, artist, CCLI,
 * songbook number, misspelt words, and the songs' words when asked) and its
 * keys: the arrows move, Enter picks.
 */
export function SongPicker({ onPick, placeholder, query: givenQuery, onQueryChange, addableTo, lyrics: withLyrics = false, suggestions, exclude, action, empty, closed = false, disabled, limit = 20, autoFocus, id, className, testIds }: SongPickerProps) {
  const { t } = useTranslation();
  const [ownQuery, setOwnQuery] = useState("");
  const query = givenQuery ?? ownQuery;
  const setQuery = onQueryChange ?? setOwnQuery;
  const [storedInLyrics, setInLyrics] = useInLyrics();
  const inLyrics = withLyrics && storedInLyrics;
  const { q, songs, entries, lyrics, searching } = useSongSearch(closed ? "" : query, { inLyrics, addableTo, limit });

  // Songbook numbers first, then the songs, then those found by their words - each song once.
  const seen = new Set<string>(exclude);
  const once = (candidate: Candidate) => !seen.has(candidate.id) && !!seen.add(candidate.id);
  const results: Candidate[] | null = closed
    ? null
    : !q
      ? (suggestions?.map(fromSong).filter(once) ?? null)
      : [
          ...entries.map((entry) => ({ key: `entry-${entry.songbookId}-${entry.entryCode}`, id: entry.songVersionId, label: entry.title, detail: entry.abbreviation ? entry.songbookName : null, reference: formatSongbookReference(entry) })),
          ...songs.map(fromSong),
          ...lyrics.map((found) => ({ key: `lyrics-${found.id}`, id: found.id, label: labelOf(found), detail: null, lyrics: found.match })),
        ].filter(once);
  const waiting = !!q && searching && results?.length === 0;

  return (
    <Command resetOn={`${q}|${results?.length ?? 0}`} className={cn("gap-3 overflow-visible", className)}>
      <div className="flex items-center gap-2">
        <CommandInput
          variant="field"
          wrapperClassName="min-w-0 flex-1"
          id={id}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          data-testid={testIds?.input}
        />
        {withLyrics ? (
          <button
            type="button"
            onClick={() => setInLyrics(!storedInLyrics)}
            aria-pressed={storedInLyrics}
            title={t("search.inLyrics")}
            className={cn(
              "flex h-9 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium [&_svg]:size-3.5",
              storedInLyrics ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            data-testid={testIds?.lyrics}
          >
            <Quote aria-hidden />
            <span className="hidden sm:inline">{t("search.inLyrics")}</span>
            <span className="sr-only sm:hidden">{t("search.inLyrics")}</span>
          </button>
        ) : null}
      </div>
      {results === null || waiting ? null : results.length === 0 ? (
        <CommandEmpty className="px-0 py-0 text-left">{empty}</CommandEmpty>
      ) : (
        <CommandList aria-label={placeholder} className="flex-none divide-y overflow-visible p-0" data-testid={testIds?.list}>
          {results.map((song) => (
            <CommandItem key={song.key} disabled={disabled} onSelect={() => onPick(song)} className="justify-between rounded-none px-1 data-selected:rounded-md" data-testid={testIds?.item}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {song.reference ? <span className="mr-1.5 font-normal text-muted-foreground tabular-nums">{song.reference}</span> : null}
                  {song.label}
                </p>
                {song.lyrics ? <LyricsSnippet match={song.lyrics} className="block truncate text-xs text-muted-foreground" /> : null}
                {song.detail ? <p className="truncate text-xs text-muted-foreground">{song.detail}</p> : null}
              </div>
              {action?.(song)}
            </CommandItem>
          ))}
        </CommandList>
      )}
    </Command>
  );
}
