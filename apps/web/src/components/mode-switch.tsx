import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Headphones, Mic, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { setMode, useMode, type AppMode } from "#/lib/mode";
import { cn } from "@songverse/ui/lib/utils";

const SET_SONG = /^\/sets\/([^/]+)\/(songs|live)\/([^/]+)\/?$/;
const LIBRARY_LIVE = /^\/library\/([^/]+)\/live\/?$/;

/**
 * Edit / Practice / Live, at the top right of every page (the light or
 * dark theme is in the account menu, at the bottom of the sidebar). On a
 * song of a set, switching to or from Live also moves between
 * its page and its full-screen Live view.
 */
export function ModeSwitch({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { mode } = useMode();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  function choose(next: AppMode) {
    if (next === mode) return;
    setMode(next);
    const setSong = SET_SONG.exec(pathname);
    if (setSong && (next === "live" || mode === "live")) {
      const params = { setlistId: setSong[1]!, itemId: setSong[3]! };
      void navigate(next === "live" ? { to: "/sets/$setlistId/live/$itemId", params } : { to: "/sets/$setlistId/songs/$itemId", params });
    }
    // A library song full screen, leaving Live: back to its page (which opens Live by itself).
    const librarySong = LIBRARY_LIVE.exec(pathname);
    if (librarySong && mode === "live") void navigate({ to: "/library/$songVersionId", params: { songVersionId: librarySong[1]! } });
  }

  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      <div role="radiogroup" aria-label={t("mode.label")} className="flex rounded-lg border bg-muted p-0.5" data-testid="mode-switch">
        <ModeButton active={mode === "edit"} label={t("mode.edit")} onClick={() => choose("edit")}>
          <Pencil />
        </ModeButton>
        <ModeButton active={mode === "practice"} label={t("mode.practice")} onClick={() => choose("practice")}>
          <Headphones />
        </ModeButton>
        <ModeButton active={mode === "live"} label={t("mode.live")} onClick={() => choose("live")}>
          <Mic />
        </ModeButton>
      </div>
    </div>
  );
}

function ModeButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors [&_svg]:size-3.5",
        active ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {/* Icons only on a phone, where the header is narrow. */}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}
