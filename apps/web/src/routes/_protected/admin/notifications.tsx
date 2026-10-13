import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@songverse/ui/components/confirm-button";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/admin/notifications")({
  loader: () => apiClient.adminGetNotificationSettings(),
  component: AdminNotificationsPage,
});

/**
 * Admin > Notifications (issue #236): whether notifications also go by
 * email - off by default, since they go through the same Resend account
 * as account mail, with its sending limits - and web push to people's
 * devices: its VAPID key pair (generated here, or one's own; the private
 * key never shown, only kept) and contact. Each setting says where it
 * comes from; a saved one wins over the environment.
 */
function AdminNotificationsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const summary = Route.useLoaderData();
  const setting = summary.settings.emailEnabled;
  const { push } = summary;
  const [emailEnabled, setEmailEnabled] = useState(setting.value);
  const [publicKey, setPublicKey] = useState(push.publicKey ?? "");
  const [privateKey, setPrivateKey] = useState("");
  const [subject, setSubject] = useState(push.subject ?? "");
  useEffect(() => {
    setEmailEnabled(setting.value);
    setPublicKey(push.publicKey ?? "");
    setPrivateKey("");
    setSubject(push.subject ?? "");
  }, [summary]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source =
    setting.source === "database" ? t("admin.securityFromDatabase") : setting.source === "env" ? t("admin.securityFromEnv", { name: setting.env }) : t("admin.securityFromDefault", { name: setting.env });

  async function run(action: () => Promise<void>, busy: (on: boolean) => void) {
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
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("notifications.adminTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("notifications.adminDescription")}</p>
        <p className="mt-2 text-xs" data-testid="notification-settings-source">
          <span className="font-medium">{t("admin.authSource")}: </span>
          <span className="text-muted-foreground">
            {summary.source === "database" ? t("admin.authSourceDatabase") : summary.source === "env" ? t("admin.authSourceEnv") : t("admin.securitySourceDefaults")}
          </span>
        </p>
      </div>

      <Card>
        <CardContent>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 size-4" checked={emailEnabled} onChange={(event) => setEmailEnabled(event.target.checked)} data-testid="notifications-email-enabled" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t("notifications.adminEmail")}</span>
              <span className="text-xs text-muted-foreground">{t("notifications.adminEmailHint")}</span>
              <span className="text-xs text-muted-foreground">{source}</span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("notifications.adminPush")}</CardTitle>
          <CardDescription>{t("notifications.adminPushHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs" data-testid="push-status">
            <span className="font-medium">{push.ready ? t("notifications.adminPushReady") : t("notifications.adminPushMissing")}</span>{" "}
            <span className="text-muted-foreground">
              {push.source === "database" ? t("admin.securityFromDatabase") : push.source === "env" ? t("admin.securityFromEnv", { name: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY" }) : null}
            </span>
          </p>
          {push.error ? (
            <p className="text-xs text-destructive" data-testid="push-error">
              {push.error}
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vapid-public">{t("notifications.adminPublicKey")}</Label>
            <Input id="vapid-public" value={publicKey} onChange={(event) => setPublicKey(event.target.value)} className="font-mono text-xs" data-testid="vapid-public" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vapid-private">{t("notifications.adminPrivateKey")}</Label>
            <Input
              id="vapid-private"
              type="password"
              autoComplete="off"
              // The key is never sent back: say it's there (issue #237).
              placeholder={push.hasDatabasePrivateKey ? `•••••••• ${t("notifications.adminPrivateKeySaved")}` : push.source === "env" ? t("notifications.adminPrivateKeyFromEnv") : undefined}
              value={privateKey}
              onChange={(event) => setPrivateKey(event.target.value)}
              className="font-mono text-xs"
              data-testid="vapid-private"
            />
            {push.hasDatabasePrivateKey ? <span className="text-xs text-muted-foreground">{t("notifications.adminPrivateKeyKeep")}</span> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vapid-subject">{t("notifications.adminSubject")}</Label>
            <Input id="vapid-subject" value={subject} placeholder={push.subjectEnv ?? "mailto:"} onChange={(event) => setSubject(event.target.value)} data-testid="vapid-subject" />
            <span className="text-xs text-muted-foreground">{t("notifications.adminSubjectHint")}</span>
          </div>
          {push.ready ? (
            <ConfirmButton
              label={t("notifications.adminGenerate")}
              confirmLabel={t("notifications.adminGenerateConfirm")}
              busyLabel={t("notifications.adminGenerate")}
              cancelLabel={t("admin.cancel")}
              busy={generating}
              onConfirm={() => run(async () => void (await apiClient.adminGeneratePushKeys()), setGenerating)}
            />
          ) : (
            <Button variant="outline" className="self-start" disabled={generating} onClick={() => void run(async () => void (await apiClient.adminGeneratePushKeys()), setGenerating)} data-testid="vapid-generate">
              {t("notifications.adminGenerate")}
            </Button>
          )}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center justify-between">
        <Button
          onClick={() =>
            void run(
              () =>
                apiClient.adminSaveNotificationSettings({
                  // Only what changed: the rest keeps coming from where it does.
                  ...(emailEnabled !== setting.value ? { emailEnabled } : {}),
                  ...(publicKey !== (push.publicKey ?? "") ? { vapidPublicKey: publicKey } : {}),
                  ...(privateKey ? { vapidPrivateKey: privateKey } : {}),
                  ...(subject !== (push.subject ?? "") ? { vapidSubject: subject } : {}),
                }),
              setSaving,
            )
          }
          disabled={saving}
          data-testid="notifications-save"
        >
          {saving ? t("admin.authSaving") : t("admin.authSaveConfig")}
        </Button>
        {summary.source === "database" ? (
          <ConfirmButton
            label={t("admin.authClearConfig")}
            confirmLabel={t("admin.authConfirmClear")}
            busyLabel={t("admin.authClearing")}
            cancelLabel={t("admin.cancel")}
            busy={clearing}
            onConfirm={() => run(() => apiClient.adminClearNotificationSettings(), setClearing)}
          />
        ) : null}
      </div>
    </div>
  );
}
