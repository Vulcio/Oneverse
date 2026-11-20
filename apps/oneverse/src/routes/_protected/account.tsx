import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { publicEnvValue } from "@oneverse/app/public-env";
import { EmailCard, LanguageCard, PasskeysCard, ProfileCard } from "@oneverse/app/components/account-cards";
import { AwaitingApprovalCard } from "@oneverse/app/components/awaiting-approval";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/account")({
  loader: () => apiClient.getMe(),
  component: AccountPage,
});

/**
 * One's Oneverse account (issue #303): name and picture, email, passkeys,
 * language - the same for every app - and the way to each app. Waiting
 * for an organisation's approval (issue #533), where it stands instead.
 */
function AccountPage() {
  const { t } = useTranslation();
  const profile = Route.useLoaderData();
  const apps = [
    { name: "Songverse", address: publicEnvValue("SONGVERSE_URL") ?? "http://localhost:3000" },
    ...(publicEnvValue("PLANIVERSE_URL") ? [{ name: "Oneverse Plan", address: publicEnvValue("PLANIVERSE_URL") ?? "" }] : []),
  ];
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("nav.account")}</h1>
      {/* Signed up asking for an organisation, not approved yet (issue #533): where it stands first. */}
      {profile.awaitingApproval ? <AwaitingApprovalCard api={apiClient} profile={profile} /> : null}
      <div className="grid grid-cols-1 items-start gap-6 @3xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          <ProfileCard api={apiClient} profile={profile} />
          <EmailCard email={profile.email} />
        </div>
        <div className="flex flex-col gap-6">
          <PasskeysCard />
          <LanguageCard api={apiClient} locale={profile.locale} weekStartsOn={profile.weekStartsOn} />
          {profile.awaitingApproval ? null : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("account.apps")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {apps.map((app) => (
                <Button key={app.name} variant="outline" render={<a href={app.address} />}>
                  {app.name}
                </Button>
              ))}
            </CardContent>
          </Card>
          )}
        </div>
      </div>
    </div>
  );
}
