import { ApiError, partKey, type AvailabilityAnswer, type CustomInstrument, type EventPart, type MemberEventAnswer, type SetAvailability } from "@oneverse/core";
import { CalendarDays, Music, Pencil, Plane } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { FieldError } from "@oneverse/ui/components/field";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { cn } from "@oneverse/ui/lib/utils";
import { HostLink, usePlanning } from "../host";
import { answerLabel } from "./event-answer";
import { partOf, usePartLabel } from "./lineup";
import { partBody, PartsEditor } from "./team-calendar";

type Group = AvailabilityAnswer | "NONE";
const GROUPS: { group: Group; tone: string; mark: string }[] = [
  { group: "AVAILABLE", tone: "text-success", mark: "✓" },
  { group: "IF_NEEDED", tone: "text-warning", mark: "?" },
  { group: "UNAVAILABLE", tone: "text-rose-700 dark:text-rose-400", mark: "✗" },
  { group: "NONE", tone: "text-muted-foreground", mark: "–" },
];

const groupOf = (member: MemberEventAnswer): Group => (member.away ? "UNAVAILABLE" : (member.answer ?? "NONE"));

/**
 * Who can play on the date a set was made for (issue #520), on the set's
 * page for those who edit it: the team's answers grouped Available, If
 * needed, Not available and No reply, what each would like to play, their
 * place on the line-up, and the date's host and music leader. Nothing for a set not
 * made for a calendar date.
 */
