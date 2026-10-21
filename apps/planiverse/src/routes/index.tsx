import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthCard } from "@oneverse/app/components/auth-card";
import { AuthPage } from "@oneverse/app/components/auth-page";
import { LocaleProvider } from "@oneverse/app/components/locale-provider";
import { loadLocale } from "@oneverse/app/i18n";
import { getSession, getVisitorLocale } from "@oneverse/app/server-auth";
import { PlaniverseBrand } from "#/components/brand";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (await getSession()) throw redirect({ to: "/calendar" });
    const [{ hasGoogleAuth, signupInviteOnly }, locale] = await Promise.all([apiClient.getAuthPublicConfig(), getVisitorLocale()]);
    return { hasGoogleAuth, signupInviteOnly, locale: await loadLocale(locale) };
  },
  component: Home,
});

/** Signing in to Planiverse (issue #241): the same account as Songverse's. */
function Home() {
  const { hasGoogleAuth, signupInviteOnly, locale } = Route.useRouteContext();
  return (
    <LocaleProvider locale={locale}>
      <AuthPage brand={<PlaniverseBrand />}>
        <AuthCard redirectTo="/calendar" hasGoogleAuth={hasGoogleAuth} signupInviteOnly={signupInviteOnly} />
      </AuthPage>
    </LocaleProvider>
  );
}
