import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthCard } from "@oneverse/app/components/auth-card";
import { AuthPage } from "@oneverse/app/components/auth-page";
import { SongverseBrand } from "#/components/brand";
import { LocaleProvider } from "@oneverse/app/components/locale-provider";
import { SourceCodeLink } from "#/components/source-code-link";
import { apiClient } from "#/lib/api-client";
import { loadAppData } from "#/lib/app-data";
import { forgetOffline } from "#/lib/offline-db";
import { getVisitorLocale } from "@oneverse/app/server-auth";
import { loadLocale } from "@oneverse/app/i18n";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    // Through the app data, which offline falls back to the session kept on the device.
    const session = (await loadAppData())?.session;
    if (session) {
      throw redirect({ to: "/library" });
    }
    const [{ hasGoogleAuth, signupInviteOnly }, locale] = await Promise.all([apiClient.getAuthPublicConfig(), getVisitorLocale()]);
    return { hasGoogleAuth, signupInviteOnly, locale: await loadLocale(locale) };
  },
  component: Home,
});

function Home() {
  const { hasGoogleAuth, signupInviteOnly, locale } = Route.useRouteContext();
  // Signed out: nothing of the last user's stays on the device (issue #49).
  useEffect(() => void forgetOffline(), []);
  return (
    <LocaleProvider locale={locale}>
      <AuthPage brand={<SongverseBrand />}>
        <AuthCard hasGoogleAuth={hasGoogleAuth} signupInviteOnly={signupInviteOnly} />
        <SourceCodeLink />
      </AuthPage>
    </LocaleProvider>
  );
}
