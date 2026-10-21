import type { SignupInvitationPreview } from "@oneverse/core";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AuthPage } from "@oneverse/app/components/auth-page";
import { SongverseBrand } from "#/components/brand";
import { LocaleProvider } from "@oneverse/app/components/locale-provider";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { loadLocale } from "@oneverse/app/i18n";
import { getSession, getVisitorLocale } from "@oneverse/app/server-auth";
import { signInFirst } from "@oneverse/app/join";

/**
 * An invitation to create an account (issue #198): off to Oneverse (issue
 * #303), its email filled in, the sign-up tab open; or why it can't be used.
 */
export const Route = createFileRoute("/invite/$token")({
  beforeLoad: async ({ params }) => {
    const session = await getSession();
    let invitation: SignupInvitationPreview | null = null;
    try {
      invitation = await apiClient.getSignupInvitation(params.token);
    } catch {
      // Removed, or never was: said below.
    }
    if (invitation?.status === "pending" && !session) throw signInFirst("/library", { kind: "signup", token: params.token }, invitation.email);
    return { locale: await loadLocale(session?.locale ?? (await getVisitorLocale())), signedIn: !!session, invitation };
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
  const { signedIn, invitation } = Route.useRouteContext();

  return (
    <AuthPage brand={<SongverseBrand />}>
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
          <Button render={<a href={signedIn ? "/library" : "/"} />}>{signedIn ? t("auth.goToLibrary") : t("auth.backToSignIn")}</Button>
        </CardContent>
      </Card>
    </AuthPage>
  );
}
