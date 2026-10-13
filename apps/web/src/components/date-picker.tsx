import { CalendarDays, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "@songverse/ui/components/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@songverse/ui/components/popover";
import { fromDayKey, toDayKey } from "@songverse/ui/lib/dates";
import { formatSetDate } from "#/lib/setlists";
import { cn } from "@songverse/ui/lib/utils";

/**
 * A date ("YYYY-MM-DD", or "" for none) chosen on the calendar: a button
 * showing it, opening the calendar in a popover. `min`/`max` limit the days
 * that can be picked; `clearable` offers taking it away.
 */
export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  disabled = false,
  clearable = false,
  placeholder,
  className,
  testId,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = value ? fromDayKey(value) : undefined;
  const bounds = [...(min ? [{ before: fromDayKey(min) }] : []), ...(max ? [{ after: fromDayKey(max) }] : [])];
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              id={id}
              type="button"
              disabled={disabled}
              className="flex h-9 w-full min-w-36 items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid={testId}
              data-value={value}
            />
          }
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? formatSetDate(value, i18n.language) : (placeholder ?? t("common.pickDate"))}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? (min ? fromDayKey(min) : undefined)}
            disabled={bounds.length ? bounds : undefined}
            onSelect={(day) => {
              if (!day) return;
              onChange(toDayKey(day));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {clearable && value && !disabled ? (
        <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("common.clearDate")} title={t("common.clearDate")} onClick={() => onChange("")}>
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
