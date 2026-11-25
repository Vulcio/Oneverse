import { createFileRoute } from "@tanstack/react-router";
import { TeamsPage } from "#/components/teams";
import { apiClient } from "#/lib/api-client";

/** One's teams (issue #550): by organisation, then main teams with their sub-teams, then the others; and a new one. */
export const Route = createFileRoute("/_protected/teams/")({
  loader: async () => {
    const [teams, organizations] = await Promise.all([apiClient.listTeams(true), apiClient.listMyOrganizations().catch(() => null)]);
    return { teams, organizations: organizations && organizations.mode !== "NONE" ? organizations.organizations : [] };
  },
  component: function Page() {
    const { teams, organizations } = Route.useLoaderData();
    return <TeamsPage teams={teams} organizations={organizations} />;
  },
});
