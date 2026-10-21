import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { I18nextProvider } from "react-i18next";
import { AppShell } from "#/components/app-shell";
import { keepAppDataOffline, loadAppData } from "#/lib/app-data";
import { useOfflineSync } from "#/lib/offline-data";
import { createI18n, loadLocale } from "@oneverse/app/i18n";
import { WeekStartContext } from "@oneverse/ui/lib/dates";
import { PlanningProvider } from "@oneverse/planning/host";
import { planningHost } from "#/lib/planning-host";

/**
 * Pathless layout route — gates every route nested under `_protected/` in
 * one place. `beforeLoad` runs on the server during SSR and on the client
 * during a soft navigation.
 */
export const Route = createFileRoute("/_protected")({
  beforeLoad: async () => {
    // Runs on every navigation (and hover preload); cached between them in the browser.
    const data = await loadAppData();
    if (!data) {
      throw redirect({ to: "/" });
    }
    await loadLocale(data.session.locale);
    return data;
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { session, teams, songbooks, setlists, offline } = Route.useRouteContext();
  // Upcoming sets downloaded and kept up to date for offline use (issue #51).
  useOfflineSync();
  // Kept on the device for an offline launch (issue #49), each time it's confirmed online.
  useEffect(() => {
    if (!offline) keepAppDataOffline({ session, teams, songbooks, setlists });
  }, [session, teams, songbooks, setlists, offline]);
  // Recreated only when the locale actually changes (e.g. after the
  // dashboard's language picker triggers a router.invalidate()), not on
  // every render - see createI18n's own note on why this isn't a
  // module-level singleton.
  const i18n = useMemo(() => createI18n(session.locale), [session.locale]);

  return (
    <I18nextProvider i18n={i18n}>
      {/* Every calendar's first day of the week (issue #235). */}
      <WeekStartContext.Provider value={session.weekStartsOn}>
        <PlanningProvider host={planningHost}>
          <AppShell session={session} teams={teams} songbooks={songbooks} setlists={setlists}>
            <Outlet />
          </AppShell>
        </PlanningProvider>
      </WeekStartContext.Provider>
    </I18nextProvider>
  );
}
