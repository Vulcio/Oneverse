import type { ArrangementSummary } from "@songverse/core";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { AlertTriangle, Plus, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@songverse/ui/components/badge";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";

/**
 * The song's arrangements (docs/arrangement-document-v2.md): the user's own
 * and their teams', with a way to start a new one - yours, or a team's you
 * administer. Anyone who can see the song can arrange it.
 */
export function ArrangementsTab({ songVersionId }: { songVersionId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { teams } = useRouteContext({ from: "/_protected" });
  const adminTeams = teams.filter((team) => team.currentUserRole === "ADMIN");
  const [arrangements, setArrangements] = useState<ArrangementSummary[] | null>(null);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listArrangements(songVersionId)
      .then((list) => !cancelled && setArrangements(list))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [songVersionId]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await apiClient.createArrangement(songVersionId, { name: name.trim(), ...(owner && { teamId: owner }) });
      await navigate({ to: "/library/$songVersionId/arrangements/$arrangementId", params: { songVersionId, arrangementId: created.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader>
          <CardTitle>{t("arrangements.title")}</CardTitle>
          <CardDescription>{t("arrangements.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {arrangements === null ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : arrangements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("arrangements.none")}</p>
          ) : (
            <ul className="flex flex-col divide-y" data-testid="arrangement-list">
              {arrangements.map((arrangement) => (
                <li key={arrangement.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <Link
                    to="/library/$songVersionId/arrangements/$arrangementId"
                    params={{ songVersionId, arrangementId: arrangement.id }}
                    className="font-medium hover:underline"
                  >
                    {arrangement.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {[
                      arrangement.teamName ?? t("arrangements.mine"),
                      arrangement.key ? t("arrangements.inKey", { key: arrangement.key }) : null,
                      arrangement.capo ? t("arrangements.capo", { capo: arrangement.capo }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {arrangement.isTeamDefault ? (
                    <Badge variant="muted" className="gap-1">
                      <Star className="size-3" aria-hidden />
                      {t("arrangements.usual")}
                    </Badge>
                  ) : null}
                  {arrangement.needsReview ? (
                    <Badge variant="muted" className="gap-1 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="size-3" aria-hidden />
                      {t("arrangements.needsReview")}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("arrangements.new")}</CardTitle>
          <CardDescription>{t("arrangements.newDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="arrangement-name">{t("arrangements.name")}</Label>
              <Input
                id="arrangement-name"
                value={name}
                maxLength={100}
                placeholder={t("arrangements.namePlaceholder")}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void create();
                  }
                }}
              />
            </div>
            {adminTeams.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="arrangement-owner">{t("arrangements.owner")}</Label>
                <NativeSelect id="arrangement-owner" value={owner} onChange={(event) => setOwner(event.target.value)}>
                  <option value="">{t("arrangements.mine")}</option>
                  {adminTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
            <Button type="button" onClick={() => void create()} disabled={busy || !name.trim()}>
              <Plus />
              {t("arrangements.create")}
            </Button>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
