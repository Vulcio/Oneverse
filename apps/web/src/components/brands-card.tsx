import type { Brand } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { Palette } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";

/** A team's or an organisation's brands (issue #279), on its page for its admins: how many, and where to change them. */
export function BrandsCard({ owner }: { owner: { teamId: string } | { organizationId: string } }) {
  const { t } = useTranslation();
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const teamId = "teamId" in owner ? owner.teamId : undefined;
  const organizationId = "organizationId" in owner ? owner.organizationId : undefined;
  useEffect(() => {
    let live = true;
    void apiClient
      .listBrands({ teamId, organizationId })
      .then((found) => live && setBrands(found))
      .catch(() => live && setBrands([]));
    return () => {
      live = false;
    };
  }, [teamId, organizationId]);
  return (
    <Card data-testid="brands-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Palette className="size-4 text-muted-foreground" aria-hidden />
          {t("brands.manage")}
        </CardTitle>
        <CardDescription>{t("brands.cardDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {brands ? (
          <ul className="flex flex-col gap-1 text-sm">
            {brands.map((brand) => (
              <li key={brand.id}>
                <Link to="/brands/$brandId" params={{ brandId: brand.id }} className="hover:underline">
                  {brand.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <div>
          <Button size="sm" variant="outline" render={<Link to="/screens" search={{ tab: "brands" }} />} data-testid="brands-open">
            {brands?.length ? t("brands.open") : t("brands.new")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
