import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@songverse/ui/components/card";
import { EntityAvatar } from "@songverse/ui/components/entity-avatar";
import { groupTree } from "@songverse/planning/organizations";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/teams/")({
  // Every one of theirs, groups that only plan too (issue #242).
  loader: () => apiClient.listTeams(true),
  component: TeamsPage,
});

/**
 * One's teams and groups, those in no organisation too (issue #242): each
 * opens its page, a sub-group under its group when one's in both (issue #246).
 */
function TeamsPage() {
  const { t } = useTranslation();
  const teams = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("nav.teams")}</h1>
      <Card>
        <CardContent>
          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("teams.noTeamsYet")}</p>
          ) : (
            <ul className="flex flex-col divide-y" data-testid="teams-list">
              {groupTree(teams.map((one) => ({ ...one, parentId: one.parentId ?? null }))).map(({ group: team, depth }) => (
                <li key={team.id} data-depth={depth} style={{ paddingLeft: `${depth * 1.5}rem` }}>
                  <Link to="/teams/$teamId" params={{ teamId: team.id }} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 hover:text-primary">
                    <div className="flex min-w-0 items-center gap-3">
                      <EntityAvatar name={team.name} color={team.color} avatarUrl={team.avatarUrl} size={36} />
                      <div className="min-w-0">
                        <p className="font-medium">{team.name}</p>
                        {team.organization ? <p className="text-xs text-muted-foreground">{t("organizations.partOf", { name: team.organization.name })}</p> : null}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{team.currentUserRole === "ADMIN" ? t("teams.roleAdmin") : t("teams.roleMember")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
