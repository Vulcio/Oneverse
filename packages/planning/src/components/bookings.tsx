import { addDays, localDate, type Booking, type BookingClash, type BookingRequest } from "@oneverse/core";
import { CalendarCheck, CalendarRange, CalendarX, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { FieldError } from "@oneverse/ui/components/field";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Textarea } from "@oneverse/ui/components/textarea";
import { usePlanning } from "../host";

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
      <AskThem clashes={clashes} />
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

/**
 * "Ask them" (issue #565): the organisers of each event holding a room or
 * resource are told who asks, for what and when, with a message - one ask
 * per event, for its first clash.
 */
function AskThem({ clashes }: { clashes: readonly BookingClash[] }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const holders = [...new Map(clashes.map((clash) => [clash.eventId, clash])).values()].slice(0, 4);
  const [asking, setAsking] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (clash: BookingClash) => {
    setBusy(true);
    setError(null);
    try {
      await api.askBooking({ eventId: clash.eventId, eventKind: clash.eventKind, date: clash.date, kind: clash.kind, id: clash.id, ...(message.trim() ? { message: message.trim() } : {}) });
      setSent((now) => [...now, clash.eventId]);
      setAsking(null);
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {holders.map((clash) =>
        sent.includes(clash.eventId) ? (
          <p key={clash.eventId} className="text-xs text-muted-foreground" data-testid="booking-asked">
            {t("bookings.asked", { event: clash.event, owner: clash.owner })}
          </p>
        ) : asking === clash.eventId ? (
          <div key={clash.eventId} className="flex flex-col gap-1.5" data-testid="booking-ask-form">
            <Textarea rows={2} maxLength={500} value={message} placeholder={t("bookings.askPlaceholder", { what: clash.what })} aria-label={t("bookings.askMessage")} onChange={(e) => setMessage(e.target.value)} />
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => void send(clash)} data-testid="booking-ask-send">
                <Send className="size-4" aria-hidden />
                {t("bookings.send")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(null)}>
                {t("locations.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <Button key={clash.eventId} type="button" size="sm" variant="outline" className="self-start" onClick={() => setAsking(clash.eventId)} data-testid="booking-ask">
            {t("bookings.ask", { event: clash.event, owner: clash.owner })}
          </Button>
        ),
      )}
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}

type Owner = { teamId: string } | { organizationId: string };

/** The teams that can manage an owner's rooms and resources (issue #565): its organisation's teams, or a lone team itself. */
export function useManagerTeams(owner: Owner) {
  const { api } = usePlanning();
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const key = JSON.stringify(owner);
  useEffect(() => {
    let live = true;
    void (async () => {
      let organizationId = "organizationId" in owner ? owner.organizationId : null;
      if ("teamId" in owner) {
        const team = await api.getTeam(owner.teamId);
        organizationId = team.organization?.id ?? null;
        if (!organizationId) return live && setTeams([{ id: team.id, name: team.name }]);
      }
      const organization = await api.getOrganization(organizationId!);
      if (live) setTeams(organization.teams.map((team) => ({ id: team.id, name: team.name })));
    })().catch(() => live && setTeams([]));
    return () => {
      live = false;
    };
  }, [key]);
  return teams;
}

/** Whether a room's or resource's bookings wait for approval, and whose: its owner's admins, or a team's (a Facilities team). */
export function ApprovalFields({ id, needsApproval, managerTeamId, teams, onChange }: { id: string; needsApproval: boolean; managerTeamId: string; teams: { id: string; name: string }[]; onChange: (value: { needsApproval: boolean; managerTeamId: string }) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="approval-fields">
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={needsApproval} onChange={(e) => onChange({ needsApproval: e.target.checked, managerTeamId })} data-testid="needs-approval" />
        {t("bookings.needsApproval")}
      </label>
      {needsApproval ? (
        <NativeSelect id={`approval-team-${id}`} className="h-8 w-48 text-xs" aria-label={t("bookings.approvedBy")} value={managerTeamId} onChange={(e) => onChange({ needsApproval, managerTeamId: e.target.value })} data-testid="approval-team">
          <option value="">{t("bookings.itsAdmins")}</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {t("bookings.teamAdmins", { team: team.name })}
            </option>
          ))}
        </NativeSelect>
      ) : null}
    </div>
  );
}