export function SetAvailabilityCard({ setlistId, refreshKey }: { setlistId: string; refreshKey?: unknown }) {
  const { api, links } = usePlanning();
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<SetAvailability | null>(null);
  // Fetched again after the date's asks change (issue #549).
  const [reload, setReload] = useState(0);
  const [customInstruments, setCustomInstruments] = useState<CustomInstrument[]>([]);
  const partLabel = usePartLabel(customInstruments);
  useEffect(() => {
    let current = true;
    api.getSetAvailability(setlistId).then(
      (found) => current && setData(found),
      // Not a calendar date's set, or not one the viewer edits: nothing to show.
      (error: unknown) => {
        if (current && error instanceof ApiError && (error.status === 404 || error.status === 403)) setData(null);
      },
    );
    return () => {
      current = false;
    };
  }, [setlistId, refreshKey, reload]);
  useEffect(() => {
    void api.listCustomInstruments().then(setCustomInstruments, () => {});
  }, []);
  if (!data) return null;

  const labelOf = (key: string) => partLabel(partOf(data.parts, key));
  const names = (ids: readonly string[]) => ids.map((id) => data.members.find((member) => member.userId === id)?.displayName ?? data.lineup.find((place) => place.userId === id)?.displayName ?? "").filter(Boolean);
  // Its set leaders (issues #520, #559): on the line-up, else who'd like to be; "nobody yet" only when the date asks for that part.
  const leading = data.leadingParts.map((key) => {
    const on = names(data.leaders.filter((leader) => leader.partKey === key).map((leader) => leader.userId));
    const volunteers = data.members.filter((member) => groupOf(member) !== "UNAVAILABLE" && member.wishes?.includes(key)).map((member) => member.displayName);
    const asked = data.parts.some((part) => partKey(part) === key);
    return { key, on, volunteers, asked, shown: on.length > 0 || volunteers.length > 0 || asked };
  }).filter((one) => one.shown);
  const placesOf = (userId: string) => data.lineup.filter((place) => place.userId === userId && place.status !== "DECLINED").map((place) => labelOf(place.partKey));
  const day = new Intl.DateTimeFormat(i18n.language, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${data.date}T12:00:00Z`));

  return (
    <Card data-testid="set-availability">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>{t("teamCalendar.whoCanPlay")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("teamCalendar.setAvailabilityOf", { title: data.title, date: day })}</p>
        </div>
        <HostLink href={links.team(data.teamId)} className="flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs hover:bg-muted" data-testid="set-availability-calendar">
          <CalendarDays className="size-3.5" aria-hidden />
          {t("teamCalendar.openCalendar")}
        </HostLink>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {leading.length > 0 ? (
          <div className="flex flex-col gap-1.5 text-sm">
            {leading.map(({ key, on, volunteers, asked }) => (
              <div key={key} className="flex flex-col gap-0.5" data-leading={key}>
                {on.length > 0 ? (
                  <span>{t("teamCalendar.leadingPart", { part: labelOf(key), names: on.join(", ") })}</span>
                ) : asked ? (
                  <span className="text-warning">{t("teamCalendar.leadingPartNone", { part: labelOf(key) })}</span>
                ) : (
                  <span>{labelOf(key)}</span>
                )}
                {on.length === 0 && volunteers.length > 0 ? <span className="text-xs text-muted-foreground">{t("teamCalendar.leadingPartWished", { names: volunteers.join(", ") })}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {/* The instruments the date asks for (issue #549): its music lead asks, the music team signs up. */}
        <DateAsks data={data} partLabel={partLabel} customInstruments={customInstruments} onChanged={() => setReload((n) => n + 1)} />
        <div className="grid gap-4 sm:grid-cols-2">
          {GROUPS.map(({ group, tone, mark }) => {
            const members = data.members.filter((member) => groupOf(member) === group);
            return (
              <section key={group} className="flex min-w-0 flex-col gap-1.5" data-group={group}>
                <h3 className={cn("text-xs font-medium", tone)}>
                  {mark} {answerLabel(group === "NONE" ? null : group, t)} · <span className="tabular-nums">{members.length}</span>
                </h3>
                {members.length === 0 ? <p className="text-xs text-muted-foreground">–</p> : null}
                {group === "NONE" ? (
                  members.length > 0 ? <p className="text-sm text-muted-foreground">{members.map((member) => member.displayName).join(", ")}</p> : null
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {members.map((member) => {
                      const places = placesOf(member.userId);
                      return (
                        <li key={member.userId} className="flex flex-col gap-0.5" data-member={member.userId}>
                          <div className="flex flex-wrap items-center gap-1.5 text-sm">
                            <span className="font-medium">{member.displayName}</span>
                            {member.away ? (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Plane className="size-3" aria-hidden />
                                {t("teamCalendar.away")}
                              </span>
                            ) : null}
                            {group !== "UNAVAILABLE"
                              ? (member.wishes ?? []).map((wish) => (
                                  <Badge key={wish} variant="outline" data-wish={wish}>
                                    {labelOf(wish)}
                                  </Badge>
                                ))
                              : null}
                          </div>
                          {places.length > 0 ? <span className="text-xs text-muted-foreground">{t("teamCalendar.onLineup", { parts: places.join(", ") })}</span> : null}
                          {member.note ? <span className="text-xs text-muted-foreground italic">"{member.note}"</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * What a date asks for besides its event's parts (issue #549), on its set:
 * the instruments its music lead wants that date, with who's on each. The
 * team's admins and the date's music lead change them; whoever the event's
 * Music part is open to signs up for them, as for any open place.
 */
function DateAsks({ data, partLabel, customInstruments, onChanged }: { data: SetAvailability; partLabel: (part: EventPart) => string; customInstruments: CustomInstrument[]; onChanged: () => void }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const asks = data.asks ?? [];
  const [editing, setEditing] = useState<EventPart[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (asks.length === 0 && !data.canAsk) return null;
  const onIt = (part: EventPart) => data.lineup.filter((place) => place.partKey === partKey(part) && place.status !== "DECLINED");

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await api.setTeamEventDateAsks(data.teamId, data.eventId, data.date, { parts: editing.map((part) => ({ ...partBody(part), openTo: undefined })) });
      setEditing(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border p-3" data-testid="date-asks">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Music className="size-4" aria-hidden />
          {t("teamCalendar.asksTitle")}
        </h3>
        {data.canAsk && !editing ? (
          <Button variant="outline" size="sm" className="h-7" onClick={() => setEditing(asks)} data-testid="date-asks-edit">
            <Pencil />
            {asks.length > 0 ? t("teamCalendar.asksChange") : t("teamCalendar.asksAdd")}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t("teamCalendar.asksHint")}</p>
          <div className="grid grid-cols-2 gap-3">
            <PartsEditor parts={editing} onChange={setEditing} teamNames={[]} positions={[]} customInstruments={customInstruments} partLabel={partLabel} instruments />
          </div>
          {error ? <FieldError>{error}</FieldError> : null}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void save()} data-testid="date-asks-save">
              {busy ? t("teamCalendar.saving") : t("teamCalendar.asksSave")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              {t("teamCalendar.cancel")}
            </Button>
          </div>
        </div>
      ) : asks.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("teamCalendar.asksNone")}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {asks.map((part) => {
            const on = onIt(part);
            return (
              <li key={partKey(part)} className="flex flex-wrap items-baseline gap-x-2" data-ask={partKey(part)}>
                <span className="font-medium">{partLabel({ ...part, openTo: undefined })}</span>
                <span className={cn("text-xs tabular-nums", on.length < part.count ? "text-warning" : "text-success")}>
                  {on.length}/{part.count}
                </span>
                {on.length > 0 ? <span className="text-xs text-muted-foreground">{on.map((place) => place.displayName).join(", ")}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
