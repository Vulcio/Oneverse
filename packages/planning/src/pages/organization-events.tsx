import { addDays, bookingClashes, type BookingRefusal, localDate, needsFromParts, partsFromNeeds, type CustomInstrument, type EventPart, type OrganizationDetail, type OrganizationEvent, type OrganizationEventDate, type TeamEventType, type OrganizationEventTransfer, type OrganizationMember, type OrganizationTeam } from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, Ban, CalendarArrowUp, CalendarDays, CircleCheck, ExternalLink, MapPin, MoreHorizontal, Pencil, PencilLine, Repeat, RotateCcw, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { DatePicker } from "@oneverse/ui/components/date-picker";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { usePartLabel } from "../components/lineup";
import { DEFAULT_START, firstDateAt, partBody, PartsEditor } from "../components/team-calendar";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@oneverse/ui/components/dropdown-menu";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Tabs, TabsList, TabsTrigger } from "@oneverse/ui/components/tabs";
import { Textarea } from "@oneverse/ui/components/textarea";
import { LocationField, useLocations } from "../components/locations";
import { resourceChoices, ResourcesField, useResources } from "../components/resources";
import { BookingClashes } from "../components/bookings";
import { MoveDateDialog } from "../components/move-date-dialog";
import { HostLink, usePlanning } from "../host";
import { loadOrganizationEventsPage } from "../loaders";

export { loadOrganizationEventsPage };
import { cn } from "@oneverse/ui/lib/utils";
import { formatSetDate } from "@oneverse/ui/lib/dates";
import { FieldError } from "@oneverse/ui/components/field";

const SHOWN_WEEKS = 8;
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * An organisation's events (issue #241): each coming date with its host and
 * every group it needs - how its parts are covered, for the organisation's
 * admins and the event's host, who change it, cancel a date for all, and
 * start one from one of its event types.
 */