/** A room's or resource's bookings, the next weeks (issue #565): by day, when each event holds it, set-up included. */
export function BookingsButton({ title, load }: { title: string; load: (from: string, to: string) => Promise<Booking[]> }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [weeks, setWeeks] = useState(8);
  useEffect(() => {
    if (!open) return;
    const from = localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    setBookings(null);
    void load(from, addDays(from, weeks * 7)).then(setBookings, () => setBookings([]));
  }, [open, weeks]);
  const day = (date: string) => new Intl.DateTimeFormat(i18n.language, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const time = (iso: string) => new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const byDay = new Map<string, Booking[]>();
  for (const booking of bookings ?? []) byDay.set(booking.date, [...(byDay.get(booking.date) ?? []), booking]);
  // A venue's several rooms: each booking names its room.
  const many = new Set((bookings ?? []).map((one) => one.id)).size > 1;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} data-testid="bookings-open">
        <CalendarRange className="size-4" aria-hidden />
        {t("bookings.calendar")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg" data-testid="bookings-dialog">
          <DialogHeader>
            <DialogTitle>{t("bookings.calendarOf", { name: title })}</DialogTitle>
          </DialogHeader>
          {bookings === null ? <p className="text-sm text-muted-foreground">…</p> : null}
          {bookings?.length === 0 ? <p className="text-sm text-muted-foreground">{t("bookings.none", { count: weeks })}</p> : null}
          <ul className="flex flex-col gap-3">
            {[...byDay].map(([date, list]) => (
              <li key={date}>
                <p className="text-xs font-medium uppercase text-muted-foreground">{day(date)}</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {list.map((booking) => (
                    <li key={`${booking.eventId}|${booking.id}|${booking.heldFrom}`} className="flex flex-wrap items-baseline gap-x-2 text-sm" data-testid="booking-row">
                      <span className="tabular-nums">
                        {time(booking.startsAt)}–{time(booking.endsAt)}
                      </span>
                      <span className="font-medium">{booking.event}</span>
                      <span className="text-muted-foreground">{booking.owner}</span>
                      {many ? <span className="text-muted-foreground">· {booking.what}</span> : null}
                      {booking.quantity > 1 ? <span className="text-muted-foreground">×{booking.quantity}</span> : null}
                      {booking.heldFrom !== booking.startsAt || booking.heldUntil !== booking.endsAt ? (
                        <span className="text-xs text-muted-foreground">{t("bookings.held", { from: time(booking.heldFrom), to: time(booking.heldUntil) })}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {bookings !== null && weeks < 52 ? (
            <Button variant="outline" size="sm" className="self-start" onClick={() => setWeeks((now) => Math.min(52, now + 8))}>
              {t("bookings.later")}
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The bookings waiting for the viewer's approval (issue #565), of an owner's rooms and resources: approve, or decline (the event gives it up). Hidden when none. */
export function BookingRequestsCard({ owner }: { owner: Owner }) {
  const { api } = usePlanning();
  const { t, i18n } = useTranslation();
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(owner);
  const load = () => api.listBookingRequests(owner).then(setRequests);
  useEffect(() => {
    void load().catch(() => setRequests([]));
  }, [key]);
  if (requests.length === 0) return null;
  const day = (date: string) => new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const decide = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card data-testid="booking-requests">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarCheck className="size-4 text-muted-foreground" aria-hidden />
          {t("bookings.requests")}
        </CardTitle>
        <CardDescription>{t("bookings.requestsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0" data-testid="booking-request" data-what={request.what}>
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {request.what}
                  {request.venue ? <span className="text-muted-foreground"> · {request.venue}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(request.repeats ? "bookings.requestSeries" : "bookings.requestOnce", { event: request.event, owner: request.owner, date: day(request.date) })}
                  {request.requestedBy ? ` · ${t("bookings.askedBy", { name: request.requestedBy })}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" disabled={busy === request.id} onClick={() => void decide(request.id, () => api.approveBooking(request.id))} data-testid="booking-approve">
                  {t("bookings.approve")}
                </Button>
                <ConfirmButton
                  label={t("bookings.decline")}
                  confirmLabel={t("bookings.decline")}
                  busyLabel={t("bookings.decline")}
                  cancelLabel={t("locations.cancel")}
                  busy={busy === request.id}
                  onConfirm={() => decide(request.id, () => api.declineBooking(request.id))}
                />
              </div>
            </li>
          ))}
        </ul>
        {error ? <FieldError>{error}</FieldError> : null}
      </CardContent>
    </Card>
  );
}
