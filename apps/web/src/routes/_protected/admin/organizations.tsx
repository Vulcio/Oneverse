import type { AdminOrganizationRequest, OrganizationMode } from "@oneverse/core";
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
  loader: async () => {
    const [summary, requests] = await Promise.all([apiClient.adminGetOrganizations(), apiClient.adminListOrganizationRequests()]);
    return { ...summary, requests };
  },
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
  const { mode: modeSetting, anyoneCreates: anyoneSetting, ownStorage: ownStorageSetting, reviewRequests: reviewSetting } = summary.settings;
  const [ownStorage, setOwnStorage] = useState(ownStorageSetting.value);
  const [reviewRequests, setReviewRequests] = useState(reviewSetting.value);
  const [mode, setMode] = useState<OrganizationMode>(modeSetting.value);
  const [anyoneCreates, setAnyoneCreates] = useState(anyoneSetting.value);
  useEffect(() => {
    setMode(modeSetting.value);
    setAnyoneCreates(anyoneSetting.value);
    setReviewRequests(reviewSetting.value);
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
          {mode === "MULTI" && anyoneCreates ? (
            <label className="flex items-start gap-3 pl-7">
              <input type="checkbox" className="mt-1 size-4" checked={reviewRequests} onChange={(event) => setReviewRequests(event.target.checked)} data-testid="organization-review-requests" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t("organizations.reviewRequests")}</span>
                <span className="text-xs text-muted-foreground">{t("organizations.reviewRequestsHint")}</span>
                <span className="text-xs text-muted-foreground">{sourceOf(reviewSetting)}</span>
              </span>
            </label>
          ) : null}
          {mode !== "NONE" ? (
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 size-4" checked={ownStorage} onChange={(event) => setOwnStorage(event.target.checked)} data-testid="organization-own-storage" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t("organizations.ownStorageAllowed")}</span>
                <span className="text-xs text-muted-foreground">{t("organizations.ownStorageAllowedHint")}</span>
                <span className="text-xs text-muted-foreground">{sourceOf(ownStorageSetting)}</span>
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
                ...(ownStorage !== ownStorageSetting.value ? { ownStorage } : {}),
                ...(reviewRequests !== reviewSetting.value ? { reviewRequests } : {}),
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

      {summary.requests.pending.length > 0 || summary.requests.reviewed.length > 0 ? (
        <Card data-testid="organization-requests">
          <CardHeader>
            <CardTitle className="text-sm">{t("organizations.requests.adminTitle", { count: summary.requests.pending.length })}</CardTitle>
            <CardDescription>{t("organizations.requests.adminHint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {summary.requests.pending.map((request) => (
              <PendingRequest key={request.id} request={request} busy={busy} run={run} />
            ))}
            {summary.requests.reviewed.length > 0 ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">{t("organizations.requests.reviewed", { count: summary.requests.reviewed.length })}</summary>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                  {summary.requests.reviewed.map((request) => (
                    <li key={request.id}>
                      {t(request.status === "APPROVED" ? "organizations.requests.approvedBy" : "organizations.requests.declinedBy", {
                        name: request.name,
                        city: request.city,
                        by: request.reviewedBy?.displayName ?? "-",
                      })}
                      {request.declineReason ? ` - ${request.declineReason}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

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

/** A request waiting (issue #364): what they told, what it looks like, approve or decline with a reason. */
function PendingRequest({ request, busy, run }: { request: AdminOrganizationRequest; busy: string | null; run: (key: string, action: () => Promise<unknown>) => Promise<void> }) {
  const { t } = useTranslation();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3" data-request={request.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {request.name} <span className="font-normal text-muted-foreground">· {request.city}</span>
        </p>
        <span className="text-xs text-muted-foreground">{new Date(request.createdAt).toLocaleDateString()}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">{t("organizations.requests.kind")}</dt>
        <dd>
          {t(`organizations.kinds.${request.kind}`)}
          {request.peopleCount ? ` · ${t(`organizations.sizes.${request.peopleCount}`)}` : ""}
        </dd>
        <dt className="text-muted-foreground">{t("organizations.requests.contact")}</dt>
        <dd>
          {request.contactName} · <a href={`mailto:${request.contactEmail}`} className="hover:text-primary">{request.contactEmail}</a>
        </dd>
        <dt className="text-muted-foreground">{t("organizations.requests.askedBy")}</dt>
        <dd>
          {request.requestedBy.displayName} ({request.requestedBy.email})
        </dd>
        {request.website ? (
          <>
            <dt className="text-muted-foreground">{t("organizations.requests.website")}</dt>
            <dd>
              {/* Someone else's address: opened without telling it where from. */}
              <a href={request.website} target="_blank" rel="noopener noreferrer nofollow" className="break-all hover:text-primary">
                {request.website}
              </a>
            </dd>
          </>
        ) : null}
      </dl>
      {request.description ? <p className="text-xs">{request.description}</p> : null}
      {request.looksLike.length > 0 ? (
        <div className="rounded-md bg-amber-500/10 p-2 text-xs" data-testid="request-looks-like">
          <p className="font-medium">{t("organizations.requests.looksLike")}</p>
          <ul className="list-disc pl-4">
            {request.looksLike.map((one) => (
              <li key={`${one.source}-${one.id}`}>
                {one.name}
                {one.city ? ` · ${one.city}` : ""} ({t(one.source === "organization" ? "organizations.requests.existing" : "organizations.requests.alsoAsked")})
              </li>
            ))}
          </ul>
          {request.duplicateNote ? <p className="mt-1">{t("organizations.requests.theirNote", { note: request.duplicateNote })}</p> : null}
        </div>
      ) : null}
      {declining ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`decline-${request.id}`}>{t("organizations.requests.declineReason")}</Label>
          <Input id={`decline-${request.id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="request-decline-reason" />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy !== null}
              onClick={() => void run(`decline-${request.id}`, () => apiClient.adminDeclineOrganizationRequest(request.id, reason.trim() ? { reason: reason.trim() } : {}))}
              data-testid="request-decline-confirm"
            >
              {t("organizations.requests.decline")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDeclining(false)}>
              {t("admin.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => void run(`approve-${request.id}`, () => apiClient.adminApproveOrganizationRequest(request.id))} data-testid="request-approve">
            {busy === `approve-${request.id}` ? t("organizations.creating") : t("organizations.requests.approve")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDeclining(true)} data-testid="request-decline">
            {t("organizations.requests.decline")}
          </Button>
        </div>
      )}
    </div>
  );
}
