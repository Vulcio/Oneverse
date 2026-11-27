import { EVENT_DURATION_DAYS_MAX } from "@oneverse/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";

const DAY = 24 * 60;
const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};
const timeOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * How long an event lasts: minutes, or (issue #593) over several days - a
 * weekend, a week - as the day it ends on and the time it ends, kept as
 * minutes. `value` is the minutes as typed ("" when not given).
 */
export function DurationField({ id, value, onChange, startTime, required = false, testId }: { id: string; value: string; onChange: (minutes: string) => void; startTime: string; required?: boolean; testId?: string }) {
  const { t } = useTranslation();
  const minutes = Number(value) || 0;
  const [several, setSeveral] = useState(minutes > DAY);
  const start = minutesOf(startTime || "00:00");
  const end = start + minutes;
  const days = Math.max(2, Math.floor(end / DAY) + 1);
  const endTime = timeOf(((end % DAY) + DAY) % DAY);
  const setEnd = (dayCount: number, time: string) => onChange(String(Math.max(5, (dayCount - 1) * DAY + minutesOf(time) - start)));

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={several ? `${id}-days` : id}>{t("teamCalendar.duration")}</Label>
      {several ? (
        <div className="flex items-center gap-2">
          <Input id={`${id}-days`} type="number" min={2} max={EVENT_DURATION_DAYS_MAX} value={days} aria-label={t("teamCalendar.durationDays")} onChange={(event) => setEnd(Math.min(EVENT_DURATION_DAYS_MAX, Math.max(2, Number(event.target.value) || 2)), endTime)} className="w-20" data-testid="event-duration-days" />
          <span className="text-sm text-muted-foreground">{t("teamCalendar.durationDaysUntil")}</span>
          <Input type="time" value={endTime} required aria-label={t("teamCalendar.durationEndsAt")} onChange={(event) => setEnd(days, event.target.value)} className="w-28" data-testid="event-duration-ends" />
        </div>
      ) : (
        <Input id={id} type="number" min={5} max={DAY} value={value} required={required} onChange={(event) => onChange(event.target.value)} data-testid={testId} />
      )}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="size-3.5"
          checked={several}
          onChange={(event) => {
            setSeveral(event.target.checked);
            if (event.target.checked) onChange(String(DAY));
            else if (minutes > DAY || !value) onChange("90");
          }}
          data-testid="event-several-days"
        />
        {t("teamCalendar.severalDays")}
      </label>
    </div>
  );
}
