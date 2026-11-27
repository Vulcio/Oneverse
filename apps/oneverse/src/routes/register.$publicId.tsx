import type { PublicRegistrationPage } from "@oneverse/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AuthPage } from "@oneverse/app/components/auth-page";
import { LocaleProvider } from "@oneverse/app/components/locale-provider";
import { RegisterPage } from "@oneverse/app/components/registration-pages";
import { ThemeSwitch } from "@oneverse/app/components/theme-switch";
import { loadLocale } from "@oneverse/app/i18n";
import { getSession, getVisitorLocale } from "@oneverse/app/server-auth";
import { OneverseBrand } from "#/components/brand";
import { apiClient } from "#/lib/api-client";

/** An event's registration page (issue #593): anyone with its link registers, signed in or not. */
export const Route = createFileRoute("/register/$publicId")({
  beforeLoad: async ({ params }) => {
    const session = await getSession();
    let page: PublicRegistrationPage | null = null;
    try {
      page = await apiClient.getRegistrationPage(params.publicId);
    } catch {
      // Turned off, or never was: said on the page.
    }
    return { locale: await loadLocale(session?.locale ?? (await getVisitorLocale())), page, signedIn: session ? { name: session.displayName, email: session.email, locale: session.locale } : null };
  },
  head: ({ match }) => ({ meta: [{ title: match.context.page?.title ?? "Oneverse" }] }),
  component: function Page() {
    const { locale, page, signedIn } = Route.useRouteContext();
    const router = useRouter();
    return (
      <LocaleProvider locale={locale}>
        <AuthPage brand={<OneverseBrand />} actions={<ThemeSwitch />}>
          <RegisterPage page={page} api={apiClient} signedIn={signedIn} onRegistered={(registration) => void router.navigate({ to: "/registration/$token", params: { token: registration.token! } })} />
        </AuthPage>
      </LocaleProvider>
    );
  },
});
