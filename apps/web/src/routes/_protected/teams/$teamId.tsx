import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { loadTeamPage, TeamPage } from "@oneverse/planning/pages/team";
import { AppearanceCard } from "#/components/appearance-card";
import { BrandsCard } from "#/components/brands-card";
import { SonicServerCard } from "#/components/sonic-server-card";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/teams/$teamId")({
  loader: async ({ context, params }) => {
    const data = await loadTeamPage(apiClient, params.teamId);
    if (!data) throw redirect({ to: "/dashboard" });
    return { userId: context.session.userId, data };
  },
  component: TeamDetail,
});

function TeamDetail() {
  const router = useRouter();
  const { userId, data } = Route.useLoaderData();
  const { team } = data;
  return (
    <TeamPage
      userId={userId}
      data={data}
      adminCards={
        <>
          {/* Its colour and picture (issue #161). */}
          <AppearanceCard owner="teams" id={team.id} name={team.name} color={team.color} avatarUrl={team.avatarUrl} onColor={(color) => apiClient.updateTeam(team.id, { color })} onChanged={() => router.invalidate()} />
          {/* Its brands (issue #279), for a team that uses Songverse. */}
          {team.usesSongverse !== false ? <BrandsCard owner={{ teamId: team.id }} /> : null}
          {/* Its own Sonic server for its songs' stems (issue #300). */}
          {team.usesSongverse !== false ? <SonicServerCard owner={{ teamId: team.id }} /> : null}
        </>
      }
    />
  );
}
