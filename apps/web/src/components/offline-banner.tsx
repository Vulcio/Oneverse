import { useRouteContext, useRouter } from "@tanstack/react-router";
import { WifiOff } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { markAppDataStale } from "#/lib/app-data-version";
import { cn } from "@oneverse/ui/lib/utils";

/** "3 hours ago", in the reader's language. */
export function timeAgo(iso: string, language: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  for (const [unit, size] of [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ] as const) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "minute");
}

/** Back online: reload the session and page from the server (issue #49). */
export function useReconnect() {
  const router = useRouter();
  useEffect(() => {
    const online = () => {
      markAppDataStale();
      void router.invalidate();
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [router]);
}

/**
 * Offline, the app runs on what's kept on this device: this says so, and
 * how fresh it is. Signed in, read-only.
 */
export function OfflineBanner({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const { offline } = useRouteContext({ from: "/_protected" });
  useReconnect();
  if (!offline) return null;
  const when = timeAgo(offline.savedAt, i18n.language);
  if (compact) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" title={t("offline.banner", { when })} data-testid="offline-banner">
        <WifiOff className="size-3" />
        {t("offline.badge")}
      </span>
    );
  }
  return (
    <div role="status" className={cn("flex items-center gap-2 border-b bg-muted px-4 py-2 text-sm text-muted-foreground")} data-testid="offline-banner">
      <WifiOff className="size-4 shrink-0" />
      <span>{t("offline.banner", { when })}</span>
    </div>
  );
}
