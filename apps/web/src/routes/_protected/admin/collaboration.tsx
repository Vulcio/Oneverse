import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/admin/collaboration")({
  loader: () => apiClient.adminGetCollaborationSettings(),
  component: AdminCollaborationPage,
});

/**
 * Admin > Collaboration (issue #27): live co-editing - typing in the same
 * song together in the editor - on or off. Off by default while it's new;
 * LIVE_CO_EDITING sets it too, a saved choice wins.
 */
function AdminCollaborationPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const summary = Route.useLoaderData();
  const setting = summary.settings.liveCoEditing;
  const [on, setOn] = useState(setting.value);
  useEffect(() => setOn(setting.value), [summary]);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
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

  const source =
    setting.source === "database" ? t("admin.securityFromDatabase") : setting.source === "env" ? t("admin.securityFromEnv", { name: setting.env }) : t("admin.securityFromDefault", { name: setting.env });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("admin.collaborationTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.collaborationDescription")}</p>
        <p className="mt-2 text-xs" data-testid="collaboration-source">
          <span className="font-medium">{t("admin.authSource")}: </span>
          <span className="text-muted-foreground">
            {summary.source === "database" ? t("admin.authSourceDatabase") : summary.source === "env" ? t("admin.authSourceEnv") : t("admin.securitySourceDefaults")}
          </span>
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.collaborationEditing")}</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 size-4" checked={on} onChange={(event) => setOn(event.target.checked)} data-testid="collaboration-liveCoEditing" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t("admin.collaborationLiveCoEditing")}</span>
              <span className="text-xs text-muted-foreground">{t("admin.collaborationLiveCoEditingHint")}</span>
              <span className="text-xs text-muted-foreground">{source}</span>
            </span>
          </label>
        </CardContent>
      </Card>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center justify-between">
        <Button onClick={() => void run(() => apiClient.adminSaveCollaborationSettings({ liveCoEditing: on }), setSaving)} disabled={saving} data-testid="collaboration-save">
          {saving ? t("admin.authSaving") : t("admin.authSaveConfig")}
        </Button>
        {summary.source === "database" ? (
          <ConfirmButton
            label={t("admin.authClearConfig")}
            confirmLabel={t("admin.authConfirmClear")}
            busyLabel={t("admin.authClearing")}
            cancelLabel={t("admin.cancel")}
            busy={clearing}
            onConfirm={() => run(() => apiClient.adminClearCollaborationSettings(), setClearing)}
          />
        ) : null}
      </div>
    </div>
  );
}
