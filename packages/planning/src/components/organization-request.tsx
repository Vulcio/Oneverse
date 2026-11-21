import { ApiError, type OrganizationLookalike, type OrganizationRequestView } from "@oneverse/core";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { OrganizationFields, countryFromLocale, emptyOrganizationDraft, organizationDraftBody, organizationDraftReady, type OrganizationDraft } from "@oneverse/ui/components/organization-fields";
import { usePlanning } from "../host";
import { FieldError } from "@oneverse/ui/components/field";

/**
 * Asking for an organisation (issue #364): what it is, where, and who to
 * reach about it, reviewed by this server's admins. One that looks like an
 * organisation already here, or one someone asked for, is shown and sent
 * only with a word on why it isn't the same.
 */
export function RequestOrganizationCard({ initial }: { initial: OrganizationRequestView[] }) {
  const { api } = usePlanning();
  const { t, i18n } = useTranslation();
  const suggest = useCallback((q: string, country: string) => api.addressSuggestions(q, country || undefined, i18n.language?.split("-")[0]), [api, i18n.language]);
  const [requests, setRequests] = useState(initial);
  // Its address and the person responsible too (issue #533).
  const [draft, setDraft] = useState<OrganizationDraft>(() => emptyOrganizationDraft(countryFromLocale(typeof navigator === "undefined" ? i18n.language : navigator.language)));
  const [contact, setContact] = useState({ contactName: "", contactEmail: "" });
  const [looksLike, setLooksLike] = useState<OrganizationLookalike[] | null>(null);
  const [duplicateNote, setDuplicateNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = (next: OrganizationDraft) => {
    // Another name or address: what it looks like is asked again.
    if (next.name !== draft.name || next.city !== draft.city || next.street !== draft.street || next.postalCode !== draft.postalCode || next.country !== draft.country) setLooksLike(null);
    setDraft(next);
  };
  const setContactField = (field: keyof typeof contact) => (event: { target: { value: string } }) => setContact((before) => ({ ...before, [field]: event.target.value }));
  const alreadyHere = !!looksLike?.some((one) => one.match === "same");
  const ready = organizationDraftReady(draft) && contact.contactName.trim().length >= 2 && contact.contactEmail.includes("@") && !alreadyHere && (!looksLike || duplicateNote.trim().length >= 5);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const made = await api.requestOrganization({
        ...organizationDraftBody(draft),
        contactName: contact.contactName,
        contactEmail: contact.contactEmail,
        ...(looksLike ? { duplicateNote } : {}),
      });
      setRequests((before) => [made, ...before]);
      setDraft(emptyOrganizationDraft(draft.country));
      setContact({ contactName: "", contactEmail: "" });
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
      setRequests((before) => before.filter((one) => one.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {requests.length > 0 ? (
        <Card data-testid="my-organization-requests">
          <CardHeader>
            <CardTitle className="text-sm">{t("organizations.requests.mine")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {requests.map((request) => (
              <div key={request.id} className="flex flex-wrap items-center justify-between gap-2" data-request={request.id}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {request.name} <span className="font-normal text-muted-foreground">· {request.city}</span>
                  </p>
                  {request.status === "DECLINED" && request.declineReason ? <p className="text-xs text-muted-foreground">{request.declineReason}</p> : null}
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
          </CardContent>
        </Card>
      ) : null}
      <Card className="max-w-lg" data-testid="organization-request-form">
        <CardHeader>
          <CardTitle className="text-sm">{t("organizations.requests.title")}</CardTitle>
          <CardDescription>{t("organizations.requests.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <OrganizationFields value={draft} onChange={change} idPrefix="request" looksLike={looksLike} duplicateNote={duplicateNote} onDuplicateNoteChange={setDuplicateNote} suggest={suggest} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="request-contact-name">{t("organizations.requests.contactName")}</Label>
              <Input id="request-contact-name" value={contact.contactName} maxLength={100} onChange={setContactField("contactName")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="request-contact-email">{t("organizations.requests.contactEmail")}</Label>
              <Input id="request-contact-email" type="email" value={contact.contactEmail} maxLength={320} onChange={setContactField("contactEmail")} />
            </div>
          </div>
          <span className="-mt-2 text-xs text-muted-foreground">{t("organizations.requests.contactHint")}</span>
          {error ? (
            <FieldError>
              {error}
            </FieldError>
          ) : null}
          <Button className="self-start" disabled={busy || !ready} onClick={() => void send()} data-testid="organization-request-send">
            {busy ? t("organizations.requests.sending") : t("organizations.requests.send")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
