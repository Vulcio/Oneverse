import type { BookingClash } from "@oneverse/core";
import { CalendarX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";

/** The dates that clash, once each, in order. */
export const clashDates = (clashes: readonly BookingClash[]) => [...new Set(clashes.map((clash) => clash.date))].sort();

/**
 * Why a save was refused (issue #565): each room or resource already booked,
 * on which date and by whom. A series can book its free dates instead
 * (`onBookFree`: saved again with skipClashes, its clashing dates cancelled).
 */
export function BookingClashes({ clashes, onBookFree, busy }: { clashes: readonly BookingClash[]; onBookFree?: (() => void) | null; busy?: boolean }) {
  const { t, i18n } = useTranslation();
  const day = (date: string) => new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const lines = [...new Map(clashes.map((clash) => [`${clash.date}|${clash.id}|${clash.eventId}`, clash])).values()];
  const dates = clashDates(clashes);
  return (
    <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="booking-clashes">
      <p className="flex items-center gap-2 font-medium text-destructive">
        <CalendarX className="size-4" aria-hidden />
        {t("bookings.title")}
      </p>
      <ul className="list-disc space-y-0.5 ps-5">
        {lines.slice(0, 8).map((clash) => (
          <li key={`${clash.date}|${clash.id}|${clash.eventId}`} data-testid="booking-clash">
            {t("bookings.clash", { what: clash.what, date: day(clash.date), event: clash.event, owner: clash.owner })}
          </li>
        ))}
        {lines.length > 8 ? <li>{t("bookings.more", { count: lines.length - 8 })}</li> : null}
      </ul>
      <p className="text-muted-foreground">{t("bookings.hint")}</p>
      {onBookFree ? (
        <div className="space-y-1">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onBookFree} data-testid="booking-book-free">
            {t("bookings.bookFree")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {dates.length <= 6 ? t("bookings.bookFreeHint", { dates: dates.map(day).join(", ") }) : t("bookings.bookFreeHintMany", { count: dates.length, first: day(dates[0]!), last: day(dates.at(-1)!) })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
