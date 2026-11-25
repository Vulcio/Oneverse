import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { loadTeamPage } from "@oneverse/planning/loaders";
import { TeamPage } from "@oneverse/planning/pages/team";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { appAddresses } from "#/lib/apps";

/** A team's page in Oneverse (issue #550): managed here, its Songverse settings a link away. */
export const Route = createFileRoute("/_protected/teams/$teamId")({
  loader: async ({ context, params }) => {
    const data = await loadTeamPage(apiClient, params.teamId);
    if (!data) throw redirect({ to: "/teams" });
    return { userId: context.session.userId, data };
  },
  component: function Page() {
    const { userId, data } = Route.useLoaderData();
    return <TeamPage userId={userId} data={data} adminCards={data.team.usesSongverse === false ? null : <SongverseSettings teamId={data.team.id} />} />;
  },
});

/** What only Songverse has (brands, archives, Sonic server, songs played often, the Bible): on the team's page there. */
function SongverseSettings({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const { songverse } = appAddresses();
  return (
    <Card data-testid="team-songverse-settings">
      <CardHeader>
        <CardTitle className="text-sm">{t("teams.songverseSettingsTitle")}</CardTitle>
        <CardDescription>{t("teams.songverseSettingsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" render={<a href={`${songverse}/teams/${teamId}`} />} data-testid="team-songverse-link">
          <ExternalLink />
          {t("teams.openInSongverse")}
        </Button>
      </CardContent>
    </Card>
  );
}
