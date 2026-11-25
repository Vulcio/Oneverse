import { addDays, localDate, type AppLink, type AppNotification, type Brand, type MyEventDate, type OpenPlace, type OrganizationSummary, type TeamSummary } from "@oneverse/core";
import { ChevronRight, Globe, MessageCircle, Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EventDateRow } from "@oneverse/planning/components/event-date-row";
import { usePartLabel } from "@oneverse/planning/components/lineup";
import { NotificationList } from "@oneverse/planning/components/notification-list";
import { OpenPlacesCard } from "@oneverse/planning/components/open-places-card";
import { HostLink, usePlanning } from "@oneverse/planning/host";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { FieldError } from "@oneverse/ui/components/field";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { createDeviceStore } from "@oneverse/ui/lib/device-store";
import { cn } from "@oneverse/ui/lib/utils";
import { appHref } from "@oneverse/app/apps";
import { APP_LOOKS, useAppName } from "@oneverse/app/components/app-switcher";
import { appAddresses } from "#/lib/apps";

/** How far ahead the home looks for one's dates and open places, and how many of each it shows. */
const DAYS_AHEAD = 28;
const SHOWN = 5;

/** The organisation the home shows, kept on the device; "" for the first one. */
const chosenOrganization = createDeviceStore<string>("oneverse.homeOrganization", { fallback: "", parse: (raw) => raw ?? "", format: (value) => value || null });

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * Oneverse's home (issue #538), where one lands after signing in: the apps,
 * one's coming dates answered right here, the places other groups need
 * someone for, the news, one's teams, the organisation's links, and the
 * settings. It shows and answers; making and managing stay in the apps.
 * With organisations, one at a time (chosen at the top); without any, the
 * same for one's own teams.
 */
export function HomePage({ name, organizations, teams, apps }: { name: string; organizations: OrganizationSummary[]; teams: TeamSummary[]; apps: AppLink[] }) {
  const { t } = useTranslation();
  const chosen = chosenOrganization.use();
  const organization = organizations.find((one) => one.id === chosen) ?? organizations[0] ?? null;
  // The organisation's teams, and those in none; all of them without organisations.
  const shownTeams = organization ? teams.filter((team) => !team.organization || team.organization.id === organization.id) : teams;
  return (
    <div className="flex flex-col gap-6" data-testid="home">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("hub.hello", { name })}</h1>
        {organizations.length > 1 ? (
          <NativeSelect aria-label={t("hub.organization")} value={organization?.id ?? ""} onChange={(event) => chosenOrganization.set(event.target.value)} className="w-auto" data-testid="home-organization">
            {organizations.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </NativeSelect>
        ) : organization ? (
          <span className="flex items-center gap-2 text-sm font-medium" data-testid="home-organization-name">
            <EntityAvatar name={organization.name} color={organization.color} size={20} />
            {organization.name}
          </span>
        ) : null}
      </div>
      <AppTiles apps={apps.filter((link) => link.app !== "oneverse")} />
      <div className="grid grid-cols-1 items-start gap-6 @3xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Planning />
        </div>
        <div className="flex flex-col gap-6">
          <News />
          <Teams teams={shownTeams} />
          {organization ? <FollowCard organization={organization} /> : null}
          <SettingsCard organization={organization} />
        </div>
      </div>
    </div>
  );
}

/** The apps one can open (issue #538): the switcher's list (issue #552), at their homes. */
function AppTiles({ apps }: { apps: AppLink[] }) {
  const { t } = useTranslation();
  const name = useAppName();
  const text: Record<string, string> = { plan: t("hub.planText"), songverse: t("hub.songverseText"), screen: t("hub.screenText") };
  return (
    <nav aria-label={t("hub.apps")} className="grid grid-cols-2 gap-3 @2xl:grid-cols-3">
      {apps.map((link) => {
        const { icon: Icon, tint } = APP_LOOKS[link.app];
        return (
          <a key={link.app} href={appHref(link, "/")} className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/30" data-testid={`home-app-${link.app}`}>
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg]:size-5", tint)}>
              <Icon />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">{name(link.app)}</span>
              <span className="hidden truncate text-sm text-muted-foreground @xl:block">{text[link.app]}</span>
            </span>
          </a>
        );
      })}
    </nav>
  );
}

