import { getLanguageDisplayName, type SongVersionDetail, type WorkDetail } from "@songverse/core";
import { Link } from "@tanstack/react-router";
import { Languages, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { apiClient } from "#/lib/api-client";

/** How a linked song relates: "translation", "adaptation", or just "linked". */
export function relationKind(relationshipType: string | null): "translation" | "adaptation" | "linked" {
  if (relationshipType === "DIRECT_TRANSLATION") return "translation";
  if (relationshipType === "LYRICAL_ADAPTATION" || relationshipType === "SINGABLE_ADAPTATION" || relationshipType === "SIMPLIFIED_VERSION") return "adaptation";
  return "linked";
}

/**
 * The songs linked to this one (issue #78): its original, and its
 * translations and adaptations - each a song of its own, with its own
 * owner and versions - that the user can see; and "Add a translation".
 */
export function LinkedSongsCard({ version }: { version: SongVersionDetail }) {
  const { t, i18n } = useTranslation();
  const [linked, setLinked] = useState<WorkDetail["versions"]>([]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getWork(version.workId)
      .then((work) => !cancelled && setLinked(work.versions.filter((other) => other.id !== version.id)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [version.id, version.workId]);

  const relation = (other: WorkDetail["versions"][number]) =>
    other.id === version.parentVersion?.id ? t("songEditor.relation.original") : t(`songEditor.relation.${relationKind(other.relationshipType)}`);

  return (
    <Card data-testid="linked-songs">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="size-4 text-primary" aria-hidden />
          {t("songEditor.linkedSongs")}
        </CardTitle>
        <CardDescription>{t("songEditor.linkedSongsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {linked.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("songEditor.noLinkedSongs")}</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {linked.map((other) => (
              <li key={other.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <Link to="/library/$songVersionId" params={{ songVersionId: other.id }} className="font-medium hover:underline">
                  {other.title}
                </Link>
                <span className="text-muted-foreground">
                  {[relation(other), getLanguageDisplayName(other.language, i18n.language)].join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" className="self-start" render={<Link to="/library/new" search={{ linkTo: version.id }} />}>
            <Plus />
            {t("songEditor.addTranslation")}
          </Button>
      </CardContent>
    </Card>
  );
}
