import {
  CATALOG_ENTRY_FIELDS,
  compareEntryCodes,
  computeSectionLabel,
  foldForSearch,
  formatDuration,
  readReferenceLink,
  splitNames,
  type CatalogEntryFieldKey,
  type SongbookCatalogEntry,
  type SongbookCatalogLibrary,
  type SongbookSection,
} from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { Check, ExternalLink, LayoutList, Play, Plus, Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Input } from "@oneverse/ui/components/input";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@oneverse/ui/components/sheet";
import { useIsMobile } from "@oneverse/ui/hooks/use-mobile";
import { cn } from "@oneverse/ui/lib/utils";
import { YouTubeDock } from "#/components/youtube-dock";
import { apiClient } from "#/lib/api-client";
import type { YouTubeVideo } from "#/lib/youtube-player";
import { CatalogEntriesTable } from "./-catalog-entries-table";

const VIEW_STORAGE_KEY = "songverse.catalog.view";
const LIST_LIMIT = 200;
const SERVICE_NAMES = { YOUTUBE: "YouTube", SPOTIFY: "Spotify", APPLE_MUSIC: "Apple Music", DEEZER: "Deezer" } as const;
const ALL_FIELDS = CATALOG_ENTRY_FIELDS.map((field) => field.key);

type View = "list" | "table";
type Song = SongbookCatalogLibrary["songs"][number];

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "table" ? "table" : "list";
  } catch {
    return "list";
  }
}

function saveView(view: View) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Not remembered; fine.
  }
}

function fieldText(entry: SongbookCatalogEntry, field: CatalogEntryFieldKey): string {
  const value = entry[field];
  if (value === null) return "";
  if (field === "durationSeconds" && typeof value === "number") return formatDuration(value);
  return Array.isArray(value) ? value.join("; ") : String(value);
}

/**
 * A catalogue's entries to read (issue #210): a list (on a phone, always)
 * or the table for editing, the choice remembered on the device; filters by
 * tag, key, language and volume, a search across every field, what's
 * already a song in your songbooks, and an entry's details in a panel.
 */
