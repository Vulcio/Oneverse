import { addDays, bookingClashes, type BookingRefusal, wherePlace, coversPart, EVENT_ROLES, fillingGroups, INSTRUMENTS, leadsSet, partsForTeam, localDate, partKey, type CustomInstrument, type EventPart, type MemberEventAnswer, type TeamAnswerRequest, type TeamEvent, type TeamEventDateSummary, type TeamEventType, type TeamPosition } from "@oneverse/core";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Ban, Building2, CalendarArrowUp, CalendarClock, CalendarDays, CalendarPlus, CircleCheck, ExternalLink, Shapes, MapPin, MessageCircleQuestion, MoreHorizontal, Pencil, Repeat, RotateCcw, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { DatePicker } from "@oneverse/ui/components/date-picker";
import { EventAnswer } from "./event-answer";
import { EditsSetField, EventTypesDialog, WithSetField } from "./event-types";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@oneverse/ui/components/dropdown-menu";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Tabs, TabsList, TabsTrigger } from "@oneverse/ui/components/tabs";
import { Textarea } from "@oneverse/ui/components/textarea";
import { LineupDialog, LineupLine, partOf, usePartLabel } from "./lineup";
import { LocationField, useLocations } from "./locations";
import { resourceChoices, ResourcesField, useResources } from "./resources";
import { BookingClashes } from "./bookings";
import { MoveDateDialog } from "./move-date-dialog";
import { HostLink, usePlanning } from "../host";
import { formatSetDate } from "@oneverse/ui/lib/dates";
import { cn } from "@oneverse/ui/lib/utils";
import { FieldError } from "@oneverse/ui/components/field";
import { DurationField } from "./duration-field";

/** How far the calendar shows, then how much more each "Show more" adds. */
const SHOWN_WEEKS = 8;

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";


/**
 * A team's calendar (issue #235): its coming dates, every event's, each
 * with its set. Its admins add and edit events, cancel or restore a date,
 * plan a date's set however far ahead, and choose how far ahead the sets
 * are made; ask for answers by a deadline, and tell the people signed up
 * for a date that its set is ready (reminders, issue #235).
 */
