import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "#/components/home";
import { apiClient } from "#/lib/api-client";

/** Oneverse's home (issue #538): where one lands once signed in. */
export const Route = createFileRoute("/_protected/")({
  loader: async () => {
    const [profile, organizations, teams] = await Promise.all([apiClient.getMe(), apiClient.listMyOrganizations(), apiClient.listTeams(true)]);
    return { profile, organizations: organizations.organizations, teams };
  },
  component: HomeRoute,
});

function HomeRoute() {
  const { profile, organizations, teams } = Route.useLoaderData();
  return <HomePage name={profile.displayName} isGlobalAdmin={profile.isGlobalAdmin} organizations={organizations} teams={teams} />;
}
