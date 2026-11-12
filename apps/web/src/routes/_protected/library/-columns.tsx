import { resolveTranslation, type LocaleValue, type SongVersionSummary } from "@oneverse/core";
import { SongCover } from "#/components/library-home";
import type { Column, ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@oneverse/ui/components/button";
import { artistNames } from "#/lib/artists";
import { columnPrefsStore } from "#/lib/column-prefs";
import { QuickSelectToggle } from "#/components/quick-selection";

function tagLabel(tags: SongVersionSummary["tags"], locale: LocaleValue): string {
  if (tags.length === 0) return "—";
  return tags.map((tag) => resolveTranslation(tag.label, tag.translations, locale)).join(", ");
}

function plainHeader(label: string) {
  return function PlainHeader() {
    return <span>{label}</span>;
  };
}

function sortableHeader(label: string) {
  return function SortableHeader({ column }: { column: Column<SongVersionSummary, unknown> }) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 h-8"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        {label}
        <ArrowUpDown />
      </Button>
    );
  };
}

export function useLibraryColumns(currentUserId: string): ColumnDef<SongVersionSummary>[] {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as LocaleValue;

  return useMemo(
    () => [
      {
        accessorKey: "title",
        header: sortableHeader(t("library.columnTitle")),
        cell: ({ row }) => (
          <span className="flex items-center gap-3">
            {/* Its image (issue #85), or a cover of its own. */}
            <span className="size-8 shrink-0">
              <SongCover song={row.original} size="small" className="rounded" />
            </span>
            <span className="min-w-0 flex-1 font-medium">
              {row.original.title}
              {row.original.versionName ? <span className="font-normal text-muted-foreground"> — {row.original.versionName}</span> : null}
            </span>
            {/* Into the Quick selection (issue #334). */}
            <QuickSelectToggle songVersionId={row.original.id} className="-my-1 shrink-0" />
          </span>
        ),
      },
      {
        id: "artist",
        accessorFn: (version) => artistNames(version.artists) ?? "—",
        // The list is sorted by the server, which sorts by the song's own
        // fields; artists and tags are credits and links, not columns.
        enableSorting: false,
        header: plainHeader(t("library.columnArtist")),
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        accessorKey: "language",
        meta: { secondary: true },
        header: sortableHeader(t("library.columnLanguage")),
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.language}</span>,
      },
      {
        accessorKey: "publicationState",
        meta: { secondary: true },
        header: sortableHeader(t("library.columnStatus")),
        cell: ({ row }) => <span className="text-muted-foreground">{statusLabel(row.original, t, currentUserId)}</span>,
      },
      {
        id: "tags",
        meta: { secondary: true },
        accessorFn: (version) => tagLabel(version.tags, locale),
        enableSorting: false,
        header: plainHeader(t("library.columnTags")),
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        accessorKey: "updatedAt",
        meta: { secondary: true },
        header: sortableHeader(t("library.columnUpdated")),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{new Date(row.original.updatedAt).toLocaleDateString()}</span>
        ),
      },
      // Offered in Columns, hidden to start with (issue #150).
      {
        accessorKey: "createdAt",
        meta: { secondary: true },
        header: sortableHeader(t("library.columnAdded")),
        cell: ({ row }) => <span className="text-muted-foreground">{new Date(row.original.createdAt).toLocaleDateString()}</span>,
      },
      {
        accessorKey: "ccli",
        meta: { secondary: true },
        enableSorting: false,
        header: plainHeader(t("library.columnCcli")),
        cell: ({ row }) => <span className="text-muted-foreground tabular-nums">{row.original.ccli ?? "—"}</span>,
      },
    ],
    [t, locale, currentUserId],
  );
}

/**
 * Where a song stands, readably (issue #46): one never offered to the
 * catalogue is simply the user's or their team's; after that, where its
 * submission is, in the publish card's words; a catalogue song the user
 * put there is theirs still (issue #73).
 */
function statusLabel(version: Pick<SongVersionSummary, "publicationState" | "ownerScope" | "contributedBy" | "sharedBy">, t: TFunction, currentUserId: string): string {
  if (version.ownerScope === "GLOBAL" && version.contributedBy?.id === currentUserId) return t("library.statusPublishedByYou");
  // Shared with the user by its owner (issue #77), or with one of their teams (#331).
  if (version.sharedBy?.organization) return t("library.statusSharedWithTeam", { team: version.sharedBy.organization.name });
  if (version.sharedBy?.team) return t("library.statusSharedWithTeam", { team: version.sharedBy.team.name });
  if (version.sharedBy) return t("library.statusSharedBy", { name: version.sharedBy.displayName });
  switch (version.publicationState) {
    case "DRAFT":
      return version.ownerScope === "USER" ? t("library.statusPersonal") : version.ownerScope === "TEAM" ? t("library.statusTeam") : t("library.statusDraft");
    case "ARCHIVED":
      return t("library.statusArchived");
    case "SUBMITTED":
    case "UNDER_REVIEW":
    case "NEEDS_CHANGES":
    case "APPROVED":
    case "REJECTED":
    case "WITHDRAWN":
      return t(`publish.state${version.publicationState}`);
    default:
      return version.publicationState;
  }
}

/** The columns a user can choose (issue #150), in their default order; Title is always first. */
export const LIBRARY_COLUMNS = ["artist", "tags", "language", "publicationState", "updatedAt", "createdAt", "ccli"] as const;
export type LibraryColumn = (typeof LIBRARY_COLUMNS)[number];
// Title, Artist and Tags to start with (issue #168); the rest a pick away.
const HIDDEN_AT_FIRST: LibraryColumn[] = ["language", "publicationState", "updatedAt", "createdAt", "ccli"];

/** The Songs list's columns as chosen on this device (issue #150): which show, in what order. */
export const { useColumnPrefs } = columnPrefsStore<LibraryColumn>("songverse.library.columns", LIBRARY_COLUMNS, HIDDEN_AT_FIRST);

/** Their names in the Columns menu. */
export const LIBRARY_COLUMN_LABELS: Record<LibraryColumn, string> = {
  artist: "library.columnArtist",
  language: "library.columnLanguage",
  publicationState: "library.columnStatus",
  tags: "library.columnTags",
  updatedAt: "library.columnUpdated",
  createdAt: "library.columnAdded",
  ccli: "library.columnCcli",
};