export function OrganizationEventsPage({
  data,
  view: shownView,
}: {
  data: NonNullable<Awaited<ReturnType<typeof loadOrganizationEventsPage>>>;
  /** Shown by the Calendar section (issue #551), which picks dates or events from its own menu: no title or tabs here. */
  view?: "dates" | "events";
}) {
  const { api, links, sets } = usePlanning();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { organization, events, types, members, customInstruments } = data;
  const isAdmin = organization.currentUserRole === "ADMIN";
  // Its events made and changed elsewhere (issue #551: Plan's Calendar, from Songverse); who edits a date's set stays here.
  const managedIn = links.manageEvents?.(`organization:${organization.id}`) ?? null;
  // Its groups name the roles they fill (issue #549): "Music · Worship".
  const partLabel = usePartLabel(customInstruments, organization.teams);
  const [weeks, setWeeks] = useState(SHOWN_WEEKS);
  const [dates, setDates] = useState<OrganizationEventDate[] | null>(null);
  const [editing, setEditing] = useState<OrganizationEvent | "new" | null>(null);
  const [moving, setMoving] = useState<OrganizationEventDate | null>(null);
  // Who edits one date's set (issue #578).
  const [editors, setEditors] = useState<OrganizationEventDate | null>(null);
  // Its dates, or each event once (issue #549): a series is changed as a whole from there.
  const [ownView, setView] = useState<"dates" | "events">("dates");
  const view = shownView ?? ownView;
  const [error, setError] = useState<string | null>(null);
  const dayFormat = new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" });
  const timeFormat = (zone: string) => new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone: zone });

  const load = useCallback(async () => {
    const today = addDays(localDate(new Date(), browserZone()), -1);
    const fresh = await api.listOrganizationEventDates(organization.id, today, addDays(today, weeks * 7));
    setDates(fresh);
    return fresh;
  }, [organization.id, weeks]);
  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  async function act(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await Promise.all([load(), router.invalidate()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className={cn("flex flex-wrap items-start justify-between gap-4", shownView && "justify-end")}>
        {shownView ? null : (
        <div className="min-w-0">
          <HostLink href={links.organization(organization.id)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            {organization.name}
          </HostLink>
          <h1 className="text-2xl font-semibold">{t("organizations.events")}</h1>
          <p className="text-sm text-muted-foreground">{t("organizations.eventsHint")}</p>
        </div>
        )}
        {isAdmin && managedIn ? (
          <Button variant="outline" render={<a href={managedIn} />} data-testid="org-manage-in-plan">
            <ExternalLink />
            {t("calendarSection.manageInPlan")}
          </Button>
        ) : isAdmin ? (
          <Button onClick={() => setEditing("new")} data-testid="org-new-event">
            {t("organizations.newEvent")}
          </Button>
        ) : null}
      </div>

      {error ? <FieldError>{error}</FieldError> : null}

      {/* Groups' events asking to be the organisation's (issue #549): its admins accept or decline. */}
      {isAdmin ? <TransfersCard organizationId={organization.id} onDecided={() => act(async () => {})} /> : null}

      <Card>
        <CardContent className="flex flex-col gap-3">
          {shownView ? null : (
          <Tabs value={view} onValueChange={(value) => setView(value as "dates" | "events")}>
            <TabsList aria-label={t("organizations.events")}>
              <TabsTrigger value="dates" data-testid="org-view-dates">
                <CalendarDays />
                {t("teamCalendar.viewDates")}
              </TabsTrigger>
              <TabsTrigger value="events" data-testid="org-view-events">
                <Repeat />
                {t("teamCalendar.viewEvents")}
                {events.length > 0 ? <span className="text-xs text-muted-foreground tabular-nums">{events.length}</span> : null}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          )}
          {view === "events" ? (
            <OrganizationSeriesList events={events} onEdit={managedIn ? null : setEditing} />
          ) : (
          <>
          {dates === null ? null : dates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("organizations.noEventsYet")}</p>
          ) : (
            <ul className="flex flex-col divide-y" data-testid="org-event-dates">
              {dates.map((date) => {
                const event = events.find((one) => one.id === date.eventId);
                return (
                  <li key={`${date.eventId}-${date.date}`} className={cn("flex flex-col gap-2 py-3 first:pt-0 last:pb-0", date.cancelled && "text-muted-foreground")} data-org-event-date={date.date} data-org-event={date.eventId}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-4">
                        <div className="w-28 shrink-0 text-sm tabular-nums">
                          <div className="font-medium">{dayFormat.format(new Date(`${date.date}T12:00:00Z`))}</div>
                          <div className="text-xs text-muted-foreground">{timeFormat(date.timeZone).format(new Date(date.startsAt))}</div>
                        </div>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={cn("text-sm font-medium", date.cancelled && "line-through")}>{date.title}</span>
                            {date.cancelled ? <Badge variant="outline">{t("teamCalendar.cancelled")}</Badge> : null}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {date.host ? t("organizations.hostedBy", { name: date.host.displayName }) : null}
                            {date.place ? (
                              <span className="ml-2 inline-flex items-center gap-1">
                                <MapPin className="size-3" aria-hidden />
                                {date.place}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </div>
                      {date.canManage && event && (!managedIn || (!date.cancelled && date.groups.some((group) => group.setlistId))) ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("teamCalendar.dateActions", { title: `${date.title}, ${dayFormat.format(new Date(`${date.date}T12:00:00Z`))}` })} />}>
                            <MoreHorizontal className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {managedIn ? null : (
                              <DropdownMenuItem onClick={() => void act(() => api.setOrganizationEventDateCancelled(organization.id, date.eventId, date.date, !date.cancelled))} data-testid="org-toggle-date">
                                {date.cancelled ? <RotateCcw /> : <Ban />}
                                {date.cancelled ? t("teamCalendar.restoreDate") : t("teamCalendar.cancelDate")}
                              </DropdownMenuItem>
                            )}
                            {/* Another day for this date, for every team (issue #576). */}
                            {date.cancelled || managedIn ? null : (
                              <DropdownMenuItem onClick={() => setMoving(date)} data-testid="org-move-date">
                                <CalendarArrowUp />
                                {t("teamCalendar.moveDate")}
                              </DropdownMenuItem>
                            )}
                            {!date.cancelled && date.groups.some((group) => group.setlistId) ? (
                              <DropdownMenuItem onClick={() => setEditors(date)} data-testid="org-date-editors">
                                <PencilLine />
                                {t("organizations.dateEditors")}
                              </DropdownMenuItem>
                            ) : null}
                            {managedIn ? null : (
                              <DropdownMenuItem onClick={() => setEditing(event)} data-testid="org-edit-event">
                                <Pencil />
                                {event.repeat ? t("teamCalendar.editSeries") : t("organizations.editEvent")}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                    {/* Each group it needs: how its parts are covered (its admins and the host), or who's on it. */}
                    <ul className="flex flex-col gap-1.5 sm:pl-32">
                      {date.groups.map((group) => {
                        const short = group.coverage?.filter((part) => part.missing > 0) ?? [];
                        const on = group.lineup.filter((place) => place.status !== "DECLINED").length;
                        return (
                          <li key={group.teamId} className="flex flex-wrap items-center gap-2 text-sm" data-org-group={group.teamId}>
                            <EntityAvatar name={group.teamName} color={group.color} avatarUrl={group.avatarUrl} size={20} />
                            {group.mine ? (
                              <HostLink href={links.team(group.teamId)} className="font-medium hover:text-primary">
                                {group.teamName}
                              </HostLink>
                            ) : (
                              <span className="font-medium">{group.teamName}</span>
                            )}
                            {group.cancelled || !group.coverage ? null : short.length > 0 ? (
                              <Badge variant="warning" data-testid="org-group-short">
                                <Users />
                                {t("teamCalendar.partShort", { parts: short.map((part) => `${partLabel(part)}${part.missing > 1 ? ` ×${part.missing}` : ""}`).join(", ") })}
                              </Badge>
                            ) : group.parts.length > 0 ? (
                              <Badge variant="muted" data-testid="org-group-set">
                                <CircleCheck />
                                {t("organizations.allSet")}
                              </Badge>
                            ) : null}
                            {group.callAt && !group.cancelled ? (
                              <span className="text-xs text-muted-foreground" data-testid="org-group-call">
                                {t("teamCalendar.callAt", { time: timeFormat(date.timeZone).format(new Date(group.callAt)) })}
                              </span>
                            ) : null}
                            {on > 0 ? <span className="text-xs text-muted-foreground">{t("organizations.onIt", { count: on })}</span> : null}
                            {group.setlistId && !group.cancelled && group.editsSet ? (
                              <Badge variant="outline" data-testid="org-group-edits-set">
                                <PencilLine />
                                {t("organizations.needEditsSet")}
                              </Badge>
                            ) : null}
                            {group.mine && group.setlistId && !group.cancelled && sets ? (
                              <HostLink href={sets.href(group.setlistId)} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                                {t("teamCalendar.openSet")}
                              </HostLink>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
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
          </>
          )}
        </CardContent>
      </Card>

      {editors ? (
        <DateEditorsDialog
          date={editors}
          title={`${editors.title}, ${dayFormat.format(new Date(`${editors.date}T12:00:00Z`))}`}
          onChange={async (teamId, editsSet) => {
            await api.setOrganizationDateEditors(organization.id, editors.eventId, editors.date, { teamId, editsSet });
            const fresh = await load();
            setEditors(fresh?.find((one) => one.eventId === editors.eventId && one.date === editors.date) ?? null);
          }}
          onClose={() => setEditors(null)}
        />
      ) : null}
      {moving ? (
        <MoveDateDialog
          date={moving.date}
          title={`${moving.title}, ${dayFormat.format(new Date(`${moving.date}T12:00:00Z`))}`}
          onClose={() => setMoving(null)}
          onMove={async (to) => {
            await api.moveOrganizationEventDate(organization.id, moving.eventId, moving.date, { to });
            setMoving(null);
            await load();
          }}
        />
      ) : null}
      {editing ? (
        <OrganizationEventDialog
          organization={organization}
          event={editing === "new" ? null : editing}
          types={types}
          members={members}
          isAdmin={isAdmin}
          customInstruments={customInstruments}
          partLabel={partLabel}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await Promise.all([load(), router.invalidate()]);
          }}
        />
      ) : null}
    </div>
  );
}

/** Its groups' events asking to become the organisation's (issue #549): accepted, each is the organisation's with that group's part as it was. */
/**
 * Who edits one date's set (issue #578): each team as usual, or against it
 * for this date - a team that usually views it edits it, or the other way.
 */
function DateEditorsDialog({ date, title, onChange, onClose }: { date: OrganizationEventDate; title: string; onChange: (teamId: string, editsSet: boolean | null) => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = async (teamId: string, editsSet: boolean | null) => {
    setBusy(true);
    setError(null);
    try {
      await onChange(teamId, editsSet);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="org-date-editors-dialog">
        <DialogHeader>
          <DialogTitle>{t("organizations.dateEditors")}</DialogTitle>
          <DialogDescription>
            {title}. {t("organizations.dateEditorsHint")}
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {date.groups.map((group) => {
            // Its usual choice: what it does without this date's exception.
            const usual = group.dateEditsSet === null ? group.editsSet : !group.dateEditsSet;
            return (
              <li key={group.teamId} className="flex items-center justify-between gap-3 text-sm" data-editors-group={group.teamName}>
                <span className="flex items-center gap-2 font-medium">
                  <EntityAvatar name={group.teamName} color={group.color} avatarUrl={group.avatarUrl} size={20} />
                  {group.teamName}
                </span>
                <NativeSelect
                  compact
                  value={group.dateEditsSet === null ? "" : group.dateEditsSet ? "edit" : "view"}
                  disabled={busy}
                  aria-label={t("organizations.dateEditors")}
                  onChange={(e) => void change(group.teamId, e.target.value === "" ? null : e.target.value === "edit")}
                  data-testid="org-date-editors-choice"
                >
                  <option value="">{usual ? t("organizations.dateEditorsUsualEdits") : t("organizations.dateEditorsUsualViews")}</option>
                  {usual ? <option value="view">{t("organizations.dateEditorsViews")}</option> : <option value="edit">{t("organizations.dateEditorsEdits")}</option>}
                </NativeSelect>
              </li>
            );
          })}
        </ul>
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button type="button" onClick={onClose} data-testid="org-date-editors-done">
            {t("organizations.dateEditorsDone")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransfersCard({ organizationId, onDecided }: { organizationId: string; onDecided: () => Promise<void> }) {
  const { api } = usePlanning();
  const { t, i18n } = useTranslation();
  const [transfers, setTransfers] = useState<OrganizationEventTransfer[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.listOrganizationEventTransfers(organizationId).then(setTransfers, () => setTransfers([])), [organizationId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (transfers.length === 0) return null;
  const decide = async (id: string, accept: boolean) => {
    setBusy(id);
    setError(null);
    try {
      if (accept) await api.acceptOrganizationEventTransfer(organizationId, id);
      else await api.declineOrganizationEventTransfer(organizationId, id);
      await load();
      await onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const weekday = (date: string) => new Intl.DateTimeFormat(i18n.language, { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  return (
    <Card className="border-primary/40" data-testid="org-transfers">
      <CardHeader>
        <CardTitle className="text-sm">{t("organizations.transfersTitle")}</CardTitle>
        <CardDescription>{t("organizations.transfersHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error ? <FieldError>{error}</FieldError> : null}
        <ul className="flex flex-col divide-y">
          {transfers.map((one) => (
            <li key={one.teamEventId} className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0" data-transfer={one.teamEventId}>
              <EntityAvatar name={one.teamName} color={one.color} avatarUrl={one.avatarUrl} size={28} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{one.title}</span>
                <span className="text-xs text-muted-foreground">
                  {[
                    one.teamName,
                    one.repeat
                      ? `${t("teamCalendar.everyNWeeks", { count: one.repeat.everyWeeks })} · ${t("teamCalendar.seriesOn", { weekday: weekday(one.date), time: one.startTime })}`
                      : t("teamCalendar.seriesOnce", { date: formatSetDate(one.date, i18n.language), time: one.startTime }),
                    one.requestedBy ? t("organizations.transferAskedBy", { name: one.requestedBy }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy !== null} onClick={() => void decide(one.teamEventId, true)} data-testid="org-transfer-accept">
                  {t("organizations.transferAccept")}
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide(one.teamEventId, false)} data-testid="org-transfer-decline">
                  {t("organizations.transferDecline")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Each of the organisation's events once (issue #549): how it repeats, its host and groups, to change it as a whole. */
function OrganizationSeriesList({ events, onEdit }: { events: OrganizationEvent[]; onEdit: ((event: OrganizationEvent) => void) | null }) {
  const { t, i18n } = useTranslation();
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{t("organizations.noEventsYet")}</p>;
  const today = localDate(new Date(), browserZone());
  const over = (event: OrganizationEvent) => (event.repeat ? (event.repeat.until ?? "9999") < today : event.date < today);
  const weekday = (date: string) => new Intl.DateTimeFormat(i18n.language, { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const sorted = [...events].sort((a, b) => Number(over(a)) - Number(over(b)) || a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return (
    <ul className="flex flex-col divide-y" aria-label={t("teamCalendar.viewEvents")} data-testid="org-series">
      {sorted.map((event) => (
        <li key={event.id} className={cn("flex items-start gap-3 py-2.5 first:pt-0 last:pb-0", over(event) && "text-muted-foreground")} data-series={event.id}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{event.title}</span>
              {over(event) ? <Badge variant="outline">{t("teamCalendar.seriesPast")}</Badge> : null}
            </div>
            <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground" data-testid="series-when">
              {event.repeat ? (
                <>
                  <Repeat className="size-3" aria-hidden />
                  {[
                    t("teamCalendar.everyNWeeks", { count: event.repeat.everyWeeks }),
                    t("teamCalendar.seriesOn", { weekday: weekday(event.date), time: event.startTime }),
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
            <span className="text-xs text-muted-foreground">
              {[event.host ? t("organizations.hostedBy", { name: event.host.displayName }) : null, event.needs.map((need) => need.teamName).join(", ") || null].filter(Boolean).join(" · ")}
            </span>
          </div>
          {event.canManage && onEdit ? (
            <Button variant="outline" size="sm" onClick={() => onEdit(event)} data-testid="series-edit">
              <Pencil />
              {event.repeat ? t("teamCalendar.editSeries") : t("organizations.editEvent")}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** An organisation's event (issue #241): its timing, its host, the groups it needs and the parts it asks each for. */
function OrganizationEventDialog({
  organization,
  event,
  types,
  members,
  isAdmin,
  customInstruments,
  partLabel,
  onClose,
  onSaved,
}: {
  organization: OrganizationDetail;
  event: OrganizationEvent | null;
  types: TeamEventType[];
  members: OrganizationMember[];
  isAdmin: boolean;
  customInstruments: readonly CustomInstrument[];
  partLabel: (part: EventPart) => string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api, sets } = usePlanning();
  const { t } = useTranslation();
  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState(event?.date ?? firstDateAt(DEFAULT_START));
  const [startTime, setStartTime] = useState(event?.startTime ?? DEFAULT_START);
  const [duration, setDuration] = useState(String(event?.durationMinutes ?? 90));
  const [timeZone, setTimeZone] = useState(event?.timeZone ?? browserZone());
  const [place, setPlace] = useState(event?.place ?? "");
  // Where it takes place (issue #320): one of the organisation's locations.
  const locations = useLocations({ organizationId: organization.id });
  const [locationId, setLocationId] = useState(event?.locationId ?? "");
  // The venue's rooms it takes (issue #563).
  const [roomIds, setRoomIds] = useState<string[]>(event?.rooms?.map((room) => room.id) ?? []);
  // The resources it takes (issue #564), the organisation's.
  const resources = useResources({ organizationId: organization.id });
  const [resourceUses, setResourceUses] = useState(resourceChoices(event?.resources));
  const [clashes, setClashes] = useState<BookingRefusal | null>(null);
  const [note, setNote] = useState(event?.note ?? "");
  const [everyWeeks, setEveryWeeks] = useState(event?.repeat ? String(event.repeat.everyWeeks) : "");
  const [until, setUntil] = useState(event?.repeat?.until ?? "");
  const [hostUserId, setHostUserId] = useState(event?.host?.id ?? "");
  // Each group's parts, and when it's to be there (issue #240: minutes before; blank, none).
  const [needs, setNeeds] = useState<{ teamId: string; parts: EventPart[]; call: string; editsSet: boolean }[]>(event?.needs.map((need) => ({ teamId: need.teamId, parts: need.parts, call: need.callMinutes ? String(need.callMinutes) : "", editsSet: need.editsSet ?? true })) ?? []);
  // One set per date for all its teams (issue #578); each team edits it or views it.
  const [withSet, setWithSet] = useState(event?.withSet ?? true);
  const [typeName, setTypeName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [timeZone];
  const teamOf = (teamId: string): OrganizationTeam | undefined => organization.teams.find((team) => team.id === teamId);
  const choices = organization.teams.filter((team) => !needs.some((need) => need.teamId === team.id));

  // Issue #559: a type's positions, each from a team, are what the event needs of those teams.
  const fromType = (type: TeamEventType) => {
    setTitle(type.name);
    if (type.startTime) setStartTime(type.startTime);
    if (type.durationMinutes) setDuration(String(type.durationMinutes));
    const typeLocation = locations.find((one) => one.id === type.locationId);
    setLocationId(typeLocation?.id ?? "");
    setRoomIds(typeLocation ? (type.roomIds ?? []) : []);
    setResourceUses(resourceChoices(type.resources));
    setPlace(typeLocation?.name ?? "");
    if (typeLocation) setTimeZone(typeLocation.timeZone);
    setWithSet(type.withSet);
    // The type's teams that edit the set; none chosen, those that use Songverse.
    const edits = (teamId: string) => ((type.editingTeamIds ?? []).length > 0 ? type.editingTeamIds!.includes(teamId) : teamOf(teamId)?.usesSongverse !== false);
    setNeeds(needsFromParts(type.parts).filter((need) => teamOf(need.teamId)).map((need) => ({ teamId: need.teamId, parts: need.parts, call: type.callMinutes ? String(type.callMinutes) : "", editsSet: edits(need.teamId) })));
  };
  const needsBody = () => needs.map((need) => ({ teamId: need.teamId, parts: need.parts.map(partBody), ...(need.call ? { callMinutes: Number(need.call) } : {}), editsSet: need.editsSet }));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setClashes(null);
    try {
      await action();
      await onSaved();
    } catch (err) {
      // Its rooms or resources already booked (issue #565).
      const clashing = bookingClashes(err);
      if (clashing) setClashes(clashing);
      else setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const save = (skipClashes = false) =>
    run(() => {
      const booking = skipClashes ? { skipClashes: true } : {};
      const timing = { title, date, startTime, durationMinutes: Number(duration), timeZone, note: note || null, repeat: everyWeeks ? { everyWeeks: Number(everyWeeks), until: until || null } : null };
      return event
        ? api.updateOrganizationEvent(organization.id, event.id, { ...timing, place: place || null, locationId: locationId || null, roomIds: locationId ? roomIds : [], resources: resourceUses, withSet, needs: needsBody(), ...booking, ...(isAdmin ? { hostUserId } : {}) })
        : api.createOrganizationEvent(organization.id, { ...timing, place: place || null, locationId: locationId || null, roomIds: locationId ? roomIds : [], resources: resourceUses, hostUserId, withSet, needs: needsBody(), ...booking });
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="org-event-dialog">
        <DialogHeader>
          <DialogTitle>{event ? t("organizations.editEvent") : t("organizations.newEvent")}</DialogTitle>
        </DialogHeader>
        <form
          id="org-event-form"
          className="grid grid-cols-2 gap-3"
          onSubmit={(submitted) => {
            submitted.preventDefault();
            void save();
          }}
        >
          {!event && types.length > 0 ? (
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="org-event-type">{t("organizations.eventType")}</Label>
              <NativeSelect
                id="org-event-type"
                defaultValue=""
                onChange={(e) => {
                  const type = types.find((one) => one.id === e.target.value);
                  if (type) fromType(type);
                }}
                data-testid="org-event-type"
              >
                <option value="">{t("organizations.eventTypeNone")}</option>
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="org-event-title">{t("teamCalendar.eventTitle")}</Label>
            <Input id="org-event-title" value={title} maxLength={120} required onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-event-date">{t("teamCalendar.firstDate")}</Label>
            <DatePicker id="org-event-date" value={date} onChange={setDate} testId="org-event-date" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-event-time">{t("teamCalendar.startTime")}</Label>
            <Input id="org-event-time" type="time" value={startTime} required onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-event-duration">{t("teamCalendar.duration")}</Label>
            <Input id="org-event-duration" type="number" min={5} max={1440} value={duration} required onChange={(e) => setDuration(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-event-zone">{t("teamCalendar.timeZone")}</Label>
            <NativeSelect id="org-event-zone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
              {(zones.includes(timeZone) ? zones : [timeZone, ...zones]).map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-event-repeat">{t("teamCalendar.repeat")}</Label>
            <NativeSelect id="org-event-repeat" value={everyWeeks} onChange={(e) => setEveryWeeks(e.target.value)}>
              <option value="">{t("teamCalendar.oneOff")}</option>
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <option key={n} value={String(n)}>
                  {t("teamCalendar.everyNWeeks", { count: n })}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-event-until">{t("teamCalendar.until")}</Label>
            <DatePicker id="org-event-until" value={until} min={date} disabled={!everyWeeks} clearable onChange={setUntil} testId="org-event-until" />
          </div>
          <LocationField
            id="org-event-location"
            locations={locations}
            value={locationId}
            place={place}
            rooms={roomIds}
            onRooms={setRoomIds}
            onChange={(change) => {
              setLocationId(change.locationId);
              if (change.place !== undefined) setPlace(change.place);
              if (change.timeZone) setTimeZone(change.timeZone);
            }}
          />
          <ResourcesField resources={resources} value={resourceUses} onChange={setResourceUses} />
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="org-event-place">{t("teamCalendar.place")}</Label>
            <Input id="org-event-place" value={place} maxLength={200} onChange={(e) => setPlace(e.target.value)} />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="org-event-note">{t("teamCalendar.note")}</Label>
            <Textarea id="org-event-note" value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="org-event-host">{t("organizations.host")}</Label>
            <NativeSelect id="org-event-host" value={hostUserId} required disabled={!isAdmin} onChange={(e) => setHostUserId(e.target.value)} data-testid="org-event-host">
              <option value="" disabled>
                -
              </option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </NativeSelect>
          </div>
          {/* One set per date, for every team it needs (issue #578). */}
          {sets ? (
            <div className="col-span-2 flex flex-col gap-1">
              <label htmlFor="org-event-with-set" className="flex items-center gap-2 text-sm font-medium">
                <input id="org-event-with-set" type="checkbox" className="size-4" checked={withSet} onChange={(e) => setWithSet(e.target.checked)} data-testid="org-event-with-set" />
                {t("organizations.withSet")}
              </label>
              <p className="text-xs text-muted-foreground">{t("organizations.withSetHint")}</p>
            </div>
          ) : null}
          {/* The groups it needs (issue #241), each with the parts it asks it for. */}
          <div className="col-span-2 flex flex-col gap-3" data-testid="org-event-needs">
            <div>
              <Label>{t("organizations.needs")}</Label>
              <p className="text-xs text-muted-foreground">{t("organizations.needsHint")}</p>
            </div>
            {needs.map((need, index) => {
              const team = teamOf(need.teamId);
              return (
                <div key={need.teamId} className="flex flex-col gap-2 rounded-md border p-3" data-need={team?.name}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <EntityAvatar name={team?.name ?? "?"} color={team?.color ?? null} avatarUrl={team?.avatarUrl ?? null} size={20} />
                      {team?.name}
                    </span>
                    <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("organizations.removeGroup", { name: team?.name ?? "" })} onClick={() => setNeeds(needs.filter((_, at) => at !== index))}>
                      <X className="size-4" />
                    </button>
                  </div>
                  <PartsEditor
                    parts={need.parts}
                    onChange={(parts) => setNeeds(needs.map((one, at) => (at === index ? { ...one, parts } : one)))}
                    teamNames={[]}
                    positions={team?.positions ?? []}
                    customInstruments={customInstruments}
                    partLabel={partLabel}
                    openToTeams={[...(team ? [team] : []), ...organization.teams.filter((one) => one.id !== need.teamId)].map((one) => ({ id: one.id, name: one.name, fills: one.fills ?? [] }))}
                  />
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`need-call-${need.teamId}`} className="text-xs font-normal text-muted-foreground">
                      {t("teamCalendar.callMinutes")}
                    </Label>
                    <Input
                      id={`need-call-${need.teamId}`}
                      type="number"
                      min={1}
                      max={480}
                      className="h-8 w-20"
                      value={need.call}
                      placeholder="—"
                      onChange={(e) => setNeeds(needs.map((one, at) => (at === index ? { ...one, call: e.target.value } : one)))}
                      data-testid="need-call"
                    />
                  </div>
                  {/* Whether it edits each date's set or only views it (issue #578). */}
                  {sets && withSet ? (
                    <label className="flex items-center gap-2 text-sm" htmlFor={`need-edits-set-${need.teamId}`}>
                      <input
                        id={`need-edits-set-${need.teamId}`}
                        type="checkbox"
                        className="size-4"
                        checked={need.editsSet}
                        onChange={(e) => setNeeds(needs.map((one, at) => (at === index ? { ...one, editsSet: e.target.checked } : one)))}
                        data-testid="need-edits-set"
                      />
                      <span className="font-medium">{t("organizations.needEditsSet")}</span>
                      <span className="text-xs text-muted-foreground">{t("organizations.needEditsSetHint")}</span>
                    </label>
                  ) : null}
                </div>
              );
            })}
            {choices.length > 0 ? (
              <NativeSelect
                value=""
                aria-label={t("organizations.addGroup")}
                onChange={(e) => {
                  if (e.target.value) setNeeds([...needs, { teamId: e.target.value, parts: [], call: "", editsSet: teamOf(e.target.value)?.usesSongverse !== false }]);
                }}
                data-testid="org-event-add-group"
              >
                <option value="">{t("organizations.addGroup")}</option>
                {choices.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
          </div>
        </form>
        {/* Its rooms and resources whose booking waits for a manager's approval (issue #565). */}
        {event?.awaitingApproval?.length ? (
          <p className="text-xs text-muted-foreground" data-testid="event-awaiting-approval">
            {t("bookings.awaiting", { names: event.awaitingApproval.join(", ") })}
          </p>
        ) : null}
        {error ? <FieldError>{error}</FieldError> : null}
        {clashes ? <BookingClashes clashes={clashes.clashes} busy={busy} onBookFree={everyWeeks && needs.length > 0 && clashes.freeDates !== 0 ? () => void save(true) : null} /> : null}
        {typeName !== null ? (
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="org-type-name">{t("organizations.eventTypeName")}</Label>
              <Input id="org-type-name" value={typeName} maxLength={120} autoFocus onChange={(e) => setTypeName(e.target.value)} />
            </div>
            <Button
              variant="outline"
              disabled={busy || !typeName.trim() || !needs.some((need) => need.parts.length > 0)}
              onClick={() =>
                void run(() =>
                  api.createOrganizationEventType(organization.id, {
                    name: typeName.trim(),
                    startTime,
                    durationMinutes: Number(duration),
                    ...(needs[0]?.call ? { callMinutes: Number(needs[0].call) } : {}),
                    withSet,
                    editingTeamIds: needs.filter((need) => need.editsSet).map((need) => need.teamId),
                    ...(locationId ? { locationId, roomIds } : {}),
                    resources: resourceUses,
                    parts: partsFromNeeds(needsBody()),
                  }),
                )
              }
              data-testid="org-type-save"
            >
              {t("organizations.save")}
            </Button>
          </div>
        ) : null}
        <DialogFooter className="flex flex-wrap items-center gap-2 sm:justify-between">
          <div className="flex gap-2">
            {event && isAdmin ? (
              <ConfirmButton
                label={t("organizations.deleteEvent")}
                confirmLabel={t("organizations.confirmDeleteEvent")}
                busyLabel={t("teamCalendar.deleting")}
                cancelLabel={t("teamCalendar.cancel")}
                busy={busy}
                onConfirm={() => run(() => api.deleteOrganizationEvent(organization.id, event.id))}
              />
            ) : null}
            {isAdmin && typeName === null ? (
              <Button type="button" variant="ghost" onClick={() => setTypeName(title)} data-testid="org-save-type">
                {t("organizations.saveAsEventType")}
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("teamCalendar.cancel")}
            </Button>
            <Button type="submit" form="org-event-form" disabled={busy || needs.length === 0 || !hostUserId} data-testid="org-event-save">
              {busy ? t("teamCalendar.saving") : t("teamCalendar.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
