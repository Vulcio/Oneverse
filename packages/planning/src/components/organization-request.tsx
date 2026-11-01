import { ApiError, ORGANIZATION_KINDS, ORGANIZATION_SIZES, type OrganizationKind, type OrganizationLookalike, type OrganizationRequestView, type OrganizationSize } from "@oneverse/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Textarea } from "@oneverse/ui/components/textarea";
import { usePlanning } from "../host";

/**
 * Asking for an organisation (issue #364): what it is, where, and who to
 * reach about it, reviewed by this server's admins. One that looks like an
 * organisation already here, or one someone asked for, is shown and sent
 * only with a word on why it isn't the same.
 */
export function RequestOrganizationCard({ initial }: { initial: OrganizationRequestView[] }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [requests, setRequests] = useState(initial);
  const [form, setForm] = useState({ name: "", kind: "CHURCH" as OrganizationKind, city: "", contactName: "", contactEmail: "", website: "", peopleCount: "" as OrganizationSize | "", description: "" });
  const [looksLike, setLooksLike] = useState<OrganizationLookalike[] | null>(null);
  const [duplicateNote, setDuplicateNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm((before) => ({ ...before, [field]: event.target.value }));
    // Another name or city: what it looks like is asked again.
    if (field === "name" || field === "city") setLooksLike(null);
  };
  const ready = form.name.trim().length >= 2 && form.city.trim().length >= 2 && form.contactName.trim().length >= 2 && form.contactEmail.includes("@") && (!looksLike || duplicateNote.trim().length >= 5);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const made = await api.requestOrganization({
        name: form.name,
        kind: form.kind,
        city: form.city,
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        ...(form.website.trim() ? { website: form.website.trim() } : {}),
        ...(form.peopleCount ? { peopleCount: form.peopleCount } : {}),
        ...(form.description.trim() ? { description: form.description } : {}),
        ...(looksLike ? { duplicateNote } : {}),
      });
      setRequests((before) => [made, ...before]);
      setForm({ name: "", kind: "CHURCH", city: "", contactName: "", contactEmail: "", website: "", peopleCount: "", description: "" });
      setLooksLike(null);
      setDuplicateNote("");
    } catch (err) {
      if (err instanceof ApiError && err.code === "ORGANIZATION_LOOKS_LIKE" && Array.isArray(err.details?.looksLike)) setLooksLike(err.details.looksLike as OrganizationLookalike[]);
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-name">{t("organizations.name")}</Label>
            <Input id="request-name" value={form.name} maxLength={100} onChange={set("name")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="request-kind">{t("organizations.requests.kind")}</Label>
              <NativeSelect id="request-kind" value={form.kind} onChange={set("kind")}>
                {ORGANIZATION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`organizations.kinds.${kind}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="request-city">{t("organizations.requests.city")}</Label>
              <Input id="request-city" value={form.city} maxLength={100} onChange={set("city")} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="request-contact-name">{t("organizations.requests.contactName")}</Label>
              <Input id="request-contact-name" value={form.contactName} maxLength={100} onChange={set("contactName")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="request-contact-email">{t("organizations.requests.contactEmail")}</Label>
              <Input id="request-contact-email" type="email" value={form.contactEmail} maxLength={320} onChange={set("contactEmail")} />
            </div>
          </div>
          <span className="-mt-2 text-xs text-muted-foreground">{t("organizations.requests.contactHint")}</span>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="request-website">{t("organizations.requests.websiteOptional")}</Label>
              <Input id="request-website" type="url" placeholder="https://" value={form.website} maxLength={300} onChange={set("website")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="request-size">{t("organizations.requests.size")}</Label>
              <NativeSelect id="request-size" value={form.peopleCount} onChange={set("peopleCount")}>
                <option value="">-</option>
                {ORGANIZATION_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {t(`organizations.sizes.${size}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-description">{t("organizations.descriptionLabel")}</Label>
            <Textarea id="request-description" value={form.description} maxLength={500} onChange={set("description")} />
          </div>
          {looksLike ? (
            <div className="flex flex-col gap-2 rounded-md bg-amber-500/10 p-3 text-sm" data-testid="request-looks-like">
              <p className="font-medium">{t("organizations.requests.looksLikeYours")}</p>
              <ul className="list-disc pl-5 text-xs">
                {looksLike.map((one) => (
                  <li key={`${one.source}-${one.id}`}>
                    {one.name}
                    {one.city ? ` · ${one.city}` : ""} ({t(one.source === "organization" ? "organizations.requests.existing" : "organizations.requests.alsoAsked")})
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t("organizations.requests.looksLikeHint")}</p>
              <Label htmlFor="request-duplicate-note">{t("organizations.requests.duplicateNote")}</Label>
              <Textarea id="request-duplicate-note" value={duplicateNote} maxLength={500} onChange={(e) => setDuplicateNote(e.target.value)} />
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button className="self-start" disabled={busy || !ready} onClick={() => void send()} data-testid="organization-request-send">
            {busy ? t("organizations.requests.sending") : t("organizations.requests.send")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
