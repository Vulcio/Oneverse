import { CommandSearch } from "#/components/command-search";
import { ModeSwitch } from "#/components/mode-switch";
import { NotificationBell } from "@oneverse/planning/components/notification-bell";
import { SidebarTrigger } from "@oneverse/ui/components/sidebar";
import { useMode } from "#/lib/mode";
import { usePageBeat } from "#/lib/song-beat";
import { cn } from "@oneverse/ui/lib/utils";

/**
 * The top of every page: the sidebar's toggle, search, notifications and
 * the mode switch.
 * No breadcrumb (issue #67): the sidebar shows where you are, and the
 * page's own title names it.
 */
export function SiteHeader() {
  const { mode } = useMode();
  // The beat behind the page (issue #107) shows through it, the page still blurred as it scrolls under.
  const beat = !!usePageBeat();

  return (
    // Always in view at the top, as the page scrolls under it.
    <header className={cn("sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b-2", beat ? "bg-background/40 backdrop-blur-sm" : "bg-background", mode !== "edit" && "border-b-primary")}>
      <div className="flex w-full min-w-0 items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="ml-auto flex items-center gap-2">
          <CommandSearch />
          <NotificationBell />
          <ModeSwitch />
        </div>
      </div>
    </header>
  );
}
