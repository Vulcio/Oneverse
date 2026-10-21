import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@oneverse/app/components/auth-page";
import { ResetPasswordCard } from "@oneverse/app/components/reset-password-card";
import { LocaleProvider } from "@oneverse/app/components/locale-provider";
import { getSession, getVisitorLocale } from "@oneverse/app/server-auth";
import { loadLocale } from "@oneverse/app/i18n";
import { OneverseBrand } from "#/components/brand";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  beforeLoad: async () => ({ locale: await loadLocale((await getSession())?.locale ?? (await getVisitorLocale())) }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { locale } = Route.useRouteContext();
  return (
    <LocaleProvider locale={locale}>
      <AuthPage brand={<OneverseBrand />}>
        <ResetPasswordCard token={Route.useSearch().token} />
      </AuthPage>
    </LocaleProvider>
  );
}
