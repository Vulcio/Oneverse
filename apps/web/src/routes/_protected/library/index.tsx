import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LibraryShelves } from "#/components/library-home";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent } from "@oneverse/ui/components/card";
import { DataTable } from "@oneverse/ui/components/data-table";
import { Input } from "@oneverse/ui/components/input";
import { apiClient } from "#/lib/api-client";
import { useColumnPrefs, useLibraryColumns } from "./-columns";
import { parseLibrarySearch } from "./-library-search";

/** Songs shown under the shelves; the rest is on Songs. */
const PREVIEW = 8;

/**
 * The Library's home (issue #81): its shelves - newly added, recently
 * viewed, favorites, popular in your teams - and the songs changed last,
 * with a search. The whole list, filtered and sorted, is Songs
 * (/library/songs); an address with a search or filters goes there.
 */
export const Route = createFileRoute("/_protected/library/")({
  validateSearch: parseLibrarySearch,
  beforeLoad: ({ search }) => {
    if (Object.keys(search).length > 0) throw redirect({ to: "/library/songs", search, replace: true });
  },
  loader: async () => {
    const [home, recent] = await Promise.all([apiClient.getLibraryHome().catch(() => null), apiClient.listSongVersions({ pageSize: PREVIEW })]);
    return { home, recent };
  },
  component: LibraryHomePage,
});

function LibraryHomePage() {
  const { t } = useTranslation();
  const { home, recent } = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const columns = useLibraryColumns(session.userId);
  // As chosen for Songs (issue #150).
  const [columnPrefs] = useColumnPrefs();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("library.title")}</h1>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {/* Searching takes you to Songs, with its filters. */}
          <form
            className="relative w-full max-w-64 min-w-0"
            onSubmit={(event) => {
              event.preventDefault();
              if (query.trim()) void navigate({ to: "/library/songs", search: { q: query.trim() } });
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("library.searchPlaceholder")} aria-label={t("library.searchPlaceholder")} className="pl-9" />
          </form>
          <Button render={<Link to="/library/new" />}>{t("library.addASong")}</Button>
        </div>
      </div>

      {recent.total === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">{t("library.noSongsYet")}</CardContent>
        </Card>
      ) : (
        <>
          {home ? <LibraryShelves home={home} /> : null}
          <section className="flex flex-col gap-3" data-testid="library-recently-updated">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{t("library.home.recentlyUpdated")}</h2>
              <Link to="/library/songs" className="flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground">
                {t("library.home.allSongsCount", { count: recent.total })}
                <ChevronRight className="size-4" />
              </Link>
            </div>
            <Card className="gap-0 p-0">
              <DataTable
                columns={columns}
                data={recent.items}
                columnVisibility={Object.fromEntries(columnPrefs.columns.map((column) => [column.id, column.shown]))}
                columnOrder={["title", ...columnPrefs.columns.map((column) => column.id)]}
                emptyMessage={t("library.noMatches")}
                onRowClick={(version) => void navigate({ to: "/library/$songVersionId", params: { songVersionId: version.id } })}
              />
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
