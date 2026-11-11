import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GettingStarted } from "#/components/getting-started";
import { LibraryShelves } from "#/components/library-home";
import { Button } from "@oneverse/ui/components/button";
import { Card } from "@oneverse/ui/components/card";
import { DataTable } from "@oneverse/ui/components/data-table";
import { apiClient } from "#/lib/api-client";
import { useColumnPrefs, useLibraryColumns } from "./-columns";
import { parseLibrarySearch } from "./-library-search";
import { Empty } from "@oneverse/ui/components/empty";

/** Songs shown under the shelves; the rest is on Songs. */
const PREVIEW = 8;

/**
 * The Library's home (issue #81): its shelves - newly added, recently
 * viewed, favorites, popular in your teams - and the songs changed last. The whole list, filtered and sorted, is Songs
 * (/library/songs); an address with a search or filters goes there.
 */
export const Route = createFileRoute("/_protected/library/")({
  validateSearch: parseLibrarySearch,
  beforeLoad: ({ search }) => {
    if (Object.keys(search).length > 0) throw redirect({ to: "/library/songs", search, replace: true });
  },
  loader: async () => {
    const [home, recent, stats] = await Promise.all([
      apiClient.getLibraryHome().catch(() => null),
      apiClient.listSongVersions({ pageSize: PREVIEW }),
      apiClient.getSongStats().catch(() => null),
    ]);
    return { home, recent, stats };
  },
  component: LibraryHomePage,
});

function LibraryHomePage() {
  const { t } = useTranslation();
  const { home, recent, stats } = Route.useLoaderData();
  const { session, teams, setlists } = Route.useRouteContext();
  const columns = useLibraryColumns(session.userId);
  // As chosen for Songs (issue #150).
  const [columnPrefs] = useColumnPrefs();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("library.title")}</h1>
        <div className="flex items-center gap-2">
          <Button render={<Link to="/library/new" />}>{t("library.addASong")}</Button>
        </div>
      </div>

      {/* The way from signing up to a set with one's team (issue #350). */}
      {stats?.ownSongCount !== undefined ? <GettingStarted ownSongs={stats.ownSongCount} teams={teams} setlists={setlists} /> : null}

      {recent.total === 0 ? (
        <Empty variant="card">{t("library.noSongsYet")}</Empty>
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
