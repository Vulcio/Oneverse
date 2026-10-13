import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthCard } from "@songverse/app/components/auth-card";
import { AuthPage } from "@songverse/app/components/auth-page";
import { LocaleProvider } from "@songverse/app/components/locale-provider";
import { loadLocale } from "@songverse/app/i18n";
import { getSession, getVisitorLocale } from "@songverse/app/server-auth";
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