export function CatalogBrowser({
  catalogId,
  entries: initialEntries,
  sections,
  canEdit,
  initialSearch,
}: {
  catalogId: string;
  entries: SongbookCatalogEntry[];
  sections: SongbookSection[] | null;
  canEdit: boolean;
  initialSearch: string;
}) {
  const { t, i18n } = useTranslation();
  const mobile = useIsMobile();
  const [view, setView] = useState<View>("list");
  const [entries, setEntries] = useState(initialEntries);
  const [search, setSearch] = useState(initialSearch);
  const [tag, setTag] = useState("");
  const [key, setKey] = useState("");
  const [language, setLanguage] = useState("");
  const [volume, setVolume] = useState("");
  const [library, setLibrary] = useState<SongbookCatalogLibrary | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [video, setVideo] = useState<YouTubeVideo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setEntries(initialEntries), [initialEntries]);
  useEffect(() => setSearch(initialSearch), [initialSearch]);
  // After hydration, so the server and first client render agree.
  useEffect(() => setView(loadView()), []);
  useEffect(() => {
    let current = true;
    apiClient
      .getSongbookCatalogLibrary(catalogId)
      .then((result) => current && setLibrary(result))
      .catch(() => current && setLibrary({ songbooks: [], songs: [] }));
    return () => {
      current = false;
    };
  }, [catalogId]);

  const songOf = useMemo(() => {
    const map = new Map<string, Song>();
    for (const song of library?.songs ?? []) if (!map.has(song.catalogEntryId)) map.set(song.catalogEntryId, song);
    return map;
  }, [library]);
  const startIn = library?.songbooks.find((songbook) => songbook.access !== "view") ?? null;

  const options = useMemo(() => {
    const sorted = (values: Iterable<string>) => [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b, i18n.language));
    return {
      tags: sorted(entries.flatMap((entry) => entry.tags)),
      keys: sorted(entries.map((entry) => entry.key ?? "")),
      languages: sorted(entries.map((entry) => entry.originalLanguage ?? "")),
    };
  }, [entries, i18n.language]);

  const visible = useMemo(() => {
    const query = foldForSearch(search.trim());
    return entries
      .filter((entry) => !tag || entry.tags.includes(tag))
      .filter((entry) => !key || entry.key === key)
      .filter((entry) => !language || entry.originalLanguage === language)
      .filter((entry) => !volume || computeSectionLabel(entry.entryCode, sections) === volume)
      .filter((entry) => !query || ALL_FIELDS.some((field) => foldForSearch(fieldText(entry, field)).includes(query)))
      .sort((a, b) => compareEntryCodes(a.entryCode, b.entryCode));
  }, [entries, search, tag, key, language, volume, sections]);

  const open = entries.find((entry) => entry.id === openId) ?? null;
  const shown: View = mobile ? "list" : view;

  function choose(next: View) {
    setView(next);
    saveView(next);
  }

  async function start(entry: SongbookCatalogEntry) {
    if (!startIn) return;
    setError(null);
    try {
      const made = await apiClient.materializeSongbookCatalogEntry(startIn.id, entry.id);
      setLibrary((current) =>
        current && {
          ...current,
          songs: [
            ...current.songs,
            { catalogEntryId: entry.id, entryCode: entry.entryCode, songbookId: startIn.id, songbookName: startIn.name, songVersionId: made.songVersionId, title: entry.title },
          ],
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function updated(entry: SongbookCatalogEntry) {
    setEntries((current) => current.map((row) => (row.id === entry.id ? { ...entry, translations: row.translations } : row)));
  }

  return (
    <div className="flex flex-col gap-3">
      {!mobile ? (
        <div className="flex gap-1" role="group" aria-label={t("songbookCatalog.view")}>
          <Button size="sm" variant={view === "list" ? "secondary" : "ghost"} aria-pressed={view === "list"} onClick={() => choose("list")}>
            <LayoutList />
            {t("songbookCatalog.viewList")}
          </Button>
          <Button size="sm" variant={view === "table" ? "secondary" : "ghost"} aria-pressed={view === "table"} onClick={() => choose("table")}>
            <Table2 />
            {t("songbookCatalog.viewTable")}
          </Button>
        </div>
      ) : null}

      {shown === "table" ? (
        <CatalogEntriesTable catalogId={catalogId} entries={entries} canEdit={canEdit} initialSearch={search} onOpen={setOpenId} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("songbookCatalog.search")}
              aria-label={t("songbookCatalog.search")}
              className="w-full sm:max-w-xs"
            />
            {options.tags.length > 0 ? (
              <NativeSelect value={tag} onChange={(event) => setTag(event.target.value)} aria-label={t("songbookCatalog.fields.tags")}>
                <option value="">{t("songbookCatalog.anyTag")}</option>
                {options.tags.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            {options.keys.length > 0 ? (
              <NativeSelect value={key} onChange={(event) => setKey(event.target.value)} aria-label={t("songbookCatalog.fields.key")}>
                <option value="">{t("songbookCatalog.anyKey")}</option>
                {options.keys.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            {options.languages.length > 1 ? (
              <NativeSelect value={language} onChange={(event) => setLanguage(event.target.value)} aria-label={t("songbookCatalog.fields.originalLanguage")}>
                <option value="">{t("songbookCatalog.anyLanguage")}</option>
                {options.languages.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            {sections?.length ? (
              <NativeSelect value={volume} onChange={(event) => setVolume(event.target.value)} aria-label={t("songbookCatalog.volume")}>
                <option value="">{t("songbookCatalog.anyVolume")}</option>
                {sections.map((section) => (
                  <option key={section.label} value={section.label}>
                    {section.label}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {t("songbookCatalog.shownCount", { count: visible.length, total: entries.length.toLocaleString(i18n.language) })}
            </span>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <ul className="divide-y rounded-md border" data-testid="catalog-list">
            {visible.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-muted-foreground">
                {entries.length === 0 ? t("songbookCatalog.noEntriesYet") : t("songbookCatalog.noMatches")}
              </li>
            ) : null}
            {visible.slice(0, LIST_LIMIT).map((entry) => (
              <EntryRow key={entry.id} entry={entry} song={songOf.get(entry.id) ?? null} canStart={!!startIn} onOpen={() => setOpenId(entry.id)} onStart={() => void start(entry)} />
            ))}
          </ul>
          {visible.length > LIST_LIMIT ? <p className="text-xs text-muted-foreground">{t("songbookCatalog.listLimited", { count: LIST_LIMIT })}</p> : null}
          {library && library.songbooks.length === 0 ? <p className="text-xs text-muted-foreground">{t("songbookCatalog.startNeedsSongbook")}</p> : null}
        </>
      )}

      <Sheet open={!!open} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg" data-testid="catalog-entry-details">
          {open ? (
            <EntryDetails
              catalogId={catalogId}
              entry={open}
              song={songOf.get(open.id) ?? null}
              canStart={!!startIn}
              canEdit={canEdit}
              sectionLabel={computeSectionLabel(open.entryCode, sections)}
              onStart={() => void start(open)}
              onUpdated={updated}
              onPlay={(videoId) => {
                setVideo({ songVersionId: `catalog:${open.id}`, videoId, title: open.title, returnTo: `/songbook-catalogs/${catalogId}` });
                setOpenId(null);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      {video ? <YouTubeDock key={video.videoId} video={video} autoPlay /> : null}
    </div>
  );
}

function SongMark({ song }: { song: Song }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/library/$songVersionId"
      params={{ songVersionId: song.songVersionId }}
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      onClick={(event) => event.stopPropagation()}
      data-testid="catalog-in-library"
    >
      <Check className="size-3.5" />
      {t("songbookCatalog.inSongbook", { songbook: song.songbookName })}
    </Link>
  );
}

function EntryRow({ entry, song, canStart, onOpen, onStart }: { entry: SongbookCatalogEntry; song: Song | null; canStart: boolean; onOpen: () => void; onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30" data-testid="catalog-list-entry">
      <button type="button" className="flex min-w-0 flex-1 items-baseline gap-3 text-left" onClick={onOpen}>
        <span className="w-12 shrink-0 font-medium tabular-nums">{entry.entryCode}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{entry.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {[entry.artist, entry.key, entry.links.length ? "▶" : null].filter(Boolean).join(" · ")}
          </span>
        </span>
        {entry.tags.length ? (
          <span className="hidden shrink-0 gap-1 md:flex">
            {entry.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="muted">
                {tag}
              </Badge>
            ))}
          </span>
        ) : null}
      </button>
      {song ? (
        <SongMark song={song} />
      ) : canStart ? (
        <Button size="sm" variant="outline" className="h-7" onClick={onStart}>
          <Plus />
          {t("songbookCatalog.start")}
        </Button>
      ) : null}
    </li>
  );
}

const DETAIL_FIELDS: CatalogEntryFieldKey[] = [
  "subtitle",
  "artist",
  "composer",
  "lyricist",
  "key",
  "timeSignature",
  "tempo",
  "durationSeconds",
  "year",
  "album",
  "copyright",
  "ccli",
  "isrc",
  "reference",
  "originalLanguage",
  "tags",
  "links",
  "notes",
];

function EntryDetails({
  catalogId,
  entry,
  song,
  canStart,
  canEdit,
  sectionLabel,
  onStart,
  onUpdated,
  onPlay,
}: {
  catalogId: string;
  entry: SongbookCatalogEntry;
  song: Song | null;
  canStart: boolean;
  canEdit: boolean;
  sectionLabel: string | null;
  onStart: () => void;
  onUpdated: (entry: SongbookCatalogEntry) => void;
  onPlay: (videoId: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const links = entry.links.map((url) => readReferenceLink(url)).filter((link) => link !== null && link.service !== "OTHER");
  const credits = (
    [
      ["artist", entry.artist],
      ["composer", entry.composer],
      ["lyricist", entry.lyricist],
    ] as const
  ).filter(([, names]) => splitNames(names).length > 0);

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          <span className="tabular-nums">{entry.entryCode}</span> · {entry.title}
        </SheetTitle>
        <SheetDescription>{[entry.subtitle, sectionLabel].filter(Boolean).join(" · ") || t("songbookCatalog.entryDetails")}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {song ? <SongMark song={song} /> : canStart ? (
            <Button size="sm" onClick={onStart}>
              <Plus />
              {t("songbookCatalog.start")}
            </Button>
          ) : null}
          {canEdit ? (
            <Button size="sm" variant="outline" onClick={() => setEditing((current) => !current)}>
              {editing ? t("songbookCatalog.doneEditing") : t("songbookCatalog.editEntry")}
            </Button>
          ) : null}
        </div>

        {links.length > 0 && !editing ? (
          <div className="flex flex-wrap gap-2" data-testid="catalog-entry-links">
            {links.map((link) =>
              link!.service === "YOUTUBE" && link!.value ? (
                <Button key={link!.url} size="sm" onClick={() => onPlay(link!.value!)}>
                  <Play />
                  {t("songbookCatalog.playOn", { service: SERVICE_NAMES.YOUTUBE })}
                </Button>
              ) : (
                <Button key={link!.url} size="sm" variant="outline" render={<a href={link!.url} target="_blank" rel="noopener noreferrer" />}>
                  <ExternalLink />
                  {t("songbookCatalog.listenOn", { service: SERVICE_NAMES[link!.service as keyof typeof SERVICE_NAMES] })}
                </Button>
              ),
            )}
          </div>
        ) : null}

        {editing ? (
          <EntryEditor catalogId={catalogId} entry={entry} onUpdated={onUpdated} />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {credits.map(([field, names]) => (
              <Detail key={field} label={t(`songbookCatalog.fields.${field}`)}>
                {splitNames(names).join(", ")}
              </Detail>
            ))}
            {DETAIL_FIELDS.filter((field) => !["subtitle", "artist", "composer", "lyricist", "links"].includes(field)).map((field) => {
              const text = fieldText(entry, field);
              if (!text) return null;
              return (
                <Detail key={field} label={t(`songbookCatalog.fields.${field}`)}>
                  {field === "tags" ? (
                    <span className="flex flex-wrap gap-1">
                      {entry.tags.map((tag) => (
                        <Badge key={tag} variant="muted">
                          {tag}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <span className={cn(field === "notes" && "whitespace-pre-line")}>{text}</span>
                  )}
                </Detail>
              );
            })}
            {entry.originalSong ? (
              <Detail label={t("songbookCatalog.fields.originalSong")}>
                {entry.original ? <EntryLink to={entry.original} /> : entry.originalSong}
              </Detail>
            ) : null}
            {entry.translations?.length ? (
              <Detail label={t("songbookCatalog.translations")}>
                <span className="flex flex-col gap-1" data-testid="catalog-entry-translations">
                  {entry.translations.map((translation) => (
                    <EntryLink key={translation.entryId} to={translation} />
                  ))}
                </span>
              </Detail>
            ) : null}
          </dl>
        )}
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function EntryLink({ to }: { to: NonNullable<SongbookCatalogEntry["original"]> }) {
  return (
    <Link to="/songbook-catalogs/$catalogId" params={{ catalogId: to.catalogId }} search={{ q: to.entryCode }} className="text-primary hover:underline">
      {to.catalogAbbreviation ?? to.catalogName} {to.entryCode} · {to.title}
    </Link>
  );
}

/** Every field, each saved when it's left (as a table cell is). */
function EntryEditor({ catalogId, entry, onUpdated }: { catalogId: string; entry: SongbookCatalogEntry; onUpdated: (entry: SongbookCatalogEntry) => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const fields: CatalogEntryFieldKey[] = ["entryCode", "title", "sortTitle", "originalSong", ...DETAIL_FIELDS];

  async function save(field: CatalogEntryFieldKey, text: string) {
    if (text.trim() === fieldText(entry, field)) return;
    try {
      onUpdated(await apiClient.updateSongbookCatalogEntry(catalogId, entry.id, { [field]: text }));
      setError(null);
    } catch (err) {
      setError(t("songbookCatalog.cellSaveFailed", { message: err instanceof Error ? err.message : String(err) }));
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="catalog-entry-editor">
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {fields.map((field) => (
        <label key={`${entry.id}-${field}`} className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t(`songbookCatalog.fields.${field}`)}</span>
          {field === "notes" ? (
            <textarea
              defaultValue={fieldText(entry, field)}
              onBlur={(event) => void save(field, event.target.value)}
              className="min-h-20 rounded-md border bg-background px-2 py-1.5"
            />
          ) : (
            <Input defaultValue={fieldText(entry, field)} onBlur={(event) => void save(field, event.target.value)} />
          )}
          <span className="text-xs text-muted-foreground">{t(`songbookCatalog.fieldHints.${field}`)}</span>
        </label>
      ))}
    </div>
  );
}
