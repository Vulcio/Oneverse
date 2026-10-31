import type { SongUsage } from "@oneverse/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { apiClient } from "#/lib/api-client";

/**
 * Deleting a song (issue #340): it goes to the bin for 30 days. When others
 * use it - their sets, songbooks, files, versions or notes - the dialog says
 * where, and offers to give it to one of the user's teams instead, so it
 * stays where it is.
 */
export function DeleteSongDialog({
  songVersionId,
  title,
  open,
  onOpenChange,
  onBinned,
  onGiven,
}: {
  songVersionId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBinned: () => void | Promise<void>;
  onGiven: (message: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<SongUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsage(null);
    setError(null);
    let current = true;
    apiClient
      .getSongUsage(songVersionId)
      .then((found) => current && setUsage(found))
      .catch(() => current && setUsage({ sets: [], songbooks: [], othersFiles: 0, othersVersions: 0, othersNotes: 0, teams: [] }));
    return () => {
      current = false;
    };
  }, [open, songVersionId]);

  const used = !!usage && (usage.sets.length > 0 || usage.songbooks.length > 0 || usage.othersFiles + usage.othersVersions + usage.othersNotes > 0);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("songEditor.deleteFailed"));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent data-testid="delete-song-dialog">
        <DialogHeader>
          <DialogTitle>{t("songEditor.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("songEditor.deleteDescription", { title })}</DialogDescription>
        </DialogHeader>
        {used ? (
          <div className="flex flex-col gap-3 rounded-md border border-destructive/40 p-3 text-sm" data-testid="delete-song-usage">
            <p className="font-medium">{t("songEditor.deleteUsedTitle")}</p>
            {usage.sets.length > 0 ? (
              <div>
                <p>{t("songEditor.deleteUsedSets", { count: usage.sets.length })}</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {usage.sets.slice(0, 6).map((set) => (
                    <li key={set.id}>{[set.name ?? set.eventDate, set.team?.name].filter(Boolean).join(" · ")}</li>
                  ))}
                  {usage.sets.length > 6 ? <li>…</li> : null}
                </ul>
              </div>
            ) : null}
            {usage.songbooks.length > 0 ? (
              <div>
                <p>{t("songEditor.deleteUsedSongbooks", { count: usage.songbooks.length })}</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {usage.songbooks.slice(0, 6).map((book) => (
                    <li key={book.id}>{book.name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {usage.othersFiles + usage.othersVersions + usage.othersNotes > 0 ? (
              <ul className="list-disc pl-5 text-muted-foreground">
                {usage.othersFiles > 0 ? <li>{t("songEditor.deleteOthersFiles", { count: usage.othersFiles })}</li> : null}
                {usage.othersVersions > 0 ? <li>{t("songEditor.deleteOthersVersions", { count: usage.othersVersions })}</li> : null}
                {usage.othersNotes > 0 ? <li>{t("songEditor.deleteOthersNotes", { count: usage.othersNotes })}</li> : null}
              </ul>
            ) : null}
            <p className="text-muted-foreground">{t("songEditor.deleteUsedHint")}</p>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("songEditor.cancel")}
          </Button>
          {usage?.teams.map((team) => (
            <Button
              key={team.id}
              type="button"
              disabled={busy}
              data-testid="delete-song-give"
              onClick={() =>
                void run(async () => {
                  const { moved } = await apiClient.moveSongToTeam(songVersionId, team.id);
                  setBusy(false);
                  onOpenChange(false);
                  await onGiven(t(moved ? "songEditor.givenToTeam" : "songEditor.offeredToTeam", { team: team.name }));
                })
              }
            >
              {t("songEditor.giveToTeam", { team: team.name })}
            </Button>
          ))}
          <Button
            type="button"
            variant="destructive"
            disabled={busy || !usage}
            data-testid="delete-song-confirm"
            onClick={() =>
              void run(async () => {
                await apiClient.deleteSongVersion(songVersionId);
                await onBinned();
              })
            }
          >
            {busy ? t("songEditor.deleting") : t("songEditor.moveToBin")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
