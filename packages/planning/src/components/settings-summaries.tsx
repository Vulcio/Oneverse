import { addDays, localDate, type AwayDays } from "@oneverse/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { formatSetDate } from "@oneverse/ui/lib/dates";
import { HostLink, usePlanning } from "../host";
import { useNotificationPreferences } from "./notification-settings-card";

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** On the Account settings (issue #540): how many sections reach one, and quiet hours, with a way to the Notifications settings. */
export function NotificationsSummaryCard({ href }: { href: string }) {
  const { t } = useTranslation();
  const { preferences, sections } = useNotificationPreferences();
  const on = preferences ? sections.filter((section) => section.kinds.some((kind) => preferences.kinds[kind].push || preferences.kinds[kind].email)).length : null;
  return (
    <Card data-testid="notifications-summary">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">{t("settings.sections.notifications")}</CardTitle>
        <HostLink href={href} className="text-sm font-medium text-primary hover:underline">
          {t("settings.open")}
        </HostLink>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
        {on === null ? null : <p>{t("settings.notificationsSummary", { on, total: sections.length })}</p>}
        {preferences?.quiet ? <p>{t("settings.quietSummary", { from: preferences.quiet.from, to: preferences.quiet.to })}</p> : null}
      </CardContent>
    </Card>
  );
}

/** One's days away, as words: "Away 24 Dec to 2 Jan". */
export function awayWords(range: AwayDays, t: (key: string, values?: Record<string, string>) => string, locale: string): string {
  const from = formatSetDate(range.from, locale);
  return range.from === range.to ? t("settings.awayDay", { from }) : t("settings.awayRange", { from, to: formatSetDate(range.to, locale) });
}

/** On the Account settings (issue #540): the coming days away, with a way to change them in Plan's settings. */
export function AvailabilitySummaryCard({ href }: { href: string }) {
  const { api } = usePlanning();
  const { t, i18n } = useTranslation();
  const [away, setAway] = useState<AwayDays[] | null>(null);
  useEffect(() => {
    const today = localDate(new Date(), browserZone());
    void api.listMyAway().then(
      (ranges) => setAway(ranges.filter((range) => range.to >= today && range.from <= addDays(today, 180))),
      () => setAway([]),
    );
  }, [api]);
  return (
    <Card data-testid="availability-summary">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">{t("settings.availability")}</CardTitle>
        <HostLink href={href} className="text-sm font-medium text-primary hover:underline">
          {t("settings.change")}
        </HostLink>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        {away === null ? null : away.length === 0 ? (
          <p className="text-muted-foreground">{t("settings.notAway")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {away.slice(0, 3).map((range) => (
              <li key={range.id} className="flex justify-between gap-3">
                <span>{awayWords(range, t, i18n.language)}</span>
                {range.note ? <span className="truncate text-muted-foreground">{range.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