/** One's next dates, answered here, and the open places one may take (issue #528): My calendar's, the first few. */
function Planning() {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const partLabel = usePartLabel([]);
  const [dates, setDates] = useState<MyEventDate[] | null>(null);
  const [places, setPlaces] = useState<OpenPlace[]>([]);
  const [taking, setTaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { plan, songverse } = appAddresses();

  const load = useCallback(async () => {
    const today = localDate(new Date(), browserZone());
    const [found, open] = await Promise.all([api.listMyEventDates(addDays(today, -1), addDays(today, DAYS_AHEAD)), api.listOpenPlaces(today, addDays(today, DAYS_AHEAD)).catch(() => [])]);
    const now = Date.now();
    setDates(found.filter((date) => !date.cancelled && Date.parse(date.endsAt) >= now).slice(0, SHOWN));
    setPlaces(open.filter((place) => place.guest).slice(0, SHOWN));
  }, []);
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
      <Card data-testid="home-dates">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("hub.nextDates")}</CardTitle>
          <a href={`${plan ?? songverse}/calendar`} className="text-sm font-medium text-primary hover:underline">
            {t("hub.openCalendar")}
          </a>
        </CardHeader>
        <CardContent>
          {error ? <FieldError>{error}</FieldError> : null}
          {dates === null ? null : dates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("hub.noDates")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {/* My calendar's row (issue #575): its page, its line-up and its set, as everywhere. */}
              {dates.map((date) => (
                <EventDateRow key={`${date.eventId}-${date.date}`} date={date} partLabel={partLabel} act={act} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <OpenPlacesCard
        places={places}
        busy={taking}
        onTake={(place) => {
          setTaking(true);
          void act(() => api.takeOpenPlace({ teamId: place.teamId, eventId: place.eventId, date: place.date, part: place.partKey })).finally(() => setTaking(false));
        }}
      />
    </>
  );
}

/** The announcements one was sent (issue #536), newest first: the organisation's, one's teams', the server's. */
function News() {
  const { api, links } = usePlanning();
  const { t } = useTranslation();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  useEffect(() => {
    void api.listMyNotifications(undefined, SHOWN, true).then(
      (page) => setItems(page.items),
      () => setItems([]),
    );
  }, []);
  return (
    <Card data-testid="home-news">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("hub.news")}</CardTitle>
        <HostLink href={links.notifications} className="text-sm font-medium text-primary hover:underline">
          {t("hub.allNotifications")}
        </HostLink>
      </CardHeader>
      <CardContent className="px-3">
        {items === null ? null : items.length === 0 ? (
          <p className="px-3 text-sm text-muted-foreground">{t("hub.noNews")}</p>
        ) : (
          <NotificationList
            items={items}
            onRead={(ids) => {
              void api.markMyNotificationsRead(ids).catch(() => {});
              setItems((shown) => shown?.map((item) => (ids.includes(item.id) ? { ...item, read: true } : item)) ?? null);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** One's teams and groups, each opening where it's planned: Songverse for one with songs, Plan for a group that only plans. */
function Teams({ teams }: { teams: TeamSummary[] }) {
  const { t } = useTranslation();
  const { songverse, plan } = appAddresses();
  return (
    <Card data-testid="home-teams">
      <CardHeader>
        <CardTitle>{t("hub.teams")}</CardTitle>
      </CardHeader>
      <CardContent>
        {teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("hub.noTeams")}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {teams.map((team) => {
              const inPlan = team.usesSongverse === false && !!plan;
              return (
                <li key={team.id}>
                  <a href={`${inPlan ? plan : songverse}/teams/${team.id}`} className="flex items-center gap-3 py-2 text-sm hover:text-primary" data-testid="home-team">
                    <EntityAvatar name={team.name} color={team.color} avatarUrl={team.avatarUrl} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{team.name}</span>
                      <span className="block text-xs text-muted-foreground">{t("hub.openIn", { app: inPlan ? "Plan" : "Songverse" })}</span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** The organisation's brand's links (issue #279): its website, social networks and WhatsApp groups. Members only: the API shows its brands only to its members. */
function FollowCard({ organization }: { organization: OrganizationSummary }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [brand, setBrand] = useState<Brand | null>(null);
  useEffect(() => {
    setBrand(null);
    void api.listBrands({ organizationId: organization.id }).then(
      (brands) => setBrand(brands.find((one) => one.isDefault) ?? brands[0] ?? null),
      () => {},
    );
  }, [organization.id]);
  if (!brand || (!brand.website && brand.socials.length === 0 && brand.whatsapp.length === 0)) return null;
  return (
    <Card data-testid="home-follow">
      <CardHeader>
        <CardTitle>{t("hub.follow", { name: organization.name })}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {brand.website ? (
            <Button variant="outline" size="sm" render={<a href={brand.website} target="_blank" rel="noopener noreferrer" />}>
              <Globe />
              {t("hub.website")}
            </Button>
          ) : null}
          {brand.socials.map((social) => (
            <Button key={social.url} variant="outline" size="sm" render={<a href={social.url} target="_blank" rel="noopener noreferrer" />}>
              {t(`brands.networks.${social.network}`)}
            </Button>
          ))}
        </div>
        {brand.whatsapp.map((group) => (
          <a key={group.url} href={group.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-lg bg-success/10 p-3 text-sm hover:bg-success/15" data-testid="home-whatsapp">
            <MessageCircle className="size-5 shrink-0 text-success" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{group.name}</span>
              <span className="block text-xs text-muted-foreground">{group.purpose || t("hub.membersOnly")}</span>
            </span>
          </a>
        ))}
      </CardContent>
    </Card>
  );
}

/** Where one's settings are: the account here; notifications, the organisation and its brand in the apps for now (#540, #541). */
function SettingsCard({ organization }: { organization: OrganizationSummary | null }) {
  const { links } = usePlanning();
  const { t } = useTranslation();
  const admin = organization?.currentUserRole === "ADMIN";
  const rows: { key: string; label: string; href: string; admins?: boolean }[] = [
    { key: "account", label: t("hub.profileSettings"), href: "/account" },
    { key: "notifications", label: t("hub.notificationSettings"), href: links.notificationSettings },
    ...(organization && admin ? [{ key: "organization", label: t("hub.organizationSettings"), href: links.organization(organization.id), admins: true }] : []),
  ];
  return (
    <Card data-testid="home-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="size-4" aria-hidden />
          {t("hub.settings")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {rows.map((row) => (
            <li key={row.key}>
              <HostLink href={row.href} className="flex items-center gap-2 py-2 text-sm hover:text-primary" data-testid={`home-setting-${row.key}`}>
                <span className="flex-1">{row.label}</span>
                {row.admins ? <Badge variant="muted">{t("hub.admins")}</Badge> : null}
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </HostLink>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
