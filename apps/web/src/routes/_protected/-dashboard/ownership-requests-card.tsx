import type { SongOwnershipRequest } from "@songverse/core";
import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { apiClient } from "#/lib/api-client";

/** Teams asking for songs of yours shared into their sets. Hidden when there are none. */
export function OwnershipRequestsCard({ requests }: { requests: SongOwnershipRequest[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (requests.length === 0) return null;

  async function decide(requestId: string, accept: boolean) {
    setBusyId(requestId);
    setError(null);
    try {
      await (accept ? apiClient.acceptOwnershipRequest(requestId) : apiClient.declineOwnershipRequest(requestId));
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("ownership.title")}</CardTitle>
        <CardDescription>{t("ownership.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y" data-testid="ownership-requests">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {request.setlistId ? (
                    <Link to="/sets/$setlistId" params={{ setlistId: request.setlistId }} className="hover:underline">
                      {t("ownership.request", { team: request.team.name, song: request.song.title })}
                    </Link>
                  ) : (
                    t("ownership.request", { team: request.team.name, song: request.song.title })
                  )}
                </p>
                {request.requestedByName ? (
                  <p className="text-xs text-muted-foreground">{t("ownership.requestedBy", { name: request.requestedByName })}</p>
                ) : null}
                {!request.ownerIsTeamMember ? <p className="text-xs text-destructive">{t("ownership.notMemberWarning")}</p> : null}
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={busyId !== null} onClick={() => void decide(request.id, true)}>
                  {t("ownership.accept")}
                </Button>
                <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => void decide(request.id, false)}>
                  {t("ownership.decline")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
