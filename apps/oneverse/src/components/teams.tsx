import type { OrganizationSummary, TeamSummary } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { groupTree } from "@oneverse/planning/organizations";
import { NewTeamForm } from "@oneverse/planning/components/team-manage";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";

type Team = TeamSummary & { parentId: string | null };

/**
 * One's teams in Oneverse (issue #550): each organisation with its groups as
 * a tree, then main teams in no organisation with their sub-teams under them,
 * then the teams on their own. Each opens its page here; New team makes one,
 * on its own, inside an organisation one runs or under a main team one runs.
 */
export function TeamsPage({ teams, organizations }: { teams: TeamSummary[]; organizations: OrganizationSummary[] }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const all: Team[] = teams.map((team) => ({ ...team, parentId: team.parentId ?? null }));
  const ids = new Set(all.map((team) => team.id));
  // A team's parent one isn't in: shown at the top of its part.
  const shown = all.map((team) => (team.parentId && !ids.has(team.parentId) ? { ...team, parentId: null } : team));

  const byOrganization = new Map<string, { name: string; teams: Team[] }>();
  for (const organization of organizations) byOrganization.set(organization.id, { name: organization.name, teams: [] });
  for (const team of shown) {
    if (!team.organization) continue;
    const entry = byOrganization.get(team.organization.id) ?? { name: team.organization.name, teams: [] };
    entry.teams.push(team);
    byOrganization.set(team.organization.id, entry);
  }
  const loose = shown.filter((team) => !team.organization);
  const parents = new Set(loose.flatMap((team) => (team.parentId ? [team.parentId] : [])));
  const families = loose.filter((team) => team.parentId || parents.has(team.id));
  const single = loose.filter((team) => !team.parentId && !parents.has(team.id));

  const runOrganizations = organizations.filter((organization) => organization.currentUserRole === "ADMIN").map(({ id, name }) => ({ id, name }));
  const mainTeams = loose.filter((team) => team.currentUserRole === "ADMIN").map(({ id, name }) => ({ id, name }));

  return (
    <div className="flex flex-col gap-6" data-testid="teams-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("teams.pageTitle")}</h1>
        {creating ? null : (
          <Button onClick={() => setCreating(true)} data-testid="teams-new">
            <Plus />
            {t("teams.newTeam")}
          </Button>
        )}
      </div>
      {creating ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("teams.newTeam")}</CardTitle>
          </CardHeader>
          <CardContent>
            <NewTeamForm organizations={runOrganizations} mainTeams={mainTeams} onCancel={() => setCreating(false)} />
          </CardContent>
        </Card>
      ) : null}
      {teams.length === 0 && !creating ? <p className="text-sm text-muted-foreground">{t("hub.noTeams")}</p> : null}
      {[...byOrganization.entries()]
        .filter(([, entry]) => entry.teams.length > 0)
        .map(([id, entry]) => (
          <TeamsPart key={id} title={entry.name} teams={entry.teams} testId={`teams-organization-${id}`} />
        ))}
      {families.length > 0 ? <TeamsPart title={t("teams.noOrganization")} teams={families} testId="teams-families" /> : null}
      {single.length > 0 ? <TeamsPart title={families.length > 0 || byOrganization.size > 0 ? t("teams.standalone") : null} teams={single} testId="teams-single" /> : null}
    </div>
  );
}

function TeamsPart({ title, teams, testId }: { title: string | null; teams: Team[]; testId: string }) {
  const { t } = useTranslation();
  return (
    <Card data-testid={testId}>
      {title ? (
        <CardHeader>
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent>
        <ul className="flex flex-col divide-y">
          {groupTree(teams).map(({ group: team, depth }) => (
            <li key={team.id} data-depth={depth} style={{ paddingLeft: `${depth * 1.5}rem` }} data-testid="teams-row" data-team={team.id}>
              <Link to="/teams/$teamId" params={{ teamId: team.id }} className="flex items-center justify-between gap-4 py-3 hover:text-primary">
                <span className="flex min-w-0 items-center gap-3">
                  <EntityAvatar name={team.name} color={team.color} avatarUrl={team.avatarUrl} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{team.name}</span>
                    {team.description ? <span className="block truncate text-xs text-muted-foreground">{team.description}</span> : null}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{team.currentUserRole === "ADMIN" ? t("teams.roleAdmin") : t("teams.roleMember")}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
