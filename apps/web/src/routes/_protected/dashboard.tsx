import { createFileRoute, Link } from "@tanstack/react-router";
import { useMovedToSettings } from "@oneverse/app/components/moved-to-settings";
import { ListMusic, Mic2, Music2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RoleBadges } from "@oneverse/planning/components/role-badges";
import { Avatar, AvatarFallback, AvatarImage } from "@oneverse/ui/components/avatar";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { sizedAvatarUrl } from "@oneverse/ui/lib/avatar-url";
import { initials } from "@oneverse/ui/lib/initials";
import { artistNames } from "#/lib/artists";
import { OwnershipRequestsCard } from "./-dashboard/ownership-requests-card";
import { Empty, EmptyContent, EmptyDescription, EmptyMedia } from "@oneverse/ui/components/empty";

/** Where the dashboard's settings went (issue #540), for links and announcements made before. */
const MOVED = {
  settings: { section: "account" },
  notifications: { section: "notifications" },
  roles: { section: "songverse", hash: "roles" },
} as const;

export const Route = createFileRoute("/_protected/dashboard")({
  loader: async ({ context }) => {
    const [recent, stats, profile, ownershipRequests, customInstruments] = await Promise.all([
      apiClient.listSongVersions({ pageSize: 5 }),
      apiClient.getSongStats(),
      apiClient.getMe(),
      apiClient.listOwnershipRequests(),
      apiClient.listCustomInstruments(),
    ]);
    return { teams: context.teams, recentVersions: recent.items, stats, profile, ownershipRequests, customInstruments };
  },
  component: Dashboard,
});

function Dashboard() {
  useMovedToSettings(MOVED);
  const { t } = useTranslation();
  const { teams, recentVersions, stats, profile, ownershipRequests, customInstruments } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar className="size-14 shrink-0">
          {profile.avatarUrl ? <AvatarImage src={sizedAvatarUrl(profile.avatarUrl, 64)} alt="" /> : null}
          <AvatarFallback className="text-lg">{initials(profile.displayName)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div>
            <h1 className="text-2xl font-semibold">{t("dashboard.welcomeBack", { name: profile.displayName })}</h1>
            <p className="text-sm text-muted-foreground">{profile.email}</p>
          </div>
          {profile.instruments.length + profile.techRoles.length > 0 ? (
            <RoleBadges instruments={profile.instruments} techRoles={profile.techRoles} customInstruments={customInstruments} />
          ) : null}
        </div>
      </div>

      {/* Until they say what they play or do (issue #109): gone once they have. */}
      {profile.instruments.length + profile.techRoles.length === 0 ? (
        <Card data-testid="complete-profile">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm font-medium">{t("dashboard.completeProfile")}</p>
              <p className="text-sm text-muted-foreground">{t("dashboard.completeProfileHint")}</p>
            </div>
            <Button size="sm" render={<Link to="/settings/$section" params={{ section: "songverse" }} hash="roles" />}>
              {t("dashboard.addYourRoles")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <OwnershipRequestsCard requests={ownershipRequests} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Music2 className="size-5" />
            </div>
            <div>
              <p className="text-2xl font-semibold leading-none">{stats.songCount}</p>
              <p className="text-sm text-muted-foreground">{t("dashboard.songs")}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Mic2 className="size-5" />
            </div>
            <div>
              <p className="text-2xl font-semibold leading-none">{stats.artistCount}</p>
              <p className="text-sm text-muted-foreground">{t("dashboard.artists")}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Users className="size-5" />
            </div>
            <div>
              <p className="text-2xl font-semibold leading-none">{teams.length}</p>
              <p className="text-sm text-muted-foreground">{t("dashboard.teams")}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">{t("dashboard.recentlyUpdated")}</CardTitle>
            <Button variant="ghost" size="sm" render={<Link to="/library" />}>{t("dashboard.viewAll")}</Button>
          </CardHeader>
          <CardContent>
            {recentVersions.length === 0 ? (
              <Empty>
                <EmptyMedia>
                  <ListMusic />
                </EmptyMedia>
                <EmptyDescription>{t("dashboard.noSongsYet")}</EmptyDescription>
                <EmptyContent>
                  <Button size="sm" render={<Link to="/library/new" />}>{t("dashboard.addASong")}</Button>
                </EmptyContent>
              </Empty>
            ) : (
              <ul className="flex flex-col divide-y">
                {recentVersions.map((version) => (
                  <li key={version.id}>
                    <Link
                      to="/library/$songVersionId"
                      params={{ songVersionId: version.id }}
                      className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 hover:text-primary"
                    >
                      <div>
                        <p className="font-medium">
                          {version.title}
                          {version.versionName ? <span className="font-normal text-muted-foreground"> — {version.versionName}</span> : null}
                        </p>
                        {artistNames(version.artists) ? (
                          <p className="text-sm text-muted-foreground">{artistNames(version.artists)}</p>
                        ) : null}
                      </div>
                      <span className="text-xs whitespace-nowrap text-muted-foreground">
                        {new Date(version.updatedAt).toLocaleDateString()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">{t("dashboard.teams")}</CardTitle>
            <Button variant="ghost" size="sm" render={<Link to="/teams/new" />}>{t("teams.createTeam")}</Button>
          </CardHeader>
          <CardContent>
            {teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("dashboard.noTeamsYet")}</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {teams.map((team) => (
                  <li key={team.id}>
                    <Link
                      to="/teams/$teamId"
                      params={{ teamId: team.id }}
                      className="flex items-center justify-between py-3 first:pt-0 last:pb-0 hover:text-primary"
                    >
                      <span className="font-medium">{team.name}</span>
                      <span className="text-xs text-muted-foreground">{team.slug}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
