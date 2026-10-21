import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";

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
      await apiClient.adminSaveAuthConfig({
        resendApiKey: resendApiKey.trim() || undefined,
        emailFrom: emailFrom.trim() || undefined,
      });
      setResendApiKey("");
      await router.invalidate();
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingEmail(false);
    }
  }

  async function clearEmail() {
    setClearingEmail(true);
    try {
      await apiClient.adminClearAuthEmailConfig();
      setEmailFrom("");
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
            <span className="text-muted-foreground">{sourceLabel(t, summary.emailSource)}</span>
          </p>

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

          {emailError ? <p className="text-sm text-destructive">{emailError}</p> : null}

          <div className="flex items-center justify-between">
            <Button onClick={() => void saveEmail()} disabled={savingEmail}>
              {savingEmail ? t("admin.authSaving") : t("admin.authSaveConfig")}
            </Button>
            {summary.hasDatabaseResendKey ? (
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

          {googleError ? <p className="text-sm text-destructive">{googleError}</p> : null}

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
