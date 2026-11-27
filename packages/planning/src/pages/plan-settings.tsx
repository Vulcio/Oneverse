import type { AwayDays } from "@oneverse/core";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FieldError } from "@oneverse/ui/components/field";
import { AwayDaysCard } from "../components/away-days-card";
import { CalendarFeedCard } from "../components/calendar-feed-card";
import { usePlanning } from "../host";

/**
 * Oneverse Plan's settings (issue #540): one's availability - the days
 * away, the same list as My calendar's - then the calendar: its first day
 * of the week (`weekStart`, the app's card) and one's calendar link.
 */
export function PlanSettings({ weekStart }: { weekStart: ReactNode }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [away, setAway] = useState<AwayDays[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.listMyAway().then(setAway), [api]);
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
    <div className="grid grid-cols-1 items-start gap-6 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-testid="plan-settings">
      <div className="flex flex-col gap-2">
        <AwayDaysCard title={t("settings.availability")} description={t("settings.availabilityDescription")} away={away} onAdd={(range) => act(() => api.addMyAway(range))} onUpdate={(id, range) => act(() => api.updateMyAway(id, range))} onRemove={(id) => act(() => api.removeMyAway(id))} />
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
      <div className="flex flex-col gap-6">
        {weekStart}
        <CalendarFeedCard />
      </div>
    </div>
  );
}
