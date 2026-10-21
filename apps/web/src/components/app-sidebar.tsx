import type { SetlistSummary, SongbookSummary, TeamSummary } from "@oneverse/core";
import { Link, useRouterState, type LinkProps } from "@tanstack/react-router";
import {
  ArrowLeft,
  AudioWaveform,
  BadgeCheck,
  Bell,
  Guitar,
  Handshake,
  BookOpen,
  ChevronRight,
  ChevronsUpDown,
  ClipboardCheck,
  Database,
  FileStack,
  Code,
  HelpCircle,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  ListFilter,
  ListMusic,
  LogOut,
  Moon,
  Music2,
  ShieldCheck,
  Sun,
  Users,
  UsersRound,
  ChevronLeft,
  Contact,
  Metronome,
  Star,
  CalendarDays,
  ClipboardList,
  Gauge,
  MicVocal,
  Waypoints,
  Music,
  Building2,
  Monitor,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AppSession } from "@oneverse/app/server-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@oneverse/ui/components/avatar";
import { sizedAvatarUrl } from "@oneverse/ui/lib/avatar-url";
import { docsUrl, docsView } from "#/lib/docs";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { SOURCE_CODE_URL, setListing } from "@oneverse/core";
import { forgetOffline } from "#/lib/offline-db";
import { setTheme, useMode } from "#/lib/mode";
import { forgetSmartLists, smartListSearch, useSmartLists } from "#/lib/smart-lists";
import { setlistTitle } from "#/lib/setlists";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@oneverse/ui/components/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@oneverse/ui/components/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@oneverse/ui/components/sidebar";
import { initials } from "@oneverse/ui/lib/initials";
import { useMyOrganizations } from "@oneverse/planning/organizations";
import { cn } from "@oneverse/ui/lib/utils";

export function AppSidebar({
  session,
  teams,
  songbooks,
  setlists,
  itemPanel,
}: {
  session: AppSession;
  teams: TeamSummary[];
  songbooks: SongbookSummary[];
  setlists: SetlistSummary[];
  /** On a phone, on one item: the list it was opened from, shown in place of the full sidebar until "Menu" (issue #80). */
  itemPanel?: ReactNode;
}) {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inAdmin = pathname.startsWith("/admin");
  const { openMobile } = useSidebar();
  // Each time the sheet opens (or the page changes), it opens on the item's list.
  const [showMenu, setShowMenu] = useState(false);
  useEffect(() => setShowMenu(false), [openMobile, pathname]);

  if (itemPanel && !showMenu) {
    return (
      <Sidebar>
        <div className="flex h-full min-h-0 flex-col" data-testid="sidebar-item-sheet">
          <button
            type="button"
            onClick={() => setShowMenu(true)}
            className="flex items-center gap-1 border-b px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground"
            data-testid="sidebar-menu"
          >
            <ChevronLeft className="size-4" />
            <Music2 className="size-4" />
            {t("nav.menu")}
          </button>
          {itemPanel}
        </div>
      </Sidebar>
    );
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <Link to="/library" className="flex items-center gap-2 px-2 py-1.5 font-semibold">
          <Music2 className="size-5 shrink-0" />
          <SidebarLabel>Songverse</SidebarLabel>
        </Link>
      </SidebarHeader>
      {inAdmin ? (
        <AdminNav pathname={pathname} />
      ) : (
        <MainNav
          pathname={pathname}
          teams={teams}
          songbooks={songbooks}
          setlists={setlists}
          isGlobalAdmin={session.isGlobalAdmin}
          canReview={session.isGlobalAdmin || session.isReviewer}
          docsView={docsView(session)}
        />
      )}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton className="h-12" data-testid="account-menu" />}>
                  <Avatar className="size-8 shrink-0">
                    {session.avatarUrl ? <AvatarImage src={sizedAvatarUrl(session.avatarUrl, 32)} alt="" /> : null}
                    <AvatarFallback className="text-xs">{initials(session.displayName)}</AvatarFallback>
                  </Avatar>
                  <SidebarLabel className="grid min-w-0 flex-1 text-left leading-tight">
                    <span className="truncate font-semibold">{session.displayName}</span>
                    <span className="truncate text-xs text-muted-foreground">{session.email}</span>
                  </SidebarLabel>
                  <SidebarLabel>
                    <ChevronsUpDown className="size-4 text-muted-foreground" />
                  </SidebarLabel>
                </DropdownMenuTrigger>
              <AccountMenuContent session={session} side="top" align="end" />
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

/** The account menu (your name, at the bottom of the sidebar): dashboard, settings, offline, help, sign out. */
export function AccountMenuContent({ session, side, align }: { session: AppSession; side: "top" | "right"; align: "start" | "end" }) {
  const { t, i18n } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
      <DropdownMenuContent align={align} side={side} className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{session.displayName}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{session.email}</span>
          </span>
          {/* Edit and Practice's light or dark theme; Live is always dark (issue #67). */}
          <ThemeToggle />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem render={<Link to="/dashboard" />}>
            <LayoutDashboard />
            {t("nav.dashboard")}
          </DropdownMenuLinkItem>
        <DropdownMenuLinkItem render={<Link to="/dashboard" hash="settings" />}>
            <KeyRound />
            {t("nav.account")}
          </DropdownMenuLinkItem>
        <DropdownMenuLinkItem render={<Link to="/offline" />}>
            <HardDrive />
            {t("nav.offlineStorage")}
          </DropdownMenuLinkItem>
        <DropdownMenuLinkItem render={<a href={docsUrl(pathname, i18n.language, docsView(session))} target="_blank" rel="noopener" />}>
            <HelpCircle />
            {t("nav.help")}
          </DropdownMenuLinkItem>
        {/* AGPL-3.0, section 13: the source, offered to whoever uses it. */}
        <DropdownMenuLinkItem render={<a href={SOURCE_CODE_URL} target="_blank" rel="noopener" data-testid="source-code" />}>
            <Code />
            {t("nav.sourceCode")}
          </DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            forgetSmartLists();
            // This app's session, then Oneverse's (issue #303).
            void forgetOffline().then(() => {
              window.location.href = "/auth/sign-out";
            });
          }}
        >
          <LogOut />
          {t("nav.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
  );
}

