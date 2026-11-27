import type { MyRegistration } from "@oneverse/core";
import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@oneverse/app/components/auth-page";
import { LocaleProvider } from "@oneverse/app/components/locale-provider";
import { MyRegistrationPage } from "@oneverse/app/components/registration-pages";
import { ThemeSwitch } from "@oneverse/app/components/theme-switch";
import { loadLocale } from "@oneverse/app/i18n";
import { getSession, getVisitorLocale } from "@oneverse/app/server-auth";
import { OneverseBrand } from "#/components/brand";
import { apiClient } from "#/lib/api-client";

/** Someone's registration (issue #593), from the link in its emails: seen, changed or cancelled without an account. */
export const Route = createFileRoute("/registration/$token")({
  beforeLoad: async ({ params }) => {
    const session = await getSession();
    let registration: MyRegistration | null = null;
    try {
      registration = await apiClient.getMyRegistration(params.token);
    } catch {
      // Not (or no longer) a registration: said on the page.
    }
    return { locale: await loadLocale(session?.locale ?? (await getVisitorLocale())), registration };
  },
  head: ({ match }) => ({ meta: [{ title: match.context.registration?.page.title ?? "Oneverse" }, { name: "referrer", content: "no-referrer" }] }),
  component: function Page() {
    const { locale, registration } = Route.useRouteContext();
    const { token } = Route.useParams();
    return (
      <LocaleProvider locale={locale}>
        <AuthPage brand={<OneverseBrand />} actions={<ThemeSwitch />}>
          <MyRegistrationPage key={token} token={token} initial={registration} api={apiClient} registerHref={(publicId) => `/register/${publicId}`} />
        </AuthPage>
      </LocaleProvider>
    );
  },
});
