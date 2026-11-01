import type { OwnStorageSummary, SaveOwnStorageRequest } from "@oneverse/core";
import { HardDrive } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";

type Provider = SaveOwnStorageRequest["provider"];
const PROVIDERS: Provider[] = ["R2", "S3", "B2", "WASABI"];

/**
 * An organisation's own bucket (issue #206), on its page for its admins: its
 * teams' songs' files kept there, moved in by the Worker, and back out when
 * they stop. Only known providers; the secret is never shown again.
 */
export function OwnStorageCard({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<OwnStorageSummary | null>(null);
  const [provider, setProvider] = useState<Provider>("R2");
  const [accountId, setAccountId] = useState("");
  const [region, setRegion] = useState("");
  const [bucket, setBucket] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [busy, setBusy] = useState<"save" | "stop" | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = useCallback((next: OwnStorageSummary) => {
    setSummary(next);
    if (next.provider) setProvider(next.provider);
    setAccountId(next.accountId ?? "");
    setRegion(next.region ?? "");
    setBucket(next.bucket ?? "");
  }, []);
  const load = useCallback(() => apiClient.getOwnStorage(organizationId).then(show, (err: unknown) => setError(err instanceof Error ? err.message : String(err))), [organizationId, show]);
  useEffect(() => void load(), [load]);
  // While files are on the move, look again now and then.
  const moving = !!summary && (summary.moving > 0 || summary.state === "LEAVING");
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [moving, load]);

  if (!summary) return null;
  if (!summary.allowed && !summary.configured) {
    return (
      <Card data-testid="own-storage-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <HardDrive className="size-4" aria-hidden />
            {t("organizations.ownStorage.title")}
          </CardTitle>
          <CardDescription>{t("organizations.ownStorage.notAllowed")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const act = (kind: "save" | "stop", work: () => Promise<OwnStorageSummary>) => {
    setBusy(kind);
    setError(null);
    setSaved(false);
    return work()
      .then(
        (next) => {
          show(next);
          setSecretAccessKey("");
          setAccessKeyId("");
          if (kind === "save") setSaved(true);
        },
        (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setBusy(null));
  };

  const leaving = summary.state === "LEAVING";
  return (
    <Card data-testid="own-storage-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <HardDrive className="size-4" aria-hidden />
          {t("organizations.ownStorage.title")}
        </CardTitle>
        <CardDescription>{t("organizations.ownStorage.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {summary.configured ? (
          <div className="flex flex-col gap-1 text-sm" data-testid="own-storage-status" data-state={summary.state ?? ""} data-reachable={summary.reachable ? "true" : "false"}>
            <p>{leaving ? t("organizations.ownStorage.leaving") : t("organizations.ownStorage.inUse", { bucket: summary.bucket })}</p>
            <p className="text-muted-foreground">
              <span data-testid="own-storage-files">{t("organizations.ownStorage.files", { count: summary.files })}</span>
              {summary.moving ? <span> · {t("organizations.ownStorage.moving", { count: summary.moving })}</span> : null}
            </p>
            {!summary.reachable ? (
              <p className="text-destructive" role="alert">
                {t("organizations.ownStorage.unreachable", { error: summary.lastError ?? "" })}
              </p>
            ) : null}
          </div>
        ) : null}

        {!leaving ? (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void act("save", () =>
                apiClient.saveOwnStorage(organizationId, {
                  provider,
                  bucket,
                  ...(accessKeyId ? { accessKeyId } : {}),
                  ...(provider === "R2" ? { accountId } : { region }),
                  ...(secretAccessKey ? { secretAccessKey } : {}),
                }),
              );
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="own-storage-provider">{t("organizations.ownStorage.provider")}</Label>
              <NativeSelect id="own-storage-provider" value={provider} onChange={(event) => setProvider(event.target.value as Provider)} data-testid="own-storage-provider">
                {PROVIDERS.map((name) => (
                  <option key={name} value={name}>
                    {t(`organizations.ownStorage.providers.${name}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {provider === "R2" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="own-storage-account">{t("organizations.ownStorage.accountId")}</Label>
                <Input id="own-storage-account" value={accountId} onChange={(event) => setAccountId(event.target.value)} autoComplete="off" data-testid="own-storage-account" />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="own-storage-region">{t("organizations.ownStorage.region")}</Label>
                <Input id="own-storage-region" value={region} onChange={(event) => setRegion(event.target.value)} placeholder={provider === "B2" ? "us-west-004" : "eu-central-1"} autoComplete="off" data-testid="own-storage-region" />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="own-storage-bucket">{t("organizations.ownStorage.bucket")}</Label>
              <Input id="own-storage-bucket" value={bucket} onChange={(event) => setBucket(event.target.value)} autoComplete="off" data-testid="own-storage-bucket" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="own-storage-key">{t("organizations.ownStorage.accessKeyId")}</Label>
              <Input id="own-storage-key" value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} placeholder={summary.accessKeyIdMasked ?? ""} autoComplete="off" data-testid="own-storage-key" />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="own-storage-secret">{t("organizations.ownStorage.secretAccessKey")}</Label>
              <Input
                id="own-storage-secret"
                type="password"
                value={secretAccessKey}
                onChange={(event) => setSecretAccessKey(event.target.value)}
                placeholder={summary.configured ? t("organizations.ownStorage.secretKeep") : ""}
                autoComplete="new-password"
                data-testid="own-storage-secret"
              />
              <span className="text-xs text-muted-foreground">{t("organizations.ownStorage.tokenHint")}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button type="submit" size="sm" disabled={busy !== null || !summary.allowed} data-testid="own-storage-save">
                {busy === "save" ? t("organizations.ownStorage.saving") : t("organizations.ownStorage.save")}
              </Button>
              {summary.configured ? (
                <ConfirmButton
                  label={t("organizations.ownStorage.stop")}
                  confirmLabel={t("organizations.ownStorage.stopConfirm")}
                  busyLabel={t("organizations.ownStorage.saving")}
                  cancelLabel={t("admin.cancel")}
                  busy={busy === "stop"}
                  onConfirm={() => act("stop", () => apiClient.stopOwnStorage(organizationId))}
                />
              ) : null}
              {saved ? (
                <span className="text-sm text-muted-foreground" data-testid="own-storage-saved">
                  {t("organizations.ownStorage.saved")}
                </span>
              ) : null}
            </div>
          </form>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("organizations.ownStorage.backups")}</p>
        {error ? (
          <p className="text-sm text-destructive" role="alert" data-testid="own-storage-error">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
