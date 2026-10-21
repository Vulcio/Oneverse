import type { OrganizationMode } from "@oneverse/core";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";
import { forgetMyOrganizations } from "@oneverse/planning/organizations";

export const Route = createFileRoute("/_protected/admin/organizations")({
  loader: () => apiClient.adminGetOrganizations(),
  component: AdminOrganizationsPage,
});

/**
 * Admin > Organisations (issue #241): whether the server has none
 * (Songverse on its own), one that everyone is in, or several - and who may
 * create one then; every organisation, made here with its admin, or deleted.
 */
function AdminOrganizationsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const summary = Route.useLoaderData();
  const { mode: modeSetting, anyoneCreates: anyoneSetting } = summary.settings;
  const [mode, setMode] = useState<OrganizationMode>(modeSetting.value);
  const [anyoneCreates, setAnyoneCreates] = useState(anyoneSetting.value);
  useEffect(() => {
    setMode(modeSetting.value);
    setAnyoneCreates(anyoneSetting.value);
  }, [summary]);
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourceOf = (setting: { source: string; env: string }) =>
    setting.source === "database" ? t("admin.securityFromDatabase") : setting.source === "env" ? t("admin.securityFromEnv", { name: setting.env }) : t("admin.securityFromDefault", { name: setting.env });

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      forgetMyOrganizations();
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  // With one organisation for the server, one can be made only while there's none.
  const canCreate = modeSetting.value === "MULTI" || (modeSetting.value === "SINGLE" && summary.organizations.length === 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("organizations.adminTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("organizations.adminDescription")}</p>
        {/* Where Planiverse is deployed (issue #241): an address set there, not here. */}
        <p className="mt-1 text-xs text-muted-foreground" data-testid="planiverse-address">
          {summary.planiverseUrl ? (
            <a href={summary.planiverseUrl} className="hover:text-primary">
              {t("organizations.planiverseAt", { url: summary.planiverseUrl })}
            </a>
          ) : (
            t("organizations.planiverseOff")
          )}
        </p>
        <p className="mt-2 text-xs" data-testid="organization-settings-source">
          <span className="font-medium">{t("admin.authSource")}: </span>
          <span className="text-muted-foreground">
            {summary.source === "database" ? t("admin.authSourceDatabase") : summary.source === "env" ? t("admin.authSourceEnv") : t("admin.securitySourceDefaults")}
          </span>
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="organization-mode">{t("organizations.mode")}</Label>
            <NativeSelect id="organization-mode" value={mode} onChange={(e) => setMode(e.target.value as OrganizationMode)} data-testid="organization-mode">
              <option value="NONE">{t("organizations.modeNone")}</option>
              <option value="SINGLE">{t("organizations.modeSingle")}</option>
              <option value="MULTI">{t("organizations.modeMulti")}</option>
            </NativeSelect>
            <span className="text-xs text-muted-foreground">{sourceOf(modeSetting)}</span>
          </div>
          {mode === "MULTI" ? (
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 size-4" checked={anyoneCreates} onChange={(event) => setAnyoneCreates(event.target.checked)} data-testid="organization-anyone-creates" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t("organizations.anyoneCreates")}</span>
                <span className="text-xs text-muted-foreground">{t("organizations.anyoneCreatesHint")}</span>
                <span className="text-xs text-muted-foreground">{sourceOf(anyoneSetting)}</span>
              </span>
            </label>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          onClick={() =>
            void run("save", () =>
              apiClient.adminSaveOrganizationSettings({
                // Only what changed: the rest keeps coming from where it does.
                ...(mode !== modeSetting.value ? { mode } : {}),
                ...(anyoneCreates !== anyoneSetting.value ? { anyoneCreates } : {}),
              }),
            )
          }
          disabled={busy === "save"}
          data-testid="organization-settings-save"
        >
          {busy === "save" ? t("admin.authSaving") : t("admin.authSaveConfig")}
        </Button>
        {summary.source === "database" ? (
          <ConfirmButton
            label={t("admin.authClearConfig")}
            confirmLabel={t("admin.authConfirmClear")}
            busyLabel={t("admin.authClearing")}
            cancelLabel={t("admin.cancel")}
            busy={busy === "clear"}
            onConfirm={() => run("clear", () => apiClient.adminClearOrganizationSettings())}
          />
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canCreate ? (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="text-sm">{modeSetting.value === "SINGLE" ? t("organizations.adminSingleNew") : t("organizations.adminNew")}</CardTitle>
            {modeSetting.value === "SINGLE" ? <CardDescription>{t("organizations.adminSingleHint")}</CardDescription> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="admin-organization-name">{t("organizations.name")}</Label>
              <Input id="admin-organization-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="admin-organization-email">{t("organizations.adminEmail")}</Label>
              <Input id="admin-organization-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
              <span className="text-xs text-muted-foreground">{t("organizations.adminEmailHint")}</span>
            </div>
            <Button
              className="self-start"
              disabled={busy === "create" || name.trim().length < 2}
              onClick={() =>
                void run("create", async () => {
                  await apiClient.adminCreateOrganization({ name, ...(adminEmail.trim() ? { adminEmail: adminEmail.trim() } : {}) });
                  setName("");
                  setAdminEmail("");
                })
              }
              data-testid="admin-organization-create"
            >
              {busy === "create" ? t("organizations.creating") : t("organizations.createButton")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("organizations.adminList")}</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.organizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("organizations.adminNone")}</p>
          ) : (
            <ul className="flex flex-col divide-y" data-testid="admin-organizations">
              {summary.organizations.map((organization) => (
                <li key={organization.id} className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0" data-organization={organization.id}>
                  <div className="min-w-0">
                    <Link to="/organizations/$organizationId" params={{ organizationId: organization.id }} className="text-sm font-medium hover:text-primary">
                      {organization.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {t("organizations.teamCount", { count: organization.teamCount })} · {t("organizations.members", { count: organization.memberCount })} ·{" "}
                      {t("organizations.adminAdmins", { names: organization.admins.map((admin) => admin.displayName).join(", ") || "-" })}
                    </p>
                  </div>
                  <ConfirmButton
                    label={t("organizations.delete")}
                    confirmLabel={t("organizations.adminConfirmDelete")}
                    busyLabel={t("organizations.deleting")}
                    cancelLabel={t("admin.cancel")}
                    busy={busy === organization.id}
                    onConfirm={() => run(organization.id, () => apiClient.adminDeleteOrganization(organization.id))}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
