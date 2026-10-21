import { ATTACHMENT_TYPES, MAX_FILE_SIZE_LIMIT_MB, type FileSizeLimits, type SaveFileSizeLimitsRequest, type StorageLimits } from "@oneverse/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { formatBytes } from "#/lib/format-bytes";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";

export const Route = createFileRoute("/_protected/admin/storage")({
  loader: async () => {
    const [stats, config, limits, fileSizes] = await Promise.all([
      apiClient.adminStorageStats(),
      apiClient.adminGetStorageConfig(),
      apiClient.adminGetStorageLimits(),
      apiClient.adminGetFileSizeLimits(),
    ]);
    return { stats, config, limits, fileSizes };
  },
  component: AdminStoragePage,
});

function AdminStoragePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { stats, config, limits, fileSizes } = Route.useLoaderData();

  const [accountId, setAccountId] = useState(config.accountId ?? "");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [bucket, setBucket] = useState(config.bucket ?? "");
  const [endpoint, setEndpoint] = useState(config.endpoint ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  async function saveConfig() {
    setSaving(true);
    setSaveError(null);
    try {
      await apiClient.adminSaveStorageConfig({
        accountId: accountId.trim() || undefined,
        accessKeyId: accessKeyId.trim() || undefined,
        secretAccessKey: secretAccessKey.trim() || undefined,
        bucket: bucket.trim() || undefined,
        endpoint: endpoint.trim() || undefined,
      });
      setAccessKeyId("");
      setSecretAccessKey("");
      await router.invalidate();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function clearConfig() {
    setClearing(true);
    try {
      await apiClient.adminClearStorageConfig();
      setAccountId("");
      setBucket("");
      setEndpoint("");
      await router.invalidate();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("nav.adminStorage")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.storageDescription")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent>
            <p className="text-2xl font-semibold leading-none">
              {stats.driver === "s3" ? t("admin.storageDriverS3") : t("admin.storageDriverLocal")}
            </p>
            <p className="text-sm text-muted-foreground">{t("admin.storageDriver")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-2xl font-semibold leading-none">{stats.attachmentCount}</p>
            <p className="text-sm text-muted-foreground">{t("admin.storageAttachmentCount")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-2xl font-semibold leading-none">{formatBytes(stats.totalBytes)}</p>
            <p className="text-sm text-muted-foreground">{t("admin.storageTotalSize")}</p>
          </CardContent>
        </Card>
      </div>

      {stats.driver === "local" ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {t("admin.storageLocalWarning")}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.storageConfigTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("admin.storageConfigDescription")}</p>
          <p className="text-xs">
            <span className="font-medium">{t("admin.storageConfigSource")}: </span>
            <span className="text-muted-foreground">
              {config.source === "database"
                ? t("admin.storageConfigSourceDatabase")
                : config.source === "env"
                  ? t("admin.storageConfigSourceEnv")
                  : t("admin.storageConfigSourceNone")}
            </span>
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="storage-account-id">{t("admin.storageAccountId")}</Label>
              <Input id="storage-account-id" value={accountId} onChange={(e) => setAccountId(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="storage-bucket">{t("admin.storageBucket")}</Label>
              <Input id="storage-bucket" value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="songverse" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="storage-access-key-id">{t("admin.storageAccessKeyId")}</Label>
              <Input
                id="storage-access-key-id"
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                placeholder={config.accessKeyIdMasked ?? t("admin.storageRequired")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="storage-secret-access-key">{t("admin.storageSecretAccessKey")}</Label>
              <Input
                id="storage-secret-access-key"
                type="password"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                placeholder={config.hasDatabaseConfig ? t("admin.storageLeaveBlankToKeep") : t("admin.storageRequired")}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="storage-endpoint">{t("admin.storageEndpoint")}</Label>
              <Input
                id="storage-endpoint"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={t("admin.storageEndpointPlaceholder")}
              />
            </div>
          </div>

          {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

          <div className="flex items-center justify-between">
            <Button onClick={() => void saveConfig()} disabled={saving}>
              {saving ? t("admin.storageSaving") : t("admin.storageSaveConfig")}
            </Button>
            {config.hasDatabaseConfig ? (
              <ConfirmButton
                label={t("admin.storageClearConfig")}
                confirmLabel={t("admin.storageConfirmClear")}
                busyLabel={t("admin.storageClearing")}
                cancelLabel={t("admin.cancel")}
                busy={clearing}
                onConfirm={clearConfig}
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

      <StorageLimitsCard limits={limits} />
      <FileSizeLimitsCard limits={fileSizes} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.storageByType")}</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(stats.byType).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("admin.storageNoAttachments")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {Object.entries(stats.byType).map(([type, count]) => (
                <li key={type} className="flex items-center justify-between py-2 text-sm first:pt-0 last:pb-0">
                  <span className="font-medium">{type}</span>
                  <span className="text-muted-foreground">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Kept apart from the R2 card: saving or reverting one never touches the
 * other. The defaults apply to whoever no storage role gives a limit (Admin >
 * Roles, issue #160): a user's own files, and a team's pool.
 */
function StorageLimitsCard({ limits }: { limits: StorageLimits }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [user, setUser] = useState(String(limits.defaultLimitMb));
  const [team, setTeam] = useState(String(limits.defaultTeamLimitMb));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(change: { defaultLimitMb?: number | null; defaultTeamLimitMb?: number | null }) {
    setPending(true);
    setError(null);
    try {
      await apiClient.adminSaveStorageLimits(change);
      await router.invalidate();
      if (change.defaultLimitMb === null) setUser(String(limits.builtInDefaultMb));
      if (change.defaultTeamLimitMb === null) setTeam(String(limits.builtInTeamDefaultMb));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  const valid = (value: string) => value.trim() !== "" && Number.isInteger(Number(value)) && Number(value) >= 0;

  const field = (id: string, label: string, value: string, onChange: (value: string) => void, isBuiltIn: boolean, builtInMb: number, reset: () => void) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id={id} type="number" min={0} step={1} value={value} onChange={(event) => onChange(event.target.value)} className="max-w-40" />
        {isBuiltIn ? (
          <span className="text-xs text-muted-foreground">{t("admin.storageLimitsSourceBuiltIn")}</span>
        ) : (
          <Button variant="outline" size="sm" onClick={reset} disabled={pending}>
            {t("admin.resetToBuiltIn", { mb: builtInMb })}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("admin.storageLimitsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("admin.storageLimitsDescription")}</p>
        {field("default-storage-limit", t("admin.storageDefaultLimitLabel"), user, setUser, limits.isBuiltIn, limits.builtInDefaultMb, () => void save({ defaultLimitMb: null }))}
        {field("default-team-storage-limit", t("admin.storageDefaultTeamLimitLabel"), team, setTeam, limits.teamIsBuiltIn, limits.builtInTeamDefaultMb, () => void save({ defaultTeamLimitMb: null }))}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div>
          <Button
            // Only what changed: the other keeps coming from where it does (the built-in default, say).
            onClick={() =>
              void save({
                ...(Number(user) !== limits.defaultLimitMb && { defaultLimitMb: Number(user) }),
                ...(Number(team) !== limits.defaultTeamLimitMb && { defaultTeamLimitMb: Number(team) }),
              })
            }
            disabled={pending || !valid(user) || !valid(team)}
          >
            {pending ? t("admin.saving") : t("admin.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The largest song file of each type (issue #163): saved ones over the
 * built-in ones; the API checks them on every upload, and the app before
 * sending a file.
 */
function FileSizeLimitsCard({ limits }: { limits: FileSizeLimits }) {
  const { t } = useTranslation();
  const router = useRouter();
  const initial = () => Object.fromEntries(ATTACHMENT_TYPES.map((type) => [type, String(limits.limitsMb[type])]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  useEffect(() => setValues(initial()), [limits]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(limitsMb: SaveFileSizeLimitsRequest["limitsMb"]) {
    setPending(true);
    setError(null);
    try {
      await apiClient.adminSaveFileSizeLimits({ limitsMb });
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  const valid = (value: string) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= MAX_FILE_SIZE_LIMIT_MB;
  // Only what changed: the rest keeps its limit, saved or built in.
  const changed = Object.fromEntries(ATTACHMENT_TYPES.filter((type) => Number(values[type]) !== limits.limitsMb[type]).map((type) => [type, Number(values[type])]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("admin.fileSizeLimitsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("admin.fileSizeLimitsDescription")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="file-size-limits">
          {ATTACHMENT_TYPES.map((type) => (
            <div key={type} className="flex flex-col gap-1.5">
              <Label htmlFor={`file-size-${type}`}>{t(`songEditor.fileTypes.${type}`)} (MB)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={`file-size-${type}`}
                  type="number"
                  min={1}
                  max={MAX_FILE_SIZE_LIMIT_MB}
                  step={1}
                  value={values[type]}
                  onChange={(event) => setValues({ ...values, [type]: event.target.value })}
                  className="max-w-28"
                />
                {limits.custom.includes(type) ? (
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => void save({ [type]: null })}>
                    {t("admin.fileSizeLimitReset")}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("admin.fileSizeLimitBuiltIn", { mb: limits.builtInMb[type] })}</span>
                )}
              </div>
            </div>
          ))}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div>
          <Button onClick={() => void save(changed)} disabled={pending || Object.keys(changed).length === 0 || !ATTACHMENT_TYPES.every((type) => valid(values[type] ?? ""))} data-testid="file-size-save">
            {pending ? t("admin.saving") : t("admin.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
