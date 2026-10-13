import { createFileRoute, redirect } from "@tanstack/react-router";
import { loadTeamPage, TeamPage } from "@songverse/planning/pages/team";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/teams/$teamId")({
  loader: async ({ context, params }) => {
    const data = await loadTeamPage(apiClient, params.teamId);
    if (!data) throw redirect({ to: "/calendar" });
    return { userId: context.session.userId, data };
  },
  component: function Page() {
    const { userId, data } = Route.useLoaderData();
    return <TeamPage userId={userId} data={data} />;
  },
});
