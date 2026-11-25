import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { usePlanning } from "../host";

/** The same address as a subscription link (webcal:), which calendar apps open as "subscribe". */
const webcal = (url: string) => url.replace(/^https?:/, "webcal:");

/** Whose link: one's own, a team's (issue #240) or an organisation's (issue #551). */
export type CalendarFeedOwner = { teamId: string } | { organizationId: string } | null;

/**
 * Someone's calendar link (issue #235): the dates they signed up for, as a
 * feed their own calendar subscribes to. Copied, or added to Google, Apple
 * or Outlook in one click; reset (the old link stops) or turned off.
 * A team's link (issue #240) or an organisation's (issue #551): all its
 * dates, nobody's answers - its members see and add it, its admins
 * (`canManage`) make, reset or turn it off.
 */
export function CalendarFeedCard({ owner = null, canManage = true }: { owner?: CalendarFeedOwner; canManage?: boolean } = {}) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const ownerKey = owner ? ("teamId" in owner ? `team:${owner.teamId}` : `organization:${owner.organizationId}`) : "me";
  const feed = !owner
    ? { get: () => api.getMyCalendarFeed(), reset: () => api.resetMyCalendarFeed(), off: () => api.turnOffMyCalendarFeed() }
    : "teamId" in owner
      ? { get: () => api.getTeamCalendarFeed(owner.teamId), reset: () => api.resetTeamCalendarFeed(owner.teamId), off: () => api.turnOffTeamCalendarFeed(owner.teamId) }
      : { get: () => api.getOrganizationCalendarFeed(owner.organizationId), reset: () => api.resetOrganizationCalendarFeed(owner.organizationId), off: () => api.turnOffOrganizationCalendarFeed(owner.organizationId) };
  const words = !owner
    ? { title: t("teamCalendar.feedTitle"), description: t("teamCalendar.feedDescription"), make: t("teamCalendar.feedMake"), private: t("teamCalendar.feedPrivate"), none: "" }
    : "teamId" in owner
      ? { title: t("teamCalendar.teamFeedTitle"), description: t("teamCalendar.teamFeedDescription"), make: t("teamCalendar.teamFeedMake"), private: t("teamCalendar.teamFeedPrivate"), none: t("calendarSection.feedNoneTeam") }
      : { title: t("calendarSection.organizationFeedTitle"), description: t("calendarSection.organizationFeedDescription"), make: t("calendarSection.organizationFeedMake"), private: t("calendarSection.organizationFeedPrivate"), none: t("calendarSection.feedNoneOrganization") };
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setUrl(undefined);
    void feed.get().then((one) => setUrl(one.url));
  }, [ownerKey]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  const make = () =>
    run(async () => {
      setUrl((await feed.reset()).url);
      setCopied(false);
    });

  return (
    <Card data-testid={!owner ? "calendar-feed" : "teamId" in owner ? "team-calendar-feed" : "organization-calendar-feed"}>
      <CardHeader>
        <CardTitle className="text-sm">{words.title}</CardTitle>
        <CardDescription>{words.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {url === undefined ? null : url === null && !canManage ? (
          <p className="text-sm text-muted-foreground" data-testid="calendar-feed-none">
            {words.none}
          </p>
        ) : url === null ? (
          <Button variant="outline" size="sm" className="self-start" disabled={busy} onClick={() => void make()} data-testid="calendar-feed-make">
            {words.make}
          </Button>
        ) : (
          <>
            <div className="flex gap-2">
              <Input readOnly value={url} aria-label={words.title} className="font-mono text-xs" onFocus={(event) => event.target.select()} data-testid="calendar-feed-url" />
              <Button
                variant="outline"
                size="sm"
                className="h-9 shrink-0"
                onClick={() =>
                  void navigator.clipboard.writeText(url).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  })
                }
                data-testid="calendar-feed-copy"
              >
                {copied ? <Check /> : <Copy />}
                {copied ? t("teamCalendar.feedCopied") : t("teamCalendar.feedCopy")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{words.private}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" render={<a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal(url))}`} target="_blank" rel="noopener noreferrer" />} data-testid="calendar-feed-google">
                {t("teamCalendar.feedGoogle")}
              </Button>
              <Button variant="outline" size="sm" render={<a href={webcal(url)} />} data-testid="calendar-feed-apple">
                {t("teamCalendar.feedApple")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                render={<a href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(t("teamCalendar.feedName"))}`} target="_blank" rel="noopener noreferrer" />}
                data-testid="calendar-feed-outlook"
              >
                {t("teamCalendar.feedOutlook")}
              </Button>
            </div>
            {canManage ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <ConfirmButton label={t("teamCalendar.feedReset")} confirmLabel={t("teamCalendar.feedResetConfirm")} busyLabel={t("teamCalendar.feedReset")} cancelLabel={t("teamCalendar.cancel")} busy={busy} onConfirm={make} />
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => {
                await feed.off();
                setUrl(null);
              })} data-testid="calendar-feed-off">
                {t("teamCalendar.feedOff")}
              </Button>
            </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
