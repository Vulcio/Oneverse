import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { EmailCard, LanguageCard, PasskeysCard, ProfileCard } from "@oneverse/app/components/account-cards";
import { NotificationSettingsCard } from "@oneverse/planning/components/notification-settings-card";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/account")({
  loader: () => apiClient.getMe(),
  component: AccountPage,
});

/**
 * One's account, in Planiverse (issue #242): the same as Songverse's - name
 * and picture, email, passkeys, language and first day of the week - and
 * how notifications reach one, with this device's (Planiverse's pushes come here).
 */
function AccountPage() {
  const { t } = useTranslation();
  const profile = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("nav.account")}</h1>
      <div className="grid grid-cols-1 items-start gap-6 @4xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          <ProfileCard api={apiClient} profile={profile} />
          <EmailCard email={profile.email} />
          <PasskeysCard />
          <LanguageCard api={apiClient} locale={profile.locale} weekStartsOn={profile.weekStartsOn} />
        </div>
        <NotificationSettingsCard />
      </div>
    </div>
  );
}
