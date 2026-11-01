import { createFileRoute, Link } from "@tanstack/react-router";
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
import { LanguageCard, OneverseAccountCard, ProfileCard } from "@oneverse/app/components/account-cards";
import { ChartDisplayCard, StorageCard } from "./-dashboard/account-cards";
import { NotificationSettingsCard } from "@oneverse/planning/components/notification-settings-card";
import { OwnershipRequestsCard } from "./-dashboard/ownership-requests-card";
import { RolesCard } from "./-dashboard/roles-card";

export const Route = createFileRoute("/_protected/dashboard")({
  loader: async ({ context }) => {
    const [recent, stats, profile, storage, ownershipRequests, customInstruments] = await Promise.all([
      apiClient.listSongVersions({ pageSize: 5 }),
      apiClient.getSongStats(),
      apiClient.getMe(),
      apiClient.getMyStorage(),
      apiClient.listOwnershipRequests(),
      apiClient.listCustomInstruments(),
    ]);
    return { teams: context.teams, recentVersions: recent.items, stats, profile, storage, ownershipRequests, customInstruments };
  },
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslation();
  const { teams, recentVersions, stats, profile, storage, ownershipRequests, customInstruments } = Route.useLoaderData();
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
            <Button size="sm" render={<a href="#roles" />}>
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
              <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
                <ListMusic className="size-8" />
                <p>{t("dashboard.noSongsYet")}</p>
                <Button size="sm" render={<Link to="/library/new" />}>{t("dashboard.addASong")}</Button>
              </div>
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

      <section id="settings" className="flex scroll-mt-16 flex-col gap-4 border-t pt-6">
        <div>
          <h2 className="text-lg font-semibold">{t("dashboard.settings")}</h2>
          <p className="text-sm text-muted-foreground">{t("dashboard.settingsDescription")}</p>
        </div>
        {/* Flowed down two columns, three with room (issue #177), in reading order: a card never split. */}
        <div className="gap-6 lg:columns-2 @7xl:columns-3 [&>*]:mb-6 [&>*]:break-inside-avoid">
          <ProfileCard api={apiClient} profile={profile} />
          <RolesCard profile={profile} customInstruments={customInstruments} />
          <OneverseAccountCard email={profile.email} />
          <StorageCard storage={storage} />
          <LanguageCard api={apiClient} locale={profile.locale} weekStartsOn={profile.weekStartsOn} />
          <NotificationSettingsCard />
          <ChartDisplayCard profile={profile} />
        </div>
      </section>
    </div>
  );
}
