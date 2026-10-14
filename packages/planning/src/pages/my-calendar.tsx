import { addDays, localDate, type AwayDays, type CustomInstrument, type MyEventDate } from "@songverse/core";
import { useRouter } from "@tanstack/react-router";
import { MapPin, Repeat } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AwayDaysCard } from "../components/away-days-card";
import { CalendarFeedCard } from "../components/calendar-feed-card";
import { EntityAvatar } from "@songverse/ui/components/entity-avatar";
import { EventAnswer } from "../components/event-answer";
import { LineupLine, usePartLabel } from "../components/lineup";
import { Badge } from "@songverse/ui/components/badge";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent } from "@songverse/ui/components/card";
import { HostLink, usePlanning } from "../host";
import { cn } from "@songverse/ui/lib/utils";

/** How far the page shows, then how much more each "Show more" adds. */
const SHOWN_WEEKS = 8;

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * My calendar (issue #235): the coming dates of all one's teams, each
 * answered here - Available, If needed, Not available, with a note for the
 * team's admins - and the days one is away, which answer Not available for
 * every date in them that isn't answered.
 */
export function MyCalendarPage() {
  const { api, links, sets } = usePlanning();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [weeks, setWeeks] = useState(SHOWN_WEEKS);
  const [dates, setDates] = useState<MyEventDate[] | null>(null);
  const [away, setAway] = useState<AwayDays[]>([]);
  const [customInstruments, setCustomInstruments] = useState<CustomInstrument[]>([]);
  const partLabel = usePartLabel(customInstruments);
  useEffect(() => {
    void api.listCustomInstruments().then(setCustomInstruments, () => {});
  }, []);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const today = addDays(localDate(new Date(), browserZone()), -1);
    const [found, ranges] = await Promise.all([api.listMyEventDates(today, addDays(today, weeks * 7)), api.listMyAway()]);
    const now = Date.now();
    setDates(found.filter((date) => Date.parse(date.endsAt) >= now - 12 * 3600_000));
    setAway(ranges);
  }, [weeks]);

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await load();
      // The sidebar lists the sets of dates you signed up for.
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const dayFormat = new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" });
  const timeFormat = (zone: string) => new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone: zone });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("teamCalendar.myCalendar")}</h1>
        <p className="text-sm text-muted-foreground">{t("teamCalendar.myCalendarDescription")}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid grid-cols-1 items-start gap-6 @6xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card data-testid="my-calendar">
          <CardContent className="flex flex-col gap-4">
            {dates === null ? null : dates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("teamCalendar.noDates")}</p>
            ) : (
              <ul className="flex flex-col divide-y" aria-label={t("teamCalendar.myCalendar")}>
                {dates.map((date) => (
                  <li
                    key={`${date.eventId}-${date.date}`}
                    // Narrow (a phone): the date and its set on one line, the rest under them, full width.
                    className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0 @lg:flex @lg:flex-wrap @lg:gap-y-1", date.cancelled && "text-muted-foreground")}
                    data-event-date={date.date}
                    data-event-id={date.eventId}
                  >
                    <div className="w-28 shrink-0 text-sm tabular-nums">
                      <div className="font-medium">{dayFormat.format(new Date(`${date.date}T12:00:00Z`))}</div>
                      <div className="text-xs text-muted-foreground">{timeFormat(date.timeZone).format(new Date(date.startsAt))}</div>
                      {date.callAt ? (
                        <div className="text-xs text-muted-foreground" data-testid="calendar-call">
                          {t("teamCalendar.callAt", { time: timeFormat(date.timeZone).format(new Date(date.callAt)) })}
                        </div>
                      ) : null}
                    </div>
                    <div className="col-span-2 flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("text-sm font-medium", date.cancelled && "line-through")}>{date.title}</span>
                        {date.repeats ? <Repeat className="size-3.5 text-muted-foreground" aria-label={t("teamCalendar.repeats")} /> : null}
                        {date.rehearsalFor ? <Badge variant="muted" data-testid="calendar-rehearsal">{t("teamCalendar.rehearsalBadge")}</Badge> : null}
                        {date.cancelled ? <Badge variant="outline">{t("teamCalendar.cancelled")}</Badge> : null}
                      </div>
                      {date.rehearsalFor ? (
                        <span className="text-xs text-muted-foreground" data-testid="calendar-rehearsal-of">
                          {t("teamCalendar.rehearsalOf", { title: date.rehearsalFor.title, date: dayFormat.format(new Date(`${date.rehearsalFor.date}T12:00:00Z`)) })}
                        </span>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <HostLink href={links.team(date.teamId)} className="flex items-center gap-1.5 hover:text-foreground">
                          <EntityAvatar name={date.teamName} color={date.teamColor} avatarUrl={date.teamAvatarUrl} size={16} />
                          {date.teamName}
                        </HostLink>
                        {date.place ? (
                          <span className="flex items-center gap-1">
                            <MapPin className="size-3" aria-hidden />
                            {date.place}
                          </span>
                        ) : null}
                      </div>
                      {/* A guest on another team's line-up answers for their place, not the date; a rehearsal follows its event's line-up. */}
                      {!date.cancelled && !date.guest && !date.rehearsalFor ? (
                        <div className="mt-1">
                          <EventAnswer
                            value={date.myAnswer}
                            labels
                            label={t("teamCalendar.yourAnswer")}
                            onAnswer={(answer, note) => act(() => api.answerTeamEventDate(date.teamId, date.eventId, date.date, { answer, ...(note !== undefined && { note }) }))}
                            onClear={() => act(() => api.clearTeamEventDateAnswer(date.teamId, date.eventId, date.date))}
                          />
                        </div>
                      ) : null}
                      {!date.cancelled && !date.rehearsalFor ? (
                        <LineupLine teamId={date.teamId} eventId={date.eventId} date={date.date} parts={date.parts} lineup={date.lineup} partLabel={partLabel} onChanged={() => act(async () => {})} />
                      ) : null}
                    </div>
                    {!date.cancelled && date.setlistId && sets ? (
                      <Button variant="outline" size="sm" className="col-start-2 row-start-1" render={<HostLink href={sets.href(date.setlistId)} />}>
                        {t("teamCalendar.openSet")}
                        <span className="text-muted-foreground">· {t("teamCalendar.songs", { count: date.songCount })}</span>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {dates && dates.length > 0 ? (
              <Button variant="ghost" size="sm" className="self-start" onClick={() => setWeeks((shown) => shown + SHOWN_WEEKS)}>
                {t("teamCalendar.showMore")}
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          {/* The dates signed up for, in one's own calendar (issue #235). */}
          <CalendarFeedCard />
          <AwayDaysCard
            away={away}
            onAdd={(range) => act(() => api.addMyAway(range))}
            onUpdate={(id, range) => act(() => api.updateMyAway(id, range))}
            onRemove={(id) => act(() => api.removeMyAway(id))}
          />
        </div>
      </div>
    </div>
  );
}
