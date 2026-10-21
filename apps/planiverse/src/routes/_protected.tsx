import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useMemo } from "react";
import { I18nextProvider } from "react-i18next";
import { createI18n, loadLocale } from "@oneverse/app/i18n";
import { getSession } from "@oneverse/app/server-auth";
import { PlanningProvider } from "@oneverse/planning/host";
import { WeekStartContext } from "@oneverse/ui/lib/dates";
import { AppHeader } from "#/components/app-header";
import { planningHost } from "#/lib/planning-host";

/** Every signed-in page (issue #241): signed out, back to signing in. */
export const Route = createFileRoute("/_protected")({
  beforeLoad: async ({ location }) => {
    const session = await getSession();
    // Signed in again, back here (issue #303).
    if (!session) throw redirect({ to: "/", search: { next: location.href } });
    await loadLocale(session.locale);
    return { session };
  },
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { session } = Route.useRouteContext();
  // Per locale, not a module-level one (see createI18n).
  const i18n = useMemo(() => createI18n(session.locale), [session.locale]);
  const host = useMemo(() => planningHost(), []);
  return (
    <I18nextProvider i18n={i18n}>
      <WeekStartContext.Provider value={session.weekStartsOn}>
        <PlanningProvider host={host}>
          <AppHeader session={session} />
          <main className="@container mx-auto max-w-6xl px-4 py-6">
            <Outlet />
          </main>
        </PlanningProvider>
      </WeekStartContext.Provider>
    </I18nextProvider>
  );
}
