import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import type { SettingsSectionKey } from "./settings-shell";

type Moved = { section: SettingsSectionKey; hash?: string };

/**
 * Where an old settings address went (issue #540): `/account`, the
 * dashboard's `#settings`, `#notifications`, `#roles`. A hash never reaches
 * the server, so it's read here, once the page is in the browser; `fallback`
 * is where the page goes when no hash matches (none: it stays).
 */
export function useMovedToSettings(moved: Record<string, Moved>, fallback?: Moved) {
  const navigate = useNavigate();
  useEffect(() => {
    const to = moved[window.location.hash.replace(/^#/, "")] ?? fallback;
    if (to) void navigate({ to: "/settings/$section", params: { section: to.section }, hash: to.hash, replace: true });
  }, []);
}

/** An old page that's now part of Settings: it sends one there. */
export function MovedToSettings({ moved = {} }: { moved?: Record<string, Moved> }) {
  useMovedToSettings(moved, { section: "account" });
  return null;
}
