import { coversPart, isEventOnlyPart, isMembersOnlyPart, partKey, TECH_ROLES, type CustomInstrument, type EventPart, type LineupPlace, type MemberEventAnswer, type Person } from "@oneverse/core";
import { AlertTriangle, ArrowLeftRight, Check, Clock, HandHelping, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Input } from "@oneverse/ui/components/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { usePlanning } from "../host";
import { useInstrumentLabel } from "../instruments";
import { cn } from "@oneverse/ui/lib/utils";
import { FieldError } from "@oneverse/ui/components/field";

/** A part's name (issue #235, phase 7): its instrument or role in the reader's language, or the team's own name for it. */
export function usePartLabel(customInstruments: readonly CustomInstrument[], groups?: readonly { id: string; name: string }[]): (part: EventPart) => string {
  const { t, i18n } = useTranslation();
  const instrumentLabel = useInstrumentLabel(customInstruments);
  const name = (part: EventPart) => {
    if (!part.part) return part.name ?? "";
    // Host and Speaker (issues #520, #523) are named with the roles; an event's role by its high-level name (issue #549: Music).
    if (isEventOnlyPart(part.part) || (TECH_ROLES as readonly string[]).includes(part.part)) return i18n.exists(`roles.eventRole.${part.part}`) ? t(`roles.eventRole.${part.part}`) : t(`roles.techRole.${part.part}`);
    return instrumentLabel(part.part);
  };
  return (part) => {
    // A role filled by a group (issue #549): "Music · Worship".
    const by = groups && part.openTo?.length ? part.openTo.map((id) => groups.find((group) => group.id === id)?.name).filter(Boolean) : [];
    return by.length > 0 ? `${name(part)} · ${by.join(", ")}` : name(part);
  };
}

/** A line-up place's part, found among the date's parts by its key. */
export function partOf(parts: EventPart[], key: string): EventPart {
  return parts.find((part) => partKey(part) === key) ?? (key.startsWith("name:") ? { name: key.slice(5), count: 1 } : { part: key, count: 1 });
}

const STATUS_ICON = { PENDING: Clock, ACCEPTED: Check, DECLINED: X } as const;

/**
 * Who's on which part for a date (issue #235, phase 7), for everyone; and
 * one's own place, to accept or decline.
 */
