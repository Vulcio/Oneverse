import type { SignupInvitationPreview } from "@songverse/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AuthCard } from "@songverse/app/components/auth-card";
import { AuthPage } from "@songverse/app/components/auth-page";
import { SongverseBrand } from "#/components/brand";
import { LocaleProvider } from "@songverse/app/components/locale-provider";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { loadLocale } from "@songverse/app/i18n";
import { getSession, getVisitorLocale } from "@songverse/app/server-auth";

/** An invitation to create an account (issue #198): its email filled in, the sign-up tab open. */
export const Route = createFileRoute("/invite/$token")({
  beforeLoad: async ({ params }) => {
    const session = await getSession();
    let invitation: SignupInvitationPreview | null = null;
    try {
      invitation = await apiClient.getSignupInvitation(params.token);
    } catch {
      // Removed, or never was: said below.
    }
    const { hasGoogleAuth } = session ? { hasGoogleAuth: false } : await apiClient.getAuthPublicConfig();
    return { locale: await loadLocale(session?.locale ?? (await getVisitorLocale())), signedIn: !!session, invitation, hasGoogleAuth };
  },
  component: InvitePage,
});

// Outside the _protected layout, so it has to supply its own i18n instance.
function InvitePage() {
  const { locale } = Route.useRouteContext();
  return (
    <LocaleProvider locale={locale}>
      <InviteContent />
    </LocaleProvider>
  );
}

function InviteContent() {
  const { t } = useTranslation();
  const { token } = Route.useParams();
  const { signedIn, invitation, hasGoogleAuth } = Route.useRouteContext();
  const usable = invitation?.status === "pending" && !signedIn;

  return (
    <AuthPage brand={<SongverseBrand />}>
      {usable ? (
        <>
          <p className="max-w-sm text-center text-sm text-muted-foreground" data-testid="invite-prompt">
            {t("auth.invitePrompt", { email: invitation.email })}
          </p>
          <AuthCard hasGoogleAuth={hasGoogleAuth} signupInviteOnly invitePass={{ kind: "signup", token }} email={invitation.email} />
        </>
      ) : (
        <Card className="w-full max-w-sm" data-testid="invite-unavailable">
          <CardHeader>
            <CardTitle>{signedIn ? t("auth.inviteSignedInTitle") : t("auth.inviteUnavailableTitle")}</CardTitle>
            <CardDescription>
              {signedIn
                ? t("auth.inviteSignedIn")
                : invitation?.status === "accepted"
                  ? t("auth.inviteAccepted")
                  : invitation?.status === "expired"
                    ? t("auth.inviteExpired")
                    : t("auth.inviteNotFound")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link to={signedIn ? "/library" : "/"} />}>{signedIn ? t("auth.goToLibrary") : t("auth.backToSignIn")}</Button>
          </CardContent>
        </Card>
      )}
    </AuthPage>
  );
}
