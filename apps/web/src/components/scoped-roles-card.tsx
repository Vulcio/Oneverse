import type { OwnRole, ScopedRolesView } from "@oneverse/core";
import { Pencil, Plus, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { RoleEditor } from "#/components/role-editor";
import { apiClient } from "#/lib/api-client";

type Owner = { teamId: string } | { organizationId: string };

/**
 * Roles a team's or an organisation's admins give their own members, there
 * only (issue #270): those Admin > Roles lets teams give, like the media
 * operator - and their own (issue #206), made here with the same editor as
 * Admin > Roles, for what they run: stems on their own Sonic server, their
 * sets' screens, and an organisation's own bucket (room there, given to
 * people or to its teams, and audio uploads).
 */
export function ScopedRolesCard({ owner, members }: { owner: Owner; members: { userId: string; displayName: string }[] }) {
  const { t } = useTranslation();
  const [view, setView] = useState<ScopedRolesView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<OwnRole | "new" | null>(null);
  const isTeam = "teamId" in owner;
  const ownerId = isTeam ? owner.teamId : owner.organizationId;

  const load = useCallback(
    () => (isTeam ? apiClient.getTeamScopedRoles(ownerId) : apiClient.getOrganizationScopedRoles(ownerId)).then(setView, (err: unknown) => setError(err instanceof Error ? err.message : String(err))),
    [isTeam, ownerId],
  );
  useEffect(() => void load(), [load]);

  const rolesOf = (userId: string) => view?.members.find((one) => one.userId === userId)?.roleIds ?? [];
  const teamRolesOf = (teamId: string) => view?.teams.find((one) => one.teamId === teamId)?.roleIds ?? [];

  async function act(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await work();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const toggle = (userId: string, roleId: string, on: boolean) => {
    const roleIds = on ? [...rolesOf(userId), roleId] : rolesOf(userId).filter((id) => id !== roleId);
    // Shown at once; the server's answer follows.
    setView((before) => before && { ...before, members: [...before.members.filter((one) => one.userId !== userId), { userId, roleIds }] });
    return act(`${userId}-${roleId}`, () => ("teamId" in owner ? apiClient.setTeamMemberRoles(owner.teamId, userId, { roleIds }) : apiClient.setOrganizationMemberRoles(owner.organizationId, userId, { roleIds })));
  };
  const toggleTeam = (teamId: string, roleId: string, on: boolean) => {
    if ("teamId" in owner) return;
    const roleIds = on ? [...teamRolesOf(teamId), roleId] : teamRolesOf(teamId).filter((id) => id !== roleId);
    setView((before) => before && { ...before, teams: before.teams.map((one) => (one.teamId === teamId ? { ...one, roleIds } : one)) });
    return act(`${teamId}-${roleId}`, () => apiClient.setOrganizationTeamRoles(owner.organizationId, teamId, { roleIds }));
  };

  const allows = (role: OwnRole) =>
    [
      role.canSeparateStems ? (role.stemSeparationMonthlyLimit ? t("admin.roleAllowsStemsLimited", { count: role.stemSeparationMonthlyLimit }) : t("admin.roleAllowsStems")) : null,
      role.canUploadAudio ? t("admin.roleAllowsAudioUploads") : null,
      role.canKeepLosslessAudio ? t("admin.roleAllowsLossless") : null,
      role.canOperateScreens ? t("admin.roleAllowsOperateScreens") : null,
      role.canCue ? t("admin.roleAllowsCue") : null,
      role.canRoute ? t("admin.roleAllowsRoute") : null,
      role.canManageScreens ? t("admin.roleAllowsManageScreens") : null,
      role.canStoreFiles ? (role.storageLimitMb != null ? t("ownRoles.storageTier", { mb: role.storageLimitMb }) : t("ownRoles.storesFiles")) : null,
    ].filter((one): one is string => one !== null);

  const memberBoxes = (roleId: string) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {members.map((member) => (
        <label key={member.userId} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={rolesOf(member.userId).includes(roleId)}
            disabled={busy !== null}
            onChange={(event) => void toggle(member.userId, roleId, event.target.checked)}
            data-testid={`scoped-role-${roleId}-${member.userId}`}
          />
          {member.displayName}
        </label>
      ))}
    </div>
  );

  return (
    <Card id="roles" className="scroll-mt-20" data-testid="scoped-roles-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4" aria-hidden />
          {t("scopedRoles.title")}
        </CardTitle>
        <CardDescription>{t(isTeam ? "scopedRoles.descriptionTeam" : "scopedRoles.descriptionOrganization")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3" data-testid="own-roles">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{t(isTeam ? "ownRoles.titleTeam" : "ownRoles.titleOrganization")}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing("new")} data-testid="own-role-new">
              <Plus className="size-4" aria-hidden />
              {t("admin.roleNew")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t(isTeam ? "ownRoles.hintTeam" : "ownRoles.hintOrganization")}</p>
          {view?.own.map((role) => (
            <div key={role.id} className="flex flex-col gap-1.5 rounded-md border p-3" data-testid={`own-role-${role.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{role.name}</p>
                <span className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(role)} aria-label={t("ownRoles.edit", { name: role.name })} data-testid="own-role-edit">
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <ConfirmButton
                    label={t("admin.roleDelete")}
                    confirmLabel={t("admin.roleConfirmDelete")}
                    busyLabel={t("admin.roleDeleting")}
                    cancelLabel={t("admin.cancel")}
                    busy={busy === `delete-${role.id}`}
                    onConfirm={() => act(`delete-${role.id}`, () => apiClient.deleteOwnRole(owner, role.id))}
                  />
                </span>
              </div>
              {role.description ? <p className="text-xs text-muted-foreground">{role.description}</p> : null}
              <div className="flex flex-wrap gap-1">
                {allows(role).map((line) => (
                  <Badge key={line} variant="muted">
                    {line}
                  </Badge>
                ))}
              </div>
              {memberBoxes(role.id)}
              {/* Given to a whole team: its members keep files there, and its tier is the team's share. */}
              {!isTeam && role.canStoreFiles && view.teams.length ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t pt-1.5">
                  <span className="text-xs text-muted-foreground">{t("ownRoles.teams")}</span>
                  {view.teams.map((team) => (
                    <label key={team.teamId} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={teamRolesOf(team.teamId).includes(role.id)}
                        disabled={busy !== null}
                        onChange={(event) => void toggleTeam(team.teamId, role.id, event.target.checked)}
                        data-testid={`own-role-${role.id}-team-${team.teamId}`}
                      />
                      {team.name}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {view?.roles.length ? (
          <div className="flex flex-col gap-3 border-t pt-3">
            <p className="text-sm font-medium">{t("ownRoles.serverRoles")}</p>
            {view.roles.map((role) => (
              <div key={role.id} className="flex flex-col gap-1.5" data-testid={`scoped-role-${role.id}`}>
                <p className="text-sm font-medium">{role.name}</p>
                {role.description ? <p className="text-xs text-muted-foreground">{role.description}</p> : null}
                {memberBoxes(role.id)}
              </div>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
      {editing ? (
        <RoleEditor
          kind={isTeam ? "team" : "organization"}
          role={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={async (data) => {
            if (editing === "new") await apiClient.createOwnRole(owner, data);
            else await apiClient.updateOwnRole(owner, editing.id, data);
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </Card>
  );
}
