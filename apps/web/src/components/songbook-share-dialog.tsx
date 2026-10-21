import type { PeopleOverview, SongbookShare, TeamSummary } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";

/**
 * Sharing a songbook (issue #211) with one of your people or one of your
 * teams: who and which teams it's shared with, each able to view it - its
 * entries and the songs in it - or edit its entries and details too;
 * changing that, stopping it, adding someone or a team.
 */
export function SongbookShareDialog({ songbookId, open, onOpenChange }: { songbookId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [shares, setShares] = useState<SongbookShare[] | null>(null);
  const [people, setPeople] = useState<PeopleOverview["people"]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [who, setWho] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    Promise.all([apiClient.getSongbookShares(songbookId), apiClient.getPeople(), apiClient.listTeams()])
      .then(([current, overview, mine]) => {
        setShares(current);
        setPeople(overview.people);
        setTeams(mine);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [open, songbookId]);

  async function run(action: () => Promise<SongbookShare[] | void>) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setShares(next ?? (await apiClient.getSongbookShares(songbookId)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // "user:<id>" or "team:<id>", for one select.
  const targetOf = (value: string) => (value.startsWith("team:") ? { teamId: value.slice(5) } : { userId: value.slice(5) });
  const keyOf = (share: SongbookShare) => (share.team ? `team:${share.team.id}` : `user:${share.user!.id}`);
  const taken = new Set((shares ?? []).map(keyOf));
  const availablePeople = people.filter((person) => !taken.has(`user:${person.id}`));
  const availableTeams = teams.filter((team) => !taken.has(`team:${team.id}`));
  const rights = (value: boolean) => (value ? "edit" : "view");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("songbookSharing.title")}</DialogTitle>
          <DialogDescription>{t("songbookSharing.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {shares && shares.length > 0 ? (
            <ul className="flex flex-col divide-y rounded-md border" data-testid="songbook-shares">
              {shares.map((share) => {
                const name = share.team?.name ?? share.user!.displayName;
                const target = share.team ? { teamId: share.team.id } : { userId: share.user!.id };
                return (
                  <li key={keyOf(share)} className="flex items-center gap-2 px-3 py-2 text-sm" data-share={keyOf(share)}>
                    {share.team ? <Users className="size-4 shrink-0 text-muted-foreground" aria-label={t("songbookSharing.team")} /> : null}
                    <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                    <NativeSelect
                      compact
                      value={rights(share.canEdit)}
                      disabled={busy}
                      aria-label={t("sharing.rightsFor", { name })}
                      onChange={(event) => void run(() => apiClient.shareSongbook(songbookId, target, event.target.value === "edit"))}
                    >
                      <option value="view">{t("sharing.canView")}</option>
                      <option value="edit">{t("sharing.canEdit")}</option>
                    </NativeSelect>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label={t("sharing.stop", { name })}
                      onClick={() => void run(() => apiClient.unshareSongbook(songbookId, target))}
                    >
                      <X />
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : shares ? (
            <p className="text-sm text-muted-foreground">{t("songbookSharing.none")}</p>
          ) : null}

          {availablePeople.length > 0 || availableTeams.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect value={who} onChange={(event) => setWho(event.target.value)} aria-label={t("songbookSharing.with")} className="min-w-0 flex-1" data-testid="songbook-share-with">
                <option value="">{t("songbookSharing.choose")}</option>
                {availableTeams.length > 0 ? (
                  <optgroup label={t("songbookSharing.teams")}>
                    {availableTeams.map((team) => (
                      <option key={team.id} value={`team:${team.id}`}>
                        {team.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {availablePeople.length > 0 ? (
                  <optgroup label={t("songbookSharing.people")}>
                    {availablePeople.map((person) => (
                      <option key={person.id} value={`user:${person.id}`}>
                        {person.displayName}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </NativeSelect>
              <NativeSelect value={rights(canEdit)} onChange={(event) => setCanEdit(event.target.value === "edit")} aria-label={t("sharing.rights")} data-testid="songbook-share-rights">
                <option value="view">{t("sharing.canView")}</option>
                <option value="edit">{t("sharing.canEdit")}</option>
              </NativeSelect>
              <Button
                type="button"
                disabled={busy || !who}
                data-testid="songbook-share-add"
                onClick={() =>
                  void run(async () => {
                    const next = await apiClient.shareSongbook(songbookId, targetOf(who), canEdit);
                    setWho("");
                    return next;
                  })
                }
              >
                {t("sharing.share")}
              </Button>
            </div>
          ) : shares && people.length === 0 && teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("songbookSharing.noOne")}{" "}
              <Link to="/people" className="font-medium text-primary hover:underline">
                {t("people.title")}
              </Link>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("songbookSharing.rightsHint")}</p>
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
