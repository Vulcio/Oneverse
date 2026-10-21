import type { SetlistSummary, SongbookSummary, TeamSummary } from "@oneverse/core";
import { useMatches, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { AppSidebar } from "#/components/app-sidebar";
import { OfflineBanner } from "#/components/offline-banner";
import { SiteHeader } from "#/components/site-header";
import { MetronomeReturnButton } from "#/components/metronome";
import { StemDockSlot, StemReturnButton } from "#/components/stem-dock";
import { SyncDetails } from "#/components/sync-details";
import { YouTubeHost } from "#/components/youtube-dock";
import { stopMetronome } from "#/lib/metronome-engine";
import { useRecordingClickBridge } from "#/lib/recording-click";
import { useSyncBridge } from "#/lib/sync-client";
import { unloadStems } from "#/lib/stem-engine";
import type { AppSession } from "@oneverse/app/server-auth";
import { nestedSidebarFor } from "#/lib/sidebar-kind";
import { ItemPanel, NestedSidebar } from "#/components/nested-sidebar";
import { SidebarInset, SidebarProvider, useSidebar } from "@oneverse/ui/components/sidebar";

export function AppShell({
  session,
  teams,
  songbooks,
  setlists,
  children,
}: {
  session: AppSession;
  teams: TeamSummary[];
  songbooks: SongbookSummary[];
  setlists: SetlistSummary[];
  children: ReactNode;
}) {
  const fullScreen = useMatches({ select: (matches) => matches.some((match) => match.staticData.fullScreen) });
  const [dockSlot, setDockSlot] = useState<HTMLElement | null>(null);
  // Sync play (issue #13): back on after a reload; the leader's metronome sent out.
  useSyncBridge();
  // The metronome with the recording (issue #100).
  useRecordingClickBridge();
  // Signed out (or out of the app): the stems and the metronome stop.
  useEffect(
    () => () => {
      unloadStems();
      stopMetronome();
    },
    [],
  );
  if (fullScreen) {
    // Live (issue #154): the song takes the whole screen but the sidebar - on a
    // wider screen open beside it, the set's songs listed; on a phone a sheet
    // its header's button opens.
    return (
      <>
        <SidebarProvider>
          <ShellSidebar session={session} teams={teams} songbooks={songbooks} setlists={setlists} />
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </SidebarProvider>
        <StemReturnButton />
        <YouTubeHost />
        <SyncDetails />
      </>
    );
  }
  return (
    <StemDockSlot.Provider value={dockSlot}>
      <SidebarProvider>
        <ShellSidebar session={session} teams={teams} songbooks={songbooks} setlists={setlists} />
        <SidebarInset>
          <SiteHeader />
          <OfflineBanner />
          {/* The page: the whole main area, less its gutter (issue #177) - a page with room to spare uses it rather than
              being narrowed. The gutter (--gutter) lets a part bleed to the edges (.bleed-x, issue #147). */}
          <div className="@container flex-1 px-(--gutter) py-8 [--gutter:1rem] md:[--gutter:1.5rem] 2xl:[--gutter:2.5rem]">
            <div className="w-full">{children}</div>
          </div>
          {/* A song's stem player docks here, at the bottom of the screen (issue #64). */}
          <div ref={setDockSlot} className="sticky bottom-0 z-30 empty:hidden" />
          <DockHeight slot={dockSlot} />
        </SidebarInset>
      </SidebarProvider>
      <StemReturnButton />
      <MetronomeReturnButton />
      <YouTubeHost />
      <SyncDetails />
    </StemDockSlot.Provider>
  );
}

/**
 * The full sidebar on a section's pages and lists; on one item, the rail
 * and its panel on a wider screen, and on a phone a sheet that opens on the
 * item's list and switches to the full sidebar (issue #80).
 */
function ShellSidebar(props: { session: AppSession; teams: TeamSummary[]; songbooks: SongbookSummary[]; setlists: SetlistSummary[] }) {
  const { isMobile } = useSidebar();
  const nested = useRouterState({ select: (s) => nestedSidebarFor(s.location.pathname) });
  if (!nested) return <AppSidebar {...props} />;
  // On a phone the sheet switches between the item's list and the full sidebar, rather than nesting them.
  return isMobile ? <AppSidebar {...props} itemPanel={<ItemPanel teams={props.teams} songbooks={props.songbooks} setlists={props.setlists} />} /> : <NestedSidebar {...props} />;
}

/**
 * The docked stem player's height, as --stem-dock-height on the page, for
 * what docks at the bottom too (the chord diagrams, issue #212) to sit
 * above it.
 */
function DockHeight({ slot }: { slot: HTMLElement | null }) {
  useEffect(() => {
    if (!slot) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty("--stem-dock-height", `${slot.offsetHeight}px`));
    observer.observe(slot);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--stem-dock-height");
    };
  }, [slot]);
  return null;
}
