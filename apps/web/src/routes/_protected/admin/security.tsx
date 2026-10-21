import type { SaveSecuritySettingsRequest, SecuritySetting } from "@oneverse/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/admin/security")({
  loader: () => apiClient.adminGetSecuritySettings(),
  component: AdminSecurityPage,
});

type NumberKey = "rateLimitPerMinute" | "rateLimitAnonymousPerMinute" | "rateLimitHeavyPerMinute" | "trustedProxies";
const NUMBERS: NumberKey[] = ["rateLimitPerMinute", "rateLimitAnonymousPerMinute", "rateLimitHeavyPerMinute", "trustedProxies"];

/**
 * Admin > Security (issue #113): the API's rate limits - per signed-in
 * user, per address before sign-in, and on the expensive routes - the
 * proxies whose client addresses it trusts, and who reads its docs. Each
 * setting says where it comes from; saved ones win over the environment.
 */
function AdminSecurityPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const summary = Route.useLoaderData();
  const { settings } = summary;
  const initial = () => ({
    rateLimitEnabled: settings.rateLimitEnabled.value,
    apiDocsPublic: settings.apiDocsPublic.value,
    contentSecurityPolicy: settings.contentSecurityPolicy.value,
    ...Object.fromEntries(NUMBERS.map((key) => [key, String(settings[key].value)])),
  }) as { rateLimitEnabled: boolean; apiDocsPublic: boolean; contentSecurityPolicy: "ENFORCE" | "REPORT_ONLY" | "OFF" } & Record<NumberKey, string>;
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial()), [summary]);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceOf = (setting: SecuritySetting<unknown>) =>
    setting.source === "database" ? t("admin.securityFromDatabase") : setting.source === "env" ? t("admin.securityFromEnv", { name: setting.env }) : t("admin.securityFromDefault", { name: setting.env });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Only what changed: the rest keeps coming from where it does.
      const change: SaveSecuritySettingsRequest = {};
      if (form.rateLimitEnabled !== settings.rateLimitEnabled.value) change.rateLimitEnabled = form.rateLimitEnabled;
      if (form.apiDocsPublic !== settings.apiDocsPublic.value) change.apiDocsPublic = form.apiDocsPublic;
      if (form.contentSecurityPolicy !== settings.contentSecurityPolicy.value) change.contentSecurityPolicy = form.contentSecurityPolicy;
      for (const key of NUMBERS) if (Number(form[key]) !== settings[key].value) change[key] = Number(form[key]);
      await apiClient.adminSaveSecuritySettings(change);
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setClearing(true);
    try {
      await apiClient.adminClearSecuritySettings();
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }

  const toggle = (key: "rateLimitEnabled" | "apiDocsPublic", label: string, hint: string) => (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="mt-1 size-4" checked={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} data-testid={`security-${key}`} />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
        <span className="text-xs text-muted-foreground">{sourceOf(settings[key])}</span>
      </span>
    </label>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("admin.securityTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.securityDescription")}</p>
        <p className="mt-2 text-xs" data-testid="security-source">
          <span className="font-medium">{t("admin.authSource")}: </span>
          <span className="text-muted-foreground">
            {summary.source === "database" ? t("admin.authSourceDatabase") : summary.source === "env" ? t("admin.authSourceEnv") : t("admin.securitySourceDefaults")}
          </span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.securityRateLimits")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {toggle("rateLimitEnabled", t("admin.securityRateLimitEnabled"), t("admin.securityRateLimitEnabledHint"))}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {NUMBERS.map((key) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label htmlFor={`security-${key}`}>{t(`admin.security_${key}`)}</Label>
                <Input id={`security-${key}`} type="number" min={0} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="max-w-40" />
                <span className="text-xs text-muted-foreground">{t(`admin.security_${key}Hint`)}</span>
                <span className="text-xs text-muted-foreground">{sourceOf(settings[key])}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.securityApiDocs")}</CardTitle>
        </CardHeader>
        <CardContent>{toggle("apiDocsPublic", t("admin.securityApiDocsPublic"), t("admin.securityApiDocsPublicHint"))}</CardContent>
      </Card>

      {/* The web app's Content-Security-Policy (issue #114). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.securityCsp")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <Label htmlFor="security-csp">{t("admin.securityCspMode")}</Label>
          <NativeSelect
            id="security-csp"
            value={form.contentSecurityPolicy}
            onChange={(event) => setForm({ ...form, contentSecurityPolicy: event.target.value as typeof form.contentSecurityPolicy })}
            className="w-full max-w-xs"
          >
            <option value="ENFORCE">{t("admin.securityCspEnforce")}</option>
            <option value="REPORT_ONLY">{t("admin.securityCspReportOnly")}</option>
            <option value="OFF">{t("admin.securityCspOff")}</option>
          </NativeSelect>
          <span className="text-xs text-muted-foreground">{t("admin.securityCspHint")}</span>
          <span className="text-xs text-muted-foreground">{sourceOf(settings.contentSecurityPolicy)}</span>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center justify-between">
        <Button onClick={() => void save()} disabled={saving} data-testid="security-save">
          {saving ? t("admin.authSaving") : t("admin.authSaveConfig")}
        </Button>
        {summary.source === "database" ? (
          <ConfirmButton
            label={t("admin.authClearConfig")}
            confirmLabel={t("admin.authConfirmClear")}
            busyLabel={t("admin.authClearing")}
            cancelLabel={t("admin.cancel")}
            busy={clearing}
            onConfirm={clear}
          />
        ) : null}
      </div>
    </div>
  );
}
