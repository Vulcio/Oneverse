import type { SetlistSummary, TeamSummary } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { cn } from "@oneverse/ui/lib/utils";
import { usePlanning } from "@oneverse/planning/host";
import { usePushDevice } from "@oneverse/planning/use-push-device";

const DISMISSED = "songverse.gettingStarted.dismissed";

/**
 * Getting started (issue #350): the way from signing up to playing a set
 * with one's team - notifications on this device first (issue #568), a song
 * of one's own, a team (joined by its link or started), a set of the
 * team's - each ticked once done (notifications left out where this device
 * can't have them). Gone once all are,
 * or when put away (on this device).
 */
export function GettingStarted({ ownSongs, teams, setlists }: { ownSongs: number; teams: readonly TeamSummary[]; setlists: readonly SetlistSummary[] }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(true);
  const [pushKey, setPushKey] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    api.getMyNotificationPreferences().then((preferences) => setPushKey(preferences.pushKey), () => setPushKey(null));
  }, [api]);
  const push = usePushDevice(pushKey, pushKey !== undefined);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);
  const songverseTeams = teams.filter((team) => team.usesSongverse !== false);
  const steps: { key: "notifications" | "song" | "team" | "set"; done: boolean; to?: "/library/new" | "/teams/new" | "/sets/new"; action: string }[] = [
    // Only where it can be done: not when this browser can't, it's blocked, or the server sends none.
    ...(push.state === "on" || push.state === "off" ? [{ key: "notifications" as const, done: push.state === "on", action: t("gettingStarted.notificationsAction") }] : []),
    { key: "song", done: ownSongs > 0, to: "/library/new" as const, action: t("gettingStarted.songAction") },
    { key: "team", done: songverseTeams.length > 0, to: "/teams/new" as const, action: t("gettingStarted.teamAction") },
    { key: "set", done: setlists.some((set) => set.teamId !== null && !set.isGuest), to: "/sets/new" as const, action: t("gettingStarted.setAction") },
  ];
  if (dismissed || push.state === "loading" || steps.every((step) => step.done)) return null;
  return (
    <Card data-testid="getting-started">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-base">{t("gettingStarted.title")}</CardTitle>
          <CardDescription>{t("gettingStarted.description")}</CardDescription>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("gettingStarted.dismiss")}
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(DISMISSED, "1");
            } catch {
              // Put away for now only.
            }
          }}
        >
          <X />
        </Button>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3">
          {steps.map((step, index) => (
            <li key={step.key} className="flex items-start gap-3" data-step={step.key} data-done={step.done}>
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                  step.done ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
                aria-hidden
              >
                {step.done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className={cn("text-sm font-medium", step.done && "text-muted-foreground line-through")}>{t(`gettingStarted.${step.key}`)}</p>
                <p className="text-sm text-muted-foreground">{t(`gettingStarted.${step.key}Hint`)}</p>
                {step.done ? null : step.to ? (
                  <Button size="sm" variant="outline" className="self-start" render={<Link to={step.to} />}>
                    {step.action}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="self-start" disabled={push.busy} onClick={() => void push.turnOn()} data-testid="getting-started-push">
                    {step.action}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
