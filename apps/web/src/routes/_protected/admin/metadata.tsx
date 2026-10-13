import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import type { AdminCommandResult, ArtistSettings, ArtworkSettings } from "@songverse/core";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { ConfirmButton } from "#/components/confirm-button";
import { BackgroundJobsCard } from "./-background-jobs";
import { MetadataProvidersCard, YouTubeCard } from "./-metadata-providers";

export const Route = createFileRoute("/_protected/admin/metadata")({
  component: AdminMetadataPage,
});

function ResultPanel({ result }: { result: AdminCommandResult | null }) {
  if (!result) return null;
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return (
    <div className="flex flex-col gap-1.5">
      <p className={`text-sm font-medium ${result.ok ? "text-foreground" : "text-destructive"}`}>
        {result.command} — {result.ok ? "done" : "failed"}
      </p>
      {output ? (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{output}</pre>
      ) : null}
    </div>
  );
}

function AdminMetadataPage() {
  const { t } = useTranslation();
  const [statusResult, setStatusResult] = useState<AdminCommandResult | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [seedResult, setSeedResult] = useState<AdminCommandResult | null>(null);
  const [seeding, setSeeding] = useState(false);

  async function checkStatus() {
    setCheckingStatus(true);
    try {
      setStatusResult(await apiClient.adminMigrationStatus());
    } finally {
      setCheckingStatus(false);
    }
  }

  async function runSeed() {
    setSeeding(true);
    try {
      setSeedResult(await apiClient.adminRunSeed());
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("nav.adminMetadata")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.description")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.serverAndApi")}</CardTitle>
          <CardDescription>{t("admin.serverAndApiDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t("admin.migrationStatus")}</p>
                <p className="text-sm text-muted-foreground">{t("admin.migrationStatusDescription")}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void checkStatus()} disabled={checkingStatus}>
                {checkingStatus ? t("admin.checking") : t("admin.checkStatus")}
              </Button>
            </div>
            <ResultPanel result={statusResult} />
          </div>

          <div className="flex flex-col gap-2 border-t pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t("admin.runSeed")}</p>
                <p className="text-sm text-muted-foreground">{t("admin.runSeedDescription")}</p>
              </div>
              <ConfirmButton
                label={t("admin.runSeed")}
                confirmLabel={t("admin.confirm")}
                busyLabel={t("admin.running")}
                cancelLabel={t("admin.cancel")}
                busy={seeding}
                onConfirm={runSeed}
              />
            </div>
            <ResultPanel result={seedResult} />
          </div>
        </CardContent>
      </Card>

      <BackgroundJobsCard />
      <MetadataProvidersCard />
      <YouTubeCard />
      <ArtworkSettingsCard />
      <ArtistSettingsCard />
    </div>
  );
}

/** Song artwork (issue #85): on or off, and finding it for songs without one; where it comes from is the providers' (issue #89). */
function ArtworkSettingsCard() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ArtworkSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const apply = (next: ArtworkSettings) => {
    setSettings(next);
    setEnabled(next.enabled);
  };
  useEffect(() => {
    apiClient.getArtworkSettings().then(apply).catch(() => {});
  }, []);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: "ok", text: await action() });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="artwork-settings">
      <CardHeader>
        <CardTitle className="text-sm">{t("artwork.adminTitle")}</CardTitle>
        <CardDescription>{t("artwork.adminDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {settings ? <p className="text-sm text-muted-foreground">{settings.source === "database" ? t("artwork.currentlyDatabase") : t("artwork.currentlyDefault")}</p> : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="size-4" />
          {t("artwork.enabled")}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                apply(await apiClient.saveArtworkSettings({ enabled }));
                return t("artwork.saved");
              })
            }
          >
            {t("artwork.save")}
          </Button>
          {settings?.source === "database" ? (
            <ConfirmButton
              label={t("artwork.revert")}
              confirmLabel={t("artwork.revertConfirm")}
              busyLabel={t("admin.running")}
              cancelLabel={t("admin.cancel")}
              busy={busy}
              onConfirm={() =>
                run(async () => {
                  apply(await apiClient.resetArtworkSettings());
                  return t("artwork.saved");
                })
              }
            />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !settings?.enabled}
            onClick={() =>
              void run(async () => {
                const { queued } = await apiClient.backfillArtwork();
                return queued ? t("jobs.started") : t("jobs.alreadyRunning");
              })
            }
          >
            {busy ? t("artwork.backfilling") : t("artwork.backfill")}
          </Button>
        </div>
        {message ? (
          <p className={`text-sm ${message.kind === "error" ? "text-destructive" : "text-muted-foreground"}`} role={message.kind === "error" ? "alert" : "status"}>
            {message.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Artist pictures and bios (issue #86): on or off, and looking up the artists not looked up yet. */
function ArtistSettingsCard() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ArtistSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const apply = (next: ArtistSettings) => {
    setSettings(next);
    setEnabled(next.enabled);
  };
  useEffect(() => {
    apiClient.getArtistSettings().then(apply).catch(() => {});
  }, []);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: "ok", text: await action() });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const currently = settings?.source === "database" ? "currentlyDatabase" : settings?.source === "env" ? "currentlyEnv" : "currentlyDefault";
  return (
    <Card data-testid="artist-settings">
      <CardHeader>
        <CardTitle className="text-sm">{t("artistSettings.title")}</CardTitle>
        <CardDescription>{t("artistSettings.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {settings ? <p className="text-sm text-muted-foreground">{t(`artistSettings.${currently}`)}</p> : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="size-4" />
          {t("artistSettings.enabled")}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                apply(await apiClient.saveArtistSettings(enabled));
                return t("artistSettings.saved");
              })
            }
          >
            {t("artistSettings.save")}
          </Button>
          {settings?.source === "database" ? (
            <ConfirmButton
              label={t("artistSettings.revert")}
              confirmLabel={t("artistSettings.revertConfirm")}
              busyLabel={t("admin.running")}
              cancelLabel={t("admin.cancel")}
              busy={busy}
              onConfirm={() =>
                run(async () => {
                  apply(await apiClient.resetArtistSettings());
                  return t("artistSettings.saved");
                })
              }
            />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !settings?.enabled}
            onClick={() =>
              void run(async () => {
                const { queued } = await apiClient.backfillArtists();
                return queued ? t("jobs.started") : t("jobs.alreadyRunning");
              })
            }
          >
            {busy ? t("artistSettings.backfilling") : t("artistSettings.backfill")}
          </Button>
        </div>
        {message ? (
          <p className={`text-sm ${message.kind === "error" ? "text-destructive" : "text-muted-foreground"}`} role={message.kind === "error" ? "alert" : "status"}>
            {message.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
