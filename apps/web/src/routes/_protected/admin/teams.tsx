import type { AdminTeamSummary } from "@oneverse/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card } from "@oneverse/ui/components/card";
import { DataTable } from "@oneverse/ui/components/data-table";
import { apiClient } from "#/lib/api-client";
import { formatBytes } from "#/lib/format-bytes";
import { RolesDialog } from "./-roles-dialog";

export const Route = createFileRoute("/_protected/admin/teams")({
  loader: async () => {
    const [teams, roles] = await Promise.all([apiClient.adminListTeams(), apiClient.adminListRoles()]);
    return { teams, roles };
  },
  component: AdminTeamsPage,
});

/**
 * Admin > Teams (issue #160): every team, its members and songs, its
 * storage pool - what's on its songs, whoever uploaded it - and its roles,
 * which apply to each of its members (and a storage tier, to its pool).
 */
function AdminTeamsPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { teams, roles } = Route.useLoaderData();
  const [editing, setEditing] = useState<AdminTeamSummary | null>(null);

  const columns = useMemo<ColumnDef<AdminTeamSummary>[]>(
    () => [
      {
        id: "team",
        accessorFn: (team) => team.name,
        header: t("admin.columnTeam"),
        cell: ({ row }) => {
          const team = row.original;
          return (
            <div className="flex min-w-0 items-start gap-3">
              <EntityAvatar name={team.name} color={team.color} avatarUrl={team.avatarUrl} size={32} />
              <div className="min-w-0">
                <p className="font-medium">{team.name}</p>
                {team.roles.length ? (
                  <p className="mt-1 flex flex-wrap gap-1" data-testid="team-roles">
                    {team.roles.map((role) => (
                      <Badge key={role.id} variant="muted">
                        {role.name}
                      </Badge>
                    ))}
                  </p>
                ) : null}
              </div>
            </div>
          );
        },
      },
      { accessorKey: "memberCount", header: t("admin.columnMembers"), meta: { secondary: true } },
      { accessorKey: "songCount", header: t("admin.columnSongs"), meta: { secondary: true } },
      {
        accessorKey: "usedBytes",
        header: t("admin.columnTeamStorage"),
        cell: ({ row }) => (
          <span className="text-sm">
            {formatBytes(row.original.usedBytes)} / {formatBytes(row.original.limitBytes)}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: t("admin.columnCreated"),
        meta: { secondary: true },
        cell: ({ row }) => <span className="text-muted-foreground">{new Date(row.original.createdAt).toLocaleDateString(i18n.language)}</span>,
      },
      {
        id: "actions",
        header: () => null,
        enableSorting: false,
        cell: ({ row }) => (
          <Button variant="outline" size="sm" onClick={() => setEditing(row.original)} data-testid={`team-roles-${row.original.id}`}>
            {t("admin.actionRoles")}
          </Button>
        ),
      },
    ],
    [t, i18n.language],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("nav.adminTeams")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.teamsDescription")}</p>
      </div>
      <Card className="p-0">
        <DataTable columns={columns} data={teams} filterPlaceholder={t("admin.teamsFilterPlaceholder")} />
      </Card>
      {editing ? (
        <RolesDialog
          title={t("admin.teamRolesTitle", { name: editing.name })}
          description={t("admin.teamRolesDescription")}
          roles={roles}
          selected={editing.roles.map((role) => role.id)}
          onClose={() => setEditing(null)}
          onSave={async (roleIds) => {
            await apiClient.adminSetTeamRoles(editing.id, { roleIds });
            setEditing(null);
            await router.invalidate();
          }}
        />
      ) : null}
    </div>
  );
}
