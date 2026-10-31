import type { BinnedSong } from "@oneverse/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { apiClient } from "#/lib/api-client";

/**
 * The bin (issue #340): songs deleted in the last 30 days that the user may
 * put back (they deleted them, or could have), each until it's deleted for
 * good.
 */
export const Route = createFileRoute("/_protected/library/bin")({
  loader: (): Promise<BinnedSong[]> => apiClient.listSongBin(),
  component: BinPage,
});

function BinPage() {
  const { t, i18n } = useTranslation();
  const songs = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const day = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: "numeric", month: "long", year: "numeric" });

  async function act(song: BinnedSong, action: "restore" | "delete") {
    setBusy(song.id);
    setMessage(null);
    try {
      if (action === "restore") await apiClient.restoreSong(song.id);
      else await apiClient.deleteSongForGood(song.id);
      if (action === "restore") setMessage({ kind: "ok", text: t("bin.restored", { title: song.title }) });
      await router.invalidate();
    } catch {
      setMessage({ kind: "error", text: t("bin.failed") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Trash2 className="size-5 text-primary" aria-hidden />
          {t("bin.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("bin.description")}</p>
      </div>
      {message ? (
        <p role="status" className={message.kind === "error" ? "text-sm text-destructive" : "text-sm"} data-testid="bin-message">
          {message.text}
        </p>
      ) : null}
      {songs.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="bin-empty">
          {t("bin.empty")}
        </p>
      ) : (
        <Card className="gap-0 p-0">
          <CardContent className="flex flex-col divide-y p-0">
            {songs.map((song) => (
              <div key={song.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="bin-song">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{song.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {[song.artist, song.team?.name].filter(Boolean).join(" · ")}
                    {song.artist || song.team ? " · " : ""}
                    {song.deletedBy ? t("bin.deletedBy", { name: song.deletedBy, date: day(song.deletedAt) }) : t("bin.deletedOn", { date: day(song.deletedAt) })}
                  </span>
                  <span className="text-xs text-muted-foreground">{t("bin.purgeOn", { date: day(song.purgeAt) })}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" disabled={busy === song.id} onClick={() => void act(song, "restore")}>
                    {t("bin.restore")}
                  </Button>
                  <ConfirmButton
                    label={t("bin.deleteForGood")}
                    confirmLabel={t("bin.confirmDelete")}
                    busyLabel={t("bin.deleting")}
                    cancelLabel={t("bin.cancel")}
                    busy={busy === song.id}
                    onConfirm={() => act(song, "delete")}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
