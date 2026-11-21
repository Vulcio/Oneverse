import { ApiError, addressLine, type ApiClient, type OrganizationLookalike, type OrganizationRequestView, type UserProfile } from "@oneverse/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { FieldError } from "@oneverse/ui/components/field";
import { OrganizationFields, countryFromLocale, emptyOrganizationDraft, organizationDraftBody, organizationDraftReady, type OrganizationDraft } from "@oneverse/ui/components/organization-fields";

/**
 * Signed up asking for an organisation (issue #533), not approved yet: where
 * the request stands - waiting, or declined and why - and, with none
 * waiting, asking again. Nothing else is open to the account until a global
 * admin approves one (or someone invites them).
 */
export function AwaitingApprovalCard({ api, profile }: { api: ApiClient; profile: Pick<UserProfile, "displayName" | "email"> }) {
  const { t, i18n } = useTranslation();
  const suggest = useCallback((q: string, country: string) => api.addressSuggestions(q, country || undefined, i18n.language?.split("-")[0]), [api, i18n.language]);
  const [requests, setRequests] = useState<OrganizationRequestView[] | null>(null);
  const [draft, setDraft] = useState<OrganizationDraft>(() => emptyOrganizationDraft(countryFromLocale(typeof navigator === "undefined" ? undefined : navigator.language)));
  const [looksLike, setLooksLike] = useState<OrganizationLookalike[] | null>(null);
  const [duplicateNote, setDuplicateNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Also tells this server's admins about a request made at sign-up, now the email is verified.
    void api
      .myOrganizationRequests()
      .then((mine) => setRequests(mine.requests))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [api]);

  const waiting = requests?.filter((one) => one.status === "PENDING") ?? [];
  const alreadyHere = !!looksLike?.some((one) => one.match === "same");
  const ready = organizationDraftReady(draft) && !alreadyHere && (!looksLike || duplicateNote.trim().length >= 5);

  function change(next: OrganizationDraft) {
    if (next.name !== draft.name || next.city !== draft.city || next.street !== draft.street || next.postalCode !== draft.postalCode || next.country !== draft.country) setLooksLike(null);
    setDraft(next);
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const made = await api.requestOrganization({ ...organizationDraftBody(draft), contactName: profile.displayName, contactEmail: profile.email, ...(looksLike ? { duplicateNote } : {}) });
      setRequests((before) => [made, ...(before ?? [])]);
      setDraft(emptyOrganizationDraft(draft.country));
      setLooksLike(null);
      setDuplicateNote("");
    } catch (err) {
      if (err instanceof ApiError && (err.code === "ORGANIZATION_LOOKS_LIKE" || err.code === "ORGANIZATION_EXISTS") && Array.isArray(err.details?.looksLike)) setLooksLike(err.details.looksLike as OrganizationLookalike[]);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string) {
    try {
      await api.withdrawOrganizationRequest(id);
      setRequests((before) => (before ?? []).filter((one) => one.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Card data-testid="awaiting-approval">
      <CardHeader>
        <CardTitle>{t(waiting.length > 0 ? "organizations.awaiting.title" : "organizations.awaiting.titleNone")}</CardTitle>
        <CardDescription>{t(waiting.length > 0 ? "organizations.awaiting.description" : "organizations.awaiting.descriptionNone")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {requests && requests.length > 0 ? (
          <div className="flex flex-col gap-3">
            {requests.map((request) => (
              <div key={request.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3" data-request={request.id}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{request.name}</p>
                  <p className="text-xs text-muted-foreground">{addressLine({ street: request.street, postalCode: request.postalCode, city: request.city, country: request.country }, i18n.language || "en")}</p>
                  {request.responsibleFirstName ? (
                    <p className="text-xs text-muted-foreground">{t("organizations.awaiting.responsible", { name: `${request.responsibleFirstName} ${request.responsibleLastName ?? ""}`.trim() })}</p>
                  ) : null}
                  {request.status === "DECLINED" && request.declineReason ? <p className="mt-1 text-xs">{t("organizations.awaiting.reason", { reason: request.declineReason })}</p> : null}
                </div>
                <span className="flex items-center gap-2">
                  <Badge variant="muted">{t(request.status === "PENDING" ? "organizations.requests.waiting" : "organizations.requests.declined")}</Badge>
                  {request.status === "PENDING" ? (
                    <ConfirmButton
                      label={t("organizations.requests.withdraw")}
                      confirmLabel={t("organizations.requests.confirmWithdraw")}
                      busyLabel={t("organizations.requests.withdrawing")}
                      cancelLabel={t("admin.cancel")}
                      busy={false}
                      onConfirm={() => withdraw(request.id)}
                    />
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {requests && waiting.length === 0 ? (
          <div className="flex flex-col gap-4" data-testid="awaiting-approval-ask-again">
            <OrganizationFields value={draft} onChange={change} idPrefix="ask-again" looksLike={looksLike} duplicateNote={duplicateNote} onDuplicateNoteChange={setDuplicateNote} suggest={suggest} />
            <Button className="self-start" disabled={busy || !ready} onClick={() => void send()} data-testid="awaiting-approval-send">
              {busy ? t("organizations.requests.sending") : t("organizations.requests.send")}
            </Button>
          </div>
        ) : null}
        {error ? <FieldError>{error}</FieldError> : null}
        <p className="text-xs text-muted-foreground">{t("organizations.awaiting.invited")}</p>
      </CardContent>
    </Card>
  );
}
