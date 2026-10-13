import { addDays, coversPart, INSTRUMENTS, localDate, partKey, TECH_ROLES, type CustomInstrument, type EventPart, type MemberEventAnswer, type TeamAnswerRequest, type TeamEvent, type TeamEventDateSummary, type TeamPosition } from "@songverse/core";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Ban, CalendarPlus, CircleCheck, MapPin, MessageCircleQuestion, MoreHorizontal, Pencil, Repeat, RotateCcw, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "#/components/confirm-button";
import { DatePicker } from "#/components/date-picker";
import { EventAnswer } from "#/components/event-answer";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { NativeSelect } from "#/components/ui/native-select";
import { Textarea } from "#/components/ui/textarea";
import { LineupDialog, LineupLine, usePartLabel } from "#/components/lineup";
import { apiClient } from "#/lib/api-client";
import { formatSetDate } from "#/lib/setlists";
import { cn } from "#/lib/utils";

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
  withSets = true,
  positions = [],
}: {
  teamId: string;
  isAdmin: boolean;
  customInstruments?: readonly CustomInstrument[];
  /** The group's own positions (issue #241), parts its events can ask for. */
  positions?: readonly TeamPosition[];
  /** False for a group that only plans (issue #241): its dates have no set. */
  withSets?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const partLabel = usePartLabel(customInstruments);
  const navigate = useNavigate();
  const router = useRouter();
  const [weeks, setWeeks] = useState(SHOWN_WEEKS);
  // Past dates, newest first (issue #235): opened on demand, further back with each "Show more".
  const [pastWeeks, setPastWeeks] = useState(0);
  const [past, setPast] = useState<TeamEventDateSummary[] | null>(null);
  const [dates, setDates] = useState<TeamEventDateSummary[] | null>(null);
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [editing, setEditing] = useState<TeamEvent | "new" | null>(null);
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
    const [found, all, asked] = await Promise.all([apiClient.listTeamEventDates(teamId, today, addDays(today, weeks * 7)), apiClient.listTeamEvents(teamId), apiClient.listTeamAnswerRequests(teamId)]);
    setRequests(asked);
    const now = Date.now();
    setDates(found.filter((date) => Date.parse(date.endsAt) >= now - 12 * 3600_000));
    setEvents(all);
    if (pastWeeks > 0) {
      const gone = await apiClient.listTeamEventDates(teamId, addDays(today, -pastWeeks * 7), addDays(today, 1));
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
      const { setlistId } = await apiClient.ensureTeamEventDateSet(teamId, date.eventId, date.date);
      await navigate({ to: "/sets/$setlistId", params: { setlistId } });
    });

  const dayFormat = new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" });
  const timeFormat = (zone: string) => new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone: zone });

  return (
    <Card data-testid="team-calendar">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-sm">{t("teamCalendar.title")}</CardTitle>
          <CardDescription>{withSets ? t("teamCalendar.description") : t("teamCalendar.descriptionPlanning")}</CardDescription>
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setAsking(true)} data-testid="calendar-ask">
              <MessageCircleQuestion />
              {t("teamCalendar.askAnswers")}
            </Button>
            <Button size="sm" onClick={() => setEditing("new")} data-testid="calendar-new-event">
              <CalendarPlus />
              {t("teamCalendar.newEvent")}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
                onClick={() => void act(() => apiClient.removeTeamAnswerRequest(teamId, request.id))}
                data-testid="calendar-request-remove"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        ))}
        {dates === null ? null : dates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{isAdmin ? (withSets ? t("teamCalendar.noEventsAdmin") : t("teamCalendar.noEventsAdminPlanning")) : t("teamCalendar.noEvents")}</p>
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
                  </div>
                  <div className="col-span-3 flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn("text-sm font-medium", date.cancelled && "line-through")}>{date.title}</span>
                      {date.repeats ? <Repeat className="size-3.5 text-muted-foreground" aria-label={t("teamCalendar.repeats")} /> : null}
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
                    {date.place ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" aria-hidden />
                        {date.place}
                      </span>
                    ) : null}
                    {/* Whether you can play (issue #235); for the admins, how everyone answered. */}
                    {!date.cancelled && !rehearsal ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <EventAnswer
                          value={date.myAnswer}
                          label={t("teamCalendar.yourAnswer")}
                          onAnswer={(answer, note) => act(() => apiClient.answerTeamEventDate(teamId, date.eventId, date.date, { answer, ...(note !== undefined && { note }) }))}
                          onClear={() => act(() => apiClient.clearTeamEventDateAnswer(teamId, date.eventId, date.date))}
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
                      <LineupLine teamId={teamId} eventId={date.eventId} date={date.date} parts={date.parts} lineup={date.lineup} partLabel={partLabel} onChanged={() => act(async () => {})} />
                    ) : null}
                  </div>
                  {!date.cancelled && date.setlistId ? (
                    <Button variant="outline" size="sm" className="col-start-2 row-start-1" render={<Link to="/sets/$setlistId" params={{ setlistId: date.setlistId }} />} data-testid="calendar-open-set">
                      {t("teamCalendar.openSet")}
                      <span className="text-muted-foreground">· {t("teamCalendar.songs", { count: date.songCount })}</span>
                    </Button>
                  ) : !date.cancelled && !rehearsal && isAdmin && withSets ? (
                    <Button variant="outline" size="sm" className="col-start-2 row-start-1" onClick={() => void planSet(date)} data-testid="calendar-plan-set">
                      {t("teamCalendar.planSet")}
                    </Button>
                  ) : null}
                  {isAdmin ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<button type="button" className="col-start-3 row-start-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("teamCalendar.dateActions", { title: `${date.title}, ${dayFormat.format(new Date(`${date.date}T12:00:00Z`))}` })} />}
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {rehearsal || event?.planned ? null : (
                          <DropdownMenuItem onClick={() => void act(() => apiClient.updateTeamEventDate(teamId, date.eventId, date.date, { cancelled: !date.cancelled }))} data-testid="calendar-toggle-date">
                            {date.cancelled ? <RotateCcw /> : <Ban />}
                            {date.cancelled ? t("teamCalendar.restoreDate") : t("teamCalendar.cancelDate")}
                          </DropdownMenuItem>
                        )}
                        {!date.cancelled && !rehearsal && date.setlistId ? (
                          <DropdownMenuItem
                            onClick={() =>
                              void act(async () => {
                                const { notified } = await apiClient.setTeamEventDateReady(teamId, date.eventId, date.date);
                                setNotice(t("teamCalendar.setReadySent", { count: notified }));
                              })
                            }
                            data-testid="calendar-set-ready-send"
                          >
                            <CircleCheck />
                            {date.setReadyAt ? t("teamCalendar.setReadyAgain") : t("teamCalendar.setReady")}
                          </DropdownMenuItem>
                        ) : null}
                        {event ? (
                          <DropdownMenuItem onClick={() => setEditing(event)} data-testid="calendar-edit-event">
                            <Pencil />
                            {t("teamCalendar.editEvent")}
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
                  {date.setlistId ? (
                    <Button variant="outline" size="sm" render={<Link to="/sets/$setlistId" params={{ setlistId: date.setlistId }} />} data-testid="calendar-past-set">
                      {t("teamCalendar.openSet")}
                      <span className="text-muted-foreground">· {t("teamCalendar.songs", { count: date.songCount })}</span>
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
        {isAdmin && withSets ? <SetsAhead teamId={teamId} onSaved={load} /> : null}
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
      {editing ? (
        <EventDialog
          teamId={teamId}
          event={editing === "new" ? null : editing}
          teamEvents={events}
          teamNames={[...new Set(events.flatMap((one) => one.parts.filter((part) => !part.part && !part.position && part.name).map((part) => part.name!)))]}
          positions={positions}
          customInstruments={customInstruments}
          partLabel={partLabel}
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
      <span className="text-emerald-700 dark:text-emerald-400">✓ {counts.AVAILABLE}</span>
      <span className="text-amber-700 dark:text-amber-400">? {counts.IF_NEEDED}</span>
      <span className="text-rose-700 dark:text-rose-400">✗ {counts.UNAVAILABLE}</span>
      <span className="text-muted-foreground">– {counts.NONE}</span>
    </button>
  );
}

/** Every member's answer for a date, with their notes; an admin answers for someone (marked as answered by them). */
function AnswersDialog({ teamId, date, title, partLabel, onClose }: { teamId: string; date: TeamEventDateSummary; title: string; partLabel: (part: EventPart) => string; onClose: () => void }) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<MemberEventAnswer[] | null>(null);
  const load = useCallback(() => apiClient.listTeamEventDateAnswers(teamId, date.eventId, date.date).then(setMembers), [teamId, date]);
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
                    <span className={cn("text-xs", available.length < part.count ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
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
              <EventAnswer
                value={{ answer: member.answer, away: member.away, note: member.note, byAdmin: false }}
                label={t("teamCalendar.answerFor", { name: member.displayName })}
                onAnswer={(answer, note) => apiClient.answerTeamEventDateFor(teamId, date.eventId, date.date, member.userId, { answer, ...(note !== undefined && { note }) }).then(load)}
                onClear={() => apiClient.clearTeamEventDateAnswerFor(teamId, date.eventId, date.date, member.userId).then(load)}
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

/** The team's "Create sets ahead", in weeks (1 to 52). */
function SetsAhead({ teamId, onSaved }: { teamId: string; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const [weeks, setWeeks] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    // Not over what's been typed meanwhile.
    void apiClient.getTeamCalendarSettings(teamId).then((settings) => setWeeks((typed) => typed || String(settings.setsAheadWeeks)));
  }, [teamId]);
  const value = Number(weeks);
  const valid = Number.isInteger(value) && value >= 1 && value <= 52;
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        void apiClient.updateTeamCalendarSettings(teamId, { setsAheadWeeks: value }).then(async () => {
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
  teamEvents,
  teamNames,
  positions,
  customInstruments,
  partLabel,
  onClose,
  onSaved,
}: {
  teamId: string;
  event: TeamEvent | null;
  /** The team's events, a rehearsal's possible event. */
  teamEvents: TeamEvent[];
  teamNames: string[];
  positions: readonly TeamPosition[];
  customInstruments: readonly CustomInstrument[];
  partLabel: (part: EventPart) => string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [parts, setParts] = useState<EventPart[]>(event?.parts ?? []);
  const planned = event?.planned ?? null;
  // A rehearsal tied to another event (issue #235, phase 7): which, and how many days before.
  const [rehearsalOf, setRehearsalOf] = useState(event?.rehearsalFor?.eventId ?? "");
  const [daysBefore, setDaysBefore] = useState(String(event?.rehearsalFor?.daysBefore ?? 3));
  const parentEvent = teamEvents.find((one) => one.id === rehearsalOf) ?? null;
  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState(event?.date ?? localDate(new Date(), browserZone()));
  const [startTime, setStartTime] = useState(event?.startTime ?? "10:00");
  const [duration, setDuration] = useState(String(event?.durationMinutes ?? 90));
  const [timeZone, setTimeZone] = useState(event?.timeZone ?? browserZone());
  const [place, setPlace] = useState(event?.place ?? "");
  const [note, setNote] = useState(event?.note ?? "");
  const [everyWeeks, setEveryWeeks] = useState(event?.repeat ? String(event.repeat.everyWeeks) : "");
  const [until, setUntil] = useState(event?.repeat?.until ?? "");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [timeZone];

  const save = async () => {
    setBusy(true);
    setError(null);
    const repeat = everyWeeks ? { everyWeeks: Number(everyWeeks), until: until || null } : null;
    const body = parentEvent
      ? {
          title,
          date: parentEvent.date,
          startTime,
          durationMinutes: Number(duration),
          timeZone: parentEvent.timeZone,
          place: place || null,
          note: note || null,
          rehearsalFor: { eventId: parentEvent.id, daysBefore: Number(daysBefore) },
        }
      : {
          title,
          date,
          startTime,
          durationMinutes: Number(duration),
          timeZone,
          place: place || null,
          note: note || null,
          repeat,
          parts: parts.map(partBody),
          ...(event?.rehearsalFor ? { rehearsalFor: null } : {}),
        };
    try {
      if (event && planned) await apiClient.updateTeamEvent(teamId, event.id, { parts: parts.map(partBody) });
      else if (event) await apiClient.updateTeamEvent(teamId, event.id, body);
      else await apiClient.createTeamEvent(teamId, body);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="event-dialog">
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-duration">{t("teamCalendar.duration")}</Label>
            <Input id="event-duration" type="number" min={5} max={1440} value={duration} required onChange={(e) => setDuration(e.target.value)} />
          </div>
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
          {parentEvent ? null : <PartsEditor parts={parts} onChange={setParts} teamNames={teamNames} positions={positions} customInstruments={customInstruments} partLabel={partLabel} />}
        </form>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
                await apiClient.deleteTeamEvent(teamId, event.id);
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

/** A part as the API takes it: a position (issue #241) by its ID, an instrument or role by its key, else its name. */
export function partBody(part: EventPart): EventPart {
  return part.position ? { position: part.position, count: part.count } : part.part ? { part: part.part, count: part.count } : { name: part.name!, count: part.count };
}

/** Answers asked for (issue #235): the dates, from today to eight weeks on, by a deadline a week away. */
function AskDialog({ teamId, onClose, onAsked }: { teamId: string; onClose: () => void; onAsked: (notified: number) => Promise<void> }) {
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
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("teamCalendar.cancel")}
          </Button>
          <Button
            disabled={busy || !from || !to || !deadline}
            onClick={() => {
              setBusy(true);
              setError(null);
              void apiClient
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
}: {
  parts: EventPart[];
  onChange: (parts: EventPart[]) => void;
  teamNames: string[];
  positions: readonly TeamPosition[];
  customInstruments: readonly CustomInstrument[];
  partLabel: (part: EventPart) => string;
}) {
  const { t } = useTranslation();
  const [naming, setNaming] = useState<string | null>(null);
  const taken = new Set(parts.map((part) => partKey(part)));
  const add = (part: EventPart) => {
    if (!taken.has(partKey(part))) onChange([...parts, part]);
  };
  const choices = (keys: readonly string[]) => keys.filter((key) => !taken.has(key)).map((key) => ({ key, label: partLabel({ part: key, count: 1 }) }));
  const instruments = [...choices(INSTRUMENTS), ...choices(customInstruments.map((instrument) => instrument.id))];
  const names = teamNames.filter((name) => !taken.has(partKey({ name, count: 1 })));

  return (
    <div className="col-span-2 flex flex-col gap-2" data-testid="event-parts">
      <Label>{t("teamCalendar.parts")}</Label>
      <p className="text-xs text-muted-foreground">{t("teamCalendar.partsHint")}</p>
      {parts.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {parts.map((part, index) => (
            <li key={partKey(part)} className="flex items-center gap-2" data-part={partKey(part)}>
              <span className="min-w-0 flex-1 truncate text-sm">{partLabel(part)}</span>
              <Input
                type="number"
                min={1}
                max={20}
                value={part.count}
                aria-label={`${partLabel(part)} - ${t("teamCalendar.partCount")}`}
                className="h-8 w-16"
                onChange={(e) => onChange(parts.map((one, at) => (at === index ? { ...one, count: Math.min(20, Math.max(1, Number(e.target.value) || 1)) } : one)))}
              />
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("teamCalendar.partRemove", { part: partLabel(part) })}
                onClick={() => onChange(parts.filter((_, at) => at !== index))}
              >
                <X className="size-4" />
              </button>
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
          {/* The group's own positions first (issue #241): what it's mostly about. */}
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
          <optgroup label={t("teamCalendar.partInstruments")}>
            {instruments.map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.label}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("teamCalendar.partRoles")}>
            {choices(TECH_ROLES).map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.label}
              </option>
            ))}
          </optgroup>
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
