import { compareEntryCodes, formatDuration, resolveTranslation, type LocaleValue, type SongbookEntry, type SongbookSong } from "@oneverse/core";
import { Link, useNavigate } from "@tanstack/react-router";
import type { Column, ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, ExternalLink, ListPlus, MoreHorizontal, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { DataTable } from "@oneverse/ui/components/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLinkItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@oneverse/ui/components/dropdown-menu";
import { AddToSetIconButton, AddToSetPopover } from "#/components/add-to-set";
import { ColumnsMenu } from "#/components/columns-menu";
import { FavoriteButton } from "#/components/favorite-button";
import { SongCover } from "#/components/library-home";
import { artistNames } from "#/lib/artists";
import { columnPrefsStore, tableColumns, type ColumnPrefs } from "#/lib/column-prefs";
import { songDragProps } from "#/lib/song-drag";

/** A songbook's entry, with its song as the Library lists it when that came (not offline, not one the viewer can't see). */
export interface SongbookRow {
  entry: SongbookEntry;
  song: SongbookSong | null;
}

/** The columns a songbook's list offers (issue #440), in their default order; its number and the title are always first. */
const SONGBOOK_COLUMNS = ["section", "artist", "key", "tempo", "timeSignature", "duration", "tags", "language", "ccli", "updatedAt", "createdAt"] as const;
type SongbookColumn = (typeof SONGBOOK_COLUMNS)[number];
// The songbook's own (section), then what's played: artist, key, tempo.
const HIDDEN_AT_FIRST: SongbookColumn[] = ["timeSignature", "duration", "tags", "language", "ccli", "updatedAt", "createdAt"];
const { useColumnPrefs } = columnPrefsStore<SongbookColumn>("songverse.songbook.columns", SONGBOOK_COLUMNS, HIDDEN_AT_FIRST);

const LABELS: Record<SongbookColumn, string> = {
  section: "songbooks.columnSection",
  artist: "library.columnArtist",
  key: "songbooks.columnKey",
  tempo: "songbooks.columnTempo",
  timeSignature: "songbooks.columnTimeSignature",
  duration: "songbooks.columnDuration",
  tags: "library.columnTags",
  language: "library.columnLanguage",
  ccli: "library.columnCcli",
  updatedAt: "library.columnUpdated",
  createdAt: "library.columnAdded",
};

function sortableHeader(label: string) {
  return function SortableHeader({ column }: { column: Column<SongbookRow, unknown> }) {
    return (
      <Button variant="ghost" size="sm" className="-ml-3 h-8 max-sm:[&_svg]:hidden" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        {label}
        <ArrowUpDown />
      </Button>
    );
  };
}

function plainHeader(label: string) {
  return function PlainHeader() {
    return <span>{label}</span>;
  };
}

const muted = (text: string | number | null | undefined) => <span className="text-muted-foreground tabular-nums">{text ?? "—"}</span>;
const dash = (text: string | number | null | undefined) => (text === null || text === undefined || text === "" ? "—" : text);
// Rows without the value go last whichever way it's sorted.
const sortMissingLast = { sortUndefined: "last" as const };

/**
 * A songbook's songs as a table (issue #440): its number and the title, the
 * columns chosen on this device, and on each row a star, Add to set and a
 * "…" menu with Open and, for whoever edits the songbook, Remove.
 */
export function SongbookSongs({
  songbookId,
  rows,
  numbered,
  hasSections,
  canEdit,
  onRemove,
  filter,
}: {
  songbookId: string;
  rows: SongbookRow[];
  numbered: boolean;
  hasSections: boolean;
  canEdit: boolean;
  onRemove: (entryId: string) => void;
  /** Beside Columns: the section picked. */
  filter?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as LocaleValue;
  const navigate = useNavigate();
  const [prefs, setPrefs] = useColumnPrefs();
  // The columns stay the same objects while the page renders again, so a row's open menu or popover stays open.
  const removeRef = useRef(onRemove);
  removeRef.current = onRemove;

  // A songbook without sections has no Section column to offer.
  const offered = useMemo<ColumnPrefs<SongbookColumn>>(() => ({ columns: prefs.columns.filter((column) => hasSections || column.id !== "section") }), [prefs, hasSections]);
  const setOffered = (next: ColumnPrefs<SongbookColumn>) => setPrefs({ columns: [...next.columns, ...prefs.columns.filter((column) => !next.columns.some((kept) => kept.id === column.id))] });
  const { columnVisibility, columnOrder } = tableColumns(offered, ["number", "title"], ["actions"]);
  if (!numbered) columnVisibility.number = false;
  if (!hasSections) columnVisibility.section = false;

  const columns = useMemo<ColumnDef<SongbookRow>[]>(
    () => [
      {
        id: "number",
        accessorFn: (row) => row.entry.entryCode ?? undefined,
        sortingFn: (a, b) => compareEntryCodes(a.original.entry.entryCode ?? "", b.original.entry.entryCode ?? ""),
        ...sortMissingLast,
        header: sortableHeader(t("songbooks.columnNumber")),
        cell: ({ row }) =>
          row.original.entry.entryCode ? <span className="inline-block min-w-10 rounded-md bg-muted px-2 py-1 text-center text-xs font-medium tabular-nums">{row.original.entry.entryCode}</span> : null,
      },
      {
        id: "title",
        accessorFn: (row) => row.song?.title ?? row.entry.songVersionTitle ?? "",
        header: sortableHeader(t("library.columnTitle")),
        cell: ({ row }) => {
          const { entry, song } = row.original;
          return (
            <span className="flex items-center gap-3">
              {song ? (
                <span className="hidden size-8 shrink-0 sm:block">
                  <SongCover song={song} size="small" className="rounded" />
                </span>
              ) : null}
              <Link
                to="/library/$songVersionId"
                params={{ songVersionId: entry.songVersionId }}
                search={{ songbook: songbookId }}
                className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere] hover:text-primary"
                onClick={(event) => event.stopPropagation()}
              >
                {song?.title ?? entry.songVersionTitle ?? entry.songVersionId}
                {song?.versionName ? <span className="font-normal text-muted-foreground"> — {song.versionName}</span> : null}
              </Link>
            </span>
          );
        },
      },
      {
        id: "section",
        accessorFn: (row) => row.entry.sectionLabel ?? undefined,
        ...sortMissingLast,
        meta: { secondary: true },
        header: sortableHeader(t("songbooks.columnSection")),
        cell: ({ row }) =>
          row.original.entry.sectionLabel ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{row.original.entry.sectionLabel}</span> : null,
      },
      {
        id: "artist",
        accessorFn: (row) => (row.song ? (artistNames(row.song.artists) ?? undefined) : undefined),
        ...sortMissingLast,
        // On a phone: the number, the title, the key and the row's buttons.
        meta: { secondary: true },
        header: sortableHeader(t("library.columnArtist")),
        cell: ({ getValue }) => <span className="text-muted-foreground">{dash(getValue<string | undefined>())}</span>,
      },
      {
        id: "key",
        accessorFn: (row) => row.song?.key ?? undefined,
        ...sortMissingLast,
        header: sortableHeader(t("songbooks.columnKey")),
        cell: ({ getValue }) => muted(getValue<string | undefined>()),
      },
      {
        id: "tempo",
        accessorFn: (row) => row.song?.tempo ?? undefined,
        ...sortMissingLast,
        meta: { secondary: true },
        header: sortableHeader(t("songbooks.columnTempo")),
        cell: ({ getValue }) => muted(getValue<number | undefined>()),
      },
      {
        id: "timeSignature",
        accessorFn: (row) => row.song?.timeSignature ?? undefined,
        ...sortMissingLast,
        meta: { secondary: true },
        header: sortableHeader(t("songbooks.columnTimeSignature")),
        cell: ({ getValue }) => muted(getValue<string | undefined>()),
      },
      {
        id: "duration",
        accessorFn: (row) => row.song?.durationSeconds ?? undefined,
        ...sortMissingLast,
        meta: { secondary: true },
        header: sortableHeader(t("songbooks.columnDuration")),
        cell: ({ getValue }) => {
          const seconds = getValue<number | undefined>();
          return muted(seconds === undefined ? null : formatDuration(seconds));
        },
      },
      {
        id: "tags",
        accessorFn: (row) => row.song?.tags.map((tag) => resolveTranslation(tag.label, tag.translations, locale)).join(", ") || undefined,
        enableSorting: false,
        meta: { secondary: true },
        header: plainHeader(t("library.columnTags")),
        cell: ({ getValue }) => <span className="text-muted-foreground">{dash(getValue<string | undefined>())}</span>,
      },
      {
        id: "language",
        accessorFn: (row) => row.song?.language ?? undefined,
        ...sortMissingLast,
        meta: { secondary: true },
        header: sortableHeader(t("library.columnLanguage")),
        cell: ({ getValue }) => muted(getValue<string | undefined>()),
      },
      {
        id: "ccli",
        accessorFn: (row) => row.song?.ccli ?? undefined,
        enableSorting: false,
        meta: { secondary: true },
        header: plainHeader(t("library.columnCcli")),
        cell: ({ getValue }) => muted(getValue<string | undefined>()),
      },
      {
        id: "updatedAt",
        accessorFn: (row) => row.song?.updatedAt ?? undefined,
        ...sortMissingLast,
        meta: { secondary: true },
        header: sortableHeader(t("library.columnUpdated")),
        cell: ({ getValue }) => {
          const at = getValue<string | undefined>();
          return muted(at ? new Date(at).toLocaleDateString() : null);
        },
      },
      {
        id: "createdAt",
        accessorFn: (row) => row.song?.createdAt ?? undefined,
        ...sortMissingLast,
        meta: { secondary: true },
        header: sortableHeader(t("library.columnAdded")),
        cell: ({ getValue }) => {
          const at = getValue<string | undefined>();
          return muted(at ? new Date(at).toLocaleDateString() : null);
        },
      },
      {
        id: "actions",
        enableSorting: false,
        header: () => null,
        cell: ({ row }) => <RowActions row={row.original} songbookId={songbookId} canEdit={canEdit} onRemove={(entryId) => removeRef.current(entryId)} />,
      },
    ],
    [t, locale, songbookId, canEdit],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {filter ?? <span />}
        <ColumnsMenu prefs={offered} onChange={setOffered} labels={LABELS} testId="songbook-columns" />
      </div>
      <DataTable
          columns={columns}
          data={rows}
          columnVisibility={columnVisibility}
          columnOrder={columnOrder}
          emptyMessage={t("songbooks.noEntriesYet")}
          rowProps={(row) => ({ ...songDragProps({ id: row.entry.songVersionId, title: row.song?.title ?? row.entry.songVersionTitle ?? "" }), "data-testid": "songbook-song-row" }) as ComponentProps<"tr">}
          onRowClick={(row) => void navigate({ to: "/library/$songVersionId", params: { songVersionId: row.entry.songVersionId }, search: { songbook: songbookId } })}
        />
    </div>
  );
}

/** A row's star, Add to set, and "…" (Open; Remove for whoever edits the songbook). On a phone, Add to set is in "…", for room. */
function RowActions({ row, songbookId, canEdit, onRemove }: { row: SongbookRow; songbookId: string; canEdit: boolean; onRemove: (entryId: string) => void }) {
  const { t } = useTranslation();
  const { entry, song } = row;
  const title = song?.title ?? entry.songVersionTitle ?? "";
  const menuButton = useRef<HTMLButtonElement>(null);
  const [addingToSet, setAddingToSet] = useState(false);
  return (
    // Clicks here stay here, rather than opening the song (React carries them out of the menu's portal).
    <span className="flex items-center justify-end sm:gap-1" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      {song ? (
        <>
          <FavoriteButton songVersionId={song.id} initial={song.isFavorite} className="size-8" />
          <AddToSetIconButton songVersionId={song.id} songTitle={title} className="hidden size-8 items-center sm:flex justify-center rounded-md text-muted-foreground hover:bg-accent [&_svg]:size-4" testId="songbook-add-to-set" />
        </>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button ref={menuButton} type="button" variant="ghost" size="icon" className="size-8" aria-label={t("songbooks.songActions", { title })} title={t("songbooks.songActions", { title })} data-testid="songbook-song-menu" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLinkItem render={<Link to="/library/$songVersionId" params={{ songVersionId: entry.songVersionId }} search={{ songbook: songbookId }} />}>
            <ExternalLink />
            {t("songbooks.openSong")}
          </DropdownMenuLinkItem>
          {song ? (
            <DropdownMenuItem className="sm:hidden" onClick={() => setAddingToSet(true)}>
              <ListPlus />
              {t("sets.addToSet.button")}
            </DropdownMenuItem>
          ) : null}
          {canEdit ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onRemove(entry.id)} data-testid="songbook-remove-song">
                <Trash2 />
                {t("songbooks.remove")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {song ? <AddToSetPopover songVersionId={song.id} songTitle={title} open={addingToSet} onOpenChange={setAddingToSet} anchor={menuButton} /> : null}
    </span>
  );
}
