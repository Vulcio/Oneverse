import { ApiError, type CustomInstrument, type MyEventDateDetail } from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import { CalendarDays, Clock, MapPin, Repeat } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { FieldError } from "@oneverse/ui/components/field";
import { EventAnswer } from "../components/event-answer";
import { LineupDialog, LineupLine, usePartLabel } from "../components/lineup";
import { SetAvailabilityCard } from "../components/set-availability";
import { HostLink, usePlanning } from "../host";

/**
 * One event date's page (issue #575), at /events/:eventId/:date in Plan,
 * Songverse and Oneverse's home, where notifications about a date lead:
 * when and where, one's answer, its line-up, its rehearsals and its set -
 * with who can play for those who edit the set, and the line-up's tools for
 * the team's admins. Changing the event stays on the team's calendar.
 */
export function EventDatePage({ eventId, date: day }: { eventId: string; date: string }) {
  const { api, links, sets } = usePlanning();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [date, setDate] = useState<MyEventDateDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingLineup, setEditingLineup] = useState(false);
  // Fetched again after a change, so the set's card reads its answers again too.
  const [revision, setRevision] = useState(0);
  const [customInstruments, setCustomInstruments] = useState<CustomInstrument[]>([]);
  const partLabel = usePartLabel(customInstruments);
  useEffect(() => {
    void api.listCustomInstruments().then(setCustomInstruments, () => {});
  }, []);

  const load = useCallback(async () => {
    try {
      setDate(await api.getMyEventDate(eventId, day));
      setMissing(false);
      setRevision((value) => value + 1);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setMissing(true);
      else throw err;
    }
  }, [eventId, day]);
  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await load();
      // The sidebar lists the sets of dates one signed up for.
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (missing) {
    return (
      <Card data-testid="event-date-missing">
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">{t("teamCalendar.datePageNotFound")}</p>
          <Button variant="outline" size="sm" render={<HostLink href={links.home} />}>
            {t("teamCalendar.datePageBack")}
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!date) return error ? <FieldError>{error}</FieldError> : null;

  const longDay = new Intl.DateTimeFormat(i18n.language, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const shortDay = new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone: date.timeZone });
  const noon = (value: string) => new Date(`${value}T12:00:00Z`);
  const open = !date.cancelled;

  return (
    <div className="flex max-w-3xl flex-col gap-6" data-testid="event-date-page" data-event-id={date.eventId} data-event-date={date.date}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h1 className={date.cancelled ? "text-2xl font-semibold line-through" : "text-2xl font-semibold"} data-testid="event-date-title">
            {date.title}
          </h1>
          {date.repeats ? <Repeat className="size-4 text-muted-foreground" aria-label={t("teamCalendar.repeats")} /> : null}
          {date.rehearsalFor ? <Badge variant="muted">{t("teamCalendar.rehearsalBadge")}</Badge> : null}
          {date.movedFrom ? <Badge variant="outline" data-testid="event-date-moved">{t("teamCalendar.movedFrom", { date: shortDay.format(noon(date.movedFrom)) })}</Badge> : null}
          {date.cancelled ? <Badge variant="outline" data-testid="event-date-cancelled">{t("teamCalendar.cancelled")}</Badge> : null}
          </div>
          {/* Its set, and for the team's admins its calendar, where the event is changed. */}
          <div className="flex flex-wrap items-center gap-2">
            {date.isAdmin ? (
              <Button variant="ghost" size="sm" render={<HostLink href={links.team(date.teamId)} />} data-testid="event-date-team-calendar">
                {t("teamCalendar.datePageTeamCalendar", { team: date.teamName })}
              </Button>
            ) : null}
            {open && sets && date.setlistId ? (
              <Button render={<HostLink href={sets.href(date.setlistId)} />} data-testid="event-date-open-set">
                {t("teamCalendar.openSet")}
                <span className="opacity-70">· {t("teamCalendar.setItems", { count: date.songCount })}</span>
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5" data-testid="event-date-when">
            <CalendarDays className="size-4" aria-hidden />
            {longDay.format(noon(date.date))}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="size-4" aria-hidden />
            {time.format(new Date(date.startsAt))} – {time.format(new Date(date.endsAt))}
            {date.callAt ? <span data-testid="calendar-call">· {t("teamCalendar.callAt", { time: time.format(new Date(date.callAt)) })}</span> : null}
          </span>
          {date.place ? (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4" aria-hidden />
              {date.place}
            </span>
          ) : null}
          <HostLink href={links.team(date.teamId)} className="flex items-center gap-1.5 hover:text-foreground">
            <EntityAvatar name={date.teamName} color={date.teamColor} avatarUrl={date.teamAvatarUrl} size={18} />
            {date.teamName}
          </HostLink>
        </div>
        {date.rehearsalFor ? (
          <HostLink href={links.eventDate(date.rehearsalFor.eventId, date.rehearsalFor.date)} className="text-sm text-primary hover:underline" data-testid="event-date-rehearsal-for">
            {t("teamCalendar.datePageRehearsalFor", { title: `${date.rehearsalFor.title}, ${shortDay.format(noon(date.rehearsalFor.date))}` })}
          </HostLink>
        ) : null}
        {date.note ? <p className="text-sm whitespace-pre-line">{date.note}</p> : null}
      </div>
      {error ? <FieldError>{error}</FieldError> : null}

      <div className="flex flex-col gap-6">
        {open && !date.guest && !date.rehearsalFor ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("teamCalendar.yourAnswer")}</CardTitle>
            </CardHeader>
            <CardContent>
              <EventAnswer
                value={date.myAnswer}
                labels
                label={t("teamCalendar.yourAnswer")}
                onAnswer={(answer, note, wishes) => act(() => api.answerTeamEventDate(date.teamId, date.eventId, date.date, { answer, ...(note !== undefined && { note }), ...(wishes !== undefined && { wishes }) }))}
                wishOptions={date.wishOptions}
                partLabel={partLabel}
                onClear={() => act(() => api.clearTeamEventDateAnswer(date.teamId, date.eventId, date.date))}
              />
            </CardContent>
          </Card>
        ) : null}
        {open && !date.rehearsalFor ? (
          <Card data-testid="event-date-lineup">
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{t("teamCalendar.lineup")}</CardTitle>
              {date.isAdmin ? (
                <Button variant="outline" size="sm" onClick={() => setEditingLineup(true)} data-testid="event-date-edit-lineup">
                  {t("teamCalendar.datePageEditLineup")}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {date.lineup.length === 0 && (date.missing ?? []).length === 0 && (date.volunteerOptions ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("teamCalendar.lineupNobody")}</p>
              ) : (
                <LineupLine teamId={date.teamId} eventId={date.eventId} date={date.date} parts={date.parts} lineup={date.lineup} partLabel={partLabel} missing={date.missing} volunteerOptions={date.volunteerOptions} onChanged={() => act(async () => {})} />
              )}
            </CardContent>
          </Card>
        ) : null}
        {date.rehearsals.length > 0 ? (
          <Card data-testid="event-date-rehearsals">
            <CardHeader>
              <CardTitle>{t("teamCalendar.datePageRehearsals")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1.5 text-sm">
                {date.rehearsals.map((rehearsal) => (
                  <li key={`${rehearsal.eventId}-${rehearsal.date}`}>
                    <HostLink href={links.eventDate(rehearsal.eventId, rehearsal.date)} className="hover:underline">
                      <span className="font-medium">{rehearsal.title}</span> · {shortDay.format(noon(rehearsal.date))}, {time.format(new Date(rehearsal.startsAt))}
                    </HostLink>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
        {/* Who can play, for those who edit the set (it shows nothing to others). */}
        {open && date.setlistId ? <SetAvailabilityCard setlistId={date.setlistId} refreshKey={revision} /> : null}
      </div>
      {editingLineup ? (
        <LineupDialog
          teamId={date.teamId}
          eventId={date.eventId}
          date={date.date}
          title={`${date.title}, ${shortDay.format(noon(date.date))}`}
          parts={date.parts}
          lineup={date.lineup}
          partLabel={partLabel}
          onChanged={load}
          onClose={() => setEditingLineup(false)}
        />
      ) : null}
    </div>
  );
}
