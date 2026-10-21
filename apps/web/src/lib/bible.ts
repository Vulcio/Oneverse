import type { MyOrganizations, TeamSummary } from "@oneverse/core";

/** Whether the Bible is in one's sidebar (issue #310): one of one's teams, or of one's organisations, turned it on. */
export function bibleTurnedOn(teams: TeamSummary[], organizations: MyOrganizations | null | undefined): boolean {
  return teams.some((team) => team.bible || team.organization?.bible) || !!organizations?.organizations.some((organization) => organization.bible);
}