const SIDEBAR_SET_LIMIT = 8;

/** A sun or a moon: Edit and Practice's theme, the other way. Not in Live, which is always dark. */
function ThemeToggle() {
  const { t } = useTranslation();
  const { mode, theme } = useMode();
  if (mode === "live") return null;
  const label = theme === "dark" ? t("mode.lightTheme") : t("mode.darkTheme");
  return (
    <button
      type="button"
      className="flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg]:size-4"
      aria-label={label}
      title={label}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </button>
  );
}

/** Hides its children in icon-rail (collapsed, non-mobile) mode - same rule SidebarGroupLabel follows. */
function SidebarLabel({ children, className }: { children: ReactNode; className?: string }) {
  const { state, isMobile } = useSidebar();
  if (state === "collapsed" && !isMobile) return null;
  return <span className={className}>{children}</span>;
}

interface NavItem {
  key: string;
  label: string;
  isActive: boolean;
  icon?: ReactNode;
  muted?: boolean;
  link: { to: NonNullable<LinkProps["to"]>; params?: Record<string, string>; search?: object };
}

/**
 * A sidebar entry with its own list under it (Library, Sets, Songbooks,
 * Teams), as a collapsible list: the full sidebar, on a phone and on a
 * section's own page; inside a section, the nested sidebar's panel lists
 * them instead (#80).
 */
