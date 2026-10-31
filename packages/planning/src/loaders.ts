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
  const [events, presets, members, customInstruments] = await Promise.all([
    api.listOrganizationEvents(organizationId),
    api.listOrganizationEventPresets(organizationId),
    api.listOrganizationMembers(organizationId),
    api.listCustomInstruments(),
  ]);
  return { organization, events, presets, members, customInstruments };
}
