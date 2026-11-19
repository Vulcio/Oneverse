import type { OrganizationLookalike } from "@oneverse/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { FieldError } from "@oneverse/ui/components/field";
import { OrganizationFields, countryFromLocale, emptyOrganizationDraft, organizationDraftBody, organizationDraftReady, type OrganizationDraft } from "@oneverse/ui/components/organization-fields";
import { getApiUrl } from "../public-env";

/**
 * Signing up by asking for an organisation (issue #533), its first step:
 * the organisation, checked for look-alikes by the API, which keeps it for
 * the account made next (in a cookie, as an invitation's pass). Then the
 * account, by email or Google; it waits for a global admin's approval.
 */
export function OrganizationSignupStep({ draft, onDraftChange, onKept }: { draft: OrganizationDraft; onDraftChange: (draft: OrganizationDraft) => void; onKept: () => void }) {
  const { t } = useTranslation();
  const [looksLike, setLooksLike] = useState<OrganizationLookalike[] | null>(null);
  const [duplicateNote, setDuplicateNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alreadyHere = !!looksLike?.some((one) => one.match === "same");
  const ready = organizationDraftReady(draft) && !alreadyHere && (!looksLike || duplicateNote.trim().length >= 5);

  function change(next: OrganizationDraft) {
    if (next.name !== draft.name || next.city !== draft.city || next.street !== draft.street || next.postalCode !== draft.postalCode || next.country !== draft.country) setLooksLike(null);
    onDraftChange(next);
  }

  async function next() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${getApiUrl().replace(/\/$/, "")}/auth/organization-signup`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...organizationDraftBody(draft), ...(looksLike ? { duplicateNote } : {}) }),
      });
      if (response.ok) {
        onKept();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string | string[]; looksLike?: OrganizationLookalike[] };
      if ((body.code === "ORGANIZATION_LOOKS_LIKE" || body.code === "ORGANIZATION_EXISTS") && Array.isArray(body.looksLike)) setLooksLike(body.looksLike);
      else setError(Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? t("auth.somethingWentWrong")));
    } catch {
      setError(t("auth.somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="organization-signup-step">
      <p className="text-sm text-muted-foreground">{t("organizations.signup.hint")}</p>
      <OrganizationFields value={draft} onChange={change} idPrefix="signup-organization" looksLike={looksLike} duplicateNote={duplicateNote} onDuplicateNoteChange={setDuplicateNote} />
      {error ? <FieldError>{error}</FieldError> : null}
      <Button type="button" disabled={busy || !ready} onClick={() => void next()} data-testid="organization-signup-next">
        {busy ? t("organizations.signup.checking") : t("organizations.signup.next")}
      </Button>
    </div>
  );
}

/** A new draft, its country guessed from the browser's language. */
export function newOrganizationSignupDraft(): OrganizationDraft {
  return emptyOrganizationDraft(countryFromLocale(typeof navigator === "undefined" ? undefined : navigator.language));
}
