import { addDays, localDate, type CustomInstrument, type EventPart, type OrganizationDetail, type OrganizationEvent, type OrganizationEventDate, type OrganizationEventPreset, type OrganizationMember, type OrganizationTeam } from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, Ban, CircleCheck, MapPin, MoreHorizontal, Pencil, RotateCcw, Users, X } from "lucide-react";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@oneverse/ui/components/dropdown-menu";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Textarea } from "@oneverse/ui/components/textarea";
import { LocationField, useLocations } from "../components/locations";
import { HostLink, usePlanning } from "../host";
import { loadOrganizationEventsPage } from "../loaders";

export { loadOrganizationEventsPage };
import { cn } from "@oneverse/ui/lib/utils";

const SHOWN_WEEKS = 8;
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * An organisation's events (issue #241): each coming date with its host and
 * every group it needs - how its parts are covered, for the organisation's
 * admins and the event's host, who change it, cancel a date for all, and
 * start one from a preset.
 */

export function OrganizationEventsPage({ data }: { data: NonNullable<Awaited<ReturnType<typeof loadOrganizationEventsPage>>> }) {
  const { api, links, sets } = usePlanning();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { organization, events, presets, members, customInstruments } = data;
  const isAdmin = organization.currentUserRole === "ADMIN";
  const partLabel = usePartLabel(customInstruments);
  const [weeks, setWeeks] = useState(SHOWN_WEEKS);
  const [dates, setDates] = useState<OrganizationEventDate[] | null>(null);
  const [editing, setEditing] = useState<OrganizationEvent | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dayFormat = new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" });
  const timeFormat = (zone: string) => new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone: zone });

  const load = useCallback(async () => {
    const today = addDays(localDate(new Date(), browserZone()), -1);
    setDates(await api.listOrganizationEventDates(organization.id, today, addDays(today, weeks * 7)));
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <HostLink href={links.organization(organization.id)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            {organization.name}
          </HostLink>
          <h1 className="text-2xl font-semibold">{t("organizations.events")}</h1>
          <p className="text-sm text-muted-foreground">{t("organizations.eventsHint")}</p>
        </div>
        {isAdmin ? (
          <Button onClick={() => setEditing("new")} data-testid="org-new-event">
            {t("organizations.newEvent")}
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardContent className="flex flex-col gap-3">
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
                      {date.canManage && event ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("teamCalendar.dateActions", { title: `${date.title}, ${dayFormat.format(new Date(`${date.date}T12:00:00Z`))}` })} />}>
                            <MoreHorizontal className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => void act(() => api.setOrganizationEventDateCancelled(organization.id, date.eventId, date.date, !date.cancelled))} data-testid="org-toggle-date">
                              {date.cancelled ? <RotateCcw /> : <Ban />}
                              {date.cancelled ? t("teamCalendar.restoreDate") : t("teamCalendar.cancelDate")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditing(event)} data-testid="org-edit-event">
                              <Pencil />
                              {t("organizations.editEvent")}
                            </DropdownMenuItem>
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
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card data-testid="org-presets">
          <CardHeader>
            <CardTitle className="text-sm">{t("organizations.presets")}</CardTitle>
            <CardDescription>{t("organizations.presetsHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            {presets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("organizations.noPresets")}</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {presets.map((preset) => (
                  <li key={preset.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0" data-preset={preset.name}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{preset.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {preset.title} · {preset.startTime} · {preset.needs.map((need) => organization.teams.find((team) => team.id === need.teamId)?.name ?? "?").join(", ")}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => void act(() => api.deleteOrganizationEventPreset(organization.id, preset.id))}>
                      {t("organizations.removePreset")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {editing ? (
        <OrganizationEventDialog
          organization={organization}
          event={editing === "new" ? null : editing}
          presets={presets}
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

/** An organisation's event (issue #241): its timing, its host, the groups it needs and the parts it asks each for. */
function OrganizationEventDialog({
  organization,
  event,
  presets,
  members,
  isAdmin,
  customInstruments,
  partLabel,
  onClose,
  onSaved,
}: {
  organization: OrganizationDetail;
  event: OrganizationEvent | null;
  presets: OrganizationEventPreset[];
  members: OrganizationMember[];
  isAdmin: boolean;
  customInstruments: readonly CustomInstrument[];
  partLabel: (part: EventPart) => string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api } = usePlanning();
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
  const [note, setNote] = useState(event?.note ?? "");
  const [everyWeeks, setEveryWeeks] = useState(event?.repeat ? String(event.repeat.everyWeeks) : "");
  const [until, setUntil] = useState(event?.repeat?.until ?? "");
  const [hostUserId, setHostUserId] = useState(event?.host?.id ?? "");
  // Each group's parts, and when it's to be there (issue #240: minutes before; blank, none).
  const [needs, setNeeds] = useState<{ teamId: string; parts: EventPart[]; call: string }[]>(event?.needs.map((need) => ({ teamId: need.teamId, parts: need.parts, call: need.callMinutes ? String(need.callMinutes) : "" })) ?? []);
  const [presetName, setPresetName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [timeZone];
  const teamOf = (teamId: string): OrganizationTeam | undefined => organization.teams.find((team) => team.id === teamId);
  const choices = organization.teams.filter((team) => !needs.some((need) => need.teamId === team.id));

  const fromPreset = (preset: OrganizationEventPreset) => {
    setTitle(preset.title);
    setStartTime(preset.startTime);
    setDuration(String(preset.durationMinutes));
    setPlace(preset.place ?? "");
    setLocationId(preset.locationId ?? "");
    const presetLocation = locations.find((one) => one.id === preset.locationId);
    if (presetLocation) setTimeZone(presetLocation.timeZone);
    setNeeds(preset.needs.filter((need) => teamOf(need.teamId)).map((need) => ({ teamId: need.teamId, parts: need.parts ?? [], call: need.callMinutes ? String(need.callMinutes) : "" })));
  };
  const needsBody = () => needs.map((need) => ({ teamId: need.teamId, parts: need.parts.map(partBody), ...(need.call ? { callMinutes: Number(need.call) } : {}) }));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const save = () =>
    run(() => {
      const timing = { title, date, startTime, durationMinutes: Number(duration), timeZone, note: note || null, repeat: everyWeeks ? { everyWeeks: Number(everyWeeks), until: until || null } : null };
      return event
        ? api.updateOrganizationEvent(organization.id, event.id, { ...timing, place: place || null, locationId: locationId || null, needs: needsBody(), ...(isAdmin ? { hostUserId } : {}) })
        : api.createOrganizationEvent(organization.id, { ...timing, place: place || null, locationId: locationId || null, hostUserId, needs: needsBody() });
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
          {!event && presets.length > 0 ? (
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="org-event-preset">{t("organizations.preset")}</Label>
              <NativeSelect
                id="org-event-preset"
                defaultValue=""
                onChange={(e) => {
                  const preset = presets.find((one) => one.id === e.target.value);
                  if (preset) fromPreset(preset);
                }}
                data-testid="org-event-preset"
              >
                <option value="">{t("organizations.presetNone")}</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
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
            onChange={(change) => {
              setLocationId(change.locationId);
              if (change.place !== undefined) setPlace(change.place);
              if (change.timeZone) setTimeZone(change.timeZone);
            }}
          />
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
                </div>
              );
            })}
            {choices.length > 0 ? (
              <NativeSelect
                value=""
                aria-label={t("organizations.addGroup")}
                onChange={(e) => {
                  if (e.target.value) setNeeds([...needs, { teamId: e.target.value, parts: [], call: "" }]);
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
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {presetName !== null ? (
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="org-preset-name">{t("organizations.presetName")}</Label>
              <Input id="org-preset-name" value={presetName} maxLength={60} autoFocus onChange={(e) => setPresetName(e.target.value)} />
            </div>
            <Button
              variant="outline"
              disabled={busy || !presetName.trim() || needs.length === 0 || !title.trim()}
              onClick={() =>
                void run(() => api.createOrganizationEventPreset(organization.id, { name: presetName.trim(), title, startTime, durationMinutes: Number(duration), place: place || undefined, locationId: locationId || undefined, needs: needsBody() }))
              }
              data-testid="org-preset-save"
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
            {isAdmin && presetName === null ? (
              <Button type="button" variant="ghost" onClick={() => setPresetName(title)} data-testid="org-save-preset">
                {t("organizations.saveAsPreset")}
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
