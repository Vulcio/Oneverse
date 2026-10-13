import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent } from "@songverse/ui/components/card";

export const Route = createFileRoute("/_protected/admin/catalogs")({
  loader: () => apiClient.listSongbookCatalogs(),
  component: AdminCatalogsPage,
});

function AdminCatalogsPage() {
  const { t } = useTranslation();
  const catalogs = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("nav.adminCatalogs")}</h1>
          <p className="text-sm text-muted-foreground">{t("songbookCatalog.description")}</p>
        </div>
        <Button render={<Link to="/songbook-catalogs/new" />}>{t("songbookCatalog.createCatalog")}</Button>
      </div>

      <Card>
        <CardContent>
          {catalogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("songbookCatalog.noCatalogsYet")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {catalogs.map((catalog) => (
                <li key={catalog.id}>
                  <Link
                    to="/songbook-catalogs/$catalogId"
                    params={{ catalogId: catalog.id }}
                    className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 hover:text-primary"
                  >
                    <div>
                      <p className="font-medium">
                        {catalog.name}
                        {catalog.abbreviation ? ` (${catalog.abbreviation})` : ""}
                      </p>
                      {catalog.publisher ? <p className="text-xs text-muted-foreground">{catalog.publisher}</p> : null}
                    </div>
                    {catalog.licensed ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {t("songbookCatalog.licensed")}
                      </span>
                    ) : null}
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
