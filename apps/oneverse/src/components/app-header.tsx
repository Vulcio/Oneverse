import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LogOut, UserRound, UsersRound } from "lucide-react";
import { NotificationBell } from "@oneverse/planning/components/notification-bell";
import { authClient } from "@oneverse/app/auth-client";
import { AppSwitcher } from "@oneverse/app/components/app-switcher";
import { ThemeSwitch } from "@oneverse/app/components/theme-switch";
import { apiClient } from "#/lib/api-client";
import { Button } from "@oneverse/ui/components/button";
import { OneverseBrand } from "#/components/brand";

/** Oneverse's name, leading home (issue #538); the other apps (issue #552), one's teams (issue #550), the bell, the account, light or dark (issue #422), and signing out. */
export function AppHeader({ awaitingApproval = false }: { awaitingApproval?: boolean }) {
  const { t } = useTranslation();
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* The other apps right beside its name, as in every app (issue #552). */}
        <div className="flex items-center gap-1">
          <Link to="/" className="flex items-center gap-2 font-semibold" data-testid="home-link">
            <OneverseBrand />
          </Link>
          {awaitingApproval ? null : <AppSwitcher current="oneverse" api={apiClient} />}
        </div>
        <div className="flex items-center gap-2">
        {/* Waiting for their organisation's approval (issue #533): nothing to be told of here yet. */}
        {awaitingApproval ? null : <NotificationBell />}
        {awaitingApproval ? null : (
          <Button variant="ghost" size="sm" aria-label={t("nav.teams")} render={<Link to="/teams" data-testid="teams-link" />}>
            <UsersRound />
            <span className="hidden sm:inline">{t("nav.teams")}</span>
          </Button>
        )}
        <Button variant="ghost" size="sm" aria-label={t("nav.account")} render={<Link to="/settings/$section" params={{ section: "account" }} data-testid="account-link" />}>
          <UserRound />
          <span className="hidden sm:inline">{t("nav.account")}</span>
        </Button>
        {/* Kept on the account (issue #540), so every app and device follows. */}
        <ThemeSwitch onChange={(choice) => void apiClient.updateMe({ theme: choice === "device" ? "auto" : choice })} />
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
