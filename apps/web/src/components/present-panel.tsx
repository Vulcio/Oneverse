import { lyricSlides, stepSlide, structureOf, type RenderedChart, type SyncPresenting } from "@songverse/core";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, MonitorOff, MonitorUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { publishPresenting, screensLocked, useSync } from "#/lib/sync-client";
import { cn } from "@songverse/ui/lib/utils";

/** After a step back past a song's first slide: the previous song opens on its last. */
let openOnLastSlide = false;

/**
 * Presenting a set on its screens (issue #186), at the bottom of Live for
 * the device leading its sync session: the slide the screens show, Previous
 * and Next (and the down and up arrows, or a pedal's Page Down and Up),
 * which go on to the next or previous song at either end, and Black. The
 * screens cut the song into the same slides (lyricSlides), so only "this
 * song, slide N" is sent.
 */
export function PresentPanel({
  setId,
  itemId,
  chart,
  next,
  previous,
  onSlidePass,
}: {
  setId: string;
  itemId: string;
  chart: RenderedChart | null;
  next: (() => void) | null;
  previous: (() => void) | null;
  /** The chart scrolled to the pass a slide's from. */
  onSlidePass: (passId: string) => void;
}) {
  const { t } = useTranslation();
  const sync = useSync();
  const confirmed = sync.setId === setId && sync.leading ? (sync.session?.presenting ?? null) : null;
  // What was last sent, until the session says so (or otherwise): a pedal pressed twice quickly goes two slides on.
  const [sent, setSent] = useState<SyncPresenting | null>(null);
  useEffect(() => {
    // Dropped once the session has it (an echo of something else - the song changing - isn't it), or once nobody's presenting.
    if (!confirmed || (sent && confirmed.itemId === sent.itemId && confirmed.slide === sent.slide && confirmed.black === sent.black)) setSent(null);
  }, [confirmed]);
  const presenting = confirmed ? (sent ?? confirmed) : null;
  const show = (next: SyncPresenting) => {
    setSent(next);
    publishPresenting(next);
  };
  const slides = useMemo(() => (chart ? lyricSlides(chart) : []), [chart]);
  const steps = useMemo(() => (chart ? structureOf(chart) : []), [chart]);
  const screens = sync.setId === setId ? sync.members.filter((member) => member.screen) : [];
  // A media operator running the screens alone (issue #275): this Live shows what's on them, and waits.
  const locked = screensLocked(sync);

  // Another song opened while presenting: its first slide (its last, stepping back), as black or not as it was.
  useEffect(() => {
    if (!presenting || presenting.itemId === itemId) return;
    const slide = openOnLastSlide ? Math.max(0, slides.length - 1) : 0;
    openOnLastSlide = false;
    show({ itemId, slide, black: presenting.black });
  }, [presenting?.itemId, itemId, slides.length]);

  const slide = presenting && presenting.itemId === itemId ? Math.min(presenting.slide, Math.max(0, slides.length - 1)) : 0;
  const current = slides[slide];

  // The chart follows the slide.
  const lastPass = useRef<string | null>(null);
  useEffect(() => {
    if (!presenting || !current || lastPass.current === current.passId) return;
    lastPass.current = current.passId;
    onSlidePass(current.passId);
  }, [presenting, current?.passId]);

  function go(by: 1 | -1) {
    if (!presenting) return;
    const to = stepSlide(slides.length, slide, by);
    if (to !== null) return show({ ...presenting, itemId, slide: to });
    if (by > 0) next?.();
    else if (previous) {
      openOnLastSlide = true;
      previous();
    }
  }

  // Keys and page-turner pedals, while presenting: down or Page Down for the next slide, up or Page Up for the one before.
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (!presenting || locked) return;
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]") || document.querySelector("[role=dialog]")) return;
      if (event.key === "ArrowDown" || event.key === "PageDown") goRef.current(1);
      else if (event.key === "ArrowUp" || event.key === "PageUp") goRef.current(-1);
      else return;
      // Before Live's own keys (which would scroll the chart): this is capture.
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [!!presenting, locked]);

  if (!presenting) return null;
  const firstOf = (passId: string) => slides.findIndex((one) => one.passId === passId);

  return (
    <section className="flex shrink-0 flex-col gap-2 border-t-2 border-t-primary bg-card px-2 py-2 sm:px-4" aria-label={t("screens.presenting")} data-testid="present-panel" data-slide={slide} data-black={String(presenting.black)}>
      {locked ? (
        <p className="text-xs text-muted-foreground" data-testid="present-locked">
          {t("screens.operator.lockedBy", { name: sync.session?.screens?.name })}
        </p>
      ) : null}
      <fieldset disabled={locked} className="contents">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" className="size-12 shrink-0" onClick={() => go(-1)} aria-label={t("screens.previousSlide")} data-testid="present-previous">
          <ChevronLeft />
        </Button>
        {/* What the screens show now. */}
        <div className={cn("min-w-0 flex-1 rounded-md border px-3 py-1.5", presenting.black && "bg-neutral-950 text-neutral-500")} data-testid="present-slide">
          <p className="truncate text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
            {presenting.black ? t("screens.black") : `${t("screens.slideOf", { slide: slide + 1, count: slides.length })}${screens.length ? ` · ${t("screens.screenCount", { count: screens.length })}` : ` · ${t("screens.noScreens")}`}`}
          </p>
          {current && current.lines.length ? (
            current.lines.map((line, index) => (
              <p key={index} className="truncate text-sm leading-snug">
                {line}
              </p>
            ))
          ) : (
            <p className="truncate text-sm leading-snug text-muted-foreground italic">{t("screens.noWords")}</p>
          )}
        </div>
        <Button
          type="button"
          variant={presenting.black ? "default" : "outline"}
          size="icon"
          className="size-12 shrink-0"
          aria-pressed={presenting.black}
          onClick={() => show({ ...presenting, itemId, slide, black: !presenting.black })}
          aria-label={t("screens.blackButton")}
          title={t("screens.blackButton")}
          data-testid="present-black"
        >
          <MonitorOff />
        </Button>
        <Button type="button" size="icon" className="size-12 shrink-0" onClick={() => go(1)} aria-label={t("screens.nextSlide")} data-testid="present-next">
          <ChevronRight />
        </Button>
      </div>
      </fieldset>
      {/* The song's sections, to jump to one: V1 C V2 C B C. */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {steps.map((step) => {
          const first = firstOf(step.passId);
          if (first < 0) return null;
          const name = `${t(`chart.sections.${step.type}`)}${step.number ? ` ${step.number}` : ""}`;
          const here = current?.passId === step.passId;
          return (
            <button
              key={step.passId}
              type="button"
              className={cn("h-7 min-w-8 shrink-0 rounded-full border px-2 text-xs font-semibold", here ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
              disabled={locked}
              onClick={() => show({ ...presenting, itemId, slide: first, black: false })}
              aria-label={t("live.goToPass", { name })}
              aria-current={here ? "step" : undefined}
              data-testid="present-section"
            >
              {t(`live.short.${step.type}`)}
              {step.number ?? ""}
            </button>
          );
        })}
        <Link to="/screens" search={{ setlistId: setId }} className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:underline" data-testid="present-add-screen">
          <MonitorUp className="size-3.5" />
          {t("screens.manage")}
        </Link>
      </div>
    </section>
  );
}
