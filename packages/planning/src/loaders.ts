import type { ApiClient } from "@oneverse/core";

/**
 * What the planning pages load (issue #343), kept apart from the pages: a route's loader is in the
 * app's first chunk, so importing it from a page would bring the whole page there too.
 */

/** What a team's (a group's) page needs, or null when there's no such team or it isn't theirs. */
export async function loadTeamPage(api: ApiClient, teamId: string) {
  const team = await api.getTeam(teamId).catch(() => null);
  if (!team) return null;
  const [members, inviteLinks, customInstruments, organizations, positions, organization] = await Promise.all([
    api.listTeamMembers(teamId),
    team.currentUserRole === "ADMIN" ? api.listTeamInviteLinks(teamId) : [],
    api.listCustomInstruments(),
    api.listMyOrganizations().catch(() => null),
    api.listTeamPositions(teamId),
    // Its organisation's groups (issue #241), for where it sits.
    team.organization ? api.getOrganization(team.organization.id).catch(() => null) : null,
  ]);
  return { team, members, inviteLinks, customInstruments, organizations, positions, organization };
}

/** What the page needs, or null when there's no such organisation (or it isn't theirs to see). */
export async function loadOrganizationPage(api: ApiClient, organizationId: string) {
  const organization = await api.getOrganization(organizationId).catch(() => null);
  if (!organization) return null;
  const [members, inviteLinks, mine] = await Promise.all([
    api.listOrganizationMembers(organizationId),
    organization.currentUserRole === "ADMIN" ? api.listOrganizationInviteLinks(organizationId) : [],
    api.listMyOrganizations(),
  ]);
  return { organization, members, inviteLinks, mode: mine.mode };
}

/** What the page needs, or null when there's no such organisation (or it isn't theirs to see). */
export async function loadOrganizationEventsPage(api: ApiClient, organizationId: string) {
  const organization = await api.getOrganization(organizationId).catch(() => null);
  if (!organization) return null;
  const [events, types, members, customInstruments] = await Promise.all([
    api.listOrganizationEvents(organizationId),
    api.listOrganizationEventTypes(organizationId),
    api.listOrganizationMembers(organizationId),
    api.listCustomInstruments(),
  ]);
  return { organization, events, types, members, customInstruments };
}

/**
 * What the Calendar section (issue #551) needs: one's teams and
 * organisations to pick from, and the chosen calendar's own - a team's
 * (positions, instruments, whether it's in an organisation) or an
 * organisation's events and types. `of`: "me", "team:<id>" or
 * "organization:<id>"; one that isn't theirs falls back to My calendar.
 */
export async function loadCalendarSection(api: ApiClient, of: string | undefined) {
  const [teams, organizations] = await Promise.all([api.listTeams(true), api.listMyOrganizations().catch(() => null)]);
  const [kind, id] = (of ?? "me").split(":") as [string, string | undefined];
  if (kind === "team" && id && teams.some((one) => one.id === id)) {
    const [team, positions, customInstruments] = await Promise.all([api.getTeam(id), api.listTeamPositions(id), api.listCustomInstruments()]);
    return { teams, organizations, chosen: { kind: "team" as const, team, positions, customInstruments } };
  }
  if (kind === "organization" && id && organizations?.organizations.some((one) => one.id === id)) {
    const data = await loadOrganizationEventsPage(api, id);
    if (data) return { teams, organizations, chosen: { kind: "organization" as const, data } };
  }
  return { teams, organizations, chosen: { kind: "me" as const } };
}
