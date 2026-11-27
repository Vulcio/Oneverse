import { createFileRoute } from "@tanstack/react-router";
import { EmailCard, PasskeysCard, PasswordCard } from "@oneverse/app/components/account-cards";
import { AwaitingApprovalCard } from "@oneverse/app/components/awaiting-approval";
import { SettingsPage, settingsSection } from "@oneverse/app/components/settings-page";
import { NotificationSettingsCard } from "@oneverse/planning/components/notification-settings-card";
import { NotificationsSummaryCard } from "@oneverse/planning/components/settings-summaries";
import { apiClient } from "#/lib/api-client";

/**
 * One's settings at Oneverse (issues #303, #540): the account - with its
 * email, password and passkeys, Oneverse's - and notifications; each app's
 * own open in that app. Waiting for an organisation's approval (issue
 * #533), where it stands comes first.
 */
export const Route = createFileRoute("/_protected/settings/$section")({
  loader: () => apiClient.getMe(),
  component: SettingsRoute,
});

function SettingsRoute() {
  const profile = Route.useLoaderData();
  const { section } = Route.useParams();
  const waiting = !!profile.awaitingApproval;
  return (
    <SettingsPage
      api={apiClient}
      profile={profile}
      section={waiting ? "account" : settingsSection(section)}
      apps={{}}
      before={waiting ? <AwaitingApprovalCard api={apiClient} profile={profile} /> : null}
      signIn={
        <>
          <EmailCard email={profile.email} />
          <PasswordCard />
          <PasskeysCard />
        </>
      }
      notifications={<NotificationSettingsCard />}
      summaries={waiting ? null : <NotificationsSummaryCard href="/settings/notifications" />}
    />
  );
}
