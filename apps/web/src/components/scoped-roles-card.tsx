import type { ScopedRolesView } from "@oneverse/core";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";

/**
 * Roles a team's or an organisation's admins give their own members, there
 * only (issue #270): those Admin > Roles lets teams give, like the media
 * operator, who runs the screens of its sets without editing them. Nothing
 * shows when there are none.
 */
export function ScopedRolesCard({ owner, members }: { owner: { teamId: string } | { organizationId: string }; members: { userId: string; displayName: string }[] }) {
  const { t } = useTranslation();
  const [view, setView] = useState<ScopedRolesView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isTeam = "teamId" in owner;
  const ownerId = isTeam ? owner.teamId : owner.organizationId;

  useEffect(() => {
    void (isTeam ? apiClient.getTeamScopedRoles(ownerId) : apiClient.getOrganizationScopedRoles(ownerId)).then(setView, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [isTeam, ownerId]);

  if (view && view.roles.length === 0) return null;
  const rolesOf = (userId: string) => view?.members.find((one) => one.userId === userId)?.roleIds ?? [];

  async function toggle(userId: string, roleId: string, on: boolean) {
    const roleIds = on ? [...rolesOf(userId), roleId] : rolesOf(userId).filter((id) => id !== roleId);
    setBusy(`${userId}-${roleId}`);
    setError(null);
    try {
      if ("teamId" in owner) await apiClient.setTeamMemberRoles(owner.teamId, userId, { roleIds });
      else await apiClient.setOrganizationMemberRoles(owner.organizationId, userId, { roleIds });
      setView((before) => before && { ...before, members: [...before.members.filter((one) => one.userId !== userId), { userId, roleIds }] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card data-testid="scoped-roles-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4" aria-hidden />
          {t("scopedRoles.title")}
        </CardTitle>
        <CardDescription>{t("teamId" in owner ? "scopedRoles.descriptionTeam" : "scopedRoles.descriptionOrganization")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {(view?.roles ?? []).map((role) => (
          <div key={role.id} className="flex flex-col gap-1.5" data-testid={`scoped-role-${role.id}`}>
            <p className="text-sm font-medium">{role.name}</p>
            {role.description ? <p className="text-xs text-muted-foreground">{role.description}</p> : null}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {members.map((member) => (
                <label key={member.userId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={rolesOf(member.userId).includes(role.id)}
                    disabled={busy !== null}
                    onChange={(event) => void toggle(member.userId, role.id, event.target.checked)}
                    data-testid={`scoped-role-${role.id}-${member.userId}`}
                  />
                  {member.displayName}
                </label>
              ))}
            </div>
          </div>
        ))}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
