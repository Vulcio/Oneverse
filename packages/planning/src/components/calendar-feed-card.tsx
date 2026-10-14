import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@songverse/ui/components/confirm-button";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { usePlanning } from "../host";

/** The same address as a subscription link (webcal:), which calendar apps open as "subscribe". */
const webcal = (url: string) => url.replace(/^https?:/, "webcal:");

/**
 * Someone's calendar link (issue #235): the dates they signed up for, as a
 * feed their own calendar subscribes to. Copied, or added to Google, Apple
 * or Outlook in one click; reset (the old link stops) or turned off.
 * With `teamId`, the team's link (issue #240), for its admins: all its
 * dates, nobody's answers.
 */
export function CalendarFeedCard({ teamId }: { teamId?: string } = {}) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const feed = teamId
    ? { get: () => api.getTeamCalendarFeed(teamId), reset: () => api.resetTeamCalendarFeed(teamId), off: () => api.turnOffTeamCalendarFeed(teamId) }
    : { get: () => api.getMyCalendarFeed(), reset: () => api.resetMyCalendarFeed(), off: () => api.turnOffMyCalendarFeed() };
  const words = teamId
    ? { title: t("teamCalendar.teamFeedTitle"), description: t("teamCalendar.teamFeedDescription"), make: t("teamCalendar.teamFeedMake"), private: t("teamCalendar.teamFeedPrivate") }
    : { title: t("teamCalendar.feedTitle"), description: t("teamCalendar.feedDescription"), make: t("teamCalendar.feedMake"), private: t("teamCalendar.feedPrivate") };
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void feed.get().then((one) => setUrl(one.url));
  }, [teamId]);
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
    <Card data-testid={teamId ? "team-calendar-feed" : "calendar-feed"}>
      <CardHeader>
        <CardTitle className="text-sm">{words.title}</CardTitle>
        <CardDescription>{words.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {url === undefined ? null : url === null ? (
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
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <ConfirmButton label={t("teamCalendar.feedReset")} confirmLabel={t("teamCalendar.feedResetConfirm")} busyLabel={t("teamCalendar.feedReset")} cancelLabel={t("teamCalendar.cancel")} busy={busy} onConfirm={make} />
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => {
                await feed.off();
                setUrl(null);
              })} data-testid="calendar-feed-off">
                {t("teamCalendar.feedOff")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
