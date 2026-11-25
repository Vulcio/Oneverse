import type { AwayDays, TeamEventType } from "@oneverse/core";
import { CalendarDays, Link2, Plane, Repeat, Shapes } from "lucide-react";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { FieldError } from "@oneverse/ui/components/field";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { cn } from "@oneverse/ui/lib/utils";
import { AwayDaysCard } from "../components/away-days-card";
import { CalendarFeedCard } from "../components/calendar-feed-card";
import { EventTypesDialog } from "../components/event-types";
import { usePartLabel } from "../components/lineup";
import { TeamCalendar } from "../components/team-calendar";
import { usePlanning } from "../host";
import type { loadCalendarSection } from "../loaders";
import { MyCalendarPage } from "./my-calendar";
import { OrganizationEventsPage } from "./organization-events";

export type CalendarSectionData = Awaited<ReturnType<typeof loadCalendarSection>>;

/** What the section shows of the chosen calendar. */
export type CalendarTab = "dates" | "events" | "types" | "subscribe" | "availability";

const TABS: readonly CalendarTab[] = ["dates", "events", "types", "subscribe", "availability"];

/** A tab from the address, or the dates. */
export function calendarTab(value: unknown): CalendarTab {
  return TABS.includes(value as CalendarTab) ? (value as CalendarTab) : "dates";
}

const ICONS: Record<CalendarTab, ComponentType<{ className?: string }>> = { dates: CalendarDays, events: Repeat, types: Shapes, subscribe: Link2, availability: Plane };

/**
 * Plan's Calendar section (issue #551): one's own calendar, or one of one's
 * organisations' or teams', picked here without going through Organisations
 * or Teams; a menu beside it (tabs on a phone) for its dates, its events and
 * event types (made and changed here, by those who manage it), its calendar
 * link and one's away days - those last two a button away at the top too.
 * `onChange` puts the choice in the address.
 */
