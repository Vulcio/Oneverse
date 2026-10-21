import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { LogOut, MonitorUp } from "lucide-react";
import { useMemo } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { createI18n, loadLocale } from "@oneverse/app/i18n";
import { getSession } from "@oneverse/app/server-auth";
import { Button } from "@oneverse/ui/components/button";

/**
 * The operator's console (issue #305), at screen.oneverse.top/operate: signed
 * in at Oneverse, as the OAuth client "screen". Signed out, off to sign in,
 * coming back here.
 */
export const Route = createFileRoute("/operate")({
  beforeLoad: async ({ location }) => {
    const session = await getSession();
    if (!session) throw redirect({ href: `/auth/sign-in?${new URLSearchParams({ next: location.href })}`, reloadDocument: true });
    return { session, locale: await loadLocale(session.locale) };
  },
  component: OperateLayout,
});

function OperateLayout() {
  const { session } = Route.useRouteContext();
  // Per locale, not a module-level one (see createI18n).
  const i18n = useMemo(() => createI18n(session.locale), [session.locale]);
  return (
    <I18nextProvider i18n={i18n}>
      <div className="min-h-screen bg-background text-foreground">
        <Header name={session.displayName} />
        <main className="mx-auto max-w-6xl px-4 py-6">
          <Outlet />
        </main>
      </div>
    </I18nextProvider>
  );
}

function Header({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link to="/operate" className="flex flex-1 items-center gap-2 font-semibold">
          <MonitorUp className="size-5" />
          {t("screens.operator.pickTitle")}
        </Link>
        <span className="truncate text-sm text-muted-foreground">{name}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("nav.signOut")}
          // The console's session, then Oneverse's (issue #303).
          onClick={() => (window.location.href = "/auth/sign-out")}
          data-testid="sign-out"
        >
          <LogOut />
        </Button>
      </div>
    </header>
  );
}
