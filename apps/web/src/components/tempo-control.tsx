import { clampTempo, MAX_TEMPO, MIN_TEMPO, type TempoUnit } from "@oneverse/core";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Input } from "@oneverse/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@oneverse/ui/components/popover";
import { cn } from "@oneverse/ui/lib/utils";
import { tempoText } from "#/lib/tempo-unit";

/**
 * A song's tempo where it's played (issue #382): its BPM, a tap away from
 * slower, faster or typed - for oneself in Practice, for everyone in a set
 * - and back to the song's own whenever. The song itself never changes.
 * `onChange(null)` goes back to the song's.
 */
export function TempoControl({
  tempo,
  songTempo,
  tempoUnit,
  timeSignature,
  hint,
  onChange,
  className,
  testId = "tempo-control",
}: {
  /** What plays: the song's, or the one chosen here. */
  tempo: number | null;
  /** The song's own (its arrangement's in a set). */
  songTempo: number | null;
  tempoUnit: TempoUnit | null | undefined;
  timeSignature: { numerator: number; denominator: number } | null | undefined;
  /** Whose it is: "Yours, for practising", "This set's". */
  hint: string;
  /** Null when it can't be changed here: the tempo shows, as text. */
  onChange: ((tempo: number | null) => void) | null;
  className?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(String(tempo ?? songTempo ?? 100));
  const changed = tempo !== null && tempo !== songTempo;
  useEffect(() => setTyped(String(tempo ?? songTempo ?? 100)), [tempo, songTempo]);
  // Saved a moment after the last tap: a few taps on + are one change.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const current = shown ?? tempo ?? songTempo;
  const change = (next: number | null) => {
    if (!onChange) return;
    setShown(next ?? songTempo);
    setTyped(String(next ?? songTempo ?? 100));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onChange(next === songTempo ? null : next);
      setShown(null);
    }, 400);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const label = current ? tempoText(current, tempoUnit, timeSignature) : t("tempo.none");

  if (!onChange) return current ? <span className={className} data-testid={testId}>{label}</span> : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn("inline-flex items-center gap-1 rounded-sm underline decoration-dotted underline-offset-4 hover:text-foreground", changed && "text-primary", className)}
            aria-label={t("tempo.change", { tempo: label })}
            data-testid={testId}
            data-tempo={current ?? undefined}
            data-changed={changed || undefined}
          />
        }
      >
        {label}
        {changed ? <span className="size-1.5 rounded-full bg-primary" aria-hidden /> : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-3" data-testid={`${testId}-panel`}>
        <p className="text-sm font-medium">{t("tempo.title")}</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" onClick={() => change(clampTempo((current ?? 100) - 1))} disabled={(current ?? 100) <= MIN_TEMPO} aria-label={t("tempo.slower")} data-testid={`${testId}-slower`}>
            <Minus />
          </Button>
          <Input
            type="number"
            inputMode="numeric"
            min={MIN_TEMPO}
            max={MAX_TEMPO}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={() => {
              const value = Number(typed);
              if (typed.trim() && Number.isFinite(value) && clampTempo(value) !== current) change(clampTempo(value));
              else setTyped(String(current ?? 100));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="w-20 text-center text-lg tabular-nums"
            aria-label={t("tempo.title")}
            data-testid={`${testId}-input`}
          />
          <Button type="button" variant="outline" size="icon" onClick={() => change(clampTempo((current ?? 100) + 1))} disabled={(current ?? 100) >= MAX_TEMPO} aria-label={t("tempo.faster")} data-testid={`${testId}-faster`}>
            <Plus />
          </Button>
          <span className="text-sm text-muted-foreground">BPM</span>
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
        {songTempo && current !== songTempo ? (
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => change(null)} data-testid={`${testId}-reset`}>
            <RotateCcw />
            {t("tempo.reset", { tempo: songTempo })}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
