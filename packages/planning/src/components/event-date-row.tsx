import { wherePlace, type EventPart, type MyEventDate } from "@oneverse/core";
import { MapPin, Repeat } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { cn } from "@oneverse/ui/lib/utils";
import { HostLink, usePlanning } from "../host";
import { EventAnswer } from "./event-answer";
import { LineupLine } from "./lineup";

/**
 * One date of one's calendar (issue #575), the same on My calendar and
 * Oneverse's home: its day and time, its title (to its page), team and
 * place, one's answer, its line-up and its set. `act` runs a change and
 * reads the dates again.
 */
export function EventDateRow({ date, partLabel, act }: { date: MyEventDate; partLabel: (part: EventPart) => string; act: (work: () => Promise<unknown>) => Promise<void> }) {
  const { api, links, sets } = usePlanning();
  const { t, i18n } = useTranslation();
  const dayFormat = new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" });
  const timeFormat = new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone: date.timeZone });
  return (
    <li
      // Narrow (a phone): the date and its set on one line, the rest under them, full width.
      className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0 @lg:flex @lg:flex-wrap @lg:gap-y-1", date.cancelled && "text-muted-foreground")}
      data-event-date={date.date}
      data-event-id={date.eventId}
    >
      <div className="w-28 shrink-0 text-sm tabular-nums">
        <div className="font-medium">{dayFormat.format(new Date(`${date.date}T12:00:00Z`))}</div>
        <div className="text-xs text-muted-foreground">{timeFormat.format(new Date(date.startsAt))}</div>
        {date.callAt ? (
          <div className="text-xs text-muted-foreground" data-testid="calendar-call">
            {t("teamCalendar.callAt", { time: timeFormat.format(new Date(date.callAt)) })}
          </div>
        ) : null}
      </div>
      <div className="col-span-2 flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <HostLink href={links.eventDate(date.eventId, date.date)} className={cn("text-sm font-medium hover:underline", date.cancelled && "line-through")} data-testid="event-date-link">
            {date.title}
          </HostLink>
          {date.repeats ? <Repeat className="size-3.5 text-muted-foreground" aria-label={t("teamCalendar.repeats")} /> : null}
          {date.rehearsalFor ? <Badge variant="muted" data-testid="calendar-rehearsal">{t("teamCalendar.rehearsalBadge")}</Badge> : null}
          {date.movedFrom ? <Badge variant="outline" data-testid="calendar-date-moved">{t("teamCalendar.movedFrom", { date: dayFormat.format(new Date(`${date.movedFrom}T12:00:00Z`)) })}</Badge> : null}
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
          {wherePlace(date.place, date.rooms) ? (
            <span className="flex items-center gap-1">
              <MapPin className="size-3" aria-hidden />
              {wherePlace(date.place, date.rooms)}
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
              onAnswer={(answer, note, wishes) => act(() => api.answerTeamEventDate(date.teamId, date.eventId, date.date, { answer, ...(note !== undefined && { note }), ...(wishes !== undefined && { wishes }) }))}
              wishOptions={date.wishOptions}
              partLabel={partLabel}
              onClear={() => act(() => api.clearTeamEventDateAnswer(date.teamId, date.eventId, date.date))}
            />
          </div>
        ) : null}
        {!date.cancelled && !date.rehearsalFor ? (
          <LineupLine teamId={date.teamId} eventId={date.eventId} date={date.date} parts={date.parts} lineup={date.lineup} partLabel={partLabel} missing={date.missing} volunteerOptions={date.volunteerOptions} onChanged={() => act(async () => {})} />
        ) : null}
      </div>
      {!date.cancelled && date.setlistId && sets ? (
        <Button variant="outline" size="sm" className="col-start-2 row-start-1" render={<HostLink href={sets.href(date.setlistId)} />} data-testid="event-date-open-set">
          {t("teamCalendar.openSet")}
          <span className="text-muted-foreground">· {t("teamCalendar.setItems", { count: date.songCount })}</span>
        </Button>
      ) : null}
    </li>
  );
}