export function LineupLine({
  teamId,
  eventId,
  date,
  parts,
  lineup,
  partLabel,
  onChanged,
  missing = [],
  volunteerOptions = [],
}: {
  teamId: string;
  eventId: string;
  date: string;
  parts: EventPart[];
  lineup: LineupPlace[];
  partLabel: (part: EventPart) => string;
  onChanged: () => Promise<void>;
  /** The required parts its line-up doesn't fill yet (issue #528). */
  missing?: readonly string[];
  /** The open places one may take (issue #528), by part key. */
  volunteerOptions?: readonly string[];
}) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  // The place one's asking a replacement for, with its note being written.
  const [asking, setAsking] = useState<{ id: string; note: string } | null>(null);
  const shown = lineup.filter((place) => place.status !== "DECLINED");
  const mine = lineup.filter((place) => place.mine);
  const takeable = lineup.filter((place) => place.canTake);
  if (lineup.length === 0 && missing.length === 0 && volunteerOptions.length === 0) return null;
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    void work()
      .then(onChanged)
      .finally(() => setBusy(false));
  };
  const answer = (place: LineupPlace, status: "ACCEPTED" | "DECLINED") => run(() => api.respondTeamEventPart(teamId, eventId, date, place.id, { status }));
  return (
    <div className="flex flex-col gap-1.5" data-testid="lineup-line">
      {missing.length > 0 ? (
        <div>
          <Badge variant="warning" data-testid="lineup-missing">
            <AlertTriangle />
            {t("teamCalendar.missingParts", { parts: missing.map((key) => partLabel(partOf(parts, key))).join(", ") })}
          </Badge>
        </div>
      ) : null}
      {/* Open places (issue #528): one puts oneself on them. */}
      {volunteerOptions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {volunteerOptions.map((key) => (
            <Button key={key} size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => run(() => api.takeOpenPlace({ teamId, eventId, date, part: key }))} data-testid="lineup-volunteer" data-part={key}>
              <HandHelping />
              {t("teamCalendar.volunteer", { part: partLabel(partOf(parts, key)) })}
            </Button>
          ))}
        </div>
      ) : null}
      {mine.map((place) => (
        <div key={place.id} className="flex flex-wrap items-center gap-2 text-sm" data-my-place={place.status}>
          <span className="font-medium">{t("teamCalendar.youreOn", { part: partLabel(partOf(parts, place.partKey)) })}</span>
          {place.volunteered && place.status === "PENDING" ? (
            // An offer that waits for an admin (issue #559): taken back, it's open again.
            <>
              <Badge variant="outline" data-testid="lineup-offer-waiting">{t("teamCalendar.offerWaiting")}</Badge>
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" disabled={busy} onClick={() => run(() => api.giveUpOpenPlace(place.id))} data-testid="lineup-give-up">
                {t("teamCalendar.giveUp")}
              </button>
            </>
          ) : place.status === "PENDING" ? (
            <>
              <Button size="sm" className="h-7" disabled={busy} onClick={() => answer(place, "ACCEPTED")} data-testid="lineup-accept">
                <Check />
                {t("teamCalendar.accept")}
              </Button>
              <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => answer(place, "DECLINED")} data-testid="lineup-decline">
                <X />
                {t("teamCalendar.decline")}
              </Button>
            </>
          ) : place.volunteered && place.status === "ACCEPTED" ? (
            // A place one took oneself (issue #528): given up, it's open again.
            <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" disabled={busy} onClick={() => run(() => api.giveUpOpenPlace(place.id))} data-testid="lineup-give-up">
              {t("teamCalendar.giveUp")}
            </button>
          ) : (
            <>
              <Badge variant={place.status === "ACCEPTED" ? "muted" : "outline"}>{place.status === "ACCEPTED" ? t("teamCalendar.accepted") : t("teamCalendar.declined")}</Badge>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                disabled={busy}
                onClick={() => answer(place, place.status === "ACCEPTED" ? "DECLINED" : "ACCEPTED")}
                data-testid="lineup-change"
              >
                {place.status === "ACCEPTED" ? t("teamCalendar.decline") : t("teamCalendar.accept")}
              </button>
            </>
          )}
          {/* A swap (issue #235, phase 7): asking those who play the part to take one's place. */}
          {place.status !== "DECLINED" ? (
            place.swap ? (
              <>
                <Badge variant="warning" data-testid="lineup-swap-asked">
                  <ArrowLeftRight />
                  {t("teamCalendar.swapAsked")}
                </Badge>
                <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" disabled={busy} onClick={() => run(() => api.cancelTeamEventSwap(teamId, eventId, date, place.id))} data-testid="lineup-swap-cancel">
                  {t("teamCalendar.swapCancel")}
                </button>
              </>
            ) : asking?.id === place.id ? (
              <span className="flex basis-full flex-wrap items-center gap-2">
                <Input
                  autoFocus
                  className="h-7 max-w-xs text-xs"
                  value={asking.note}
                  maxLength={300}
                  placeholder={t("teamCalendar.swapNote")}
                  onChange={(event) => setAsking({ id: place.id, note: event.target.value })}
                  data-testid="lineup-swap-note"
                />
                <Button
                  size="sm"
                  className="h-7"
                  disabled={busy}
                  onClick={() => {
                    const note = asking.note.trim();
                    setAsking(null);
                    run(() => api.requestTeamEventSwap(teamId, eventId, date, place.id, note ? { note } : {}));
                  }}
                  data-testid="lineup-swap-send"
                >
                  {t("teamCalendar.swapSend")}
                </Button>
                <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setAsking(null)}>
                  {t("teamCalendar.swapCancel")}
                </button>
              </span>
            ) : (
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" disabled={busy} onClick={() => setAsking({ id: place.id, note: "" })} data-testid="lineup-swap-ask">
                {t("teamCalendar.swapAsk")}
              </button>
            )
          ) : null}
        </div>
      ))}
      {takeable.map((place) => (
        <div key={place.id} className="flex flex-wrap items-center gap-2 text-sm" data-swap-offered={place.id}>
          <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => run(() => api.takeTeamEventSwap(teamId, eventId, date, place.id))} data-testid="lineup-swap-take">
            <ArrowLeftRight />
            {t("teamCalendar.swapTake", { part: partLabel(partOf(parts, place.partKey)), name: place.displayName })}
          </Button>
          {place.swap?.note ? <span className="text-xs text-muted-foreground italic">"{place.swap.note}"</span> : null}
        </div>
      ))}
      {shown.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground" aria-label={t("teamCalendar.lineup")}>
          {parts
            .map((part) => ({ part, people: shown.filter((place) => place.partKey === partKey(part)) }))
            .filter(({ people }) => people.length > 0)
            .map(({ part, people }) => (
              <span key={partKey(part)} data-lineup-part={partKey(part)}>
                <span className="font-medium text-foreground">{partLabel(part)}</span> {people.map((place) => place.displayName).join(", ")}
              </span>
            ))}
        </div>
      ) : null}
    </div>
  );
}

