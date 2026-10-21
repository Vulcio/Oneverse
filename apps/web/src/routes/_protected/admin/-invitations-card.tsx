import type { SecuritySetting, SignupInvitationSummary } from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { apiClient } from "#/lib/api-client";

/**
 * Admin > Users' sign-up (issue #198): whether only invited people can
 * create an account - saved with the other security settings, so it has
 * their database / env var / default resolution - and the invitations.
 */
export function InvitationsCard({ inviteOnly, invitations }: { inviteOnly: SecuritySetting<boolean>; invitations: SignupInvitationSummary[] }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [send, setSend] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [created, setCreated] = useState<SignupInvitationSummary | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function setInviteOnly(value: boolean | null) {
    setSaving(true);
    await run(() => apiClient.adminSaveSecuritySettings({ signupInviteOnly: value }));
    setSaving(false);
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    setInviting(true);
    setCreated(null);
    await run(async () => {
      setCreated(await apiClient.adminCreateSignupInvitation({ email, send }));
      setEmail("");
    });
    setInviting(false);
  }

  async function copy(invitation: SignupInvitationSummary) {
    try {
      await navigator.clipboard.writeText(invitation.link);
      setCopied(invitation.id);
      setTimeout(() => setCopied((current) => (current === invitation.id ? null : current)), 2000);
    } catch {
      // Clipboard refused: the link is shown, to select by hand.
      setCreated(invitation);
    }
  }

  const source =
    inviteOnly.source === "database"
      ? t("admin.securityFromDatabase")
      : inviteOnly.source === "env"
        ? t("admin.securityFromEnv", { name: inviteOnly.env })
        : t("admin.securityFromDefault", { name: inviteOnly.env });
  const statusOf = (invitation: SignupInvitationSummary) =>
    invitation.acceptedAt ? "accepted" : new Date(invitation.expiresAt) <= new Date() ? "expired" : "pending";

  return (
    <Card data-testid="invitations-card">
      <CardHeader>
        <CardTitle className="text-sm">{t("admin.invitationsTitle")}</CardTitle>
        <CardDescription>{t("admin.invitationsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={inviteOnly.value}
              disabled={saving}
              onChange={(event) => void setInviteOnly(event.target.checked)}
              data-testid="signup-invite-only-toggle"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t("admin.signupInviteOnly")}</span>
              <span className="text-xs text-muted-foreground">{t("admin.signupInviteOnlyHint")}</span>
              <span className="text-xs text-muted-foreground">{source}</span>
            </span>
          </label>
          {inviteOnly.source === "database" ? (
            <Button type="button" variant="link" size="sm" className="self-start px-7 text-xs" disabled={saving} onClick={() => void setInviteOnly(null)}>
              {t("admin.signupInviteOnlyBackToEnv")}
            </Button>
          ) : null}
        </div>

        <form className="flex flex-col gap-2" onSubmit={invite} data-testid="invite-form">
          <Label htmlFor="invite-email">{t("admin.inviteEmail")}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input id="invite-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="max-w-xs" autoComplete="off" />
            <Button type="submit" disabled={inviting || !email}>
              {inviting ? t("admin.inviting") : t("admin.inviteSubmit")}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={send} onChange={(event) => setSend(event.target.checked)} />
            {t("admin.inviteSendEmail")}
          </label>
        </form>
        {created ? (
          <div className="flex flex-col gap-1 rounded-md border bg-muted/40 p-3 text-sm" data-testid="invite-created">
            <span>{t("admin.inviteCreated", { email: created.email })}</span>
            <code className="break-all text-xs select-all" data-testid="invite-link">
              {created.link}
            </code>
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.invitationsNone")}</p>
        ) : (
          <ul className="flex flex-col divide-y" data-testid="invitations-list">
            {invitations.map((invitation) => {
              const status = statusOf(invitation);
              return (
                <li key={invitation.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid={`invitation-${invitation.email}`} data-status={status}>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{invitation.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("admin.invitationBy", { name: invitation.invitedBy?.displayName ?? "-", date: new Date(invitation.createdAt).toLocaleDateString(i18n.language) })}
                    </span>
                  </div>
                  <span
                    className={
                      status === "accepted"
                        ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                        : status === "expired"
                          ? "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                          : "rounded-full border px-2 py-0.5 text-xs font-medium"
                    }
                  >
                    {t(status === "accepted" ? "admin.invitationAccepted" : status === "expired" ? "admin.invitationExpired" : "admin.invitationPending")}
                  </span>
                  {status === "pending" ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => void copy(invitation)}>
                      {copied === invitation.id ? t("admin.invitationCopied") : t("admin.invitationCopyLink")}
                    </Button>
                  ) : null}
                  {status !== "accepted" ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => void run(async () => setCreated(await apiClient.adminCreateSignupInvitation({ email: invitation.email, send: true })))}>
                      {t("admin.invitationResend")}
                    </Button>
                  ) : null}
                  <ConfirmButton
                    label={t("admin.invitationRemove")}
                    confirmLabel={t("admin.invitationConfirmRemove")}
                    busyLabel={t("admin.invitationRemoving")}
                    cancelLabel={t("admin.cancel")}
                    busy={removing === invitation.id}
                    onConfirm={async () => {
                      setRemoving(invitation.id);
                      await run(() => apiClient.adminDeleteSignupInvitation(invitation.id));
                      setRemoving(null);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
