import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@songverse/app/components/auth-page";
import { SongverseBrand } from "#/components/brand";
import { ResetPasswordCard } from "@songverse/app/components/reset-password-card";
import { LocaleProvider } from "@songverse/app/components/locale-provider";
import { getSession, getVisitorLocale } from "@songverse/app/server-auth";
import { loadLocale } from "@songverse/app/i18n";

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
      <AuthPage brand={<SongverseBrand />}>
        <ResetPasswordCard token={Route.useSearch().token} />
      </AuthPage>
    </LocaleProvider>
  );
}