export function TeamCalendar({
  teamId,
  isAdmin,
  customInstruments = [],
  setsByDefault = true,
  positions = [],
  organization = null,
  view: shownView,
}: {
  teamId: string;
  isAdmin: boolean;
  /**
   * Shown by the Calendar section (issue #551), which picks dates or events
   * from its own menu and keeps the event types apart: no tabs here, nor an
   * Event types button.
   */
  view?: "dates" | "events";
  /** The team's organisation (issue #549): an event can be moved to it, once its admins accept. */
  organization?: { id: string; name: string } | null;
  customInstruments?: readonly CustomInstrument[];
  /** The group's own positions (issue #241), parts its events can ask for. */
  positions?: readonly TeamPosition[];
  /** False for a group that only plans (issue #241): its new events start without a set, which can still be asked for (issue #531). */
  setsByDefault?: boolean;
}) {
  const { api, sets, links } = usePlanning();
  const { t, i18n } = useTranslation();
  // Its events made and changed elsewhere (issue #551: Plan's Calendar, from Songverse): answers, line-ups and sets stay here.
  const managedIn = isAdmin ? (links.manageEvents?.(`team:${teamId}`) ?? null) : null;
  const editsEvents = isAdmin && !managedIn;
  // The team and its organisation's groups (issue #528): who a part may be open to, named on it (issue #549: "Music · Worship").
  const openToTeams = useOpenToTeams(teamId);
  // Not the team itself: on its own calendar, "Music" is plainly its.
  const otherGroups = openToTeams.filter((one) => one.id !== teamId);
  const partLabel = usePartLabel(customInstruments, otherGroups);
  // A date's set, where the app has sets (every group's, issue #531); made only where they're kept.
  const setHref = sets ? sets.href : null;
  const makesSets = Boolean(setHref && sets?.canMake);
  const navigate = useNavigate();
  const router = useRouter();
  const [weeks, setWeeks] = useState(SHOWN_WEEKS);
  // Past dates, newest first (issue #235): opened on demand, further back with each "Show more".
  const [pastWeeks, setPastWeeks] = useState(0);
  const [past, setPast] = useState<TeamEventDateSummary[] | null>(null);
  const [dates, setDates] = useState<TeamEventDateSummary[] | null>(null);
  const [events, setEvents] = useState<TeamEvent[]>([]);
  // The team's event types (issue #523).
  const [types, setTypes] = useState<TeamEventType[]>([]);
  const [typesOpen, setTypesOpen] = useState(false);
  const [editing, setEditing] = useState<TeamEvent | "new" | null>(null);
  // Dates, or each event once (issue #549): a series is changed as a whole from there.
  const [ownView, setView] = useState<"dates" | "events">("dates");
  const view = shownView ?? ownView;
  // A date changed on its own (issue #549): its title and start time.
  const [editingDate, setEditingDate] = useState<TeamEventDateSummary | null>(null);
  const [movingDate, setMovingDate] = useState<TeamEventDateSummary | null>(null);
  const [answersOf, setAnswersOf] = useState<TeamEventDateSummary | null>(null);
  // The date whose line-up is open, by event and date: shown fresh from `dates` after each change.
  const [lineupOf, setLineupOf] = useState<{ eventId: string; date: string } | null>(null);
  const [requests, setRequests] = useState<TeamAnswerRequest[]>([]);
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // From today where the browser is: the API keeps a date until its own day is over.
    const today = addDays(localDate(new Date(), browserZone()), -1);
    const [found, all, asked, kinds] = await Promise.all([api.listTeamEventDates(teamId, today, addDays(today, weeks * 7)), api.listTeamEvents(teamId), api.listTeamAnswerRequests(teamId), api.listTeamEventTypes(teamId)]);
    setRequests(asked);
    setTypes(kinds);
    const now = Date.now();
    setDates(found.filter((date) => Date.parse(date.endsAt) >= now - 12 * 3600_000));
    setEvents(all);
    if (pastWeeks > 0) {
      const gone = await api.listTeamEventDates(teamId, addDays(today, -pastWeeks * 7), addDays(today, 1));
      setPast(gone.filter((date) => Date.parse(date.endsAt) < now - 12 * 3600_000 && !date.cancelled).reverse());
    } else setPast(null);
  }, [teamId, weeks, pastWeeks]);

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

  const planSet = (date: TeamEventDateSummary) =>
    act(async () => {
      const { setlistId } = await api.ensureTeamEventDateSet(teamId, date.eventId, date.date);
      if (!setHref) return;
      const href = setHref(setlistId);
      // Another app's set (Planiverse opening Songverse's): a page of its own.
      if (/^https?:\/\//.test(href)) window.location.assign(href);
      else await navigate({ to: href });
    });

  // The team's own part names used before: its events' and its types'.
  const teamNames = [...new Set([...events, ...types].flatMap((one) => one.parts.filter((part) => !part.part && !part.position && part.name).map((part) => part.name!)))];
  const dayFormat = new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" });
  const timeFormat = (zone: string) => new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone: zone });

  return (
    <Card data-testid="team-calendar">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-sm">{t("teamCalendar.title")}</CardTitle>
          <CardDescription>{setHref ? t("teamCalendar.description") : t("teamCalendar.descriptionPlanning")}</CardDescription>
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap gap-2">
            {managedIn ? (
              <Button variant="outline" size="sm" render={<a href={managedIn} />} data-testid="calendar-manage-in-plan">
                <ExternalLink />
                {t("calendarSection.manageInPlan")}
              </Button>
            ) : null}
            {shownView || !editsEvents ? null : (
              <Button variant="outline" size="sm" onClick={() => setTypesOpen(true)} data-testid="calendar-event-types">
                <Shapes />
                {t("teamCalendar.eventTypes")}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setAsking(true)} data-testid="calendar-ask">
              <MessageCircleQuestion />
              {t("teamCalendar.askAnswers")}
            </Button>
            {editsEvents ? (
              <Button size="sm" onClick={() => setEditing("new")} data-testid="calendar-new-event">
                <CalendarPlus />
                {t("teamCalendar.newEvent")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? <FieldError>{error}</FieldError> : null}
        {notice ? (
          <p className="text-sm text-muted-foreground" role="status">
            {notice}
          </p>
        ) : null}
        {/* Answers asked for, by when: for everyone (issue #235). */}
        {requests.map((request) => (
          <div key={request.id} className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm" data-testid="calendar-request">
            <span>
              {t("teamCalendar.askedBanner", { deadline: formatSetDate(request.deadline, i18n.language), from: formatSetDate(request.from, i18n.language), to: formatSetDate(request.to, i18n.language) })}
            </span>
            {isAdmin ? (
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("teamCalendar.askRemove")}
                title={t("teamCalendar.askRemove")}
                onClick={() => void act(() => api.removeTeamAnswerRequest(teamId, request.id))}
                data-testid="calendar-request-remove"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        ))}
        {/* The coming dates, or each event once (issue #549). */}
        {shownView ? null : (
        <Tabs value={view} onValueChange={(value) => setView(value as "dates" | "events")}>
          <TabsList aria-label={t("teamCalendar.title")}>
            <TabsTrigger value="dates" data-testid="calendar-view-dates">
              <CalendarDays />
              {t("teamCalendar.viewDates")}
            </TabsTrigger>
            <TabsTrigger value="events" data-testid="calendar-view-events">
              <Repeat />
              {t("teamCalendar.viewEvents")}
              {events.length > 0 ? <span className="text-xs text-muted-foreground tabular-nums">{events.length}</span> : null}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        )}
        {view === "events" ? (
          <EventSeriesList events={events} types={types} isAdmin={editsEvents} partLabel={partLabel} onEdit={setEditing} organizationName={organization?.name ?? null} />
        ) : (
        <>
        {dates === null ? null : dates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{isAdmin ? (makesSets ? t("teamCalendar.noEventsAdmin") : t("teamCalendar.noEventsAdminPlanning")) : t("teamCalendar.noEvents")}</p>
        ) : (
          <ul className="flex flex-col divide-y" aria-label={t("teamCalendar.title")}>
            {dates.map((date) => {
              const event = events.find((one) => one.id === date.eventId);
              // A rehearsal (issue #235, phase 7) follows its event's date: no answers or line-up of its own.
              const rehearsal = date.rehearsalFor;
              return (
                <li
                  key={`${date.eventId}-${date.date}`}
                  // Narrow (a phone): the date, its set and the menu on one line, the rest under them, full width.
                  className={cn("grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 py-2.5 first:pt-0 last:pb-0 @lg:flex @lg:flex-wrap @lg:gap-x-4", date.cancelled && "text-muted-foreground")}
                  data-event-date={date.date}
                  data-event-id={date.eventId}
                  data-cancelled={date.cancelled ? "" : undefined}
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
                  <div className="col-span-3 flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn("text-sm font-medium", date.cancelled && "line-through")}>{date.title}</span>
                      {date.repeats ? <Repeat className="size-3.5 text-muted-foreground" aria-label={t("teamCalendar.repeats")} /> : null}
                      {date.changed ? <Badge variant="muted" data-testid="calendar-date-changed">{t("teamCalendar.dateChanged")}</Badge> : null}
                      {/* Moved here from another day (issue #576). */}
                      {date.movedFrom ? (
                        <Badge variant="muted" data-testid="calendar-date-moved">
                          {t("teamCalendar.movedFrom", { date: dayFormat.format(new Date(`${date.movedFrom}T12:00:00Z`)) })}
                        </Badge>
                      ) : null}
                      {rehearsal ? <Badge variant="muted" data-testid="calendar-rehearsal">{t("teamCalendar.rehearsalBadge")}</Badge> : null}
                      {/* Planned by the team's organisation (issue #241), with its host. */}
                      {event?.planned ? (
                        <Badge variant="outline" data-testid="calendar-planned">
                          {event.planned.hostName ? t("teamCalendar.plannedByHost", { organization: event.planned.organizationName, host: event.planned.hostName }) : t("teamCalendar.plannedBy", { organization: event.planned.organizationName })}
                        </Badge>
                      ) : null}
                      {date.cancelled ? <Badge variant="outline">{t("teamCalendar.cancelled")}</Badge> : null}
                      {!date.cancelled && !rehearsal && date.setReadyAt ? (
                        <Badge variant="muted" data-testid="calendar-set-ready">
                          <CircleCheck />
                          {t("teamCalendar.setReadyBadge")}
                        </Badge>
                      ) : null}
                      {/* For the admins: the parts no one available covers yet (issue #235, phase 7). */}
                      {!date.cancelled && !rehearsal && date.coverage?.some((part) => part.missing > 0) ? (
                        <Badge variant="warning" data-testid="calendar-short">
                          <Users />
                          {t("teamCalendar.partShort", {
                            parts: date.coverage
                              .filter((part) => part.missing > 0)
                              .map((part) => `${partLabel(part)}${part.missing > 1 ? ` ×${part.missing}` : ""}`)
                              .join(", "),
                          })}
                        </Badge>
                      ) : null}
                    </div>
                    {rehearsal ? (
                      <span className="text-xs text-muted-foreground" data-testid="calendar-rehearsal-of">
                        {t("teamCalendar.rehearsalOf", { title: rehearsal.title, date: dayFormat.format(new Date(`${rehearsal.date}T12:00:00Z`)) })}
                      </span>
                    ) : null}
                    {wherePlace(date.place, date.rooms) ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" aria-hidden />
                        {wherePlace(date.place, date.rooms)}
                      </span>
                    ) : null}
                    {/* Whether you can play (issue #235); for the admins, how everyone answered. */}
                    {!date.cancelled && !rehearsal ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <EventAnswer
                          value={date.myAnswer}
                          label={t("teamCalendar.yourAnswer")}
                          onAnswer={(answer, note, wishes) => act(() => api.answerTeamEventDate(teamId, date.eventId, date.date, { answer, ...(note !== undefined && { note }), ...(wishes !== undefined && { wishes }) }))}
                          wishOptions={date.wishOptions}
                          partLabel={partLabel}
                          onClear={() => act(() => api.clearTeamEventDateAnswer(teamId, date.eventId, date.date))}
                        />
                        {date.counts ? <AnswerCounts counts={date.counts} onOpen={() => setAnswersOf(date)} /> : null}
                        {isAdmin && date.parts.length > 0 ? (
                          <Button variant="outline" size="sm" className="h-7" onClick={() => setLineupOf({ eventId: date.eventId, date: date.date })} data-testid="calendar-lineup">
                            <Users />
                            {t("teamCalendar.lineup")}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {!date.cancelled && !rehearsal ? (
                      <LineupLine teamId={teamId} eventId={date.eventId} date={date.date} parts={date.parts} lineup={date.lineup} partLabel={partLabel} missing={date.missing} volunteerOptions={date.volunteerOptions} onChanged={() => act(async () => {})} />
                    ) : null}
                  </div>
                  {!date.cancelled && date.setlistId && setHref ? (
                    <Button variant="outline" size="sm" className="col-start-2 row-start-1" render={<HostLink href={setHref(date.setlistId)} />} data-testid="calendar-open-set">
                      {t("teamCalendar.openSet")}
                      <span className="text-muted-foreground">· {t("teamCalendar.setItems", { count: date.songCount })}</span>
                    </Button>
                  ) : !date.cancelled && !rehearsal && isAdmin && makesSets && date.withSet !== false ? (
                    <Button variant="outline" size="sm" className="col-start-2 row-start-1" onClick={() => void planSet(date)} data-testid="calendar-plan-set">
                      {t("teamCalendar.planSet")}
                    </Button>
                  ) : null}
                  {editsEvents || (isAdmin && !date.cancelled && !rehearsal && date.setlistId && makesSets) ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<button type="button" className="col-start-3 row-start-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("teamCalendar.dateActions", { title: `${date.title}, ${dayFormat.format(new Date(`${date.date}T12:00:00Z`))}` })} />}
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {rehearsal || event?.planned || !editsEvents ? null : (
                          <DropdownMenuItem onClick={() => void act(() => api.updateTeamEventDate(teamId, date.eventId, date.date, { cancelled: !date.cancelled }))} data-testid="calendar-toggle-date">
                            {date.cancelled ? <RotateCcw /> : <Ban />}
                            {date.cancelled ? t("teamCalendar.restoreDate") : t("teamCalendar.cancelDate")}
                          </DropdownMenuItem>
                        )}
                        {!date.cancelled && !rehearsal && date.setlistId && makesSets ? (
                          <DropdownMenuItem
                            onClick={() =>
                              void act(async () => {
                                const { notified } = await api.setTeamEventDateReady(teamId, date.eventId, date.date);
                                setNotice(t("teamCalendar.setReadySent", { count: notified }));
                              })
                            }
                            data-testid="calendar-set-ready-send"
                          >
                            <CircleCheck />
                            {date.setReadyAt ? t("teamCalendar.setReadyAgain") : t("teamCalendar.setReady")}
                          </DropdownMenuItem>
                        ) : null}
                        {/* One date on its own (issue #549): a series' date, not a rehearsal's or an organisation's. */}
                        {editsEvents && event && event.repeat && !rehearsal && !event.planned ? (
                          <DropdownMenuItem onClick={() => setEditingDate(date)} data-testid="calendar-edit-date">
                            <CalendarClock />
                            {t("teamCalendar.editDate")}
                          </DropdownMenuItem>
                        ) : null}
                        {/* Another day for this date (issue #576): an organisation's event moves on its calendar. */}
                        {editsEvents && event && !rehearsal && !event.planned && !date.cancelled ? (
                          <DropdownMenuItem onClick={() => setMovingDate(date)} data-testid="calendar-move-date">
                            <CalendarArrowUp />
                            {t("teamCalendar.moveDate")}
                          </DropdownMenuItem>
                        ) : null}
                        {editsEvents && event ? (
                          <DropdownMenuItem onClick={() => setEditing(event)} data-testid="calendar-edit-event">
                            <Pencil />
                            {event.repeat ? t("teamCalendar.editSeries") : t("teamCalendar.editEvent")}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {dates && dates.length > 0 ? (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setWeeks((shown) => shown + SHOWN_WEEKS)}>
            {t("teamCalendar.showMore")}
          </Button>
        ) : null}
        <div className="flex flex-col gap-2 border-t pt-4" data-testid="calendar-past">
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setPastWeeks((shown) => (shown > 0 ? 0 : SHOWN_WEEKS))} aria-expanded={pastWeeks > 0} data-testid="calendar-past-toggle">
            {pastWeeks > 0 ? t("teamCalendar.hidePastDates") : t("teamCalendar.pastDates")}
          </Button>
          {past === null ? null : past.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("teamCalendar.noPastDates")}</p>
          ) : (
            <ul className="flex flex-col divide-y" aria-label={t("teamCalendar.pastDates")}>
              {past.map((date) => (
                <li key={`${date.eventId}-${date.date}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-muted-foreground" data-past-date={date.date}>
                  <span className="w-28 shrink-0 text-sm tabular-nums">{dayFormat.format(new Date(`${date.date}T12:00:00Z`))}</span>
                  <span className="min-w-0 flex-1 text-sm">{date.title}</span>
                  {date.counts ? <span className="text-xs tabular-nums">✓ {date.counts.AVAILABLE}</span> : null}
                  {date.setlistId && setHref ? (
                    <Button variant="outline" size="sm" render={<HostLink href={setHref(date.setlistId)} />} data-testid="calendar-past-set">
                      {t("teamCalendar.openSet")}
                      <span className="text-muted-foreground">· {t("teamCalendar.setItems", { count: date.songCount })}</span>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {past && past.length > 0 ? (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setPastWeeks((shown) => shown + SHOWN_WEEKS)}>
              {t("teamCalendar.showMore")}
            </Button>
          ) : null}
        </div>
        </>
        )}
        {isAdmin && makesSets ? <SetsAhead teamId={teamId} onSaved={load} /> : null}
      </CardContent>
      {answersOf ? (
        <AnswersDialog
          teamId={teamId}
          date={answersOf}
          partLabel={partLabel}
          title={`${answersOf.title}, ${dayFormat.format(new Date(`${answersOf.date}T12:00:00Z`))}`}
          onClose={() => {
            setAnswersOf(null);
            void load();
          }}
        />
      ) : null}
      {(() => {
        const open = lineupOf && dates?.find((one) => one.eventId === lineupOf.eventId && one.date === lineupOf.date);
        return open ? (
          <LineupDialog
            teamId={teamId}
            eventId={open.eventId}
            date={open.date}
            title={`${open.title}, ${dayFormat.format(new Date(`${open.date}T12:00:00Z`))}`}
            parts={open.parts}
            lineup={open.lineup}
            partLabel={partLabel}
            onChanged={load}
            onClose={() => setLineupOf(null)}
          />
        ) : null;
      })()}
      {asking ? (
        <AskDialog
          teamId={teamId}
          onClose={() => setAsking(false)}
          onAsked={async (notified) => {
            setAsking(false);
            setNotice(t("teamCalendar.askSent", { count: notified }));
            await load();
          }}
        />
      ) : null}
      {typesOpen ? (
        <EventTypesDialog
          owner={{ teamId }}
          types={types}
          makesSets={!!setHref}
          teamNames={teamNames}
          positions={positions}
          customInstruments={customInstruments}
          partLabel={partLabel}
          onChanged={load}
          onClose={() => setTypesOpen(false)}
        />
      ) : null}
      {movingDate ? (
        <MoveDateDialog
          date={movingDate.date}
          title={`${movingDate.title}, ${dayFormat.format(new Date(`${movingDate.date}T12:00:00Z`))}`}
          onClose={() => setMovingDate(null)}
          onMove={async (to) => {
            await api.moveTeamEventDate(teamId, movingDate.eventId, movingDate.date, { to });
            setMovingDate(null);
            await load();
          }}
        />
      ) : null}
      {editingDate ? (
        <DateDialog
          date={editingDate}
          title={dayFormat.format(new Date(`${editingDate.date}T12:00:00Z`))}
          series={events.find((one) => one.id === editingDate.eventId) ?? null}
          onClose={() => setEditingDate(null)}
          onSave={(body) =>
            act(async () => {
              await api.updateTeamEventDate(teamId, editingDate.eventId, editingDate.date, body);
              setEditingDate(null);
            })
          }
          onEditSeries={(series) => {
            setEditingDate(null);
            setEditing(series);
          }}
        />
      ) : null}
      {editing ? (
        <EventDialog
          teamId={teamId}
          event={editing === "new" ? null : editing}
          setsByDefault={setsByDefault}
          teamEvents={events}
          types={types}
          makesSets={!!setHref}
          teamNames={teamNames}
          positions={positions}
          customInstruments={customInstruments}
          partLabel={partLabel}
          openToTeams={openToTeams}
          organization={organization}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </Card>
  );
}

/** How a date's members answered, for the team's admins: available, if needed, not available, no answer. */
function AnswerCounts({ counts, onOpen }: { counts: NonNullable<TeamEventDateSummary["counts"]>; onOpen: () => void }) {
  const { t } = useTranslation();
  const summary = t("teamCalendar.answersSummary", { available: counts.AVAILABLE, ifNeeded: counts.IF_NEEDED, unavailable: counts.UNAVAILABLE, none: counts.NONE });
  return (
    <button type="button" onClick={onOpen} className="flex h-7 items-center gap-2 rounded-md border px-2 text-xs tabular-nums hover:bg-muted" aria-label={`${t("teamCalendar.whoCanPlay")}: ${summary}`} title={summary} data-testid="calendar-answers">
      <span className="text-success">✓ {counts.AVAILABLE}</span>
      <span className="text-warning">? {counts.IF_NEEDED}</span>
      <span className="text-rose-700 dark:text-rose-400">✗ {counts.UNAVAILABLE}</span>
      <span className="text-muted-foreground">– {counts.NONE}</span>
    </button>
  );
}

/** Every member's answer for a date, with their notes; an admin answers for someone (marked as answered by them). */
function AnswersDialog({ teamId, date, title, partLabel, onClose }: { teamId: string; date: TeamEventDateSummary; title: string; partLabel: (part: EventPart) => string; onClose: () => void }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [members, setMembers] = useState<MemberEventAnswer[] | null>(null);
  const load = useCallback(() => api.listTeamEventDateAnswers(teamId, date.eventId, date.date).then(setMembers), [teamId, date]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="answers-dialog">
        <DialogHeader>
          <DialogTitle>{t("teamCalendar.whoCanPlay")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{title}</p>
        </DialogHeader>
        {/* By part (issue #235, phase 7): who covers each, available or if needed, and how many it's short. */}
        {members && date.parts.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-md border p-3" data-testid="answers-by-part">
            <span className="text-xs font-medium text-muted-foreground">{t("teamCalendar.byPart")}</span>
            <ul className="flex flex-col gap-1 text-sm">
              {date.parts.map((part) => {
                const covering = members.filter((member) => coversPart(member, part));
                const available = covering.filter((member) => member.answer === "AVAILABLE").map((member) => member.displayName);
                const ifNeeded = covering.filter((member) => member.answer === "IF_NEEDED").map((member) => member.displayName);
                return (
                  <li key={partKey(part)} className="flex flex-wrap items-baseline gap-x-2" data-part={partKey(part)}>
                    <span className="font-medium">{partLabel(part)}</span>
                    <span className="text-xs text-muted-foreground">{t("teamCalendar.partNeeded", { count: part.count })}</span>
                    <span className={cn("text-xs", available.length < part.count ? "text-warning" : "text-success")}>
                      {available.length > 0 ? `✓ ${available.join(", ")}` : t("teamCalendar.partNobody")}
                    </span>
                    {ifNeeded.length > 0 ? <span className="text-xs text-muted-foreground">{t("teamCalendar.partIfNeeded", { names: ifNeeded.join(", ") })}</span> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <ul className="flex max-h-[60vh] flex-col divide-y overflow-y-auto">
          {(members ?? []).map((member) => (
            <li key={member.userId} className="flex flex-col gap-1.5 py-2.5" data-member={member.userId}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{member.displayName}</span>
                {member.answeredBy ? <span className="text-xs text-muted-foreground italic">{t("teamCalendar.answeredBy", { name: member.answeredBy })}</span> : null}
              </div>
              {/* What they'd like to play (issue #520). */}
              {member.wishes?.length ? (
                <span className="text-xs text-muted-foreground" data-testid="answers-wishes">
                  {t("teamCalendar.wishesOf", { parts: member.wishes.map((wish) => partLabel(partOf(date.parts, wish))).join(", ") })}
                </span>
              ) : null}
              <EventAnswer
                value={{ answer: member.answer, away: member.away, note: member.note, byAdmin: false }}
                label={t("teamCalendar.answerFor", { name: member.displayName })}
                onAnswer={(answer, note) => api.answerTeamEventDateFor(teamId, date.eventId, date.date, member.userId, { answer, ...(note !== undefined && { note }) }).then(load)}
                onClear={() => api.clearTeamEventDateAnswerFor(teamId, date.eventId, date.date, member.userId).then(load)}
              />
              {member.away && member.note ? <p className="text-xs text-muted-foreground">{member.note}</p> : null}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("teamCalendar.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Each of the team's events once (issue #549): a series with how it repeats,
 * a one-off with its date, a rehearsal with its event - to change one as a
 * whole, not date by date.
 */
function EventSeriesList({ events, types, isAdmin, partLabel, onEdit, organizationName }: { events: TeamEvent[]; types: TeamEventType[]; isAdmin: boolean; partLabel: (part: EventPart) => string; onEdit: (event: TeamEvent) => void; organizationName: string | null }) {
  const { t, i18n } = useTranslation();
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{t("teamCalendar.noSeries")}</p>;
  const today = localDate(new Date(), browserZone());
  // Coming first, by their first date; those over last.
  const over = (event: TeamEvent) => (event.repeat ? (event.repeat.until ?? "9999") < today : event.date < today);
  const sorted = [...events].sort((a, b) => Number(over(a)) - Number(over(b)) || a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return (
    <ul className="flex flex-col divide-y" aria-label={t("teamCalendar.viewEvents")} data-testid="calendar-series">
      {sorted.map((event) => {
        const parent = event.rehearsalFor ? events.find((one) => one.id === event.rehearsalFor!.eventId) : null;
        const type = types.find((one) => one.id === event.typeId);
        return (
          <li key={event.id} className={cn("flex items-start gap-3 py-2.5 first:pt-0 last:pb-0", over(event) && "text-muted-foreground")} data-series={event.id}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium">{event.title}</span>
                {type ? <Badge variant="muted">{type.name}</Badge> : null}
                {event.planned ? <Badge variant="outline">{t("teamCalendar.plannedBy", { organization: event.planned.organizationName })}</Badge> : null}
                {over(event) ? <Badge variant="outline">{t("teamCalendar.seriesPast")}</Badge> : null}
                {event.transferRequestedAt && organizationName ? (
                  <Badge variant="warning" data-testid="series-transfer-waiting">
                    {t("teamCalendar.transferBadge", { organization: organizationName })}
                  </Badge>
                ) : null}
              </div>
              <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground" data-testid="series-when">
                {parent && event.rehearsalFor ? (
                  t("teamCalendar.seriesRehearsal", { title: parent.title, days: event.rehearsalFor.daysBefore })
                ) : event.repeat ? (
                  <>
                    <Repeat className="size-3" aria-hidden />
                    {[
                      t("teamCalendar.everyNWeeks", { count: event.repeat.everyWeeks }),
                      t("teamCalendar.seriesOn", { weekday: weekdayOf(event.date, i18n.language), time: event.startTime }),
                      t("teamCalendar.seriesFrom", { date: formatSetDate(event.date, i18n.language) }),
                      event.repeat.until ? t("teamCalendar.seriesUntil", { date: formatSetDate(event.repeat.until, i18n.language) }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </>
                ) : (
                  t("teamCalendar.seriesOnce", { date: formatSetDate(event.date, i18n.language), time: event.startTime })
                )}
              </span>
              {event.parts.length > 0 ? <span className="text-xs text-muted-foreground">{event.parts.map((part) => `${partLabel(part)}${part.count > 1 ? ` ×${part.count}` : ""}`).join(", ")}</span> : null}
              {wherePlace(event.place, event.rooms?.map((room) => room.name)) ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="size-3" aria-hidden />
                  {wherePlace(event.place, event.rooms?.map((room) => room.name))}
                </span>
              ) : null}
            </div>
            {isAdmin ? (
              <Button variant="outline" size="sm" onClick={() => onEdit(event)} data-testid="series-edit">
                <Pencil />
                {event.repeat ? t("teamCalendar.editSeries") : t("teamCalendar.editEvent")}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** A weekday's long name, for a YYYY-MM-DD date. */
function weekdayOf(date: string, language: string): string {
  return new Intl.DateTimeFormat(language, { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

/** One date of a series changed on its own (issue #549): its title and start time, or back to the series'. */
function DateDialog({
  date,
  title,
  series,
  onClose,
  onSave,
  onEditSeries,
}: {
  date: TeamEventDateSummary;
  title: string;
  series: TeamEvent | null;
  onClose: () => void;
  onSave: (body: { title: string | null; startTime: string | null }) => Promise<void>;
  onEditSeries: (series: TeamEvent) => void;
}) {
  const { t } = useTranslation();
  const [ownTitle, setOwnTitle] = useState(date.title);
  const [start, setStart] = useState(date.startTime);
  const [busy, setBusy] = useState(false);
  const save = (body: { title: string | null; startTime: string | null }) => {
    setBusy(true);
    void onSave(body).finally(() => setBusy(false));
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="date-dialog">
        <DialogHeader>
          <DialogTitle>{t("teamCalendar.editDate")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t("teamCalendar.editDateHint", { date: title })}</p>
        </DialogHeader>
        <form
          id="date-form"
          className="grid grid-cols-1 gap-3"
          onSubmit={(submitted) => {
            submitted.preventDefault();
            // The series' own values aren't kept as the date's.
            save({ title: series && ownTitle.trim() === series.title ? null : ownTitle.trim() || null, startTime: series && start === series.startTime ? null : start });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="date-title">{t("teamCalendar.dateOwnTitle")}</Label>
            <Input id="date-title" value={ownTitle} maxLength={120} required onChange={(e) => setOwnTitle(e.target.value)} data-testid="date-title" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="date-start">{t("teamCalendar.dateOwnStart")}</Label>
            <Input id="date-start" type="time" value={start} required onChange={(e) => setStart(e.target.value)} data-testid="date-start" />
          </div>
        </form>
        <DialogFooter className="flex flex-wrap items-center gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {series ? (
              <Button type="button" variant="ghost" onClick={() => onEditSeries(series)} data-testid="date-edit-series">
                <Repeat />
                {t("teamCalendar.editSeries")}
              </Button>
            ) : null}
            {date.changed ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => save({ title: null, startTime: null })} data-testid="date-reset">
                <RotateCcw />
                {t("teamCalendar.dateBackToSeries")}
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("teamCalendar.cancel")}
            </Button>
            <Button type="submit" form="date-form" disabled={busy} data-testid="date-save">
              {busy ? t("teamCalendar.saving") : t("teamCalendar.saveDate")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The team's "Create sets ahead", in weeks (1 to 52). */
function SetsAhead({ teamId, onSaved }: { teamId: string; onSaved: () => Promise<void> }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [weeks, setWeeks] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    // Not over what's been typed meanwhile.
    void api.getTeamCalendarSettings(teamId).then((settings) => setWeeks((typed) => typed || String(settings.setsAheadWeeks)));
  }, [teamId]);
  const value = Number(weeks);
  const valid = Number.isInteger(value) && value >= 1 && value <= 52;
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        void api.updateTeamCalendarSettings(teamId, { setsAheadWeeks: value }).then(async () => {
          setSaved(true);
          await onSaved();
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sets-ahead">{t("teamCalendar.setsAhead")}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="sets-ahead"
            type="number"
            min={1}
            max={52}
            value={weeks}
            onChange={(event) => {
              setWeeks(event.target.value);
              setSaved(false);
            }}
            className="w-20"
            data-testid="calendar-sets-ahead"
          />
          <span className="text-sm text-muted-foreground">{t("teamCalendar.weeks")}</span>
        </div>
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={!valid} data-testid="calendar-sets-ahead-save">
        {saved ? t("teamCalendar.savedSetting") : t("teamCalendar.saveSetting")}
      </Button>
      <p className="basis-full text-xs text-muted-foreground">{t("teamCalendar.setsAheadHelp")}</p>
    </form>
  );
}

/** Adding or editing an event: its title, first date and time, how long, where, and whether it repeats. */
function EventDialog({
  teamId,
  event,
  setsByDefault,
  teamEvents,
  types,
  makesSets,
  teamNames,
  positions,
  customInstruments,
  partLabel,
  openToTeams,
  organization,
  onClose,
  onSaved,
}: {
  teamId: string;
  event: TeamEvent | null;
  /** A new event's dates get a set until unticked (false for a group that only plans). */
  setsByDefault: boolean;
  /** The team's events, a rehearsal's possible event. */
  teamEvents: TeamEvent[];
  /** The team's event types (issue #523): picking one fills the form. */
  types: TeamEventType[];
  /** The app has sets: whether the event's dates get one is asked. */
  makesSets: boolean;
  teamNames: string[];
  positions: readonly TeamPosition[];
  customInstruments: readonly CustomInstrument[];
  partLabel: (part: EventPart) => string;
  openToTeams: OpenToTeam[];
  organization: { id: string; name: string } | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api } = usePlanning();
  // Asked to become the organisation's (issue #549): waiting for its admins.
  const transferAsked = !!event?.transferRequestedAt;
  const { t } = useTranslation();
  const [parts, setParts] = useState<EventPart[]>(event?.parts ?? []);
  const planned = event?.planned ?? null;
  // A rehearsal tied to another event (issue #235, phase 7): which, and how many days before.
  const [rehearsalOf, setRehearsalOf] = useState(event?.rehearsalFor?.eventId ?? "");
  const [daysBefore, setDaysBefore] = useState(String(event?.rehearsalFor?.daysBefore ?? 3));
  const parentEvent = teamEvents.find((one) => one.id === rehearsalOf) ?? null;
  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState(event?.date ?? firstDateAt(DEFAULT_START));
  const [startTime, setStartTime] = useState(event?.startTime ?? DEFAULT_START);
  const [duration, setDuration] = useState(String(event?.durationMinutes ?? 90));
  // Its call time (issue #240): minutes before the start; blank, none.
  const [call, setCall] = useState(event?.callMinutes ? String(event.callMinutes) : "");
  const [timeZone, setTimeZone] = useState(event?.timeZone ?? browserZone());
  const [place, setPlace] = useState(event?.place ?? "");
  // Where it takes place (issue #320): one of the team's or its organisation's locations.
  const locations = useLocations({ teamId });
  const [locationId, setLocationId] = useState(event?.locationId ?? "");
  // The venue's rooms it takes (issue #563).
  const [roomIds, setRoomIds] = useState<string[]>(event?.rooms?.map((room) => room.id) ?? []);
  // The resources it takes (issue #564).
  const resources = useResources({ teamId });
  const [resourceUses, setResourceUses] = useState(resourceChoices(event?.resources));
  const [clashes, setClashes] = useState<BookingRefusal | null>(null);
  const [note, setNote] = useState(event?.note ?? "");
  const [everyWeeks, setEveryWeeks] = useState(event?.repeat ? String(event.repeat.everyWeeks) : "");
  const [until, setUntil] = useState(event?.repeat?.until ?? "");
  // Its type (issue #523), and whether its dates get a set.
  const [typeId, setTypeId] = useState(event?.typeId ?? "");
  const [withSet, setWithSet] = useState(event?.withSet ?? setsByDefault);
  // Whether its people on a date's line-up edit the date's set (issue #578).
  const [editsSet, setEditsSet] = useState(event?.editsSet ?? true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [timeZone];

  /** A type picked: the form takes its timing, parts and sets; its name as the title unless one was typed. */
  const pickType = (id: string) => {
    const previous = types.find((one) => one.id === typeId);
    const type = types.find((one) => one.id === id);
    setTypeId(id);
    if (!type) return;
    if (!title.trim() || title === previous?.name) setTitle(type.name);
    if (type.startTime) setStartTime(type.startTime);
    if (type.durationMinutes) setDuration(String(type.durationMinutes));
    setCall(type.callMinutes ? String(type.callMinutes) : "");
    // Its roles open to the groups that fill them (issue #549), unless the type says who.
    setParts(withFillingGroups(partsForTeam(type.parts, teamId), openToTeams));
    setWithSet(type.withSet);
    if (type.resources?.length) setResourceUses(resourceChoices(type.resources));
    // Where its events usually are (issue #559).
    const typeLocation = locations.find((one) => one.id === type.locationId);
    if (typeLocation) {
      setLocationId(typeLocation.id);
      setRoomIds(type.roomIds ?? []);
      if (!place || place === locations.find((one) => one.id === locationId)?.name) setPlace(typeLocation.name);
      if (!parentEvent) setTimeZone(typeLocation.timeZone);
    }
  };

  const save = async (skipClashes = false) => {
    setBusy(true);
    setError(null);
    setClashes(null);
    const repeat = everyWeeks ? { everyWeeks: Number(everyWeeks), until: until || null } : null;
    const body = parentEvent
      ? {
          title,
          date: parentEvent.date,
          startTime,
          durationMinutes: Number(duration),
          callMinutes: call ? Number(call) : null,
          timeZone: parentEvent.timeZone,
          place: place || null,
          locationId: locationId || null,
          roomIds: locationId ? roomIds : [],
          resources: resourceUses,
          note: note || null,
          rehearsalFor: { eventId: parentEvent.id, daysBefore: Number(daysBefore) },
        }
      : {
          title,
          date,
          startTime,
          durationMinutes: Number(duration),
          callMinutes: call ? Number(call) : null,
          timeZone,
          place: place || null,
          locationId: locationId || null,
          roomIds: locationId ? roomIds : [],
          resources: resourceUses,
          note: note || null,
          repeat,
          parts: parts.map(partBody),
          typeId: typeId || null,
          withSet,
          editsSet,
          ...(event?.rehearsalFor ? { rehearsalFor: null } : {}),
        };
    try {
      const booking = skipClashes ? { skipClashes: true } : {};
      if (event && planned) await api.updateTeamEvent(teamId, event.id, { parts: parts.map(partBody), callMinutes: call ? Number(call) : null });
      else if (event) await api.updateTeamEvent(teamId, event.id, { ...body, ...booking });
      else await api.createTeamEvent(teamId, { ...body, ...booking, typeId: typeId || undefined });
      await onSaved();
    } catch (err) {
      // Its rooms or resources already booked (issue #565): who has them, and for a series, its free dates.
      const clashing = bookingClashes(err);
      if (clashing) setClashes(clashing);
      else setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-testid="event-dialog">
        <DialogHeader>
          <DialogTitle>{event ? t("teamCalendar.editEvent") : t("teamCalendar.newEvent")}</DialogTitle>
        </DialogHeader>
        <form
          id="event-form"
          className="grid grid-cols-2 gap-3"
          onSubmit={(submitted) => {
            submitted.preventDefault();
            void save();
          }}
        >
          {/* A group's part of an organisation's event (issue #241): its timing is set there; the group chooses its parts. */}
          {planned ? (
            <p className="col-span-2 text-sm text-muted-foreground" data-testid="event-planned">
              {t("teamCalendar.plannedHint", { organization: planned.organizationName })}
            </p>
          ) : (
          <>
          {types.length > 0 && !parentEvent ? (
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="event-type">{t("teamCalendar.eventType")}</Label>
              <NativeSelect id="event-type" value={typeId} onChange={(e) => pickType(e.target.value)} data-testid="event-type">
                <option value="">{t("teamCalendar.eventTypeNone")}</option>
                {types.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="event-title">{t("teamCalendar.eventTitle")}</Label>
            <Input id="event-title" value={title} maxLength={120} required placeholder={t("teamCalendar.titlePlaceholder")} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="event-rehearsal">{t("teamCalendar.rehearsalFor")}</Label>
            <NativeSelect id="event-rehearsal" value={rehearsalOf} onChange={(e) => setRehearsalOf(e.target.value)} data-testid="event-rehearsal-for">
              <option value="">{t("teamCalendar.rehearsalNone")}</option>
              {teamEvents
                .filter((one) => !one.rehearsalFor && one.id !== event?.id)
                .map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.title}
                  </option>
                ))}
            </NativeSelect>
          </div>
          {parentEvent ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-days-before">{t("teamCalendar.daysBefore")}</Label>
              <Input id="event-days-before" type="number" min={0} max={14} value={daysBefore} required onChange={(e) => setDaysBefore(e.target.value)} data-testid="event-days-before" />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-date">{t("teamCalendar.firstDate")}</Label>
              <DatePicker id="event-date" value={date} onChange={setDate} testId="event-date" />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-time">{t("teamCalendar.startTime")}</Label>
            <Input id="event-time" type="time" value={startTime} required onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <DurationField id="event-duration" value={duration} onChange={setDuration} startTime={startTime} required />
          {!parentEvent ? (
          <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-zone">{t("teamCalendar.timeZone")}</Label>
            <NativeSelect id="event-zone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
              {(zones.includes(timeZone) ? zones : [timeZone, ...zones]).map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-repeat">{t("teamCalendar.repeat")}</Label>
            <NativeSelect id="event-repeat" value={everyWeeks} onChange={(e) => setEveryWeeks(e.target.value)}>
              <option value="">{t("teamCalendar.oneOff")}</option>
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <option key={n} value={String(n)}>
                  {t("teamCalendar.everyNWeeks", { count: n })}
                </option>
              ))}
              {everyWeeks && ![1, 2, 3, 4, 6, 8].includes(Number(everyWeeks)) ? <option value={everyWeeks}>{t("teamCalendar.everyNWeeks", { count: Number(everyWeeks) })}</option> : null}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-until">{t("teamCalendar.until")}</Label>
            <DatePicker id="event-until" value={until} min={date} disabled={!everyWeeks} clearable onChange={setUntil} testId="event-until" />
          </div>
          </>
          ) : null}
          <LocationField
            id="event-location"
            locations={locations}
            value={locationId}
            place={place}
            rooms={roomIds}
            onRooms={setRoomIds}
            onChange={(change) => {
              setLocationId(change.locationId);
              if (change.place !== undefined) setPlace(change.place);
              if (change.timeZone && !parentEvent) setTimeZone(change.timeZone);
            }}
          />
          <ResourcesField resources={resources} value={resourceUses} onChange={setResourceUses} />
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="event-place">{t("teamCalendar.place")}</Label>
            <Input id="event-place" value={place} maxLength={200} onChange={(e) => setPlace(e.target.value)} />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="event-note">{t("teamCalendar.note")}</Label>
            <Textarea id="event-note" value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} />
          </div>
          </>
          )}
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="event-call">{t("teamCalendar.callMinutes")}</Label>
            <Input id="event-call" type="number" min={1} max={480} value={call} placeholder="—" onChange={(e) => setCall(e.target.value)} data-testid="event-call" />
            <p className="text-xs text-muted-foreground">{t("teamCalendar.callMinutesHint")}</p>
          </div>
          {/* An organisation's event has one set per date, chosen there with who edits it (issue #578). */}
          {makesSets && !parentEvent && !planned ? <WithSetField id="event-with-set" checked={withSet} onChange={setWithSet} /> : null}
          {makesSets && !parentEvent && !planned && withSet ? <EditsSetField id="event-edits-set" checked={editsSet} onChange={setEditsSet} /> : null}
          {parentEvent ? null : <PartsEditor parts={parts} onChange={setParts} teamNames={teamNames} positions={positions} customInstruments={customInstruments} partLabel={partLabel} openToTeams={openToTeams} />}
        </form>
        {/* Its rooms and resources whose booking waits for a manager's approval (issue #565). */}
        {event?.awaitingApproval?.length ? (
          <p className="text-xs text-muted-foreground" data-testid="event-awaiting-approval">
            {t("bookings.awaiting", { names: event.awaitingApproval.join(", ") })}
          </p>
        ) : null}
        {error ? <FieldError>{error}</FieldError> : null}
        {clashes ? <BookingClashes clashes={clashes.clashes} busy={busy} onBookFree={!parentEvent && everyWeeks && clashes.freeDates !== 0 ? () => void save(true) : null} /> : null}
        {/* Moved to the organisation (issue #549), one-off or series: its admins accept it; dates, answers, line-ups and sets stay. */}
        {event && !planned && !event.rehearsalFor && organization ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm" data-testid="event-transfer">
            <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {transferAsked ? (
              <>
                <span className="min-w-0 flex-1">{t("teamCalendar.transferWaiting", { organization: organization.name })}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void api.requestTeamEventTransfer(teamId, event.id, false).then(() => onSaved(), (err: unknown) => setError(err instanceof Error ? err.message : String(err)))}
                  data-testid="event-transfer-cancel"
                >
                  {t("teamCalendar.transferCancel")}
                </Button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 text-muted-foreground">{t("teamCalendar.transferHint", { organization: organization.name })}</span>
                {/* Only asked: it can be taken back until an admin accepts. */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void api.requestTeamEventTransfer(teamId, event.id).then(() => onSaved(), (err: unknown) => setError(err instanceof Error ? err.message : String(err)))}
                  data-testid="event-transfer-ask"
                >
                  {t("teamCalendar.transfer", { organization: organization.name })}
                </Button>
              </>
            )}
          </div>
        ) : null}
        <DialogFooter className="flex flex-wrap items-center gap-2 sm:justify-between">
          {event && !planned ? (
            <ConfirmButton
              label={t("teamCalendar.deleteEvent")}
              confirmLabel={t("teamCalendar.confirmDelete")}
              busyLabel={t("teamCalendar.deleting")}
              cancelLabel={t("teamCalendar.cancel")}
              busy={deleting}
              onConfirm={async () => {
                setDeleting(true);
                await api.deleteTeamEvent(teamId, event.id);
                await onSaved();
              }}
            />
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("teamCalendar.cancel")}
            </Button>
            <Button type="submit" form="event-form" disabled={busy}>
              {busy ? t("teamCalendar.saving") : t("teamCalendar.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A new event's start time, until it's changed. */
export const DEFAULT_START = "10:00";

/** A new event's first date: today, unless `time` has passed here already - then tomorrow, so it isn't over as it's made. */
export function firstDateAt(time: string): string {
  const today = localDate(new Date(), browserZone());
  const now = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: browserZone() }).format(new Date());
  return now < time ? today : addDays(today, 1);
}

/** A part as the API takes it: a position (issue #241) by its ID, an instrument or role by its key, else its name. */
export function partBody(part: EventPart): EventPart {
  // Required, and open to teams (issue #528): only when set.
  // Who leads the set (issue #559): only when the event says, as Host and Music leader lead it otherwise.
  const extra = { ...(part.required && { required: true }), ...(part.openTo?.length && { openTo: part.openTo }), ...(typeof part.leadsSet === "boolean" && { leadsSet: part.leadsSet }) };
  return { ...(part.position ? { position: part.position, count: part.count } : part.part ? { part: part.part, count: part.count } : { name: part.name!, count: part.count }), ...extra };
}

/** Answers asked for (issue #235): the dates, from today to eight weeks on, by a deadline a week away. */
function AskDialog({ teamId, onClose, onAsked }: { teamId: string; onClose: () => void; onAsked: (notified: number) => Promise<void> }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const today = localDate(new Date(), browserZone());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 8 * 7));
  const [deadline, setDeadline] = useState(addDays(today, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent data-testid="ask-dialog">
        <DialogHeader>
          <DialogTitle>{t("teamCalendar.askTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("teamCalendar.askDescription")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ask-from">{t("teamCalendar.askFrom")}</Label>
            <DatePicker id="ask-from" value={from} min={today} onChange={setFrom} testId="ask-from" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ask-to">{t("teamCalendar.askTo")}</Label>
            <DatePicker id="ask-to" value={to} min={from} onChange={setTo} testId="ask-to" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ask-deadline">{t("teamCalendar.askDeadline")}</Label>
            <DatePicker id="ask-deadline" value={deadline} min={today} max={to} onChange={setDeadline} testId="ask-deadline" />
          </div>
        </div>
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("teamCalendar.cancel")}
          </Button>
          <Button
            disabled={busy || !from || !to || !deadline}
            onClick={() => {
              setBusy(true);
              setError(null);
              void api
                .askTeamForAnswers(teamId, { from, to, deadline, timeZone: browserZone() })
                .then((asked) => onAsked(asked.notified))
                .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setBusy(false));
            }}
            data-testid="ask-send"
          >
            {t("teamCalendar.askSend")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The parts an event needs (issue #235, phase 7), each with how many:
 * picked from the instruments, an admin's added instruments and the roles
 * people list on their dashboard, the team's own names used before, or a
 * new name.
 */
export function PartsEditor({
  parts,
  onChange,
  teamNames,
  positions,
  customInstruments,
  partLabel,
  openToTeams = [],
  instruments = false,
}: {
  parts: EventPart[];
  onChange: (parts: EventPart[]) => void;
  teamNames: string[];
  positions: readonly TeamPosition[];
  customInstruments: readonly CustomInstrument[];
  partLabel: (part: EventPart) => string;
  /** The teams a part's places may be open to (issue #528): the event's team and its organisation's groups. None: no open places. */
  openToTeams?: readonly OpenToTeam[];
  /**
   * Instruments offered (issue #549): only for what a date asks for from its
   * set. An event asks for roles - Music, not Drums; its music lead asks for
   * the instruments date by date.
   */
  instruments?: boolean;
}) {
  const { t } = useTranslation();
  const change = (index: number, changes: Partial<EventPart>) => onChange(parts.map((one, at) => (at === index ? { ...one, ...changes } : one)));
  const [naming, setNaming] = useState<string | null>(null);
  const taken = new Set(parts.map((part) => partKey(part)));
  const add = (part: EventPart) => {
    if (taken.has(partKey(part))) return;
    // A role open to the groups that fill it (issue #549): "Music · Worship".
    const [filled] = withFillingGroups([part], openToTeams);
    onChange([...parts, filled!]);
  };
  const choices = (keys: readonly string[]) => keys.filter((key) => !taken.has(key)).map((key) => ({ key, label: partLabel({ part: key, count: 1 }) }));
  const instrumentChoices = instruments ? [...choices(INSTRUMENTS), ...choices(customInstruments.map((instrument) => instrument.id))] : [];
  const names = teamNames.filter((name) => !taken.has(partKey({ name, count: 1 })));

  return (
    <div className="col-span-2 flex flex-col gap-2" data-testid="event-parts">
      <Label>{t("teamCalendar.parts")}</Label>
      <p className="text-xs text-muted-foreground">{t("teamCalendar.partsHint")}</p>
      {parts.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {parts.map((part, index) => (
            <li key={partKey(part)} className="flex flex-col gap-1" data-part={partKey(part)}>
              <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{partLabel(part)}</span>
              <Input
                type="number"
                min={1}
                max={20}
                value={part.count}
                aria-label={`${partLabel(part)} - ${t("teamCalendar.partCount")}`}
                className="h-8 w-16"
                onChange={(e) => change(index, { count: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })}
              />
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("teamCalendar.partRemove", { part: partLabel(part) })}
                onClick={() => onChange(parts.filter((_, at) => at !== index))}
              >
                <X className="size-4" />
              </button>
              </div>
              {/* Issue #528: a part that must be filled, and places members of chosen teams take themselves. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-1 text-xs text-muted-foreground">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" className="size-3.5" checked={!!part.required} onChange={(e) => change(index, { required: e.target.checked || undefined })} data-testid="event-part-required" />
                  {t("teamCalendar.partRequired")}
                </label>
                {!instruments ? (
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" className="size-3.5" checked={leadsSet(part)} onChange={(e) => change(index, { leadsSet: e.target.checked })} data-testid="event-part-leads-set" />
                    {t("teamCalendar.partLeadsSet")}
                  </label>
                ) : null}
                {/* Issue #559: a position comes from a team - its members offer, and are on at once. None: the admins choose who. */}
                {openToTeams.length > 0 && !instruments ? (
                  <label className="flex items-center gap-1.5">
                    {t("teamCalendar.partFrom")}
                    <NativeSelect
                      compact
                      value={part.openTo?.length === 1 ? part.openTo[0] : part.openTo?.length ? "__several" : ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value !== "__several") change(index, { openTo: value ? [value] : undefined });
                      }}
                      data-testid="event-part-from"
                    >
                      <option value="">{t("teamCalendar.partFromNobody")}</option>
                      {(part.openTo?.length ?? 0) > 1 ? <option value="__several">{part.openTo!.map((id) => openToTeams.find((team) => team.id === id)?.name ?? "?").join(", ")}</option> : null}
                      {openToTeams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {naming === null ? (
        <NativeSelect
          value=""
          aria-label={t("teamCalendar.addPart")}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "__other") setNaming("");
            else if (value.startsWith("name:")) add({ name: value.slice(5), count: 1 });
            else if (value.startsWith("position:")) add({ position: value.slice(9), name: positions.find((one) => `position:${one.id}` === value)?.name, count: 1 });
            else if (value) add({ part: value, count: 1 });
          }}
          data-testid="event-part-add"
        >
          <option value="">{t("teamCalendar.addPart")}</option>
          {/* The roles people list on their dashboard (issue #549), or a name of the event's own; each from a team (issue #559). */}
          {!instruments && choices(EVENT_ROLES).length > 0 ? (
            <optgroup label={t("teamCalendar.partRoles")}>
              {choices(EVENT_ROLES).map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {choice.label}
                </option>
              ))}
            </optgroup>
          ) : null}
          {/* The group's own positions (issue #241). */}
          {positions.some((one) => !taken.has(`position:${one.id}`)) ? (
            <optgroup label={t("teamCalendar.partPositions")}>
              {positions
                .filter((one) => !taken.has(`position:${one.id}`))
                .map((one) => (
                  <option key={one.id} value={`position:${one.id}`}>
                    {one.name}
                  </option>
                ))}
            </optgroup>
          ) : null}
          {instrumentChoices.length > 0 ? (
            <optgroup label={t("teamCalendar.partInstruments")}>
              {instrumentChoices.map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {choice.label}
                </option>
              ))}
            </optgroup>
          ) : null}
          {names.length > 0 ? (
            <optgroup label={t("teamCalendar.partTeamNames")}>
              {names.map((name) => (
                <option key={name} value={`name:${name}`}>
                  {name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <option value="__other">{t("teamCalendar.partOther")}</option>
        </NativeSelect>
      ) : (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={naming}
            maxLength={60}
            placeholder={t("teamCalendar.partNamePlaceholder")}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (naming.trim()) add({ name: naming.trim(), count: 1 });
                setNaming(null);
              } else if (e.key === "Escape") setNaming(null);
            }}
            data-testid="event-part-name"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!naming.trim()}
            onClick={() => {
              add({ name: naming.trim(), count: 1 });
              setNaming(null);
            }}
            data-testid="event-part-name-add"
          >
            {t("teamCalendar.partAdd")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A team a part may be open to (issue #528), and the roles it fills (issue #549). */
export type OpenToTeam = { id: string; name: string; fills?: string[] };

/**
 * Parts open to the groups that fill them (issue #549): a role with no
 * teams of its own goes to those - "Music" to Worship. Others as they are.
 */
export function withFillingGroups(parts: EventPart[], groups: readonly OpenToTeam[]): EventPart[] {
  return parts.map((part) => {
    if (part.openTo?.length || !part.part) return part;
    const filling = fillingGroups(part.part, groups);
    return filling.length > 0 ? { ...part, openTo: filling } : part;
  });
}

/**
 * The teams a part's places may be open to (issue #528): the team itself,
 * then the other groups of its organisation, each with the roles it fills.
 */
export function useOpenToTeams(teamId: string | null): OpenToTeam[] {
  const { api } = usePlanning();
  const [teams, setTeams] = useState<OpenToTeam[]>([]);
  useEffect(() => {
    if (!teamId) return;
    let live = true;
    void (async () => {
      const team = await api.getTeam(teamId);
      const others = team.organization ? (await api.getOrganization(team.organization.id).catch(() => null))?.teams ?? [] : [];
      const own = others.find((one) => one.id === team.id);
      if (live) setTeams([{ id: team.id, name: team.name, fills: own?.fills ?? [] }, ...others.filter((one) => one.id !== team.id).map((one) => ({ id: one.id, name: one.name, fills: one.fills ?? [] }))]);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [teamId]);
  return teams;
}
