import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent } from "@songverse/ui/components/card";
import { EntityAvatar } from "#/components/entity-avatar";

export const Route = createFileRoute("/_protected/songbooks/")({
  loader: () => apiClient.listSongbooks(),
  component: SongbooksIndex,
});

function SongbooksIndex() {
  const { t } = useTranslation();
  const songbooks = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("songbooks.title")}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" render={<Link to="/songbook-catalogs" />}>{t("songbooks.browseCatalog")}</Button>
          <Button render={<Link to="/songbooks/new" />}>{t("songbooks.createSongbook")}</Button>
        </div>
      </div>

      <Card>
        <CardContent>
          {songbooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("songbooks.noSongbooksYet")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {songbooks.map((songbook) => (
                <li key={songbook.id}>
                  <Link
                    to="/songbooks/$songbookId"
                    params={{ songbookId: songbook.id }}
                    className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 hover:text-primary"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <EntityAvatar name={songbook.name} color={songbook.color} avatarUrl={songbook.avatarUrl} size={36} />
                      <div className="min-w-0">
                        <p className="font-medium">
                          {songbook.name}
                          {songbook.abbreviation ? ` (${songbook.abbreviation})` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[songbook.publisher, songbook.year].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs whitespace-nowrap text-muted-foreground">
                      {songbook.ownerScope === "GLOBAL"
                        ? t("songbooks.global")
                        : songbook.ownerScope === "TEAM"
                          ? t("songbooks.teamOwned")
                          : t("songbooks.personal")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
