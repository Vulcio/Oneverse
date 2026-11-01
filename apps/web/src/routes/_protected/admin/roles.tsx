import type { AdminRole, CreateRoleRequest } from "@oneverse/core";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent } from "@oneverse/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { Textarea } from "@oneverse/ui/components/textarea";
import { apiClient } from "#/lib/api-client";
import { useRoleSummary } from "./-roles-dialog";

export const Route = createFileRoute("/_protected/admin/roles")({
  loader: () => apiClient.adminListRoles(),
  component: AdminRolesPage,
});

/**
 * Admin > Roles (issue #160): the one place that says what people may do
 * beyond their own songs - review, split recordings into stems, a storage
 * tier - given to users in Admin > Users and to teams in Admin > Teams.
 */
function AdminRolesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const roles = Route.useLoaderData();
  const summary = useRoleSummary();
  const [editing, setEditing] = useState<AdminRole | "new" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(role: AdminRole) {
    setDeleting(role.id);
    setError(null);
    try {
      await apiClient.adminDeleteRole(role.id);
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("nav.adminRoles")}</h1>
          <p className="text-sm text-muted-foreground">{t("admin.rolesDescription")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("admin.rolesGiveThem")}{" "}
            <Link to="/admin/users" className="underline">
              {t("nav.adminUsers")}
            </Link>
            {" · "}
            <Link to="/admin/teams" className="underline">
              {t("nav.adminTeams")}
            </Link>
          </p>
        </div>
        <Button onClick={() => setEditing("new")} data-testid="role-new">
          <Plus />
          {t("admin.roleNew")}
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Card className="p-0">
        <CardContent className="p-0">
          <ul className="flex flex-col divide-y" data-testid="roles">
            {roles.map((role) => (
              <li key={role.id} className="flex flex-wrap items-center gap-3 p-4" data-testid={`role-${role.name}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {role.name}
                    {role.builtIn ? <Badge variant="muted">{t("admin.roleBuiltIn")}</Badge> : null}
                  </p>
                  {role.description ? <p className="text-sm text-muted-foreground">{role.description}</p> : null}
                  <p className="text-xs text-muted-foreground">{summary(role) || t("admin.roleAllowsNothing")}</p>
                </div>
                <span className="text-xs text-muted-foreground">{t("admin.roleHolders", { users: role.userCount, teams: role.teamCount })}</span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(role)}>
                    {t("admin.roleEdit")}
                  </Button>
                  {role.builtIn ? null : (
                    <ConfirmButton
                      label={t("admin.roleDelete")}
                      confirmLabel={t("admin.roleConfirmDelete")}
                      busyLabel={t("admin.roleDeleting")}
                      cancelLabel={t("admin.cancel")}
                      busy={deleting === role.id}
                      onConfirm={() => remove(role)}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {editing ? (
        <RoleEditor
          role={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await router.invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

function RoleEditor({ role, onClose, onSaved }: { role: AdminRole | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [canReview, setCanReview] = useState(role?.canReview ?? false);
  const [canSeparateStems, setCanSeparateStems] = useState(role?.canSeparateStems ?? false);
  const [canKeepLossless, setCanKeepLossless] = useState(role?.canKeepLosslessAudio ?? false);
  const [canUploadAudio, setCanUploadAudio] = useState(role?.canUploadAudio ?? false);
  const [canOperateScreens, setCanOperateScreens] = useState(role?.canOperateScreens ?? false);
  const [canCue, setCanCue] = useState(role?.canCue ?? false);
  const [canRoute, setCanRoute] = useState(role?.canRoute ?? false);
  const [canManageScreens, setCanManageScreens] = useState(role?.canManageScreens ?? false);
  const [canUseOwnStorage, setCanUseOwnStorage] = useState(role?.canUseOwnStorage ?? false);
  const [teamAssignable, setTeamAssignable] = useState(role?.teamAssignable ?? false);
  const [monthlyLimit, setMonthlyLimit] = useState(role?.stemSeparationMonthlyLimit?.toString() ?? "");
  const [hasStorage, setHasStorage] = useState(role?.storageLimitMb != null);
  const [storageMb, setStorageMb] = useState(role?.storageLimitMb?.toString() ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    const data: CreateRoleRequest = {
      name: name.trim(),
      description: description.trim(),
      canReview,
      canSeparateStems,
      canKeepLosslessAudio: canKeepLossless,
      canUploadAudio,
      canOperateScreens,
      canCue,
      canRoute,
      canManageScreens,
      canUseOwnStorage,
      teamAssignable,
      stemSeparationMonthlyLimit: canSeparateStems && monthlyLimit.trim() ? Number(monthlyLimit) : null,
      storageLimitMb: hasStorage && storageMb.trim() ? Number(storageMb) : null,
    };
    try {
      if (role) await apiClient.adminUpdateRole(role.id, data);
      else await apiClient.adminCreateRole(data);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  const check = (checked: boolean, onChange: (value: boolean) => void, label: string, hint: string, testId: string) => (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="mt-1 size-4" checked={checked} onChange={(event) => onChange(event.target.checked)} data-testid={testId} />
      <span className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? t("admin.roleEditTitle", { name: role.name }) : t("admin.roleNew")}</DialogTitle>
          <DialogDescription>{t("admin.roleEditDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-name">{t("admin.roleName")}</Label>
            <Input id="role-name" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-description">{t("admin.roleDescriptionLabel")}</Label>
            <Textarea id="role-description" maxLength={300} value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t("admin.roleAllows")}</legend>
            {check(canReview, setCanReview, t("admin.roleReview"), t("admin.roleReviewHint"), "role-review")}
            {check(canSeparateStems, setCanSeparateStems, t("admin.roleStems"), t("admin.roleStemsHint"), "role-stems")}
            {canSeparateStems ? (
              <div className="ml-7 flex flex-col gap-1.5">
                <Label htmlFor="role-stems-limit">{t("admin.roleStemsLimit")}</Label>
                <Input id="role-stems-limit" type="number" min={1} max={10000} value={monthlyLimit} onChange={(event) => setMonthlyLimit(event.target.value)} className="max-w-40" />
                <span className="text-xs text-muted-foreground">{t("admin.roleStemsLimitHint")}</span>
              </div>
            ) : null}
            {check(canUploadAudio, setCanUploadAudio, t("admin.roleAudioUploads"), t("admin.roleAudioUploadsHint"), "role-audio-uploads")}
            {check(canKeepLossless, setCanKeepLossless, t("admin.roleLossless"), t("admin.roleLosslessHint"), "role-lossless")}
            {check(canOperateScreens, setCanOperateScreens, t("admin.roleOperateScreens"), t("admin.roleOperateScreensHint"), "role-operate-screens")}
            {check(canCue, setCanCue, t("admin.roleCue"), t("admin.roleCueHint"), "role-cue")}
            {check(canRoute, setCanRoute, t("admin.roleRoute"), t("admin.roleRouteHint"), "role-route")}
            {check(canManageScreens, setCanManageScreens, t("admin.roleManageScreens"), t("admin.roleManageScreensHint"), "role-manage-screens")}
            {check(canUseOwnStorage, setCanUseOwnStorage, t("admin.roleOwnStorage"), t("admin.roleOwnStorageHint"), "role-own-storage")}
            {check(teamAssignable, setTeamAssignable, t("admin.roleTeamAssignable"), t("admin.roleTeamAssignableHint"), "role-team-assignable")}
            {check(hasStorage, setHasStorage, t("admin.roleStorageTier"), t("admin.roleStorageTierHint"), "role-storage")}
            {hasStorage ? (
              <div className="ml-7 flex flex-col gap-1.5">
                <Label htmlFor="role-storage-mb">{t("admin.roleStorageMb")}</Label>
                <Input id="role-storage-mb" type="number" min={0} required value={storageMb} onChange={(event) => setStorageMb(event.target.value)} className="max-w-40" />
              </div>
            ) : null}
          </fieldset>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("admin.cancel")}
            </Button>
            <Button type="submit" disabled={pending} data-testid="role-save">
              {pending ? t("admin.saving") : t("admin.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
