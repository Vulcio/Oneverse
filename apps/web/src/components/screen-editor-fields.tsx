import type { ReactNode } from "react";
import { cn } from "@oneverse/ui/lib/utils";

/* A screen editor's fields (issues #194, #395): a group that opens and closes, a labelled field, a slider, a colour, a few choices. */

export function Group({ title, open = false, testId, children }: { title: string; open?: boolean; testId?: string; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-md border bg-card [&[open]>summary]:border-b" data-testid={testId}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold select-none">{title}</summary>
      <div className="flex flex-col gap-3 p-3">{children}</div>
    </details>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function Slider({ value, min, max, step, unit = "", onChange }: { value: number; min: number; max: number; step: number; unit?: string; onChange: (value: number) => void }) {
  return (
    <div className="flex w-full items-center gap-2">
      <input type="range" className="min-w-0 flex-1 accent-primary" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {Number.isInteger(value) ? value : value.toFixed(2)}
        {unit}
      </span>
    </div>
  );
}

export function ColorInput({ value, onChange, testId }: { value: string; onChange: (value: string) => void; testId?: string }) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5"
      aria-label={value}
      data-testid={testId}
    />
  );
}

/** One of a few, as buttons side by side; wraps when they don't fit. */
export function Choices<T extends string>({ value, options, label, onChange, testId }: { value: T; options: readonly T[]; label: (one: T) => string; onChange: (value: T) => void; testId?: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" data-testid={testId}>
      {options.map((one) => (
        <button
          key={one}
          type="button"
          aria-pressed={value === one}
          onClick={() => onChange(one)}
          data-value={one}
          className={cn(
            "h-7 rounded-md border px-2 text-xs font-medium transition-colors",
            value === one ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {label(one)}
        </button>
      ))}
    </div>
  );
}

