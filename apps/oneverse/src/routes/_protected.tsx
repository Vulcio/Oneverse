import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useMemo } from "react";
import { I18nextProvider } from "react-i18next";
import { createI18n, loadLocale } from "@oneverse/app/i18n";
import { getSession } from "@oneverse/app/server-auth";
import { AppHeader } from "#/components/app-header";

/** Every signed-in page: signed out, signing in first. */
export const Route = createFileRoute("/_protected")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/sign-in" });
    await loadLocale(session.locale);
    return { session };
  },
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { session } = Route.useRouteContext();
  // Per locale, not a module-level one (see createI18n).
  const i18n = useMemo(() => createI18n(session.locale), [session.locale]);
  return (
    <I18nextProvider i18n={i18n}>
      <AppHeader />
      <main className="@container mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>
    </I18nextProvider>
  );
}
