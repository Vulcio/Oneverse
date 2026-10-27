import { playedTooOften, type RecentPlays } from "@oneverse/core";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@oneverse/ui/lib/utils";
import { formatSetDay } from "#/lib/setlists";

/** "Played 3 times in 6 weeks · last 12 Oct" (issue #335): how often a song was in the team's sets lately. */
export function recentPlaysText(plays: RecentPlays, t: (key: string, options?: Record<string, unknown>) => string, locale: string): string {
  if (plays.count === 0) return t("recentPlays.none", { count: plays.weeks });
  return [t("recentPlays.played", { count: plays.count, weeks: plays.weeks }), plays.last ? t("recentPlays.last", { date: formatSetDay(plays.last, locale) }) : null].filter(Boolean).join(" · ");
}

/**
 * How often a song of a team set was played lately (issue #335): a quiet
 * line, or past the team's limit, a warning - which never stops anything.
 */
export function RecentPlaysLine({ plays, className }: { plays: RecentPlays | null | undefined; className?: string }) {
  const { t, i18n } = useTranslation();
  if (!plays || plays.count === 0) return null;
  const over = playedTooOften(plays);
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs", over ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground", className)}
      title={over ? t("recentPlays.overLimit", { count: plays.limit, weeks: plays.weeks }) : undefined}
      data-testid="recent-plays"
      data-over={over ? "true" : undefined}
    >
      {over ? <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> : null}
      {recentPlaysText(plays, t, i18n.language)}
    </span>
  );
}
