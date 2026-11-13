import { passName, type RenderedChart, type StructureGroup, type StructureStep } from "@oneverse/core";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@oneverse/ui/lib/utils";
import { passSelector } from "@oneverse/screen/components/song-chart";

/**
 * The pass being sung: the last one whose top has scrolled past the upper
 * quarter of the view (the first at the very top), following the scroll -
 * by hand or autoscroll.
 */
export function useCurrentPass(
  scroller: RefObject<HTMLElement | null>,
  steps: { passId: string }[],
  songId: string,
  /** The chart in columns (issue #177): how far it's scrolled doesn't say where the song is - the pass picked does. */
  flowed = false,
  /** Where its passes are: the song's own part of a stacked page (issue #214). */
  root: () => HTMLElement | null = () => scroller.current,
): [string | null, (passId: string) => void] {
  const [current, setCurrent] = useState<string | null>(steps[0]?.passId ?? null);
  // A pass picked in the bar stays current while it's scrolled to: near the
  // end of a song it may never reach the top, where it would count as reached.
  const picked = useRef<{ passId: string; until: number } | null>(null);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    // In columns: the song's first pass, until one's picked in the bar.
    if (flowed) {
      picked.current = null;
      setCurrent(steps[0]?.passId ?? null);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (picked.current && Date.now() < picked.current.until) return;
      picked.current = null;
      const line = element.getBoundingClientRect().top + element.clientHeight * 0.25;
      let found: string | null = steps[0]?.passId ?? null;
      for (const pass of (root() ?? element).querySelectorAll<HTMLElement>("[data-pass]")) {
        if (pass.getBoundingClientRect().top <= line) found = pass.dataset.pass ?? found;
        else break;
      }
      setCurrent(found);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scroller, steps, songId, flowed]);
  const pick = (passId: string) => {
    picked.current = { passId, until: Date.now() + 1000 };
    setCurrent(passId);
  };
  return [current, pick];
}

// A colour per kind of section: filled once reached, outlined ahead (lighter outlines on a dark theme).
const GROUP_STYLES: Record<StructureGroup, { filled: string; outlined: string }> = {
  edge: { filled: "bg-violet-500 text-white border-violet-500", outlined: "border-violet-500/70 text-violet-700 dark:border-violet-400/70 dark:text-violet-300" },
  verse: { filled: "bg-sky-500 text-white border-sky-500", outlined: "border-sky-500/70 text-sky-700 dark:border-sky-400/70 dark:text-sky-300" },
  chorus: { filled: "bg-amber-400 text-black border-amber-400", outlined: "border-amber-500/70 text-amber-800 dark:border-amber-300/70 dark:text-amber-200" },
  bridge: { filled: "bg-rose-500 text-white border-rose-500", outlined: "border-rose-500/70 text-rose-700 dark:border-rose-400/70 dark:text-rose-300" },
  instrumental: { filled: "bg-emerald-500 text-white border-emerald-500", outlined: "border-emerald-500/70 text-emerald-700 dark:border-emerald-400/70 dark:text-emerald-300" },
  other: { filled: "bg-zinc-500 text-white border-zinc-500", outlined: "border-zinc-500/70 text-zinc-700 dark:border-zinc-400/70 dark:text-zinc-300" },
};

/**
 * The song's structure (issue #68), fixed under the header: its passes in
 * order, coloured by kind, the one being sung ringed, those sung filled.
 * Tapping one goes there. Named in full - Verse 1 Chorus Verse 2 Chorus -
 * when they all fit, as everywhere (issue #344: a pass's own name, or its
 * section's); shortened to V1 C V2 C otherwise.
 */
export function StructureBar({ steps, chart, current, onPick, className }: { steps: StructureStep[]; chart: RenderedChart | null; current: string | null; onPick: (passId: string) => void; className?: string }) {
  const { t } = useTranslation();
  const bar = useRef<HTMLDivElement>(null);
  const fullRow = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(true);
  const reached = Math.max(0, steps.findIndex((step) => step.passId === current));
  const passes = useMemo(() => new Map((chart?.passes ?? []).map((pass) => [pass.id, pass])), [chart]);
  const names = steps.map((step) => {
    const pass = passes.get(step.passId);
    const typeName = (type: string) => t(`chart.sections.${type}`);
    return (pass && passName(pass, pass.section, pass.section.number, typeName)) || `${typeName(step.type)}${step.number ? ` ${step.number}` : ""}`;
  });

  // Full names when the row of them fits the bar; measured on a hidden copy, so showing one or the other doesn't flicker.
  useEffect(() => {
    const nav = bar.current;
    const row = fullRow.current;
    if (!nav || !row) return;
    const measure = () => {
      const style = getComputedStyle(nav);
      const room = nav.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setFull(row.scrollWidth <= room);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [names.join("|")]);

  // The current one kept in view, on a long song on a phone.
  useEffect(() => {
    bar.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current, full]);

  const pill = "flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full border px-1.5 text-xs font-semibold whitespace-nowrap";
  return (
    <nav ref={bar} className={cn("relative flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-2 py-2 sm:px-4", className)} aria-label={t("live.structure")} data-testid="live-structure" data-names={full ? "full" : "short"}>
      <div ref={fullRow} aria-hidden="true" className="pointer-events-none invisible absolute top-0 left-0 flex w-max gap-1.5">
        {steps.map((step, index) => (
          <span key={step.passId} className={cn(pill, "px-2.5")}>
            {names[index]}
          </span>
        ))}
      </div>
      {steps.map((step, index) => {
        const name = names[index]!;
        const style = GROUP_STYLES[step.group];
        const isCurrent = step.passId === current;
        return (
          <button
            key={step.passId}
            type="button"
            onClick={() => onPick(step.passId)}
            aria-label={t("live.goToPass", { name })}
            aria-current={isCurrent ? "step" : undefined}
            title={name}
            data-group={step.group}
            className={cn(
              pill,
              "transition-colors",
              full && "px-2.5",
              index <= reached ? style.filled : style.outlined,
              index < reached && "opacity-60",
              isCurrent && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
            )}
          >
            {full ? (
              name
            ) : (
              <>
                {t(`live.short.${step.type}`)}
                {step.number ?? ""}
              </>
            )}
          </button>
        );
      })}
    </nav>
  );
}


/**
 * The pass being read on a page that scrolls as a whole (Practice, issue
 * #416): the last one whose top is above the upper quarter of what's left
 * under the page's header (`top`, in pixels).
 */
export function usePagePass(root: RefObject<HTMLElement | null>, steps: StructureStep[], top: number): [string | null, (passId: string) => void] {
  const [current, setCurrent] = useState<string | null>(steps[0]?.passId ?? null);
  const picked = useRef<{ passId: string; until: number } | null>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (picked.current && Date.now() < picked.current.until) return;
      picked.current = null;
      const line = top + (window.innerHeight - top) * 0.25;
      let found: string | null = steps[0]?.passId ?? null;
      for (const pass of root.current?.querySelectorAll<HTMLElement>("[data-pass]") ?? []) {
        if (pass.getBoundingClientRect().top <= line) found = pass.dataset.pass ?? found;
        else break;
      }
      setCurrent(found);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [root, steps, top]);
  const pick = (passId: string) => {
    picked.current = { passId, until: Date.now() + 1000 };
    setCurrent(passId);
    const pass = root.current?.querySelector<HTMLElement>(passSelector(passId));
    if (pass) window.scrollTo({ top: pass.getBoundingClientRect().top + window.scrollY - top - 12, behavior: "smooth" });
  };
  return [current, pick];
}
