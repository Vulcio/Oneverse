import { createFileRoute } from "@tanstack/react-router";
import { OneverseAccountCard, WeekStartCard } from "@oneverse/app/components/account-cards";
import { SettingsPage, settingsSection } from "@oneverse/app/components/settings-page";
import { NotificationSettingsCard } from "@oneverse/planning/components/notification-settings-card";
import { AvailabilitySummaryCard, NotificationsSummaryCard } from "@oneverse/planning/components/settings-summaries";
import { PlanSettings } from "@oneverse/planning/pages/plan-settings";
import { ArchivesCard } from "#/components/archives-card";
import { apiClient } from "#/lib/api-client";
import { setThemeChoice } from "#/lib/mode";
import { ChartDisplayCard, StorageCard } from "./-dashboard/account-cards";
import { RolesCard } from "./-dashboard/roles-card";

/**
 * One's settings, in Songverse (issue #540): the account's and
 * notifications, Songverse's own - what one plays or does, how charts
 * read, storage and backups - and Plan's (availability, the calendar),
 * whose screens Songverse has too.
 */
export const Route = createFileRoute("/_protected/settings/$section")({
  loader: async () => {
    const [profile, storage, customInstruments] = await Promise.all([apiClient.getMe(), apiClient.getMyStorage(), apiClient.listCustomInstruments()]);
    return { profile, storage, customInstruments };
  },
  component: SettingsRoute,
});

function SettingsRoute() {
  const { profile, storage, customInstruments } = Route.useLoaderData();
  const { section } = Route.useParams();
  return (
    <SettingsPage
      api={apiClient}
      profile={profile}
      section={settingsSection(section)}
      applyTheme={setThemeChoice}
      apps={{
        songverse: (
          <div className="grid grid-cols-1 items-start gap-6 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-testid="songverse-settings">
            <ChartDisplayCard profile={profile} />
            <div className="flex flex-col gap-6">
              <RolesCard profile={profile} customInstruments={customInstruments} />
              <StorageCard storage={storage} />
              {/* Your own backups (issue #351). */}
              <ArchivesCard owner={{ scope: "user" }} />
            </div>
          </div>
        ),
        plan: <PlanSettings weekStart={<WeekStartCard api={apiClient} weekStartsOn={profile.weekStartsOn} />} />,
      }}
      signIn={<OneverseAccountCard email={profile.email} />}
      notifications={<NotificationSettingsCard />}
      summaries={
        <>
          <NotificationsSummaryCard href="/settings/notifications" />
          <AvailabilitySummaryCard href="/settings/plan" />
        </>
      }
    />
  );
}
