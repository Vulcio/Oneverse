import type { AppSession } from "@oneverse/app/session";
import { Link } from "@tanstack/react-router";
import { HelpCircle, LogOut, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@oneverse/ui/components/dropdown-menu";
import { NotificationBell } from "@oneverse/planning/components/notification-bell";
import { PlaniverseBrand } from "#/components/brand";

/** Planiverse's header (issue #241): its name, its pages, and who's signed in. */
export function AppHeader({ session }: { session: AppSession }) {
  const { t, i18n } = useTranslation();
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
          <Link to="/teams" className={tab} activeProps={{ className: "bg-accent text-accent-foreground" }} data-testid="nav-teams">
            {t("nav.teams")}
          </Link>
          <Link to="/organizations" className={tab} activeProps={{ className: "bg-accent text-accent-foreground" }} data-testid="nav-organizations">
            {t("nav.organizations")}
          </Link>
        </nav>
        {/* Its notifications (issue #242): the same as Songverse's bell. */}
        <NotificationBell />
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
            <DropdownMenuItem render={<Link to="/account" />} data-testid="nav-account">
              <UserRound />
              {t("nav.account")}
            </DropdownMenuItem>
            {/* Its page in the docs (issue #242), in the reader's language. */}
            <DropdownMenuItem render={<a href={`https://docs.songverse.one${i18n.language.startsWith("fr") ? "/fr" : ""}/planiverse/`} target="_blank" rel="noopener" />}>
              <HelpCircle />
              {t("nav.help")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                // This app's session, then Oneverse's (issue #303).
                window.location.href = "/auth/sign-out";
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
