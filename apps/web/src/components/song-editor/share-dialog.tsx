import type { OrganizationSummary, PeopleOverview, SongOrganizationShare, SongShare, SongTeamShare, TeamSummary } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { Building2, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";

/**
 * Sharing a song with one of your people (issue #77) or one of your teams
 * (#331): who and which teams it's shared with, each able to view or edit
 * it; changing that, stopping it, adding someone or a team. People come
 * from the People page. It can be shared with a whole organisation one is in
 * too (issue #350), to view. A personal song can also be moved to a team (#331):
 * at once for one of its admins, else offered to them.
 */
export function ShareDialog({
  songVersionId,
  songTitle,
  personal,
  ownerTeamId,
  open,
  onOpenChange,
  onMoved,
}: {
  songVersionId: string;
  songTitle: string;
  /** A personal song, which can be moved to a team. */
  personal: boolean;
  /** A team's song: that team, which it needn't be shared with. */
  ownerTeamId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** It's a team's now. */
  onMoved: () => void;
}) {
  const { t } = useTranslation();
  const [shares, setShares] = useState<SongShare[] | null>(null);
  const [teamShares, setTeamShares] = useState<SongTeamShare[]>([]);
  const [organizationShares, setOrganizationShares] = useState<SongOrganizationShare[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [people, setPeople] = useState<PeopleOverview["people"]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [who, setWho] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const [confirmingMove, setConfirmingMove] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNotice(null);
    setConfirmingMove(false);
    Promise.all([
      apiClient.getSongShares(songVersionId),
      apiClient.getSongTeamShares(songVersionId),
      apiClient.getSongOrganizationShares(songVersionId),
      apiClient.getPeople(),
      apiClient.listTeams(),
      apiClient.listMyOrganizations(),
    ])
      .then(([current, currentTeams, currentOrganizations, overview, mine, myOrganizations]) => {
        setShares(current);
        setTeamShares(currentTeams);
        setOrganizationShares(currentOrganizations);
        setOrganizations(myOrganizations.organizations);
        setPeople(overview.people);
        setTeams(mine.filter((team) => team.id !== ownerTeamId && team.usesSongverse !== false));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [open, songVersionId, ownerTeamId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      const [next, nextTeams, nextOrganizations] = await Promise.all([
        apiClient.getSongShares(songVersionId),
        apiClient.getSongTeamShares(songVersionId),
        apiClient.getSongOrganizationShares(songVersionId),
      ]);
      setShares(next);
      setTeamShares(nextTeams);
      setOrganizationShares(nextOrganizations);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function move(team: TeamSummary) {
    setBusy(true);
    setError(null);
    try {
      const { moved } = await apiClient.moveSongToTeam(songVersionId, team.id);
      setConfirmingMove(false);
      setMoveTo("");
      if (moved) {
        onOpenChange(false);
        onMoved();
      } else {
        setNotice(t("sharing.move.offered", { team: team.name }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // "user:<id>", "team:<id>" or "org:<id>", for one select.
  const taken = new Set([
    ...(shares ?? []).map((share) => `user:${share.user.id}`),
    ...teamShares.map((share) => `team:${share.team.id}`),
    ...organizationShares.map((share) => `org:${share.organization.id}`),
  ]);
  const availablePeople = people.filter((person) => !taken.has(`user:${person.id}`));
  const availableTeams = teams.filter((team) => !taken.has(`team:${team.id}`));
  const availableOrganizations = organizations.filter((organization) => !taken.has(`org:${organization.id}`));
  const rows = [
    ...organizationShares.map((share) => ({ key: `org:${share.organization.id}`, name: share.organization.name, kind: "org" as const, canEdit: false })),
    ...teamShares.map((share) => ({ key: `team:${share.team.id}`, name: share.team.name, kind: "team" as const, canEdit: share.canEdit })),
    ...(shares ?? []).map((share) => ({ key: `user:${share.user.id}`, name: share.user.displayName, kind: "user" as const, canEdit: share.canEdit })),
  ];
  const [kindOf, idOf] = [(key: string) => key.slice(0, key.indexOf(":")), (key: string) => key.slice(key.indexOf(":") + 1)];
  const shareWith = (key: string, edit: boolean) =>
    kindOf(key) === "org"
      ? apiClient.shareSongWithOrganization(songVersionId, idOf(key))
      : kindOf(key) === "team"
        ? apiClient.shareSongWithTeam(songVersionId, idOf(key), edit)
        : apiClient.shareSong(songVersionId, idOf(key), edit);
  const stopSharing = (key: string) =>
    kindOf(key) === "org"
      ? apiClient.unshareSongWithOrganization(songVersionId, idOf(key))
      : kindOf(key) === "team"
        ? apiClient.unshareSongWithTeam(songVersionId, idOf(key))
        : apiClient.unshareSong(songVersionId, idOf(key));
  // An organisation's share is to view (issue #350).
  const choosingOrganization = who.startsWith("org:");
  const rights = (value: boolean) => (value ? "edit" : "view");
  const moveTeam = teams.find((team) => team.id === moveTo);
  const asAdmin = moveTeam?.currentUserRole === "ADMIN";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sharing.title")}</DialogTitle>
          <DialogDescription>{t("sharing.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {shares && rows.length > 0 ? (
            <ul className="flex flex-col divide-y rounded-md border" data-testid="song-shares">
              {rows.map((row) => (
                <li key={row.key} className="flex items-center gap-2 px-3 py-2 text-sm" data-share={row.key}>
                  {row.kind === "team" ? <Users className="size-4 shrink-0 text-muted-foreground" aria-label={t("sharing.team")} /> : null}
                  {row.kind === "org" ? <Building2 className="size-4 shrink-0 text-muted-foreground" aria-label={t("sharing.organization")} /> : null}
                  <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                  {row.kind === "org" ? (
                    <span className="text-xs text-muted-foreground">{t("sharing.canView")}</span>
                  ) : (
                  <NativeSelect
                    compact
                    value={rights(row.canEdit)}
                    disabled={busy}
                    aria-label={t("sharing.rightsFor", { name: row.name })}
                    onChange={(event) => void run(() => shareWith(row.key, event.target.value === "edit"))}
                  >
                    <option value="view">{t("sharing.canView")}</option>
                    <option value="edit">{t("sharing.canEdit")}</option>
                  </NativeSelect>
                  )}
                  <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={t("sharing.stop", { name: row.name })} onClick={() => void run(() => stopSharing(row.key))}>
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          ) : shares ? (
            <p className="text-sm text-muted-foreground">{t("sharing.none")}</p>
          ) : null}

          {availablePeople.length > 0 || availableTeams.length > 0 || availableOrganizations.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect value={who} onChange={(event) => setWho(event.target.value)} aria-label={t("sharing.with")} className="min-w-0 flex-1" data-testid="song-share-with">
                <option value="">{t("sharing.choose")}</option>
                {availableOrganizations.length > 0 ? (
                  <optgroup label={t("sharing.organizations")}>
                    {availableOrganizations.map((organization) => (
                      <option key={organization.id} value={`org:${organization.id}`}>
                        {organization.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {availableTeams.length > 0 ? (
                  <optgroup label={t("sharing.teams")}>
                    {availableTeams.map((team) => (
                      <option key={team.id} value={`team:${team.id}`}>
                        {team.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {availablePeople.length > 0 ? (
                  <optgroup label={t("sharing.people")}>
                    {availablePeople.map((person) => (
                      <option key={person.id} value={`user:${person.id}`}>
                        {person.displayName}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </NativeSelect>
              <NativeSelect
                value={choosingOrganization ? "view" : rights(canEdit)}
                disabled={choosingOrganization}
                onChange={(event) => setCanEdit(event.target.value === "edit")}
                aria-label={t("sharing.rights")}
                data-testid="song-share-rights"
              >
                <option value="view">{t("sharing.canView")}</option>
                <option value="edit">{t("sharing.canEdit")}</option>
              </NativeSelect>
              <Button
                type="button"
                disabled={busy || !who}
                data-testid="song-share-add"
                onClick={() =>
                  void run(async () => {
                    await shareWith(who, canEdit);
                    setWho("");
                  })
                }
              >
                {t("sharing.share")}
              </Button>
            </div>
          ) : null}
          {people.length === 0 && shares ? (
            <p className="text-sm text-muted-foreground">
              {t("sharing.noPeople")}{" "}
              <Link to="/people" className="font-medium text-primary hover:underline">
                {t("people.title")}
              </Link>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("sharing.rightsHint")}</p>
          {organizations.length > 0 ? <p className="text-xs text-muted-foreground">{t("sharing.organizationHint")}</p> : null}

          {/* Moving a personal song to a team (issue #331): a step of its own, confirmed, since its owner can't undo it. */}
          {personal && teams.length > 0 ? (
            <div className="flex flex-col gap-2 border-t pt-4" data-testid="song-move">
              <p className="text-sm font-medium">{t("sharing.move.title")}</p>
              <p className="text-xs text-muted-foreground">{t("sharing.move.hint")}</p>
              {confirmingMove && moveTeam ? (
                <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3">
                  <p className="text-sm font-medium">{t("sharing.move.confirm", { song: songTitle, team: moveTeam.name })}</p>
                  <p className="text-xs text-muted-foreground">{t(asAdmin ? "sharing.move.confirmAdmin" : "sharing.move.confirmMember", { team: moveTeam.name })}</p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void move(moveTeam)} data-testid="song-move-confirm">
                      {t(asAdmin ? "sharing.move.button" : "sharing.move.offer")}
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmingMove(false)}>
                      {t("sharing.move.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect value={moveTo} onChange={(event) => setMoveTo(event.target.value)} aria-label={t("sharing.move.team")} className="min-w-0 flex-1" data-testid="song-move-team">
                    <option value="">{t("sharing.move.choose")}</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button type="button" variant="outline" disabled={busy || !moveTo} onClick={() => setConfirmingMove(true)} data-testid="song-move-start">
                    {t("sharing.move.button")}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
          {notice ? (
            <p className="text-sm text-muted-foreground" role="status">
              {notice}
            </p>
          ) : null}
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
