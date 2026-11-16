import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { FieldError } from "@oneverse/ui/components/field";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { toast } from "@oneverse/ui/components/toast";

export const Route = createFileRoute("/_protected/admin/auth")({
  loader: () => apiClient.adminGetAuthConfig(),
  component: AdminAuthPage,
});

function sourceLabel(t: (key: string) => string, source: "database" | "env" | "none"): string {
  return source === "database"
    ? t("admin.authSourceDatabase")
    : source === "env"
      ? t("admin.authSourceEnv")
      : t("admin.authSourceNone");
}

function AdminAuthPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const summary = Route.useLoaderData();

  const [resendApiKey, setResendApiKey] = useState("");
  const [emailFrom, setEmailFrom] = useState(summary.emailFrom);
  const [emailProvider, setEmailProvider] = useState(summary.emailProvider);
  const [smtpHost, setSmtpHost] = useState(summary.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(summary.smtpPort ? String(summary.smtpPort) : "");
  const [smtpSecure, setSmtpSecure] = useState(summary.smtpSecure ?? false);
  const [smtpUser, setSmtpUser] = useState(summary.smtpUser ?? "");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [clearingEmail, setClearingEmail] = useState(false);

  const [googleClientId, setGoogleClientId] = useState(summary.googleClientId ?? "");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [savingGoogle, setSavingGoogle] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [clearingGoogle, setClearingGoogle] = useState(false);

  async function saveEmail() {
    setSavingEmail(true);
    setEmailError(null);
    try {
      const port = smtpPort.trim() ? Number(smtpPort) : null;
      await apiClient.adminSaveAuthConfig({
        resendApiKey: resendApiKey.trim() || undefined,
        emailFrom: emailFrom.trim() || undefined,
        // Only what changed, so a value from the environment isn't copied into the database.
        ...(emailProvider !== summary.emailProvider && { emailProvider }),
        ...(emailProvider === "smtp" && {
          ...(smtpHost.trim() !== (summary.smtpHost ?? "") && { smtpHost: smtpHost.trim() }),
          ...(port !== summary.smtpPort && { smtpPort: port }),
          ...(smtpSecure !== (summary.smtpSecure ?? false) && { smtpSecure }),
          ...(smtpUser.trim() !== (summary.smtpUser ?? "") && { smtpUser: smtpUser.trim() }),
          smtpPassword: smtpPassword || undefined,
        }),
      });
      setResendApiKey("");
      setSmtpPassword("");
      await router.invalidate();
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingEmail(false);
    }
  }

  async function sendTestEmail() {
    setTestingEmail(true);
    setEmailError(null);
    try {
      const { sent, to } = await apiClient.adminSendTestEmail();
      if (sent) toast.success(t("admin.authTestEmailSent", { to }));
      else toast(t("admin.authTestEmailLogged"));
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingEmail(false);
    }
  }

  async function clearEmail() {
    setClearingEmail(true);
    try {
      await apiClient.adminClearAuthEmailConfig();
      setEmailFrom("");
      setSmtpHost("");
      setSmtpPort("");
      setSmtpUser("");
      await router.invalidate();
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearingEmail(false);
    }
  }

  async function saveGoogle() {
    setSavingGoogle(true);
    setGoogleError(null);
    try {
      await apiClient.adminSaveAuthConfig({
        googleClientId: googleClientId.trim() || undefined,
        googleClientSecret: googleClientSecret.trim() || undefined,
      });
      setGoogleClientSecret("");
      await router.invalidate();
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingGoogle(false);
    }
  }

  async function clearGoogle() {
    setClearingGoogle(true);
    try {
      await apiClient.adminClearAuthGoogleConfig();
      setGoogleClientId("");
      await router.invalidate();
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearingGoogle(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("nav.adminAuth")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.authDescription")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.authEmailTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("admin.authEmailDescription")}</p>
          <p className="text-xs">
            <span className="font-medium">{t("admin.authSource")}: </span>
            <span className="text-muted-foreground" data-testid="email-source">
              {sourceLabel(t, summary.emailSource)}
            </span>
          </p>

          {summary.emailConfigured ? null : (
            <p className="text-xs text-muted-foreground" data-testid="email-not-sending">
              {t("admin.authEmailNotSending")}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-provider">{t("admin.authEmailProvider")}</Label>
              <NativeSelect
                id="email-provider"
                value={emailProvider}
                onChange={(e) => setEmailProvider(e.target.value as "resend" | "smtp")}
                data-testid="email-provider"
              >
                <option value="resend">{t("admin.authEmailProviderResend")}</option>
                <option value="smtp">{t("admin.authEmailProviderSmtp")}</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-from">{t("admin.authEmailFrom")}</Label>
              <Input
                id="email-from"
                value={emailFrom}
                onChange={(e) => setEmailFrom(e.target.value)}
                placeholder="Songverse <onboarding@resend.dev>"
              />
            </div>
          </div>

          {emailProvider === "resend" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="resend-api-key">{t("admin.authResendApiKey")}</Label>
                <Input
                  id="resend-api-key"
                  type="password"
                  value={resendApiKey}
                  onChange={(e) => setResendApiKey(e.target.value)}
                  placeholder={summary.hasDatabaseResendKey ? t("admin.authLeaveBlankToKeep") : t("admin.authRequired")}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-muted-foreground">{t("admin.authSmtpHint")}</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_8rem]">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="smtp-host">{t("admin.authSmtpHost")}</Label>
                  <Input id="smtp-host" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" data-testid="smtp-host" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="smtp-port">{t("admin.authSmtpPort")}</Label>
                  <Input
                    id="smtp-port"
                    inputMode="numeric"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    placeholder={smtpSecure ? "465" : "587"}
                    data-testid="smtp-port"
                  />
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-4" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} data-testid="smtp-secure" />
                <span>
                  {t("admin.authSmtpSecure")}
                  <span className="block text-xs text-muted-foreground">{t("admin.authSmtpSecureHint")}</span>
                </span>
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="smtp-user">{t("admin.authSmtpUser")}</Label>
                  <Input id="smtp-user" autoComplete="off" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} data-testid="smtp-user" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="smtp-password">{t("admin.authSmtpPassword")}</Label>
                  <Input
                    id="smtp-password"
                    type="password"
                    autoComplete="new-password"
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
                    placeholder={summary.hasDatabaseSmtpPassword ? t("admin.authLeaveBlankToKeep") : undefined}
                    data-testid="smtp-password"
                  />
                </div>
              </div>
            </div>
          )}

          {emailError ? <FieldError>{emailError}</FieldError> : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void saveEmail()} disabled={savingEmail} data-testid="email-save">
                {savingEmail ? t("admin.authSaving") : t("admin.authSaveConfig")}
              </Button>
              <Button variant="outline" onClick={() => void sendTestEmail()} disabled={testingEmail} data-testid="email-test">
                {testingEmail ? t("admin.authSendingTestEmail") : t("admin.authSendTestEmail")}
              </Button>
            </div>
            {summary.emailSource === "database" ? (
              <ConfirmButton
                label={t("admin.authClearConfig")}
                confirmLabel={t("admin.authConfirmClear")}
                busyLabel={t("admin.authClearing")}
                cancelLabel={t("admin.cancel")}
                busy={clearingEmail}
                onConfirm={clearEmail}
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.authGoogleTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("admin.authGoogleDescription")}</p>
          <p className="text-xs">
            <span className="font-medium">{t("admin.authSource")}: </span>
            <span className="text-muted-foreground">{sourceLabel(t, summary.googleSource)}</span>
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="google-client-id">{t("admin.authGoogleClientId")}</Label>
              <Input id="google-client-id" value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="google-client-secret">{t("admin.authGoogleClientSecret")}</Label>
              <Input
                id="google-client-secret"
                type="password"
                value={googleClientSecret}
                onChange={(e) => setGoogleClientSecret(e.target.value)}
                placeholder={summary.hasDatabaseGoogleSecret ? t("admin.authLeaveBlankToKeep") : t("admin.authRequired")}
              />
            </div>
          </div>

          {googleError ? <FieldError>{googleError}</FieldError> : null}

          <div className="flex items-center justify-between">
            <Button onClick={() => void saveGoogle()} disabled={savingGoogle}>
              {savingGoogle ? t("admin.authSaving") : t("admin.authSaveConfig")}
            </Button>
            {summary.hasDatabaseGoogleSecret ? (
              <ConfirmButton
                label={t("admin.authClearConfig")}
                confirmLabel={t("admin.authConfirmClear")}
                busyLabel={t("admin.authClearing")}
                cancelLabel={t("admin.cancel")}
                busy={clearingGoogle}
                onConfirm={clearGoogle}
              />
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
