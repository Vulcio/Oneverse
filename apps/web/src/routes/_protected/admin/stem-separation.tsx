import type { SaveStemSeparationSettingsRequest, StemSeparationTest } from "@songverse/core";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@songverse/ui/components/confirm-button";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/admin/stem-separation")({
  loader: async () => {
    const [summary, servers] = await Promise.all([apiClient.adminGetStemSeparation(), apiClient.adminListSonicServers()]);
    return { summary, servers };
  },
  component: AdminStemSeparationPage,
});

/**
 * Admin > Stem separation (issue #63): the instance's Songverse Sonic
 * server recordings are split on - its address, key and models, a monthly
 * limit - and who may use it: whoever has a role that allows it (Admin >
 * Roles, issue #160). It's optional: teams and organisations may connect
 * their own when allowed here (issue #300), listed below.
 */
function AdminStemSeparationPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { summary, servers } = Route.useLoaderData();
  const initial = () => ({
    apiUrl: summary.apiUrl ?? "",
    apiKey: "",
    fastModel: summary.fastModel,
    hqModel: summary.hqModel,
    hqEnabled: summary.hqEnabled,
    monthlyLimit: summary.monthlyLimit === null ? "" : String(summary.monthlyLimit),
    ownServers: summary.ownServers,
    ownServersPrivate: summary.ownServersPrivate,
  });
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial()), [summary]);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<StemSeparationTest | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, setBusy: (busy: boolean) => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await router.invalidate();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function save() {
    // Only what changed: the rest keeps coming from where it does. The key is sent only when one's typed.
    const change: SaveStemSeparationSettingsRequest = {};
    if (form.apiUrl.trim() !== (summary.apiUrl ?? "")) change.apiUrl = form.apiUrl.trim() || null;
    if (form.apiKey) change.apiKey = form.apiKey;
    if (form.fastModel.trim() !== summary.fastModel) change.fastModel = form.fastModel.trim() || null;
    if (form.hqModel.trim() !== summary.hqModel) change.hqModel = form.hqModel.trim() || null;
    if (form.hqEnabled !== summary.hqEnabled) change.hqEnabled = form.hqEnabled;
    const limit = form.monthlyLimit.trim() ? Number(form.monthlyLimit) : null;
    if (limit !== summary.monthlyLimit) change.monthlyLimit = limit;
    if (form.ownServers !== summary.ownServers) change.ownServers = form.ownServers;
    if (form.ownServersPrivate !== summary.ownServersPrivate) change.ownServersPrivate = form.ownServersPrivate;
    void run(() => apiClient.adminSaveStemSeparation(change), setSaving);
  }

  async function testConnection() {
    setTesting(true);
    setTest(null);
    try {
      setTest(await apiClient.adminTestStemSeparation());
    } catch (err) {
      setTest({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("admin.stemTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.stemDescription")}</p>
        <p className="mt-2 text-xs" data-testid="stem-source">
          <span className="font-medium">{t("admin.authSource")}: </span>
          <span className="text-muted-foreground">
            {summary.source === "database" ? t("admin.authSourceDatabase") : summary.source === "env" ? t("admin.authSourceEnv") : t("admin.authSourceNone")}
          </span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.stemServer")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("admin.stemServerOptional")}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stem-api-url">{t("admin.stemApiUrl")}</Label>
            <Input id="stem-api-url" type="url" value={form.apiUrl} onChange={(event) => setForm({ ...form, apiUrl: event.target.value })} placeholder="https://demucs.example.com" />
            <span className="text-xs text-muted-foreground">{t("admin.stemApiUrlHint")}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stem-api-key">{t("admin.stemApiKey")}</Label>
            <Input
              id="stem-api-key"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              placeholder={summary.hasKey ? t("admin.stemApiKeyKeep") : ""}
            />
            <span className="text-xs text-muted-foreground">{t("admin.stemApiKeyNone")}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stem-fast-model">{t("admin.stemFastModel")}</Label>
              <Input id="stem-fast-model" value={form.fastModel} onChange={(event) => setForm({ ...form, fastModel: event.target.value })} className="max-w-60" />
              <span className="text-xs text-muted-foreground">{t("admin.stemFastModelHint")}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stem-hq-model">{t("admin.stemHqModel")}</Label>
              <Input id="stem-hq-model" value={form.hqModel} disabled={!form.hqEnabled} onChange={(event) => setForm({ ...form, hqModel: event.target.value })} className="max-w-60" />
              <span className="text-xs text-muted-foreground">{t("admin.stemHqModelHint")}</span>
            </div>
          </div>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 size-4" checked={form.hqEnabled} onChange={(event) => setForm({ ...form, hqEnabled: event.target.checked })} data-testid="stem-hq-enabled" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t("admin.stemHqEnabled")}</span>
              <span className="text-xs text-muted-foreground">{t("admin.stemHqEnabledHint")}</span>
            </span>
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stem-limit">{t("admin.stemMonthlyLimit")}</Label>
            <Input id="stem-limit" type="number" min={1} value={form.monthlyLimit} onChange={(event) => setForm({ ...form, monthlyLimit: event.target.value })} className="max-w-40" />
            <span className="text-xs text-muted-foreground">{t("admin.stemMonthlyLimitHint")}</span>
          </div>
          {summary.hasKey && !summary.signedCallbacks ? <p className="text-xs text-muted-foreground">{t("admin.stemUnsignedCallbacks")}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={() => void testConnection()} disabled={testing || !summary.apiUrl} data-testid="stem-test">
              {testing ? t("admin.stemTesting") : t("admin.stemTest")}
            </Button>
            {test ? (
              <span className={test.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"} data-testid="stem-test-result">
                {test.ok ? t("admin.stemTestOk", { models: test.models.models.join(", ") }) : t("admin.stemTestFailed", { error: test.error })}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.stemOwnTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 size-4" checked={form.ownServers} onChange={(event) => setForm({ ...form, ownServers: event.target.checked })} data-testid="stem-own-servers" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t("admin.stemOwnServers")}</span>
              <span className="text-xs text-muted-foreground">{t("admin.stemOwnServersHint")}</span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={form.ownServersPrivate}
              disabled={!form.ownServers}
              onChange={(event) => setForm({ ...form, ownServersPrivate: event.target.checked })}
              data-testid="stem-own-private"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t("admin.stemOwnPrivate")}</span>
              <span className="text-xs text-muted-foreground">{t("admin.stemOwnPrivateHint")}</span>
            </span>
          </label>
          <div className="flex flex-col gap-1.5" data-testid="stem-own-list">
            <span className="text-sm font-medium">{t("admin.stemOwnList")}</span>
            {servers.length === 0 ? (
              <span className="text-sm text-muted-foreground">{t("admin.stemOwnNone")}</span>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {servers.map((server) => (
                  <li key={server.id} className="flex flex-wrap items-baseline gap-x-2">
                    {server.owner.kind === "team" ? (
                      <Link to="/teams/$teamId" params={{ teamId: server.owner.id }} className="font-medium hover:underline">
                        {server.owner.name}
                      </Link>
                    ) : (
                      <Link to="/organizations/$organizationId" params={{ organizationId: server.owner.id }} className="font-medium hover:underline">
                        {server.owner.name}
                      </Link>
                    )}
                    <span className="truncate text-muted-foreground">{server.apiUrl}</span>
                    <span className="text-xs text-muted-foreground">{t("admin.stemOwnSeparations", { count: server.separations })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between">
        <Button onClick={save} disabled={saving} data-testid="stem-save">
          {saving ? t("admin.authSaving") : t("admin.authSaveConfig")}
        </Button>
        {summary.source === "database" ? (
          <ConfirmButton
            label={t("admin.authClearConfig")}
            confirmLabel={t("admin.authConfirmClear")}
            busyLabel={t("admin.authClearing")}
            cancelLabel={t("admin.cancel")}
            busy={clearing}
            onConfirm={async () => void (await run(() => apiClient.adminClearStemSeparation(), setClearing))}
          />
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.stemGrants")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("admin.stemGrantsByRole")}{" "}
            <Link to="/admin/roles" className="underline">
              {t("nav.adminRoles")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