function NavGroup({
  icon,
  label,
  to,
  isActive,
  items,
  empty,
  testId,
}: {
  icon: ReactNode;
  label: string;
  to: NavItem["link"]["to"];
  isActive: boolean;
  items: NavItem[];
  empty?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarMenuItem>
        <SidebarMenuButton isActive={isActive} tooltip={label} render={<Link to={to} />}>
            {icon}
            <span>{label}</span>
          </SidebarMenuButton>
        <CollapsibleTrigger render={<SidebarMenuAction />}>
            <ChevronRight className="transition-transform group-data-open/collapsible:rotate-90" />
            <span className="sr-only">{t("nav.toggle")}</span>
          </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub data-testid={testId}>
            {items.length === 0 && empty ? <p className="px-2 py-1 text-xs text-muted-foreground">{empty}</p> : null}
            {items.map((item) => (
              <SidebarMenuSubItem key={item.key}>
                <SidebarMenuSubButton isActive={item.isActive} render={<Link {...(item.link as LinkProps)} className={cn(item.muted && "text-muted-foreground")} />}>
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function MainNav({
  pathname,
  teams,
  songbooks,
  setlists,
  isGlobalAdmin,
  canReview,
  docsView,
}: {
  pathname: string;
  teams: TeamSummary[];
  songbooks: SongbookSummary[];
  setlists: SetlistSummary[];
  isGlobalAdmin: boolean;
  canReview: boolean;
  /** What the docs show them (issue #160). */
  docsView: string;
}) {
  const { t, i18n } = useTranslation();
  const organizations = useMyOrganizations();
  // Upcoming and undated sets come first (the API's order); past ones are
  // on the Sets page. A team's event sets only for dates you signed up for (issue #235).
  const sidebarSets = setlists.filter((set) => setListing(set) === "sidebar");
  const shownSetlists = sidebarSets.slice(0, SIDEBAR_SET_LIMIT);
  const smartLists = useSmartLists();
  const listId = useRouterState({ select: (s) => (s.location.search as { list?: string }).list });
  const favorites = useRouterState({ select: (s) => !!(s.location.search as { favorites?: boolean }).favorites });

  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarMenu>
          <NavGroup
            icon={<Music2 />}
            label={t("nav.library")}
            to="/library"
            // Library is its home (and a song); Songs, Favorites, a smart list and Artists are marked on their own.
            isActive={pathname === "/library" || (/^\/library\/[^/]+/.test(pathname) && !/^\/library\/(songs|artists|new)\/?$/.test(pathname))}
            testId="library-sections"
            items={[
              // Songs (the whole list), favorites, artists, and the user's smart lists (issues #58, #81).
              { key: "songs", label: t("nav.songs"), icon: <Music />, isActive: pathname === "/library/songs" && !listId && !favorites, link: { to: "/library/songs" as const } },
              {
                key: "favorites",
                label: t("library.home.favorites"),
                icon: <Star />,
                isActive: pathname === "/library/songs" && favorites,
                link: { to: "/library/songs" as const, search: { favorites: true } },
              },
              { key: "artists", label: t("nav.artists"), icon: <MicVocal />, isActive: pathname === "/library/artists" || pathname.startsWith("/library/artists/"), link: { to: "/library/artists" as const } },
              // Songs by chord progression (issue #204).
              { key: "progressions", label: t("nav.progressions"), icon: <Waypoints />, isActive: pathname === "/library/progressions", link: { to: "/library/progressions" as const } },
              ...smartLists.map((list) => ({
                key: list.id,
                label: list.name,
                icon: <ListFilter />,
                isActive: pathname === "/library/songs" && listId === list.id,
                link: { to: "/library/songs" as const, search: smartListSearch(list) },
              })),
            ]}
          />
          <NavGroup
            icon={<ListMusic />}
            label={t("nav.sets")}
            to="/sets"
            isActive={pathname.startsWith("/sets")}
            empty={t("sets.noSetsYet")}
            items={[
              ...shownSetlists.map((set) => ({
                key: set.id,
                label: setlistTitle(set, t, i18n.language),
                // A set with a date, a calendar; one without, a list (issue #151).
                icon: set.eventDate ? <CalendarDays /> : <ClipboardList />,
                isActive: pathname === `/sets/${set.id}`,
                link: { to: "/sets/$setlistId" as const, params: { setlistId: set.id } },
              })),
              ...(sidebarSets.length > shownSetlists.length
                ? [{ key: "all", label: t("sets.viewAll", { count: sidebarSets.length }), muted: true, isActive: false, link: { to: "/sets" as const } }]
                : []),
            ]}
          />
          <NavGroup
            icon={<BookOpen />}
            label={t("nav.songbooks")}
            to="/songbooks"
            isActive={pathname.startsWith("/songbooks")}
            empty={t("songbooks.noSongbooksYet")}
            items={songbooks.map((songbook) => ({
              key: songbook.id,
              label: songbook.name,
              icon: <EntityAvatar name={songbook.name} color={songbook.color} avatarUrl={songbook.avatarUrl} size={16} />,
              isActive: pathname === `/songbooks/${songbook.id}`,
              link: { to: "/songbooks/$songbookId" as const, params: { songbookId: songbook.id } },
            }))}
          />
          <NavGroup
            icon={<UsersRound />}
            label={t("nav.teams")}
            to="/teams"
            isActive={pathname.startsWith("/teams")}
            empty={t("nav.noTeams")}
            items={teams.map((team) => ({
              key: team.id,
              label: team.name,
              icon: <EntityAvatar name={team.name} color={team.color} avatarUrl={team.avatarUrl} size={16} />,
              isActive: pathname === `/teams/${team.id}`,
              link: { to: "/teams/$teamId" as const, params: { teamId: team.id } },
            }))}
          />

          {/* The organisations one's in (issue #241), when the server has them. */}
          {organizations && organizations.mode !== "NONE" && (organizations.organizations.length > 0 || organizations.canCreate) ? (
            <SidebarMenuItem>
              <SidebarMenuButton isActive={pathname.startsWith("/organizations")} tooltip={t("nav.organizations")} render={<Link to="/organizations" data-testid="sidebar-organizations" />}>
                <Building2 />
                <span>{t("nav.organizations")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}

          {/* The people you share songs with (issue #77). */}
          <SidebarMenuItem>
            <SidebarMenuButton isActive={pathname.startsWith("/people")} tooltip={t("nav.people")} render={<Link to="/people" />}>
                <Contact />
                <span>{t("nav.people")}</span>
              </SidebarMenuButton>
          </SidebarMenuItem>

          {/* My calendar (issue #235). */}
          <SidebarMenuItem>
            <SidebarMenuButton isActive={pathname === "/calendar"} tooltip={t("nav.calendar")} render={<Link to="/calendar" />}>
              <CalendarDays />
              <span>{t("nav.calendar")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      {/* Tools (issue #147): the metronome (issue #2), and a tuner to come. */}
      <SidebarGroup>
        <SidebarGroupLabel>{t("nav.tools")}</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={pathname === "/metronome"} tooltip={t("nav.metronome")} render={<Link to="/metronome" />}>
              <Metronome />
              <span>{t("nav.metronome")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={pathname === "/tuner"} tooltip={t("nav.tuner")} render={<Link to="/tuner" />}>
              <Gauge />
              <span>{t("nav.tuner")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* Screens (issue #222): one's own, one's teams' and organisations'. */}
          <SidebarMenuItem>
            <SidebarMenuButton isActive={pathname === "/screens"} tooltip={t("nav.screens")} render={<Link to="/screens" />} data-testid="nav-screens">
              <Monitor />
              <span>{t("nav.screens")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      {/* The documentation, docked at the bottom for everyone (issue #147). */}
      <SidebarGroup className="mt-auto">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={t("nav.documentation")} render={<a href={docsUrl(pathname, i18n.language, docsView)} target="_blank" rel="noopener" data-testid="sidebar-docs" />}>
              <HelpCircle />
              <span>{t("nav.documentation")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      {canReview || isGlobalAdmin ? (
        <SidebarGroup>
          <SidebarGroupLabel>{t("nav.admin")}</SidebarGroupLabel>
          <SidebarMenu>
            {canReview ? (
              <SidebarMenuItem>
                <SidebarMenuButton isActive={pathname.startsWith("/review")} tooltip={t("nav.review")} render={<Link to="/review" />}>
                    <ClipboardCheck />
                    <span>{t("nav.review")}</span>
                  </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
            {isGlobalAdmin ? (
              <SidebarMenuItem>
                <SidebarMenuButton isActive={pathname.startsWith("/admin")} tooltip={t("nav.adminDashboard")} render={<Link to="/admin" />}>
                    <ShieldCheck />
                    <span>{t("nav.adminDashboard")}</span>
                  </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
        </SidebarGroup>
      ) : null}
    </SidebarContent>
  );
}

function AdminNav({ pathname }: { pathname: string }) {
  const { t } = useTranslation();
  const sections = [
    { to: "/admin/users" as const, label: t("nav.adminUsers"), icon: Users },
    { to: "/admin/teams" as const, label: t("nav.adminTeams"), icon: UsersRound },
    { to: "/admin/organizations" as const, label: t("nav.adminOrganizations"), icon: Building2 },
    { to: "/admin/roles" as const, label: t("nav.adminRoles"), icon: BadgeCheck },
    { to: "/admin/instruments" as const, label: t("nav.adminInstruments"), icon: Guitar },
    { to: "/admin/auth" as const, label: t("nav.adminAuth"), icon: KeyRound },
    { to: "/admin/security" as const, label: t("nav.adminSecurity"), icon: ShieldCheck },
    { to: "/admin/notifications" as const, label: t("nav.adminNotifications"), icon: Bell },
    { to: "/admin/collaboration" as const, label: t("nav.adminCollaboration"), icon: Handshake },
    { to: "/admin/storage" as const, label: t("nav.adminStorage"), icon: Database },
    { to: "/admin/stem-separation" as const, label: t("nav.adminStemSeparation"), icon: AudioWaveform },
    { to: "/admin/catalogs" as const, label: t("nav.adminCatalogs"), icon: FileStack },
    { to: "/admin/metadata" as const, label: t("nav.adminMetadata"), icon: LayoutDashboard },
  ];

  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={t("nav.backToApp")} render={<Link to="/library" />}>
                <ArrowLeft />
                <span>{t("nav.backToApp")}</span>
              </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>{t("nav.admin")}</SidebarGroupLabel>
        <SidebarMenu>
          {sections.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton isActive={pathname.startsWith(item.to)} tooltip={item.label} render={<Link to={item.to} />}>
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>
  );
}
