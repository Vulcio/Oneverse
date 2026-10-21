import type { SetInvitePreview } from "@oneverse/core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthCard } from "@oneverse/app/components/auth-card";
import { AuthPage } from "@oneverse/app/components/auth-page";
import { SongverseBrand } from "#/components/brand";
import { LocaleProvider } from "@oneverse/app/components/locale-provider";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { loadLocale } from "@oneverse/app/i18n";
import { getSession, getVisitorLocale } from "@oneverse/app/server-auth";
import { setlistTitle } from "#/lib/setlists";

/** Where a set's share link leads: sign in if needed, then join the set as a guest. */
export const Route = createFileRoute("/set-invite/$token")({
  beforeLoad: async ({ params }) => {
    const session = await getSession();
    let preview: SetInvitePreview | null = null;
    let error: string | null = null;
    try {
      preview = await apiClient.getSetInvite(params.token);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const { hasGoogleAuth, signupInviteOnly } = session ? { hasGoogleAuth: false, signupInviteOnly: false } : await apiClient.getAuthPublicConfig();
    return { locale: await loadLocale(session?.locale ?? (await getVisitorLocale())), signedIn: !!session, preview, error, hasGoogleAuth, signupInviteOnly };
  },
  component: SetInvitePage,
});

// Outside the _protected layout, so it has to supply its own i18n instance.
function SetInvitePage() {
  const { locale } = Route.useRouteContext();
  return (
    <LocaleProvider locale={locale}>
      <SetInviteContent />
    </LocaleProvider>
  );
}

function SetInviteContent() {
  const { t } = useTranslation();
  const { token } = Route.useParams();
  const { signedIn, preview, error, hasGoogleAuth, signupInviteOnly } = Route.useRouteContext();

  return (
    <AuthPage brand={<SongverseBrand />}>
      {!preview ? (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{t("sets.joinUnavailableTitle")}</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          {signedIn ? (
            <CardContent>
              <Button render={<Link to="/sets" />}>{t("sets.goToSets")}</Button>
            </CardContent>
          ) : null}
        </Card>
      ) : (
        <>
          <InviteCard token={token} preview={preview} signedIn={signedIn} />
          {!signedIn ? (
            <>
              <p className="max-w-sm text-center text-sm text-muted-foreground">{t("sets.joinSignInPrompt")}</p>
              {/* The set's share link lets them sign up, also by invitation only (issue #198). */}
              <AuthCard redirectTo={`/set-invite/${token}`} hasGoogleAuth={hasGoogleAuth} signupInviteOnly={signupInviteOnly} invitePass={{ kind: "set", token }} />
            </>
          ) : null}
        </>
      )}
    </AuthPage>
  );
}

function InviteCard({ token, preview, signedIn }: { token: string; preview: SetInvitePreview; signedIn: boolean }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setPending(true);
    setError(null);
    try {
      const { setlistId } = await apiClient.joinSetInvite(token);
      await navigate({ to: "/sets/$setlistId", params: { setlistId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{setlistTitle(preview, t, i18n.language)}</CardTitle>
        <CardDescription>
          {preview.teamName
            ? t("sets.joinDescriptionTeam", { team: preview.teamName })
            : t("sets.joinDescription", { name: preview.ownerName ?? "" })}{" "}
          {t("sets.joinSongs", { count: preview.itemCount })}
        </CardDescription>
      </CardHeader>
      {signedIn ? (
        <CardContent className="flex flex-col gap-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button onClick={() => void join()} disabled={pending}>
            {pending ? t("sets.joining") : t("sets.join")}
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}
