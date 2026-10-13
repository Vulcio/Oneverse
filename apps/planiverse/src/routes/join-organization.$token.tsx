import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AuthCard } from "@songverse/app/components/auth-card";
import { AuthPage } from "@songverse/app/components/auth-page";
import { PlaniverseBrand } from "#/components/brand";
import { LocaleProvider } from "@songverse/app/components/locale-provider";
import { apiClient } from "#/lib/api-client";
import { getSession, getVisitorLocale } from "@songverse/app/server-auth";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { loadLocale } from "@songverse/app/i18n";

export const Route = createFileRoute("/join-organization/$token")({
  beforeLoad: async ({ params }) => {
    const session = await getSession();
    if (!session) {
      const [{ hasGoogleAuth, signupInviteOnly }, locale] = await Promise.all([apiClient.getAuthPublicConfig(), getVisitorLocale()]);
      return { error: null, hasGoogleAuth, signupInviteOnly, locale: await loadLocale(locale) };
    }

    let organization: Awaited<ReturnType<typeof apiClient.joinOrganizationByToken>> | null = null;
    let joinError: string | null = null;
    try {
      organization = await apiClient.joinOrganizationByToken(params.token);
    } catch (error) {
      joinError = error instanceof Error ? error.message : String(error);
    }

    if (organization) {
      throw redirect({ to: "/organizations/$organizationId", params: { organizationId: organization.id } });
    }
    // Already signed in at this point, so <AuthCard> never renders below -
    // no need to resolve the real value.
    return { error: joinError, hasGoogleAuth: false, signupInviteOnly: false, locale: await loadLocale(session.locale) };
  },
  component: JoinOrganizationPage,
});

function JoinOrganizationPage() {
  const { locale } = Route.useRouteContext();
  return (
    <LocaleProvider locale={locale}>
      <JoinOrganizationContent />
    </LocaleProvider>
  );
}

function JoinOrganizationContent() {
  const { t } = useTranslation();
  const { token } = Route.useParams();
  const { error, hasGoogleAuth, signupInviteOnly } = Route.useRouteContext();

  return (
    <AuthPage brand={<PlaniverseBrand />}>
      {error ? (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{t("organizations.joinFailed")}</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link to="/calendar" />}>{t("auth.goToDashboard")}</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="max-w-sm text-center text-sm text-muted-foreground">{t("organizations.joinPrompt")}</p>
          {/* The organisation's invite link lets them sign up, also by invitation only (issue #241, as a team's). */}
          <AuthCard redirectTo={`/join-organization/${token}`} hasGoogleAuth={hasGoogleAuth} signupInviteOnly={signupInviteOnly} invitePass={{ kind: "organization", token }} />
        </>
      )}
    </AuthPage>
  );
}
