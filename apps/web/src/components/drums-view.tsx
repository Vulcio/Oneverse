import { chartBars, drumsSections, drumsWordsAt, passName, type EffectiveDisplaySettings, type RenderedChart, type SongDocumentV2 } from "@oneverse/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@oneverse/ui/lib/utils";
import { BeatColumns } from "#/components/metronome-display";
import { useBeatLevels, useRegisterDrumsView, useSongBeat } from "#/lib/song-beat";

/** Behind the Drums view the beat is the whole background: never so faint it can't be read from behind a kit. */
const DRUMS_BRIGHTNESS = 0.45;

/**
 * What a drummer needs (issue #107), readable from behind a kit: the whole
 * background is the metronome, one column per beat lit in its level's colour
 * (issue #443); the song's sections as big badges, the one being played
 * marked with its bar; the tempo and time signature big, with the beat
 * counted; the words being sung and the next line; the band's notes; and
 * the next section coming up. It follows the music when the song's bars do
 * (the stems, the metronome, the Sync leader); otherwise Next section, or a
 * pedal's page keys, step through the sections.
 */
export function DrumsView({ songId, chart, document, settings, live = false }: { songId: string; chart: RenderedChart; document: Pick<SongDocumentV2, "sections"> | null | undefined; settings: EffectiveDisplaySettings; live?: boolean }) {
  const { t } = useTranslation();
  useRegisterDrumsView();
  const bars = useMemo(() => chartBars(chart, document), [chart, document]);
  const sections = useMemo(() => drumsSections(chart, bars), [chart, bars]);
  const beat = useSongBeat(songId, bars);
  const [manual, setManual] = useState(0);
  useEffect(() => setManual(0), [songId]);
  const following = !!beat;
  const current = beat ? (beat.passIndex ?? 0) : Math.min(manual, Math.max(0, sections.length - 1));
  const section = sections[current];
  const next = sections[current + 1] ?? null;
  const timeSignature = chart.passes[current]?.timeSignature ?? chart.timeSignature;
  const levels = useBeatLevels(beat?.beats ?? timeSignature?.numerator ?? 4, timeSignature?.denominator ?? 4);
  const words = settings.drums.words ? drumsWordsAt(chart, bars, beat?.bar ?? null, current) : null;
  const typeName = (type: string) => t(`chart.sections.${type}`);
  const nameOf = (index: number) => {
    const pass = chart.passes[index];
    const one = sections[index];
    if (!pass || !one) return "";
    return passName(pass, pass.section, pass.section.number, typeName) ?? `${typeName(one.type)}${one.number ? ` ${one.number}` : ""}`;
  };
  const step = (by: number) => setManual((at) => Math.max(0, Math.min(sections.length - 1, Math.min(at, sections.length - 1) + by)));

  // A pedal's page keys step through the sections when the music doesn't say where it is; before Live's own keys.
  useEffect(() => {
    if (following) return;
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      if (document_().querySelector("[role=dialog]")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "PageDown" || event.key === "ArrowDown") step(1);
      else if (event.key === "PageUp" || event.key === "ArrowUp") step(-1);
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [following, sections.length]);

  if (sections.length === 0) return <p className="text-muted-foreground">{t("sets.noChart")}</p>;
  const barText = beat?.countIn ? t("drums.countIn") : section && section.bars > 0 && beat ? t("drums.bar", { bar: beat.barInPass, bars: section.bars }) : section && section.bars > 0 ? t("drums.bars", { count: section.bars }) : null;

  return (
    <section
      className={cn("relative isolate flex flex-col overflow-hidden rounded-xl bg-zinc-950 text-zinc-50 max-sm:-mx-(--gutter) max-sm:rounded-none", live ? "min-h-[calc(100dvh-14rem)]" : "min-h-[70vh]")}
      aria-label={t("drums.label")}
      data-testid="drums-view"
      data-following={following || undefined}
      data-current={section?.passId}
    >
      <BeatColumns levels={levels} beat={beat} brightness={Math.max(DRUMS_BRIGHTNESS, settings.metronome.brightness)} lightUp={settings.metronome.lightUp} labels className="absolute inset-0 -z-10 gap-1.5 px-1.5" />

      <div className="flex flex-1 flex-col gap-3 p-3 sm:gap-4 sm:p-5">
        {/* The song's sections, the one being played marked; a tap goes there when the music doesn't say. */}
        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label={t("live.structure")}>
          {sections.map((one, index) => {
            const isCurrent = index === current;
            return (
              <button
                key={one.passId}
                type="button"
                onClick={() => setManual(index)}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={t("live.goToPass", { name: nameOf(index) })}
                className={cn(
                  "flex min-w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 transition-colors sm:min-w-20 sm:py-3",
                  isCurrent ? "bg-zinc-50 text-zinc-950" : "border-2 border-zinc-50/25 bg-zinc-950/80",
                  index < current && "opacity-45",
                )}
                data-testid="drums-section"
              >
                <span className="text-xl leading-none font-extrabold sm:text-2xl">
                  {t(`live.short.${one.type}`)}
                  {one.number ?? ""}
                </span>
                <span className={cn("text-xs font-semibold", isCurrent ? "text-zinc-600" : "text-zinc-400")}>{isCurrent && beat && !beat.countIn ? `${beat.barInPass}/${one.bars}` : one.bars > 0 ? t("drums.barsShort", { count: one.bars }) : "–"}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-2xl bg-zinc-950/80 p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-2xl font-bold sm:text-3xl" data-testid="drums-current">
                {nameOf(current)}
              </h3>
              {barText ? (
                <span className="text-lg text-zinc-300 tabular-nums" data-testid="drums-bar">
                  {barText}
                </span>
              ) : null}
            </div>
            {words && (words.now || words.next) ? (
              <div className="flex flex-col gap-1.5 border-t border-zinc-50/15 pt-3" data-testid="drums-words">
                {words.now ? <p className="text-2xl leading-snug font-semibold sm:text-3xl">{words.now}</p> : null}
                {words.next ? <p className="text-lg leading-snug text-zinc-400 sm:text-xl">{words.next}</p> : null}
              </div>
            ) : null}
            {section && section.notes.length > 0 ? (
              <div className="flex flex-wrap gap-2" data-testid="drums-notes">
                {section.notes.map((note, index) => (
                  <span key={index} className="rounded-lg bg-amber-400 px-3 py-1.5 text-base font-semibold text-amber-950 sm:text-lg">
                    {note}
                  </span>
                ))}
              </div>
            ) : null}
            {!following ? (
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                <button type="button" onClick={() => step(-1)} disabled={current === 0} className="flex h-12 items-center gap-1 rounded-xl border-2 border-zinc-50/30 px-3 text-base font-semibold disabled:opacity-40" aria-label={t("drums.previous")} data-testid="drums-previous">
                  <ChevronLeft className="size-5" aria-hidden />
                </button>
                <button type="button" onClick={() => step(1)} disabled={!next} className="flex h-12 items-center gap-1 rounded-xl border-2 border-dashed border-zinc-50/40 px-4 text-base font-semibold disabled:opacity-40" data-testid="drums-next">
                  {t("drums.next")}
                  <ChevronRight className="size-5" aria-hidden />
                </button>
                <span className="text-xs text-zinc-400">{t("drums.manualHint")}</span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-zinc-950/80 p-4 sm:w-64 sm:p-5" data-testid="drums-tempo">
            <span className="text-7xl leading-none font-extrabold tracking-tight tabular-nums sm:text-8xl">{chart.passes[current]?.tempo ?? chart.tempo ?? "–"}</span>
            <span className="text-base text-zinc-300">
              {t("drums.bpm")}
              {timeSignature ? ` · ${timeSignature.numerator}/${timeSignature.denominator}` : ""}
            </span>
            <div className="mt-3 flex gap-1.5" aria-hidden="true">
              {levels.map((level, index) => {
                const on = !!beat && beat.beat === index;
                return (
                  <span key={index} className={cn("w-7 text-center text-xl leading-10 font-extrabold tabular-nums", on ? (beat.countIn ? "text-amber-300" : level === "accent" ? "text-amber-400" : level === "medium" ? "text-blue-400" : "text-zinc-50") : "text-zinc-600")}>
                    {index + 1}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {settings.drums.next && next ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-zinc-950/80 px-4 py-3" data-testid="drums-next-cue">
            <span className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">{t("drums.nextLabel")}</span>
            <span className="text-xl font-bold">{nameOf(current + 1)}</span>
            {next.bars > 0 ? <span className="text-base text-zinc-400">{t("drums.bars", { count: next.bars })}</span> : null}
            {next.firstWords ? <span className="min-w-0 truncate text-base text-zinc-300">“{next.firstWords}”</span> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The page's document (the `document` prop is the song's). */
const document_ = () => globalThis.document;
