import { Check } from "lucide-react";
import { cn } from "@oneverse/ui/lib/utils";

// What someone plays or does, as on/off chips: the dashboard's roles card,
// and "What do you play or do?" (issue #109).

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

export function toggled<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/** A group of on/off chips; any number can be on. */
export function ChipGroup<T extends string>({
  label,
  options,
  selected,
  labelFor,
  onToggle,
  disabled,
}: {
  label: string;
  options: readonly T[];
  selected: readonly T[];
  labelFor: (option: T) => string;
  onToggle: (option: T) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const on = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(option)}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
                on ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted",
              )}
            >
              {on ? <Check className="size-3.5" /> : null}
              {labelFor(option)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
