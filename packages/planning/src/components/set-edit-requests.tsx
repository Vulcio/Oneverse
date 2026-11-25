import { ApiError, type SetEditRequest, type SetEditRequestStatus } from "@oneverse/core";
import { PencilLine } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { FieldError } from "@oneverse/ui/components/field";
import { usePlanning } from "../host";

/**
 * Asking to edit a date's set one only views (issue #578): a button, or
 * where one's ask is - waiting, or declined (ask again). Those who edit it
 * are told and grant or decline it; granted, the set opens to edit.
 */
export function AskToEditSet({ setlistId, request, onAsked }: { setlistId: string; request: { id: string; status: SetEditRequestStatus } | null | undefined; onAsked: () => Promise<void> }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.askToEditSetlist(setlistId);
      await onAsked();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-1" data-testid="set-ask-to-edit" data-status={request?.status ?? "NONE"}>
      {request?.status === "PENDING" ? (
        <p className="text-sm text-muted-foreground">{t("sets.askToEditPending")}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {request?.status === "DECLINED" ? <span className="text-sm text-muted-foreground">{t("sets.askToEditDeclined")}</span> : null}
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void ask()} data-testid="set-ask-to-edit-button">
            <PencilLine />
            {request?.status === "DECLINED" ? t("sets.askAgain") : t("sets.askToEdit")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("sets.askToEditHint")}</span>
        </div>
      )}
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}

/**
 * The asks to edit a date's set (issue #578), for those who edit it through
 * the date's teams: grant or decline each. Nothing when there are none, or
 * for someone who doesn't decide them.
 */
export function SetEditRequestsCard({ setlistId }: { setlistId: string }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [requests, setRequests] = useState<SetEditRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    api.listSetlistEditRequests(setlistId).then(
      (found) => current && setRequests(found),
      (err: unknown) => {
        if (current && err instanceof ApiError && (err.status === 403 || err.status === 404)) setRequests(null);
      },
    );
    return () => {
      current = false;
    };
  }, [setlistId]);
  if (!requests || requests.length === 0) return null;

  const decide = async (request: SetEditRequest, grant: boolean) => {
    setError(null);
    try {
      const decided = await api.decideSetlistEditRequest(setlistId, request.id, grant);
      setRequests(requests.map((one) => (one.id === decided.id ? decided : one)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Card data-testid="set-edit-requests">
      <CardHeader>
        <CardTitle className="text-sm">{t("sets.editRequests")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ul className="flex flex-col gap-2">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-edit-request={request.displayName} data-status={request.status}>
              <span className="flex items-center gap-2 font-medium">
                <EntityAvatar name={request.displayName} color={null} avatarUrl={request.avatarUrl} size={20} />
                {request.displayName}
              </span>
              {request.status === "PENDING" ? (
                <span className="flex gap-2">
                  <Button size="sm" onClick={() => void decide(request, true)} data-testid="set-edit-request-grant">
                    {t("sets.editRequestGrant")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void decide(request, false)} data-testid="set-edit-request-decline">
                    {t("sets.editRequestDecline")}
                  </Button>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {request.status === "GRANTED" ? t("sets.editRequestGranted", { name: request.decidedBy ?? "" }) : t("sets.editRequestDeclined", { name: request.decidedBy ?? "" })}
                </span>
              )}
            </li>
          ))}
        </ul>
        {error ? <FieldError>{error}</FieldError> : null}
      </CardContent>
    </Card>
  );
}
