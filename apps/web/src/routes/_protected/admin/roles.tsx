import type { AdminRole } from "@oneverse/core";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent } from "@oneverse/ui/components/card";
import { RoleEditor } from "#/components/role-editor";
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
          kind="server"
          role={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={async (data) => {
            if (editing === "new") await apiClient.adminCreateRole(data);
            else await apiClient.adminUpdateRole(editing.id, data);
            setEditing(null);
            await router.invalidate();
          }}
        />
      ) : null}
    </div>
  );
}
