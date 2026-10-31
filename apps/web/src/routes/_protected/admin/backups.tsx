import type { BackupRun, BackupSummary, SaveBackupConfigRequest, SecuritySetting } from "@oneverse/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { formatBytes } from "#/lib/format-bytes";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";

export const Route = createFileRoute("/_protected/admin/backups")({
  loader: () => apiClient.adminGetBackups(),
  component: AdminBackupsPage,
});

type NumberKey = "hourUtc" | "keepDaily" | "keepWeekly" | "keepMonthly" | "fileRetentionDays";
const NUMBERS: NumberKey[] = ["hourUtc", "keepDaily", "keepWeekly", "keepMonthly", "fileRetentionDays"];
const LIMITS: Record<NumberKey, [number, number]> = { hourUtc: [0, 23], keepDaily: [1, 365], keepWeekly: [0, 520], keepMonthly: [0, 240], fileRetentionDays: [0, 3650] };

/**
 * Admin > Backups (issue #119): where the Worker copies the database and the
 * stored files each night, when, how long they're kept, "Back up now", and
 * how the last runs went. Saved settings win over the BACKUP_* env vars.
 */
function AdminBackupsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const loaded = Route.useLoaderData();
  const [summary, setSummary] = useState<BackupSummary>(loaded);
  useEffect(() => setSummary(loaded), [loaded]);
  const { settings, saved, destination } = summary;

  // From what was loaded, not the state: after a save, the new values fill the form.
  const initial = ({ saved, settings }: BackupSummary = loaded) => ({
    endpoint: saved.endpoint ?? "",
    region: saved.region ?? "",
    bucket: saved.bucket ?? "",
    prefix: saved.prefix ?? "",
    accessKeyId: "",
    secretAccessKey: "",
    enabled: settings.enabled.value,
    ...(Object.fromEntries(NUMBERS.map((key) => [key, String(settings[key].value)])) as Record<NumberKey, string>),
  });
  const [form, setForm] = useState(() => initial(loaded));
  useEffect(() => setForm(initial(loaded)), [loaded]);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While a backup runs, its row is refreshed every few seconds.
  const running = summary.runs.some((run) => run.status === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void apiClient.adminGetBackups().then(setSummary, () => undefined), 3000);
    return () => clearInterval(timer);
  }, [running]);

  const sourceOf = (setting: SecuritySetting<unknown>) =>
    setting.source === "database" ? t("admin.securityFromDatabase") : setting.source === "env" ? t("admin.securityFromEnv", { name: setting.env }) : t("admin.securityFromDefault", { name: setting.env });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Only what changed: the rest keeps coming from where it does; a blank secret keeps the saved one.
      const change: SaveBackupConfigRequest = {};
      for (const key of ["endpoint", "region", "bucket", "prefix"] as const) if (form[key].trim() !== (saved[key] ?? "")) change[key] = form[key].trim();
      if (form.accessKeyId.trim()) change.accessKeyId = form.accessKeyId.trim();
      if (form.secretAccessKey.trim()) change.secretAccessKey = form.secretAccessKey.trim();
      if (form.enabled !== settings.enabled.value) change.enabled = form.enabled;
      for (const key of NUMBERS) if (Number(form[key]) !== settings[key].value) change[key] = Number(form[key]);
      await apiClient.adminSaveBackupConfig(change);
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
      await apiClient.adminClearBackupConfig();
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }

  async function backUpNow() {
    setStarting(true);
    setError(null);
    try {
      await apiClient.adminRunBackup();
      // The Worker picks it up: show its row as soon as it's there.
      for (let i = 0; i < 10; i++) {
        const next = await apiClient.adminGetBackups();
        setSummary(next);
        if (next.runs[0] && next.runs[0].id !== summary.runs[0]?.id) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  const valid = NUMBERS.every((key) => {
    const value = Number(form[key]);
    return form[key].trim() !== "" && Number.isInteger(value) && value >= LIMITS[key][0] && value <= LIMITS[key][1];
  });
  const lastOk = summary.runs.find((run) => run.status === "ok");
  const where =
    destination.kind === "s3"
      ? t("backups.whereBucket", { bucket: destination.bucket, prefix: destination.prefix ? `/${destination.prefix}` : "", endpoint: destination.endpoint ?? t("backups.defaultEndpoint") })
      : destination.kind === "dir"
        ? t("backups.whereDir", { dir: destination.dir })
        : t("backups.whereNone");

  const textField = (key: "endpoint" | "region" | "bucket" | "prefix", placeholder?: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`backup-${key}`}>{t(`backups.${key}`)}</Label>
      <Input id={`backup-${key}`} value={form[key]} placeholder={placeholder} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("nav.adminBackups")}</h1>
        <p className="text-sm text-muted-foreground">{t("backups.description")}</p>
        <p className="mt-2 text-xs" data-testid="backups-source">
          <span className="font-medium">{t("admin.storageConfigSource")}: </span>
          <span className="text-muted-foreground">
            {destination.source === "database" ? t("backups.sourceDatabase") : destination.source === "env" ? t("backups.sourceEnv") : t("backups.sourceNone")}
          </span>
        </p>
      </div>

      <Card data-testid="backups-status">
        <CardHeader>
          <CardTitle className="text-sm">{t("backups.statusTitle")}</CardTitle>
          <CardDescription>{where}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {destination.kind === "none" ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">{t("backups.noneWarning")}</p>
          ) : !settings.enabled.value ? (
            <p className="text-destructive">{t("backups.off")}</p>
          ) : (
            <p>{t("backups.nightly", { hour: String(settings.hourUtc.value).padStart(2, "0") })}</p>
          )}
          <p className="text-muted-foreground">
            {lastOk ? t("backups.lastOk", { when: new Date(lastOk.finishedAt ?? lastOk.startedAt).toLocaleString() }) : t("backups.neverOk")}
          </p>
          <p className="text-xs text-muted-foreground">{t("backups.keysWarning")}</p>
          <div>
            <Button onClick={() => void backUpNow()} disabled={starting || running || destination.kind === "none"} data-testid="backup-now">
              {running ? t("backups.running") : starting ? t("backups.starting") : t("backups.backUpNow")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("backups.destinationTitle")}</CardTitle>
          <CardDescription>{t("backups.destinationDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {textField("endpoint", t("backups.endpointPlaceholder"))}
          {textField("region", "auto")}
          {textField("bucket", "oneverse-backups")}
          {textField("prefix", t("backups.prefixPlaceholder"))}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="backup-access-key-id">{t("admin.storageAccessKeyId")}</Label>
            <Input id="backup-access-key-id" value={form.accessKeyId} onChange={(event) => setForm({ ...form, accessKeyId: event.target.value })} placeholder={saved.accessKeyIdMasked ?? t("admin.storageRequired")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="backup-secret-access-key">{t("admin.storageSecretAccessKey")}</Label>
            <Input
              id="backup-secret-access-key"
              type="password"
              value={form.secretAccessKey}
              onChange={(event) => setForm({ ...form, secretAccessKey: event.target.value })}
              placeholder={saved.hasDatabaseSecret ? t("admin.storageLeaveBlankToKeep") : t("admin.storageRequired")}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("backups.scheduleTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 size-4" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} data-testid="backup-enabled" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t("backups.enabled")}</span>
              <span className="text-xs text-muted-foreground">{sourceOf(settings.enabled)}</span>
            </span>
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {NUMBERS.map((key) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label htmlFor={`backup-${key}`}>{t(`backups.${key}`)}</Label>
                <Input id={`backup-${key}`} type="number" min={LIMITS[key][0]} max={LIMITS[key][1]} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="max-w-40" />
                <span className="text-xs text-muted-foreground">{sourceOf(settings[key])}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center justify-between">
        <Button onClick={() => void save()} disabled={saving || !valid} data-testid="backups-save">
          {saving ? t("admin.authSaving") : t("admin.authSaveConfig")}
        </Button>
        {summary.hasDatabaseConfig ? (
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

      <Card data-testid="backup-runs">
        <CardHeader>
          <CardTitle className="text-sm">{t("backups.runsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("backups.noRuns")}</p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {summary.runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RunRow({ run }: { run: BackupRun }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0" data-testid="backup-run" data-status={run.status}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={run.status === "failed" ? "font-medium text-destructive" : "font-medium"}>{t(`backups.status_${run.status}`)}</span>
        <span className="text-xs text-muted-foreground">
          {new Date(run.startedAt).toLocaleString()} · {t(`backups.trigger_${run.trigger}`)}
        </span>
      </div>
      {run.status === "failed" && run.error ? <span className="text-xs text-destructive">{run.error}</span> : null}
      {run.databaseBytes !== null ? (
        <span className="text-xs text-muted-foreground">
          {t("backups.runDetails", { database: formatBytes(run.databaseBytes), copied: run.filesCopied, bytes: formatBytes(run.filesBytes), kept: run.filesKept })}
          {run.filesMissing > 0 ? ` · ${t("backups.runMissing", { count: run.filesMissing })}` : ""}
          {run.filesRemoved + run.dumpsRemoved > 0 ? ` · ${t("backups.runRemoved", { files: run.filesRemoved, dumps: run.dumpsRemoved })}` : ""}
        </span>
      ) : null}
    </li>
  );
}
