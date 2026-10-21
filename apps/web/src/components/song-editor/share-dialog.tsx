import type { PeopleOverview, SongShare } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";

/**
 * Sharing a song with one of your people (issue #77): who it's shared
 * with, each able to view or edit it; changing that, stopping it, adding
 * someone. People come from the People page.
 */
export function ShareDialog({ songVersionId, open, onOpenChange }: { songVersionId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [shares, setShares] = useState<SongShare[] | null>(null);
  const [people, setPeople] = useState<PeopleOverview["people"]>([]);
  const [who, setWho] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    Promise.all([apiClient.getSongShares(songVersionId), apiClient.getPeople()])
      .then(([current, overview]) => {
        setShares(current);
        setPeople(overview.people);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [open, songVersionId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setShares(await apiClient.getSongShares(songVersionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const available = people.filter((person) => !shares?.some((share) => share.user.id === person.id));
  const rights = (value: boolean) => (value ? "edit" : "view");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sharing.title")}</DialogTitle>
          <DialogDescription>{t("sharing.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {shares && shares.length > 0 ? (
            <ul className="flex flex-col divide-y rounded-md border" data-testid="song-shares">
              {shares.map((share) => (
                <li key={share.user.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{share.user.displayName}</span>
                  <NativeSelect
                    compact
                    value={rights(share.canEdit)}
                    disabled={busy}
                    aria-label={t("sharing.rightsFor", { name: share.user.displayName })}
                    onChange={(event) => void run(() => apiClient.shareSong(songVersionId, share.user.id, event.target.value === "edit"))}
                  >
                    <option value="view">{t("sharing.canView")}</option>
                    <option value="edit">{t("sharing.canEdit")}</option>
                  </NativeSelect>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={t("sharing.stop", { name: share.user.displayName })}
                    onClick={() => void run(() => apiClient.unshareSong(songVersionId, share.user.id))}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          ) : shares ? (
            <p className="text-sm text-muted-foreground">{t("sharing.none")}</p>
          ) : null}

          {people.length === 0 && shares ? (
            <p className="text-sm text-muted-foreground">
              {t("sharing.noPeople")}{" "}
              <Link to="/people" className="font-medium text-primary hover:underline">
                {t("people.title")}
              </Link>
            </p>
          ) : available.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect value={who} onChange={(event) => setWho(event.target.value)} aria-label={t("sharing.person")} className="min-w-0 flex-1">
                <option value="">{t("sharing.choosePerson")}</option>
                {available.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect value={rights(canEdit)} onChange={(event) => setCanEdit(event.target.value === "edit")} aria-label={t("sharing.rights")}>
                <option value="view">{t("sharing.canView")}</option>
                <option value="edit">{t("sharing.canEdit")}</option>
              </NativeSelect>
              <Button
                type="button"
                disabled={busy || !who}
                onClick={() =>
                  void run(async () => {
                    await apiClient.shareSong(songVersionId, who, canEdit);
                    setWho("");
                  })
                }
              >
                {t("sharing.share")}
              </Button>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("sharing.rightsHint")}</p>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
