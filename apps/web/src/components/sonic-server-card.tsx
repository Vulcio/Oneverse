import type { SaveSonicServerRequest, SonicServerOwnerRef, SonicServerSummary, StemSeparationTest } from "@oneverse/core";
import { AudioLines } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { apiClient } from "#/lib/api-client";
import { docsPageUrl } from "#/lib/docs";

/**
 * A team's or an organisation's own Songverse Sonic server (issue #300), on
 * its page for its admins: connecting it (its address and key, never shown
 * again), its finer pass and limit, Test connection, and disconnecting it.
 * Shown when Admin > Stem separation allows teams and organisations theirs
 * (or one is still connected from before).
 */
export function SonicServerCard({ owner }: { owner: SonicServerOwnerRef }) {
  const { t, i18n } = useTranslation();
  const [summary, setSummary] = useState<SonicServerSummary | null>(null);
  const [form, setForm] = useState({ apiUrl: "", apiKey: "", hqEnabled: true, monthlyLimit: "" });
  const [busy, setBusy] = useState<"save" | "remove" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<StemSeparationTest | null>(null);
  const key = JSON.stringify(owner);

  async function load() {
    const next = await apiClient.getSonicServer(owner);
    setSummary(next);
    setForm({ apiUrl: next.server?.apiUrl ?? "", apiKey: "", hqEnabled: next.server?.hqEnabled ?? true, monthlyLimit: next.server?.monthlyLimit == null ? "" : String(next.server.monthlyLimit) });
  }
  useEffect(() => {
    void load().catch(() => setSummary(null));
  }, [key]);

  // Nothing to say where Admin doesn't allow them, unless one's still connected from before.
  if (!summary || (!summary.allowed && !summary.server)) return null;
  const server = summary.server;

  async function act(kind: "save" | "remove" | "test", action: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function save() {
    // Only what changed; the key only when one's typed.
    const change: SaveSonicServerRequest = {};
    if (form.apiUrl.trim() !== (server?.apiUrl ?? "")) change.apiUrl = form.apiUrl.trim();
    if (form.apiKey) change.apiKey = form.apiKey;
    if (form.hqEnabled !== (server?.hqEnabled ?? true)) change.hqEnabled = form.hqEnabled;
    const limit = form.monthlyLimit.trim() ? Number(form.monthlyLimit) : null;
    if (limit !== (server?.monthlyLimit ?? null)) change.monthlyLimit = limit;
    void act("save", async () => {
      await apiClient.saveSonicServer(owner, change);
      setTest(null);
      await load();
    });
  }

  const testResult = (result: StemSeparationTest) =>
    result.ok
      ? `${t("sonicServer.testOk", { service: typeof result.health.service === "string" ? result.health.service : "Sonic", version: result.version ?? "", models: result.models.models.join(", ") })}${result.beats === false ? ` ${t("sonicServer.noBeats")}` : ""}`
      : t("admin.stemTestFailed", { error: result.error });

  return (
    <Card data-testid="sonic-server-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <AudioLines className="size-4 text-muted-foreground" aria-hidden />
          {t("sonicServer.title")}
        </CardTitle>
        <CardDescription>
          {t("teamId" in owner ? "sonicServer.descriptionTeam" : "sonicServer.descriptionOrganization")}{" "}
          <a href={docsPageUrl("sonic", i18n.language)} target="_blank" rel="noopener" className="underline">
            {t("sonicServer.howTo")}
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!summary.allowed ? (
          <p className="text-sm text-muted-foreground" data-testid="sonic-server-not-allowed">
            {t("sonicServer.notAllowed")}
          </p>
        ) : (
          <>
            {server ? (
              <p className="text-sm" data-testid="sonic-server-connected">
                {t("sonicServer.connected", { url: server.apiUrl })}
              </p>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sonic-api-url">{t("sonicServer.apiUrl")}</Label>
              <Input id="sonic-api-url" type="url" value={form.apiUrl} onChange={(event) => setForm({ ...form, apiUrl: event.target.value })} placeholder="https://sonic.example.org" data-testid="sonic-api-url" />
              <span className="text-xs text-muted-foreground">{t(summary.allowPrivate ? "sonicServer.apiUrlHintPrivate" : "sonicServer.apiUrlHint")}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sonic-api-key">{t("sonicServer.apiKey")}</Label>
              <Input
                id="sonic-api-key"
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                placeholder={server ? t("sonicServer.apiKeyKeep") : ""}
                data-testid="sonic-api-key"
              />
            </div>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 size-4" checked={form.hqEnabled} onChange={(event) => setForm({ ...form, hqEnabled: event.target.checked })} />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t("admin.stemHqEnabled")}</span>
                <span className="text-xs text-muted-foreground">{t("admin.stemHqEnabledHint")}</span>
              </span>
            </label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sonic-limit">{t("admin.stemMonthlyLimit")}</Label>
              <Input id="sonic-limit" type="number" min={1} value={form.monthlyLimit} onChange={(event) => setForm({ ...form, monthlyLimit: event.target.value })} className="max-w-40" />
              <span className="text-xs text-muted-foreground">{t("sonicServer.monthlyLimitHint")}</span>
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={save} disabled={busy !== null || (!server && (!form.apiUrl.trim() || !form.apiKey))} data-testid="sonic-save">
                {busy === "save" ? t("sonicServer.saving") : server ? t("sonicServer.save") : t("sonicServer.connect")}
              </Button>
              {server ? (
                <>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act("test", async () => setTest(await apiClient.testSonicServer(owner)))} data-testid="sonic-test">
                    {busy === "test" ? t("admin.stemTesting") : t("admin.stemTest")}
                  </Button>
                  <ConfirmButton
                    label={t("sonicServer.disconnect")}
                    confirmLabel={t("sonicServer.disconnectConfirm")}
                    busyLabel={t("sonicServer.disconnecting")}
                    cancelLabel={t("admin.cancel")}
                    busy={busy === "remove"}
                    onConfirm={async () =>
                      void (await act("remove", async () => {
                        await apiClient.removeSonicServer(owner);
                        setTest(null);
                        await load();
                      }))
                    }
                  />
                </>
              ) : null}
            </div>
            {test ? (
              <p className={test.ok && test.beats !== false ? "text-sm text-muted-foreground" : "text-sm text-destructive"} data-testid="sonic-test-result">
                {testResult(test)}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
