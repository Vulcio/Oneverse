import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AuthCard } from "@songverse/app/components/auth-card";
import { AuthPage } from "@songverse/app/components/auth-page";
import { SongverseBrand } from "#/components/brand";
import { LocaleProvider } from "@songverse/app/components/locale-provider";
import { apiClient } from "#/lib/api-client";
import { getSession, getVisitorLocale } from "@songverse/app/server-auth";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { loadLocale } from "@songverse/app/i18n";

export const Route = createFileRoute("/join/$token")({
  beforeLoad: async ({ params }) => {
    const session = await getSession();
    if (!session) {
      const [{ hasGoogleAuth, signupInviteOnly }, locale] = await Promise.all([apiClient.getAuthPublicConfig(), getVisitorLocale()]);
      return { error: null, hasGoogleAuth, signupInviteOnly, locale: await loadLocale(locale) };
    }

    let team: Awaited<ReturnType<typeof apiClient.joinTeamByToken>> | null = null;
    let joinError: string | null = null;
    try {
      team = await apiClient.joinTeamByToken(params.token);
    } catch (error) {
      joinError = error instanceof Error ? error.message : String(error);
    }

    if (team) {
      throw redirect({ to: "/teams/$teamId", params: { teamId: team.id } });
    }
    // Already signed in at this point, so <AuthCard> never renders below -
    // no need to resolve the real value.
    return { error: joinError, hasGoogleAuth: false, signupInviteOnly: false, locale: await loadLocale(session.locale) };
  },
  component: JoinTeamPage,
});

function JoinTeamPage() {
  const { locale } = Route.useRouteContext();
  return (
    <LocaleProvider locale={locale}>
      <JoinTeamContent />
    </LocaleProvider>
  );
}

function JoinTeamContent() {
  const { t } = useTranslation();
  const { token } = Route.useParams();
  const { error, hasGoogleAuth, signupInviteOnly } = Route.useRouteContext();

  return (
    <AuthPage brand={<SongverseBrand />}>
      {error ? (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{t("auth.joinTeamFailed")}</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link to="/dashboard" />}>{t("auth.goToDashboard")}</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="max-w-sm text-center text-sm text-muted-foreground">{t("auth.joinTeamPrompt")}</p>
          {/* The team's invite link lets them sign up, also by invitation only (issue #198). */}
          <AuthCard redirectTo={`/join/${token}`} hasGoogleAuth={hasGoogleAuth} signupInviteOnly={signupInviteOnly} invitePass={{ kind: "team", token }} />
        </>
      )}
    </AuthPage>
  );
}
