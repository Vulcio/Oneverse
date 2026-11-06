import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@oneverse/ui/lib/utils";

/*
 * A screen editor's fields (issues #194, #395, #398), in the look of the
 * #395 mockup: groups that open and close, divided by a line; segmented
 * choices; tiles with a small picture; compact fields as a design tool has.
 */

export function Group({ title, hint, open = false, testId, children }: { title: string; hint?: string; open?: boolean; testId?: string; children: ReactNode }) {
  return (
    <details open={open} className="group/field border-b last:border-b-0" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-baseline gap-2 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 self-center text-muted-foreground transition-transform group-open/field:rotate-90" aria-hidden />
        <span className="text-sm font-semibold">{title}</span>
        {hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>
    </details>
  );
}

export function Field({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-4 items-center justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function Slider({ value, min, max, step, unit = "", onChange }: { value: number; min: number; max: number; step: number; unit?: string; onChange: (value: number) => void }) {
  return (
    <div className="flex w-full items-center gap-2">
      <input type="range" className="min-w-0 flex-1 accent-primary" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {Number.isInteger(value) ? value : value.toFixed(2)}
        {unit}
      </span>
    </div>
  );
}

/** A colour's swatch, the system's picker under it. */
export function ColorInput({ value, onChange, testId, className }: { value: string; onChange: (value: string) => void; testId?: string; className?: string }) {
  return (
    <span className={cn("relative inline-block size-5 shrink-0 overflow-hidden rounded border", className)} style={{ background: value }}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute -inset-2 size-10 cursor-pointer opacity-0" aria-label={value} data-testid={testId} />
    </span>
  );
}

/** One of a few, as a segmented control; wraps when they don't fit. */
export function Choices<T extends string>({ value, options, label, onChange, testId, className }: { value: T; options: readonly T[]; label: (one: T) => ReactNode; onChange: (value: T) => void; testId?: string; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-0.5 rounded-lg border bg-muted/60 p-0.5", className)} role="group" data-testid={testId}>
      {options.map((one) => (
        <button
          key={one}
          type="button"
          aria-pressed={value === one}
          onClick={() => onChange(one)}
          data-value={one}
          className={cn(
            "h-7 min-w-fit flex-1 rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors",
            value === one ? "bg-background font-semibold text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label(one)}
        </button>
      ))}
    </div>
  );
}

/** One of several, as tiles with a small picture each (a mode, a transition); the picture moves when it's hovered or picked. */
export function Tiles<T extends string>({
  value,
  options,
  label,
  picture,
  onChange,
  columns = 3,
  testId,
}: {
  value: T | null;
  options: readonly T[];
  label: (one: T) => ReactNode;
  picture: (one: T) => ReactNode;
  onChange: (value: T) => void;
  columns?: 3 | 4 | 5;
  testId?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", { 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5" }[columns])} role="group" data-testid={testId}>
      {options.map((one) => (
        <button
          key={one}
          type="button"
          aria-pressed={value === one}
          onClick={() => onChange(one)}
          data-value={one}
          className={cn(
            "group/tile flex min-w-0 flex-col gap-1 rounded-lg border p-1 text-left transition-colors",
            value === one ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-background hover:border-primary/60",
          )}
        >
          <span className="sv-tile-pic relative block h-8 overflow-hidden rounded-md bg-zinc-900" data-on={value === one ? "" : undefined} aria-hidden>
            {picture(one)}
          </span>
          <span className="truncate px-0.5 text-[11px] leading-tight font-medium">{label(one)}</span>
        </button>
      ))}
    </div>
  );
}

/** A compact field: a small icon or label, then its control, as a design tool's properties panel has. */
export function Prop({ icon, title, className, children }: { icon?: ReactNode; title?: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("flex h-8 min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 text-xs focus-within:border-primary hover:border-primary/60", className)} title={title}>
      {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      {children}
    </label>
  );
}

/** A number in a compact field, typed or nudged with the arrows. */
export function NumberProp({ icon, title, value, min, max, step, onChange, className, testId }: { icon?: ReactNode; title: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; className?: string; testId?: string }) {
  return (
    <Prop icon={icon} title={title} className={className}>
      <input
        type="number"
        className="w-full min-w-0 bg-transparent tabular-nums outline-none"
        value={Number.isInteger(step) ? value : Number(value.toFixed(2))}
        min={min}
        max={max}
        step={step}
        aria-label={title}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
        data-testid={testId}
      />
    </Prop>
  );
}