const ANSWER_ORDER = ["AVAILABLE", "IF_NEEDED", null, "UNAVAILABLE"] as const;

/**
 * A date's line-up, for the team's admins (issue #235, phase 7): each part
 * with the people on it - asked, accepted, declined, and what clashes - to
 * take off; and someone to add, those who play it first, by their answer.
 */
export function LineupDialog({
  teamId,
  eventId,
  date,
  title,
  parts,
  lineup,
  partLabel,
  onChanged,
  onClose,
}: {
  teamId: string;
  eventId: string;
  date: string;
  title: string;
  parts: EventPart[];
  lineup: LineupPlace[];
  partLabel: (part: EventPart) => string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [members, setMembers] = useState<MemberEventAnswer[]>([]);
  // The admin's People (#79), to schedule as guests (issue #235, phase 7).
  const [people, setPeople] = useState<Person[]>([]);
  // The part someone without an account is being added to, their name, and (a speaker, issue #523) their email.
  const [naming, setNaming] = useState<{ part: string; name: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.listTeamEventDateAnswers(teamId, eventId, date).then(setMembers);
    void api.getPeople().then((overview) => setPeople(overview.people), () => {});
  }, [teamId, eventId, date]);
  const memberIds = new Set(members.map((member) => member.userId));

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const answerWord = (member: MemberEventAnswer) =>
    member.away ? t("teamCalendar.conflictAway") : member.answer === "AVAILABLE" ? t("teamCalendar.answerSignedUp") : member.answer === "IF_NEEDED" ? t("teamCalendar.answerIfNeeded") : member.answer === "UNAVAILABLE" ? t("teamCalendar.answerUnavailable") : "–";
  const conflictWord = { AWAY: t("teamCalendar.conflictAway"), UNAVAILABLE: t("teamCalendar.conflictUnavailable"), ELSEWHERE: t("teamCalendar.conflictElsewhere") } as const;
  const statusWord = { PENDING: t("teamCalendar.lineupPending"), ACCEPTED: t("teamCalendar.lineupAccepted"), DECLINED: t("teamCalendar.lineupDeclined") } as const;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="lineup-dialog">
        <DialogHeader>
          <DialogTitle>{t("teamCalendar.lineup")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{title}</p>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("teamCalendar.lineupDescription")}</p>
        <ul className="flex max-h-[60vh] flex-col divide-y overflow-y-auto">
          {parts.map((part) => {
            const key = partKey(part);
            const placed = lineup.filter((place) => place.partKey === key);
            const on = new Set(placed.map((place) => place.userId));
            const order = (member: MemberEventAnswer) => ANSWER_ORDER.indexOf(member.away ? "UNAVAILABLE" : member.answer);
            const candidates = members.filter((member) => !on.has(member.userId)).sort((a, b) => order(a) - order(b) || a.displayName.localeCompare(b.displayName));
            const covering = candidates.filter((member) => coversPart(member, part));
            const others = part.part || part.position ? candidates.filter((member) => !coversPart(member, part)) : [];
            const filled = placed.filter((place) => place.status !== "DECLINED").length;
            return (
              <li key={key} className="flex flex-col gap-1.5 py-2.5" data-lineup-part={key}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{partLabel(part)}</span>
                  <span className={cn("text-xs tabular-nums", filled < part.count ? "text-warning" : "text-muted-foreground")}>
                    {filled}/{part.count}
                  </span>
                </div>
                {placed.length === 0 ? <p className="text-xs text-muted-foreground">{t("teamCalendar.lineupNobody")}</p> : null}
                {placed.map((place) => {
                  const Icon = STATUS_ICON[place.status];
                  return (
                    <div key={place.id} className={cn("flex flex-wrap items-center gap-2 text-sm", place.status === "DECLINED" && "text-muted-foreground line-through")} data-place={place.userId} data-status={place.status}>
                      <Icon className="size-3.5" aria-label={statusWord[place.status]} />
                      <span>{place.displayName}</span>
                      {place.guestEmail ? (
                        <a className="text-xs text-muted-foreground hover:underline" href={`mailto:${place.guestEmail}`} data-testid="lineup-guest-email">
                          {place.guestEmail}
                        </a>
                      ) : null}
                      {place.guest ? (
                        <Badge variant="outline" data-guest={place.guest}>
                          {place.guest === "external" ? t("teamCalendar.externalBadge") : t("teamCalendar.guestBadge")}
                        </Badge>
                      ) : null}
                      {place.guest !== "external" ? <span className="text-xs text-muted-foreground">{statusWord[place.status]}</span> : null}
                      {place.conflicts.map((conflict) => (
                        <Badge key={conflict} variant="warning" data-conflict={conflict}>
                          <AlertTriangle />
                          {conflictWord[conflict]}
                        </Badge>
                      ))}
                      {place.swap ? (
                        <Badge variant="warning" data-testid="lineup-swap-asked">
                          <ArrowLeftRight />
                          {t("teamCalendar.swapAsked")}
                        </Badge>
                      ) : null}
                      {place.note ? <span className="text-xs text-muted-foreground italic">"{place.note}"</span> : null}
                      {place.volunteered && place.status === "PENDING" ? (
                        // An offer that waits for an admin (issue #559): confirmed here, declined with the cross.
                        <Button size="sm" variant="outline" className="h-7" onClick={() => void run(() => api.confirmTeamEventOffer(teamId, eventId, date, place.id))} data-testid="lineup-confirm-offer">
                          <Check />
                          {t("teamCalendar.confirmOffer")}
                        </Button>
                      ) : null}
                      <button
                        type="button"
                        className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={t("teamCalendar.lineupRemove", { name: place.displayName, part: partLabel(part) })}
                        onClick={() => void run(() => api.unassignTeamEventPart(teamId, eventId, date, place.id))}
                        data-testid="lineup-remove"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  );
                })}
                {naming?.part === key ? (
                  <div className="flex max-w-md flex-wrap gap-2">
                    <Input
                      autoFocus
                      className="h-8 w-40 text-xs"
                      value={naming.name}
                      maxLength={80}
                      placeholder={t("teamCalendar.lineupOutsideName")}
                      onChange={(event) => setNaming({ ...naming, name: event.target.value })}
                      data-testid="lineup-outside-name"
                    />
                    {/* Someone without an account comes with an email, to reach them (issues #523, #520). */}
                    <Input
                        type="email"
                        className="h-8 w-48 text-xs"
                        value={naming.email}
                        maxLength={320}
                        placeholder={t("teamCalendar.lineupOutsideEmail")}
                        onChange={(event) => setNaming({ ...naming, email: event.target.value })}
                        data-testid="lineup-outside-email"
                      />
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={!naming.name.trim() || !/^\S+@\S+\.\S+$/.test(naming.email.trim())}
                      onClick={() => {
                        const guestName = naming.name.trim();
                        const guestEmail = naming.email.trim();
                        setNaming(null);
                        void run(() => api.assignTeamEventPart(teamId, eventId, date, { guestName, guestEmail, part: key }));
                      }}
                      data-testid="lineup-outside-add"
                    >
                      {t("teamCalendar.partAdd")}
                    </Button>
                  </div>
                ) : null}
                <NativeSelect
                  value=""
                  aria-label={`${partLabel(part)} - ${t("teamCalendar.lineupAdd")}`}
                  className="h-8 max-w-xs text-xs"
                  onChange={(event) => {
                    const userId = event.target.value;
                    if (userId === "__outside") setNaming({ part: key, name: "", email: "" });
                    else if (userId) void run(() => api.assignTeamEventPart(teamId, eventId, date, { userId, part: key }));
                  }}
                  data-testid="lineup-add"
                >
                  <option value="">{t("teamCalendar.lineupAdd")}</option>
                  <optgroup label={part.part ? t("teamCalendar.candidatesCover") : t("teamCalendar.candidatesOthers")}>
                    {covering.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.displayName} · {answerWord(member)}
                      </option>
                    ))}
                  </optgroup>
                  {others.length > 0 ? (
                    <optgroup label={t("teamCalendar.candidatesOthers")}>
                      {others.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.displayName} · {answerWord(member)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {/* Hosting is never a guest's (issue #520). */}
                  {!isMembersOnlyPart(key) && people.some((person) => !memberIds.has(person.id) && !on.has(person.id)) ? (
                    <optgroup label={t("teamCalendar.lineupPeople")}>
                      {people
                        .filter((person) => !memberIds.has(person.id) && !on.has(person.id))
                        .map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.displayName}
                          </option>
                        ))}
                    </optgroup>
                  ) : null}
                  {!isMembersOnlyPart(key) ? <option value="__outside">{t("teamCalendar.lineupOutside")}</option> : null}
                </NativeSelect>
              </li>
            );
          })}
        </ul>
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("teamCalendar.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
