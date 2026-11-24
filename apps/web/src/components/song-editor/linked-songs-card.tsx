import { getLanguageDisplayName, SONG_RELATIONS, type SongRelation, type SongVersionDetail, type WorkDetail } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { Languages, Link2, Plus, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { toast } from "@oneverse/ui/components/toast";
import { SongPicker, type PickedSong } from "#/components/song-picker";
import { apiClient } from "#/lib/api-client";

/** How a linked song relates: "translation", "adaptation", or just "linked". */
export function relationKind(relationshipType: string | null): "translation" | "adaptation" | "linked" {
  if (relationshipType === "DIRECT_TRANSLATION") return "translation";
  if (relationshipType === "LYRICAL_ADAPTATION" || relationshipType === "SINGABLE_ADAPTATION" || relationshipType === "SIMPLIFIED_VERSION") return "adaptation";
  return "linked";
}

type Related = WorkDetail["versions"][number];

/**
 * A song's related songs (issues #78, #557): its original, and its
 * translations and adaptations - each a song of its own, with its own owner
 * and versions - that the user can see. Its editors link a song already in
 * the library, unlink one, or start a translation.
 */
export function LinkedSongsCard({ version, canEdit }: { version: SongVersionDetail; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const [related, setRelated] = useState<Related[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PickedSong | null>(null);
  const [relation, setRelation] = useState<SongRelation>("translation");
  const [busy, setBusy] = useState(false);

  const show = (work: WorkDetail) => setRelated(work.versions.filter((other) => other.id !== version.id));
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getWork(version.workId)
      .then((work) => !cancelled && show(work))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [version.id, version.workId]);

  const parentId = related.some((other) => other.id === version.parentVersion?.id) ? version.parentVersion?.id : undefined;
  const relationOf = (other: Related) => (other.id === parentId ? t("songEditor.relation.original") : t(`songEditor.relation.${relationKind(other.relationshipType)}`));

  const change = async (run: () => Promise<WorkDetail>) => {
    setBusy(true);
    try {
      show(await run());
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const link = async () => {
    if (!picked) return;
    if (await change(() => apiClient.linkRelatedSong(version.id, { songVersionId: picked.id, relation }))) {
      setPicked(null);
      setQuery("");
    }
  };

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
        {related.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("songEditor.noLinkedSongs")}</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {related.map((other) => (
              <li key={other.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <Link to="/library/$songVersionId" params={{ songVersionId: other.id }} className="font-medium hover:underline">
                  {other.title}
                </Link>
                <span className="flex items-center gap-1 text-muted-foreground">
                  {[relationOf(other), getLanguageDisplayName(other.language, i18n.language)].join(" · ")}
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={busy}
                      aria-label={t("songEditor.unlinkSong", { title: other.title })}
                      title={t("songEditor.unlinkSong", { title: other.title })}
                      onClick={() => void change(() => apiClient.unlinkRelatedSong(version.id, other.id))}
                    >
                      <Unlink />
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <div className="flex flex-col gap-2 border-t pt-3">
            <Label htmlFor="related-song-search">{t("songEditor.linkSong")}</Label>
            <div className="flex flex-wrap items-start gap-2">
              <SongPicker
                id="related-song-search"
                className="w-full max-w-xs"
                query={query}
                onQueryChange={(value) => {
                  setQuery(value);
                  setPicked(null);
                }}
                closed={!!picked}
                exclude={new Set([version.id, ...related.map((other) => other.id)])}
                placeholder={t("songEditor.linkSongPlaceholder")}
                empty={t("songEditor.linkSongNone")}
                onPick={(song) => {
                  setPicked(song);
                  setQuery(song.label);
                }}
                limit={8}
                testIds={{ item: "related-song-option" }}
              />
              <NativeSelect aria-label={t("songEditor.linkSongAs")} value={relation} onChange={(event) => setRelation(event.target.value as SongRelation)}>
                {SONG_RELATIONS.map((one) => (
                  <option key={one} value={one}>
                    {t(`songEditor.linkAs.${one}`)}
                  </option>
                ))}
              </NativeSelect>
              <Button size="sm" className="h-9" disabled={!picked || busy} onClick={() => void link()}>
                <Link2 />
                {t("songEditor.link")}
              </Button>
            </div>
          </div>
        ) : null}
        <Button variant="outline" size="sm" className="self-start" render={<Link to="/library/new" search={{ linkTo: version.id }} />}>
          <Plus />
          {t("songEditor.addTranslation")}
        </Button>
      </CardContent>
    </Card>
  );
}
