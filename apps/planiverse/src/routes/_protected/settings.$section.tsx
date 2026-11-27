import { createFileRoute } from "@tanstack/react-router";
import { OneverseAccountCard, WeekStartCard } from "@oneverse/app/components/account-cards";
import { SettingsPage, settingsSection } from "@oneverse/app/components/settings-page";
import { NotificationSettingsCard } from "@oneverse/planning/components/notification-settings-card";
import { AvailabilitySummaryCard, NotificationsSummaryCard } from "@oneverse/planning/components/settings-summaries";
import { PlanSettings } from "@oneverse/planning/pages/plan-settings";
import { apiClient } from "#/lib/api-client";

/** One's settings, in Plan (issue #540): the account's and notifications, and Plan's own (availability, the calendar). */
export const Route = createFileRoute("/_protected/settings/$section")({
  loader: () => apiClient.getMe(),
  component: SettingsRoute,
});

function SettingsRoute() {
  const profile = Route.useLoaderData();
  const { section } = Route.useParams();
  return (
    <SettingsPage
      api={apiClient}
      profile={profile}
      section={settingsSection(section)}
      apps={{ plan: <PlanSettings weekStart={<WeekStartCard api={apiClient} weekStartsOn={profile.weekStartsOn} />} /> }}
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
