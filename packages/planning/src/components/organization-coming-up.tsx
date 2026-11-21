import { addDays, localDate, type OrganizationEventDate } from "@oneverse/core";
import { CalendarDays, MapPin, Repeat, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { cn } from "@oneverse/ui/lib/utils";
import { HostLink, usePlanning } from "../host";

/** How many coming dates the card shows, over how many weeks. */
const SHOWN_DATES = 6;
const WEEKS = 8;

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * An organisation's calendar at the top of its page (issue #549): its next
 * dates with the groups each needs, and the way to the whole calendar -
 * its dates and its events, to change a series as a whole.
 */
export function OrganizationComingUp({ organizationId, isAdmin }: { organizationId: string; isAdmin: boolean }) {
  const { api, links } = usePlanning();
  const { t, i18n } = useTranslation();
  const [dates, setDates] = useState<OrganizationEventDate[] | null>(null);
  useEffect(() => {
    let live = true;
    const today = addDays(localDate(new Date(), browserZone()), -1);
    void api
      .listOrganizationEventDates(organizationId, today, addDays(today, WEEKS * 7))
      .then((found) => {
        const now = Date.now();
        if (live) setDates(found.filter((date) => Date.parse(date.endsAt) >= now).slice(0, SHOWN_DATES));
      })
      .catch(() => live && setDates([]));
    return () => {
      live = false;
    };
  }, [organizationId]);
  const dayFormat = new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" });
  const timeFormat = (zone: string) => new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone: zone });
  const calendar = links.organizationEvents(organizationId);

  return (
    <Card data-testid="organization-calendar">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CalendarDays className="size-4" aria-hidden />
            {t("organizations.events")}
          </CardTitle>
          <CardDescription>{t("organizations.comingUpHint")}</CardDescription>
        </div>
        <Button size="sm" variant={isAdmin ? "default" : "outline"} render={<HostLink href={calendar} />} data-testid="organization-calendar-open">
          {t("organizations.openCalendar")}
        </Button>
      </CardHeader>
      <CardContent>
        {dates === null ? null : dates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{isAdmin ? t("organizations.noComingAdmin") : t("organizations.noComing")}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {dates.map((date) => {
              const short = date.groups.some((group) => !group.cancelled && group.coverage?.some((part) => part.missing > 0));
              return (
                <li key={`${date.eventId}-${date.date}`} className={cn("flex items-start gap-3 py-2 first:pt-0 last:pb-0", date.cancelled && "text-muted-foreground")} data-coming-date={date.date}>
                  <div className="w-24 shrink-0 text-sm tabular-nums">
                    <div className="font-medium">{dayFormat.format(new Date(`${date.date}T12:00:00Z`))}</div>
                    <div className="text-xs text-muted-foreground">{timeFormat(date.timeZone).format(new Date(date.startsAt))}</div>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn("text-sm font-medium", date.cancelled && "line-through")}>{date.title}</span>
                      {date.cancelled ? <Badge variant="outline">{t("teamCalendar.cancelled")}</Badge> : null}
                      {short && !date.cancelled ? (
                        <Badge variant="warning">
                          <Users />
                          {t("organizations.someShort")}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {date.host ? <span>{t("organizations.hostedBy", { name: date.host.displayName })}</span> : null}
                      {date.place ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" aria-hidden />
                          {date.place}
                        </span>
                      ) : null}
                      {date.groups.length > 0 ? (
                        <span className="flex items-center gap-1" aria-label={date.groups.map((group) => group.teamName).join(", ")} title={date.groups.map((group) => group.teamName).join(", ")}>
                          {date.groups.slice(0, 5).map((group) => (
                            <EntityAvatar key={group.teamId} name={group.teamName} color={group.color} avatarUrl={group.avatarUrl} size={18} />
                          ))}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {dates && dates.length > 0 ? (
          <HostLink href={calendar} className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Repeat className="size-3" aria-hidden />
            {t("organizations.seriesLink")}
          </HostLink>
        ) : null}
      </CardContent>
    </Card>
  );
}
