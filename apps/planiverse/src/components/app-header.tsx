import type { AppSession } from "@songverse/app/session";
import { authClient } from "@songverse/app/auth-client";
import { Link } from "@tanstack/react-router";
import { Bell, LogOut, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { EntityAvatar } from "@songverse/ui/components/entity-avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@songverse/ui/components/dropdown-menu";
import { PlaniverseBrand } from "#/components/brand";
import { songverseUrl } from "#/lib/planning-host";

/** Planiverse's header (issue #241): its name, its pages, and who's signed in. */
export function AppHeader({ session }: { session: AppSession }) {
  const { t } = useTranslation();
  const songverse = songverseUrl();
  const tab = "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground";
  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link to="/calendar" className="flex items-center gap-2 font-semibold">
          <PlaniverseBrand />
        </Link>
        <nav className="flex flex-1 items-center gap-1">
          <Link to="/calendar" className={tab} activeProps={{ className: "bg-accent text-accent-foreground" }} data-testid="nav-calendar">
            {t("nav.calendar")}
          </Link>
          <Link to="/organizations" className={tab} activeProps={{ className: "bg-accent text-accent-foreground" }} data-testid="nav-organizations">
            {t("nav.organizations")}
          </Link>
        </nav>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={session.displayName} data-testid="user-menu" />}>
            <EntityAvatar name={session.displayName} color={null} avatarUrl={session.avatarUrl} size={28} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="flex flex-col">
              <span>{session.displayName}</span>
              <span className="text-xs font-normal text-muted-foreground">{session.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/notifications" />} data-testid="nav-notifications">
              <Bell />
              {t("notifications.settingsTitle")}
            </DropdownMenuItem>
            {/* One account for both (issue #241): its other settings are Songverse's. */}
            {songverse ? (
              <DropdownMenuItem render={<a href={`${songverse}/dashboard#account`} />}>
                <UserRound />
                {t("nav.account")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onClick={() => {
                void authClient.signOut().then(() => {
                  window.location.href = "/";
                });
              }}
              data-testid="sign-out"
            >
              <LogOut />
              {t("nav.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
