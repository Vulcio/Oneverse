import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LogOut, UserRound } from "lucide-react";
import { NotificationBell } from "@oneverse/planning/components/notification-bell";
import { authClient } from "@oneverse/app/auth-client";
import { AppSwitcher } from "@oneverse/app/components/app-switcher";
import { ThemeSwitch } from "@oneverse/app/components/theme-switch";
import { apiClient } from "#/lib/api-client";
import { Button } from "@oneverse/ui/components/button";
import { OneverseBrand } from "#/components/brand";

/** Oneverse's name, leading home (issue #538); the other apps (issue #552), the bell, the account, light or dark (issue #422), and signing out. */
export function AppHeader({ awaitingApproval = false }: { awaitingApproval?: boolean }) {
  const { t } = useTranslation();
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-semibold" data-testid="home-link">
          <OneverseBrand />
        </Link>
        <div className="flex items-center gap-2">
        {/* Waiting for their organisation's approval (issue #533): nothing to be told of here yet. */}
        {awaitingApproval ? null : <AppSwitcher current="oneverse" api={apiClient} />}
        {awaitingApproval ? null : <NotificationBell />}
        <Button variant="ghost" size="sm" aria-label={t("nav.account")} render={<Link to="/account" data-testid="account-link" />}>
          <UserRound />
          <span className="hidden sm:inline">{t("nav.account")}</span>
        </Button>
        <ThemeSwitch />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void authClient.signOut().then(() => {
              window.location.href = "/sign-in";
            });
          }}
          data-testid="sign-out"
          aria-label={t("nav.signOut")}
        >
          <LogOut />
          <span className="hidden sm:inline">{t("nav.signOut")}</span>
        </Button>
        </div>
      </div>
    </header>
  );
}
