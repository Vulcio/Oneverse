import { addDays, localDate, type AwayDays, type CustomInstrument, type MyEventDate, type OpenPlace } from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AwayDaysCard } from "../components/away-days-card";
import { CalendarFeedCard } from "../components/calendar-feed-card";
import { OpenPlacesCard } from "../components/open-places-card";
import { EventDateRow } from "../components/event-date-row";
import { usePartLabel } from "../components/lineup";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent } from "@oneverse/ui/components/card";
import { usePlanning } from "../host";
import { FieldError } from "@oneverse/ui/components/field";

/** How far the page shows, then how much more each "Show more" adds. */
const SHOWN_WEEKS = 8;

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * My calendar (issue #235): the coming dates of all one's teams, each
 * answered here - Available, If needed, Not available, with a note for the
 * team's admins - and the days one is away, which answer Not available for
 * every date in them that isn't answered.
 */
export function MyCalendarPage({ section = false }: { section?: boolean } = {}) {
  const { api, songverseTeamsOnly } = usePlanning();
  const { t } = useTranslation();
  const router = useRouter();
  const [weeks, setWeeks] = useState(SHOWN_WEEKS);
  const [dates, setDates] = useState<MyEventDate[] | null>(null);
  const [away, setAway] = useState<AwayDays[]>([]);
  // Open places in other groups one may take (issue #528).
  const [openPlaces, setOpenPlaces] = useState<OpenPlace[]>([]);
  const [taking, setTaking] = useState(false);
  const [customInstruments, setCustomInstruments] = useState<CustomInstrument[]>([]);
  const partLabel = usePartLabel(customInstruments);
  useEffect(() => {
    void api.listCustomInstruments().then(setCustomInstruments, () => {});
  }, []);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const today = addDays(localDate(new Date(), browserZone()), -1);
    const [found, ranges, open, teams] = await Promise.all([
      api.listMyEventDates(today, addDays(today, weeks * 7)),
      api.listMyAway(),
      api.listOpenPlaces(today, addDays(today, weeks * 7)).catch(() => []),
      // Songverse's teams only (issue #551): a group that only plans isn't in them, its dates are in Plan.
      songverseTeamsOnly ? api.listTeams() : null,
    ]);
    const shown = teams ? new Set(teams.map((team) => team.id)) : null;
    const kept = (teamId: string) => !shown || shown.has(teamId);
    setOpenPlaces(open.filter((place) => place.guest && kept(place.teamId)));
    const now = Date.now();
    setDates(found.filter((date) => Date.parse(date.endsAt) >= now - 12 * 3600_000 && kept(date.teamId)));
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

  return (
    <div className="flex flex-col gap-6">
      {/* In the Calendar section (issue #551), its title, link and away days are the section's. */}
      {section ? null : (
        <div>
          <h1 className="text-2xl font-semibold">{t("teamCalendar.myCalendar")}</h1>
          <p className="text-sm text-muted-foreground">{t("teamCalendar.myCalendarDescription")}</p>
        </div>
      )}
      {error ? <FieldError>{error}</FieldError> : null}
      <div className="grid grid-cols-1 items-start gap-6 @6xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card data-testid="my-calendar">
          <CardContent className="flex flex-col gap-4">
            {dates === null ? null : dates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("teamCalendar.noDates")}</p>
            ) : (
              <ul className="flex flex-col divide-y" aria-label={t("teamCalendar.myCalendar")}>
                {dates.map((date) => (
                  <EventDateRow key={`${date.eventId}-${date.date}`} date={date} partLabel={partLabel} act={act} />
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
          <OpenPlacesCard
            places={openPlaces}
            busy={taking}
            onTake={(place) => {
              setTaking(true);
              void act(() => api.takeOpenPlace({ teamId: place.teamId, eventId: place.eventId, date: place.date, part: place.partKey })).finally(() => setTaking(false));
            }}
          />
          {section ? null : (
            <>
              <CalendarFeedCard />
              <AwayDaysCard
                away={away}
                onAdd={(range) => act(() => api.addMyAway(range))}
                onUpdate={(id, range) => act(() => api.updateMyAway(id, range))}
                onRemove={(id) => act(() => api.removeMyAway(id))}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
