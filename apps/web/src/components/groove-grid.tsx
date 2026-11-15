import { GROOVE_DRUMS, type ChartBar, type DrumsBeat, type GrooveBar, type GrooveDrum } from "@oneverse/core";
import { Drum } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@oneverse/ui/lib/utils";
import { useGrooveOptions } from "#/lib/metronome-engine";

/** The compact line's three rows: what keeps the time, the backbeat, the kick. */
const LINE: { label: string; drums: GrooveDrum[] }[] = [
  { label: "H", drums: ["hihat", "openHihat", "ride", "crash"] },
  { label: "S", drums: ["snare", "rim"] },
  { label: "K", drums: ["kick"] },
];

/** A hit's mark, its size by how hard: an accent, a hit, a ghost note. */
function Mark({ char, lit }: { char: string | undefined; lit: boolean }) {
  if (!char || char === ".") return null;
  return <span className={cn("block rounded-full", char === "X" ? "size-3.5 sm:size-4" : char === "x" ? "size-2.5 sm:size-3" : "size-1.5 sm:size-2", lit ? "bg-amber-400" : "bg-foreground/70")} />;
}

/**
 * The groove being played, in the Drums view (issue #105): its style and
 * variation, the bar's pattern as a grid (a row per drum, a column per step,
 * the beat being played lit), or kick, snare and hi-hat on one compact line;
 * a fill when it comes, and what the next section plays.
 */
export function GrooveGrid({ grooves, bars, beat, current, nextPass }: { grooves: readonly (GrooveBar | null)[]; bars: readonly ChartBar[]; beat: DrumsBeat | null; current: number; nextPass: number | null }) {
  const { t } = useTranslation();
  const { look, play } = useGrooveOptions();
  const firstOf = (pass: number) => bars.find((bar) => bar.passIndex === pass)?.index ?? -1;
  const barIndex = beat?.bar ?? firstOf(current);
  const groove = barIndex >= 0 ? (grooves[barIndex] ?? null) : null;
  const nextBar = nextPass === null ? -1 : firstOf(nextPass);
  const nextGroove = nextBar >= 0 ? (grooves[nextBar] ?? null) : null;
  if (!groove && !nextGroove) return null;
  const nameOf = (one: GrooveBar) => `${t(`grooves.styles.${one.style.id}`)} · ${t(`grooves.variants.${one.variant}`)}`;

  const stepsPerBeat = groove ? groove.style.steps / groove.style.timeSignature.numerator : 1;
  const lit = (step: number) => !!beat && !beat.countIn && beat.bar === barIndex && Math.floor(step / stepsPerBeat) === beat.beat;
  const steps = groove ? Array.from({ length: groove.style.steps }, (_, step) => step) : [];
  const rows = groove
    ? look === "line"
      ? LINE.map((line) => ({ label: line.label, chars: steps.map((step) => strongest(line.drums.map((drum) => groove.rows[drum]?.[step]))) }))
      : GROOVE_DRUMS.filter((drum) => groove.rows[drum]?.replaceAll(".", "")).map((drum) => ({ label: t(`grooves.drums.${drum}`), chars: steps.map((step) => groove.rows[drum]?.[step]) }))
    : [];

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-foreground/10 bg-background/40 p-3 sm:p-4" data-testid="drums-groove" data-look={look} data-fill={groove?.fill || undefined}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Drum className="size-5 text-muted-foreground" aria-hidden />
        <span className="text-lg font-bold" data-testid="drums-groove-name">
          {groove ? nameOf(groove) : t("grooves.noneHere")}
        </span>
        {groove?.fill ? <span className="rounded-md bg-amber-400 px-2 py-0.5 text-sm font-bold text-amber-950">{t("grooves.fill")}</span> : null}
        {!play ? <span className="text-sm text-muted-foreground">{t("grooves.muted")}</span> : null}
        {nextGroove && (!groove || nameOf(nextGroove) !== nameOf(groove)) ? (
          <span className="ml-auto text-sm text-muted-foreground" data-testid="drums-groove-next">
            {t("grooves.next", { groove: nameOf(nextGroove) })}
          </span>
        ) : null}
      </div>
      {groove ? (
        <div className="grid items-center gap-x-1 gap-y-1.5" style={{ gridTemplateColumns: `minmax(1.5rem, max-content) repeat(${steps.length}, minmax(0, 1fr))` }} aria-hidden="true">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <span className="truncate pr-1 text-xs font-semibold text-muted-foreground">{row.label}</span>
              {row.chars.map((char, step) => (
                <span key={step} className={cn("flex h-6 items-center justify-center rounded-sm sm:h-7", step % stepsPerBeat === 0 ? "bg-foreground/10" : "bg-foreground/5", lit(step) && "bg-amber-400/25")} data-lit={lit(step) || undefined}>
                  <Mark char={char} lit={lit(step)} />
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The hardest of a step's hits, for the compact line. */
function strongest(chars: (string | undefined)[]): string | undefined {
  return chars.includes("X") ? "X" : chars.includes("x") ? "x" : chars.includes("o") ? "o" : undefined;
}
