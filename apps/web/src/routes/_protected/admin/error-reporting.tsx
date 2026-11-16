import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SaveErrorReportingSettingsRequest } from "@oneverse/core";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { FieldError } from "@oneverse/ui/components/field";
import { toast } from "@oneverse/ui/components/toast";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/admin/error-reporting")({
  loader: () => apiClient.adminGetErrorReporting(),
  component: AdminErrorReportingPage,
});

/**
 * Admin > Error reporting (issue #469): where the API's, the Worker's and -
 * if ticked - the web apps' errors are reported, as a Sentry or GlitchTip
 * project's DSN. Nothing is sent without one. The ERROR_REPORTING_* env vars
 * set it too; a saved value wins.
 */
function AdminErrorReportingPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const summary = Route.useLoaderData();
  const { dsn, browsers, environment } = summary.settings;
  const [form, setForm] = useState({ dsn: dsn.value ?? "", browsers: browsers.value, environment: environment.value ?? "" });
  useEffect(() => setForm({ dsn: dsn.value ?? "", browsers: browsers.value, environment: environment.value ?? "" }), [summary]);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, busy: (value: boolean) => void) => {
    busy(true);
    setError(null);
    try {
      await action();
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busy(false);
    }
  };

  // Only what changed is saved: a value from an env var stays the env var's.
  const changes = (): SaveErrorReportingSettingsRequest => ({
    ...(form.dsn.trim() !== (dsn.value ?? "") && { dsn: form.dsn.trim() }),
    ...(form.browsers !== browsers.value && { browsers: form.browsers }),
    ...(form.environment.trim() !== (environment.value ?? "") && { environment: form.environment.trim() || null }),
  });

  const sourceOf = (setting: { source: string; env: string }) =>
    setting.source === "database" ? t("admin.securityFromDatabase") : setting.source === "env" ? t("admin.securityFromEnv", { name: setting.env }) : t("admin.securityFromDefault", { name: setting.env });

  async function sendTest() {
    setTesting(true);
    setError(null);
    try {
      const { sent } = await apiClient.adminTestErrorReporting();
      if (sent) toast.success(t("admin.errorReportingTestSent"));
      else setError(t("admin.errorReportingTestFailed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("admin.errorReportingTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.errorReportingDescription")}</p>
        <p className="mt-2 text-xs" data-testid="error-reporting-source">
          <span className="font-medium">{t("admin.authSource")}: </span>
          <span className="text-muted-foreground">
            {summary.source === "database" ? t("admin.authSourceDatabase") : summary.source === "env" ? t("admin.authSourceEnv") : t("admin.authSourceNone")}
          </span>
        </p>
        <p className="mt-1 text-xs font-medium" data-testid="error-reporting-state" data-on={summary.on}>
          {summary.on ? t("admin.errorReportingOn") : t("admin.errorReportingOff")}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.errorReportingWhere")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="error-reporting-dsn">{t("admin.errorReportingDsn")}</Label>
            <Input
              id="error-reporting-dsn"
              value={form.dsn}
              onChange={(event) => setForm({ ...form, dsn: event.target.value })}
              placeholder="https://key@glitchtip.example.org/1"
              autoComplete="off"
              spellCheck={false}
              data-testid="error-reporting-dsn"
            />
            <p className="text-xs text-muted-foreground">{t("admin.errorReportingDsnHint")}</p>
            <p className="text-xs text-muted-foreground">{sourceOf(dsn)}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="error-reporting-environment">{t("admin.errorReportingEnvironment")}</Label>
            <Input id="error-reporting-environment" value={form.environment} onChange={(event) => setForm({ ...form, environment: event.target.value })} placeholder="production" data-testid="error-reporting-environment" />
            <p className="text-xs text-muted-foreground">{t("admin.errorReportingEnvironmentHint")}</p>
            <p className="text-xs text-muted-foreground">{sourceOf(environment)}</p>
          </div>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 size-4" checked={form.browsers} onChange={(event) => setForm({ ...form, browsers: event.target.checked })} data-testid="error-reporting-browsers" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t("admin.errorReportingBrowsers")}</span>
              <span className="text-xs text-muted-foreground">{t("admin.errorReportingBrowsersHint")}</span>
              <span className="text-xs text-muted-foreground">{sourceOf(browsers)}</span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">{t("admin.errorReportingPrivacy")}</p>
        </CardContent>
      </Card>
      {error ? <FieldError>{error}</FieldError> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void run(() => apiClient.adminSaveErrorReporting(changes()), setSaving)} disabled={saving} data-testid="error-reporting-save">
            {saving ? t("admin.authSaving") : t("admin.authSaveConfig")}
          </Button>
          {summary.on ? (
            <Button variant="outline" onClick={() => void sendTest()} disabled={testing} data-testid="error-reporting-test">
              {testing ? t("admin.errorReportingTesting") : t("admin.errorReportingTest")}
            </Button>
          ) : null}
        </div>
        {summary.source === "database" ? (
          <ConfirmButton
            label={t("admin.authClearConfig")}
            confirmLabel={t("admin.authConfirmClear")}
            busyLabel={t("admin.authClearing")}
            cancelLabel={t("admin.cancel")}
            busy={clearing}
            onConfirm={() => run(() => apiClient.adminClearErrorReporting(), setClearing)}
          />
        ) : null}
      </div>
    </div>
  );
}