export function CalendarSection({ data, tab: asked, onChange }: { data: CalendarSectionData; tab: CalendarTab; onChange: (next: { of: string; tab: CalendarTab }) => void }) {
  const { t } = useTranslation();
  const { teams, organizations, chosen } = data;
  const of = chosen.kind === "me" ? "me" : chosen.kind === "team" ? `team:${chosen.team.id}` : `organization:${chosen.data.organization.id}`;
  const isAdmin = chosen.kind === "team" ? chosen.team.currentUserRole === "ADMIN" : chosen.kind === "organization" ? chosen.data.organization.currentUserRole === "ADMIN" : false;
  // What this calendar has: one's own has no events or types; types are kept by its admins.
  const tabs = TABS.filter((one) => (chosen.kind === "me" ? one !== "events" && one !== "types" : one !== "types" || isAdmin));
  const tab = tabs.includes(asked) ? asked : "dates";
  const title = chosen.kind === "me" ? t("teamCalendar.myCalendar") : chosen.kind === "team" ? chosen.team.name : chosen.data.organization.name;
  const label = (one: CalendarTab) => t(`calendarSection.tab.${one}`);
  const go = (next: CalendarTab) => onChange({ of, tab: next });
  const listedOrganizations = organizations && organizations.mode !== "NONE" ? organizations.organizations : [];

  return (
    <div className="flex flex-col gap-6" data-testid="calendar-section" data-calendar={of} data-tab={tab}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{t("calendarSection.title")}</p>
          <h1 className="text-2xl font-semibold" data-testid="calendar-section-title">
            {title}
          </h1>
        </div>
        {/* Subscribe and one's away days, a button away from every calendar. */}
        <div className="flex flex-wrap gap-2">
          <Button variant={tab === "subscribe" ? "default" : "outline"} size="sm" onClick={() => go("subscribe")} data-testid="calendar-section-subscribe">
            <Link2 />
            {label("subscribe")}
          </Button>
          <Button variant={tab === "availability" ? "default" : "outline"} size="sm" onClick={() => go("availability")} data-testid="calendar-section-availability">
            <Plane />
            {label("availability")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 @3xl:grid-cols-[14rem_minmax(0,1fr)]">
        <nav className="flex min-w-0 flex-col gap-3" aria-label={t("calendarSection.title")}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="calendar-picker">{t("calendarSection.picker")}</Label>
            <NativeSelect id="calendar-picker" value={of} onChange={(event) => onChange({ of: event.target.value, tab })} data-testid="calendar-picker">
              <option value="me">{t("teamCalendar.myCalendar")}</option>
              {listedOrganizations.length > 0 ? (
                <optgroup label={t("nav.organizations")}>
                  {listedOrganizations.map((one) => (
                    <option key={one.id} value={`organization:${one.id}`}>
                      {one.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {teams.length > 0 ? (
                <optgroup label={t("nav.teams")}>
                  {teams.map((one) => (
                    <option key={one.id} value={`team:${one.id}`}>
                      {one.organization && listedOrganizations.length > 0 ? `${one.name} · ${one.organization.name}` : one.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </NativeSelect>
          </div>
          {/* A side menu on a computer, tabs across on a phone. */}
          <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 @3xl:mx-0 @3xl:flex-col @3xl:px-0" role="tablist">
            {tabs.map((one) => {
              const Icon = ICONS[one];
              return (
                <li key={one} className="shrink-0">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === one}
                    onClick={() => go(one)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm font-medium whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      tab === one && "bg-accent text-accent-foreground",
                    )}
                    data-testid={`calendar-tab-${one}`}
                  >
                    <Icon className="size-4" />
                    {label(one)}
                  </button>
                </li>
              );
            })}
          </ul>
          {chosen.kind === "me" ? null : (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => onChange({ of: "me", tab: "dates" })}>
              <CalendarDays />
              {t("calendarSection.backToMine")}
            </Button>
          )}
        </nav>

        <div className="flex min-w-0 flex-col gap-6" key={`${of}/${tab}`}>
          {tab === "subscribe" ? (
            <CalendarFeedCard owner={chosen.kind === "me" ? null : chosen.kind === "team" ? { teamId: chosen.team.id } : { organizationId: chosen.data.organization.id }} canManage={chosen.kind === "me" || isAdmin} />
          ) : tab === "availability" ? (
            <Availability />
          ) : chosen.kind === "me" ? (
            <MyCalendarPage section />
          ) : chosen.kind === "team" ? (
            tab === "types" ? (
              <TeamTypes teamId={chosen.team.id} makesSets={chosen.team.usesSongverse !== false} positions={chosen.positions} customInstruments={chosen.customInstruments} />
            ) : (
              <TeamCalendar
                teamId={chosen.team.id}
                isAdmin={isAdmin}
                customInstruments={chosen.customInstruments}
                setsByDefault={chosen.team.usesSongverse !== false}
                positions={chosen.positions}
                organization={chosen.team.organization && organizations && organizations.mode !== "NONE" ? chosen.team.organization : null}
                view={tab === "events" ? "events" : "dates"}
              />
            )
          ) : tab === "types" ? (
            <OrganizationTypes data={chosen.data} />
          ) : (
            <OrganizationEventsPage data={chosen.data} view={tab === "events" ? "events" : "dates"} />
          )}
        </div>
      </div>
    </div>
  );
}

/** One's away days (issue #235): every date in them that isn't answered says Not available. */
function Availability() {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [away, setAway] = useState<AwayDays[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => setAway(await api.listMyAway()), []);
  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);
  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <>
      <p className="text-sm text-muted-foreground">{t("calendarSection.availabilityHint")}</p>
      {error ? <FieldError>{error}</FieldError> : null}
      {away ? (
        <AwayDaysCard
          away={away}
          onAdd={(range) => act(() => api.addMyAway(range))}
          onUpdate={(id, range) => act(() => api.updateMyAway(id, range))}
          onRemove={(id) => act(() => api.removeMyAway(id))}
        />
      ) : null}
    </>
  );
}

/** A team's event types (issue #523), for its admins, on the page. */
function TeamTypes({ teamId, makesSets, positions, customInstruments }: { teamId: string; makesSets: boolean; positions: CalendarTeam["positions"]; customInstruments: CalendarTeam["customInstruments"] }) {
  const { api, sets } = usePlanning();
  const partLabel = usePartLabel(customInstruments);
  const [types, setTypes] = useState<TeamEventType[] | null>(null);
  const load = useCallback(async () => setTypes(await api.listTeamEventTypes(teamId)), [teamId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!types) return null;
  return (
    <EventTypesDialog
      inline
      owner={{ teamId }}
      types={types}
      makesSets={!!sets && makesSets}
      teamNames={[]}
      positions={positions}
      customInstruments={customInstruments}
      partLabel={partLabel}
      onChanged={load}
      onClose={() => {}}
    />
  );
}

/** An organisation's event types (issue #528), for its admins, on the page: every group picks from them. */
function OrganizationTypes({ data }: { data: Extract<CalendarSectionData["chosen"], { kind: "organization" }>["data"] }) {
  const { api, sets } = usePlanning();
  const { organization, customInstruments } = data;
  const partLabel = usePartLabel(customInstruments, organization.teams);
  const [types, setTypes] = useState<TeamEventType[]>(data.types);
  const load = async () => setTypes(await api.listOrganizationEventTypes(organization.id));
  return (
    <EventTypesDialog
      inline
      owner={{ organizationId: organization.id, teams: organization.teams.map((team) => ({ id: team.id, name: team.name })) }}
      types={types}
      makesSets={!!sets}
      teamNames={[]}
      positions={[]}
      customInstruments={customInstruments}
      partLabel={partLabel}
      onChanged={load}
      onClose={() => {}}
    />
  );
}

type CalendarTeam = Extract<CalendarSectionData["chosen"], { kind: "team" }>;
