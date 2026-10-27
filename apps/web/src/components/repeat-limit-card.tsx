import { Repeat } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";

/**
 * Songs played often (issue #335), on a team's page for its admins: over
 * how many weeks a song's plays in the team's sets are counted, and from
 * how many it's flagged when it goes in a set - a warning, never a block.
 */
export function RepeatLimitCard({ weeks, limit, onSave }: { weeks: number; limit: number | null; onSave: (next: { repeatWeeks: number; repeatLimit: number | null }) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(limit !== null);
  const [times, setTimes] = useState(String(limit ?? 3));
  const [span, setSpan] = useState(String(weeks));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const number = (value: string) => Math.min(52, Math.max(1, Math.round(Number(value) || 1)));

  return (
    <Card data-testid="repeat-limit-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Repeat className="size-4" aria-hidden />
          {t("recentPlays.cardTitle")}
        </CardTitle>
        <CardDescription>{t("recentPlays.cardDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {t("recentPlays.weeksLabel")}
          <Input type="number" min={1} max={52} value={span} onChange={(event) => setSpan(event.target.value)} className="h-8 w-20" data-testid="repeat-weeks" />
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={on} onChange={(event) => setOn(event.target.checked)} data-testid="repeat-limit-on" />
          {t("recentPlays.limitLabel")}
          <Input type="number" min={1} max={52} value={times} disabled={!on} onChange={(event) => setTimes(event.target.value)} className="h-8 w-20" data-testid="repeat-limit" />
        </label>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              setSaved(false);
              void onSave({ repeatWeeks: number(span), repeatLimit: on ? number(times) : null })
                .then(
                  () => setSaved(true),
                  (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
                )
                .finally(() => setBusy(false));
            }}
            data-testid="repeat-save"
          >
            {t("recentPlays.save")}
          </Button>
          {saved ? <span className="text-xs text-muted-foreground">{t("recentPlays.saved")}</span> : null}
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
