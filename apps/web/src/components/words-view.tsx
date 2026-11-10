import { barAt, barBeatPlaces, chartBars, evenScreenLine, passName, structureOf, sungAtPosition, type EffectiveDisplaySettings, type RenderedChart, type SongDocumentV2, type StructureGroup } from "@oneverse/core";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useBarsClock } from "#/lib/bars-clock";
import { keepInView } from "#/lib/follow-view";
import { useRegisterWordsView } from "#/lib/words-view";
import { cn } from "@oneverse/ui/lib/utils";

type WordsSettings = EffectiveDisplaySettings["words"];

/** A line to sing, its spaces evened out (as a lyrics screen shows it, so the music's place in it matches), its chords with it. */
interface WordsLine {
  key: string;
  lineId: string;
  text: string;
  chords: { at: number; label: string }[];
}

/** What the view shows for a pass of the song, in the order it's sung. */
interface WordsBlock {
  key: string;
  passId: string;
  passIndex: number;
  name: string;
  group: StructureGroup;
  /** Its own note (the arrangement's), and notes written in its lines. */
  notes: string[];
  /** Words: its lines; instrumental: its bars; again: a section sung before, its first words as a reminder (Repeats: once). */
  kind: "words" | "instrumental" | "again";
  lines: WordsLine[];
  bars: number;
  /** Sung this many times straight on (Repeats: once): ×2. */
  times: number;
}

/** Each block's place for the music: the block a pass is shown in (a pass merged into the one before it, Repeats: once). */
interface WordsModel {
  blocks: WordsBlock[];
  shownIn: number[];
  /** Every line and every block without words, in order: what Line by line steps through. */
  items: { key: string; block: number; line: WordsLine | null }[];
}

const BADGES: Record<StructureGroup, string> = {
  edge: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  verse: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  chorus: "bg-amber-400/20 text-amber-800 dark:text-amber-200",
  bridge: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  instrumental: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  other: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};

/** The song's passes as the Words view shows them (issue #416): its words, the parts without any, the repeats written out or once. */
export function wordsModel(chart: RenderedChart, document: Pick<SongDocumentV2, "sections"> | null | undefined, repeats: WordsSettings["repeats"], typeName: (type: string) => string): WordsModel {
  const bars = chartBars(chart, document);
  const steps = structureOf(chart);
  const blocks: WordsBlock[] = [];
  const shownIn: number[] = [];
  // A section's words, by section, as first shown: a pass that sings them again unchanged is a repeat.
  const firstWords = new Map<string, string>();
  chart.passes.forEach((pass, passIndex) => {
    const lines: WordsLine[] = pass.lines
      .filter((line) => line.kind !== "note" && line.text.trim() !== "")
      .map((line) => {
        const even = evenScreenLine(line.id, line.text, line.chords);
        return { key: `${passIndex}:${line.id}`, lineId: line.id, text: even.text, chords: even.chords.map((one) => ({ at: one.at, label: one.chord.label })) };
      });
    const notes = [pass.note, ...pass.lines.filter((line) => line.kind === "note" && line.text.trim() !== "").map((line) => line.text.trim()), ...pass.lines.flatMap((line) => (line.note ? [line.note] : []))].filter((note): note is string => !!note);
    const name = passName(pass, pass.section, pass.section.number, typeName) || typeName(pass.section.type);
    const words = lines.map((line) => line.text).join("\n");
    const previous = blocks.at(-1);
    const repeat = repeats === "once" && lines.length > 0 && !pass.changed && !pass.differs && !pass.partial && firstWords.get(pass.section.id) === words;
    if (repeat && previous && previous.kind === "words" && chart.passes[previous.passIndex]?.section.id === pass.section.id) {
      previous.times += 1;
      shownIn.push(blocks.length - 1);
      return;
    }
    if (!firstWords.has(pass.section.id) && lines.length > 0) firstWords.set(pass.section.id, words);
    shownIn.push(blocks.length);
    blocks.push({
      key: pass.id,
      passId: pass.id,
      passIndex,
      name,
      group: steps[passIndex]?.group ?? "other",
      notes,
      kind: lines.length === 0 ? "instrumental" : repeat ? "again" : "words",
      lines: repeat ? lines.slice(0, 1) : lines,
      bars: bars.filter((bar) => bar.passIndex === passIndex).length,
      times: 1,
    });
  });
  const items = blocks.flatMap<WordsModel["items"][number]>((block, index) => (block.kind === "words" ? block.lines.map((line) => ({ key: `L:${line.key}`, block: index, line })) : [{ key: `B:${block.key}`, block: index, line: null }]));
  return { blocks, shownIn, items };
}

/**
 * A song's words laid out for singers (issue #416): big, without chords
 * unless asked, in the order they're sung, section names as small badges,
 * the parts without words as one quiet line. Following the music (the beats
 * placed in the words, issue #339), the line being sung stands out and its
 * words fill as they're sung, the lines sung dim, and the next section is
 * cued at the bottom. Line by line shows the line being sung and the next
 * ones, big - stepped through with a tap when nothing plays.
 */
export function WordsView({
  songId,
  chart,
  document,
  settings,
  currentPass,
  zoom = 1,
  live = false,
  emptyText,
}: {
  songId: string;
  chart: RenderedChart;
  document?: Pick<SongDocumentV2, "sections"> | null;
  settings: WordsSettings;
  /** The pass being read, by the page's scroll (for the next section's cue) when the music doesn't say. */
  currentPass?: string | null;
  /** The zoom the view is already under (Live's text size): its own size replaces it. */
  zoom?: number;
  /** In Live: its cue sits at the bottom of Live's scroll, not over a docked player. */
  live?: boolean;
  emptyText: string;
}) {
  const { t } = useTranslation();
  useRegisterWordsView();
  const typeName = (type: string) => t(`chart.sections.${type}`);
  const model = useMemo(() => wordsModel(chart, document, settings.repeats, typeName), [chart, document, settings.repeats, t]);
  const bars = useMemo(() => chartBars(chart, document), [chart, document]);
  const places = useMemo(() => barBeatPlaces(chart, bars), [chart, bars]);
  const { position } = useBarsClock(songId, bars);
  const root = useRef<HTMLDivElement>(null);
  // What the music has reached: the item (line, or block without words) being sung.
  const [now, setNow] = useState<string | null>(null);
  // Line by line, nothing playing: where the reader is, a tap at a time.
  const [cursor, setCursor] = useState(0);
  useEffect(() => setCursor(0), [songId]);

  useEffect(() => {
    if (!position) {
      setNow(null);
      return;
    }
    let last: string | null = null;
    let lastWords: HTMLElement[] = [];
    let frame = requestAnimationFrame(function tick() {
      const at = position();
      const sung = sungAtPosition(chart, bars, places, at);
      const where = barAt(bars, at);
      const shownBlock = (passIndex: number) => model.blocks[model.shownIn[passIndex] ?? -1];
      let key: string | null = null;
      if (where) {
        const block = shownBlock(bars[where.bar]!.passIndex);
        // A part without words, or sung again as a reminder: the block itself.
        if (block && block.kind !== "words") key = `B:${block.key}`;
        else if (sung) {
          const shown = shownBlock(sung.passIndex);
          if (shown?.kind === "words") key = `L:${shown.passIndex}:${sung.lineId}`;
        }
        // Between two lines: the one sung last.
        key ??= last;
      }
      if (key !== last) {
        last = key;
        setNow(key);
      }
      // Its words filled as far as they're sung.
      if (settings.fill && sung && key?.startsWith("L:")) {
        const words = [...(root.current?.querySelectorAll<HTMLElement>(`[data-item="${CSS.escape(key)}"] [data-from]`) ?? [])];
        for (const word of lastWords) if (!words.includes(word)) word.style.removeProperty("--f");
        for (const word of words) {
          const from = Number(word.dataset.from);
          const to = Number(word.dataset.to);
          const filled = `${Math.round(Math.max(0, Math.min(1, (sung.at - from) / Math.max(1, to - from))) * 100)}%`;
          if (word.style.getPropertyValue("--f") !== filled) word.style.setProperty("--f", filled);
        }
        lastWords = words;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      for (const word of lastWords) word.style.removeProperty("--f");
    };
  }, [position, chart, bars, places, model, settings.fill]);

  const nowIndex = now ? model.items.findIndex((item) => item.key === now) : -1;
  const following = nowIndex >= 0;
  const lines = settings.layout === "lines";
  const at = lines ? (following ? nowIndex : Math.min(cursor, model.items.length - 1)) : nowIndex;

  // The line sung kept in view, in the middle of what's left above the player.
  useEffect(() => {
    if (lines || nowIndex < 0) return;
    const element = root.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(model.items[nowIndex]!.key)}"]`);
    if (element) keepInView(element);
  }, [nowIndex, lines, model]);

  if (model.blocks.length === 0) return <p className="text-muted-foreground">{emptyText}</p>;

  // The block being read: the music's, else the reader's (Line by line), else the page's scroll.
  const scrolled = currentPass ? chart.passes.findIndex((pass) => pass.id === currentPass) : -1;
  const currentBlock = at >= 0 ? model.items[at]!.block : scrolled >= 0 ? (model.shownIn[scrolled] ?? 0) : 0;
  const next = model.blocks.slice(currentBlock + 1).find((block) => block.kind !== "instrumental" || settings.instrumental) ?? null;
  const style = { fontSize: `${(1.125 * settings.size) / zoom}rem` } as CSSProperties;
  const state = (index: number) => (at < 0 ? undefined : index < at ? "sung" : index === at ? "now" : "coming");

  const label = (block: WordsBlock) =>
    settings.labels === "hidden" ? null : settings.labels === "heading" ? (
      <h3 className="text-[0.6em] font-semibold tracking-wide text-muted-foreground uppercase" data-testid="words-label">
        {block.name}
        {block.times > 1 ? ` ×${block.times}` : ""}
      </h3>
    ) : (
      <span className={cn("self-start rounded px-1.5 py-0.5 text-[0.5em] font-semibold tracking-wide uppercase", BADGES[block.group])} data-testid="words-label">
        {block.name}
        {block.times > 1 ? ` ×${block.times}` : ""}
      </span>
    );

  const lineText = (line: WordsLine, itemKey: string, now: boolean) => (
    <WordsText line={line} chords={settings.chords} fill={settings.fill && now && following} key={itemKey} />
  );

  return (
    <div ref={root} className="flex flex-col" style={style} data-testid="words-view" data-layout={settings.layout} data-following={following ? "" : undefined}>
      {lines ? (
        <LineByLine
          model={model}
          at={at}
          following={following}
          label={label}
          lineText={lineText}
          instrumental={settings.instrumental}
          onStep={(step) => setCursor((before) => Math.max(0, Math.min(model.items.length - 1, (following ? nowIndex : before) + step)))}
        />
      ) : (
        <div className="flex flex-col gap-[1em]">
          {model.blocks.map((block, blockIndex) => {
            if (block.kind === "instrumental" && !settings.instrumental) return null;
            const items = model.items.flatMap((item, index) => (item.block === blockIndex ? [{ ...item, index }] : []));
            const blockState = block.kind === "words" ? undefined : state(items[0]!.index);
            if (blockState === "sung" && settings.sung === "hide") return null;
            return (
              <section
                key={block.key}
                data-pass={block.passId}
                data-kind={block.kind}
                data-item={block.kind === "words" ? undefined : `B:${block.key}`}
                data-sung={blockState}
                className={cn("flex flex-col gap-[0.25em] transition-opacity", blockState === "sung" && "opacity-40")}
                data-testid="words-block"
              >
                {block.kind === "words" ? (
                  <>
                    {label(block)}
                    {block.notes.map((note, index) => (
                      <p key={index} className="text-[0.6em] text-muted-foreground italic">
                        {note}
                      </p>
                    ))}
                    {items.map((item) => {
                      const sung = state(item.index);
                      if (sung === "sung" && settings.sung === "hide") return null;
                      return (
                        <p
                          key={item.key}
                          data-item={item.key}
                          data-sung={sung}
                          className={cn(
                            "leading-snug font-medium transition-[opacity,color]",
                            sung === "sung" && "opacity-40",
                            sung === "now" && "font-bold text-foreground",
                            sung === "coming" && "text-foreground/85",
                          )}
                          data-testid="words-line"
                        >
                          {lineText(item.line!, item.key, sung === "now")}
                        </p>
                      );
                    })}
                  </>
                ) : (
                  <div className={cn("flex flex-wrap items-center gap-x-[0.5em] gap-y-1 text-muted-foreground", blockState === "now" && "text-foreground")} data-testid={block.kind === "again" ? "words-again" : "words-instrumental"}>
                    {label(block)}
                    {block.kind === "again" ? (
                      <span className="text-[0.7em]">
                        {t("words.again")} <span className="italic">{block.lines[0]?.text}…</span>
                      </span>
                    ) : (
                      <span className="text-[0.7em]">{block.bars > 0 ? t("words.instrumentalBars", { count: block.bars }) : t("words.instrumental")}</span>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {settings.next && next ? (
        <div className={cn("sticky z-10 mt-[1em] pt-2", live ? "bottom-0" : "bottom-(--stem-dock-height,0px)")}>
          <div className="flex flex-col gap-0.5 rounded-lg border bg-background/95 px-3 py-2 text-[0.6em] shadow-sm backdrop-blur" data-testid="words-next">
            <span className="text-muted-foreground">
              <span className="font-semibold tracking-wide uppercase">{t("words.next")}</span> · {next.name}
              {next.kind === "instrumental" && next.bars > 0 ? ` · ${t("words.instrumentalBars", { count: next.bars })}` : ""}
            </span>
            {next.lines[0] ? <span className="truncate font-medium">{next.lines[0].text}…</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Line by line: the line before, faint; the line being sung, big; the next two. */
function LineByLine({
  model,
  at,
  following,
  label,
  lineText,
  instrumental,
  onStep,
}: {
  model: WordsModel;
  at: number;
  following: boolean;
  label: (block: WordsBlock) => ReactNode;
  lineText: (line: WordsLine, key: string, now: boolean) => ReactNode;
  instrumental: boolean;
  onStep: (step: number) => void;
}) {
  const { t } = useTranslation();
  const shown = model.items.map((item, index) => ({ ...item, index })).filter((item) => item.line || instrumental || model.blocks[item.block]!.kind === "again");
  const here = Math.max(0, shown.findIndex((item) => item.index >= at));
  const visible = shown.slice(Math.max(0, here - 1), here + 3);
  const current = shown[here];
  const block = current ? model.blocks[current.block]! : null;
  return (
    <div className="flex min-h-[50vh] flex-col gap-[0.5em]" data-testid="words-lines">
      {block ? label(block) : null}
      {visible.map((item) => {
        const role = item.index < (current?.index ?? 0) ? "before" : item.index === current?.index ? "now" : "after";
        const itemBlock = model.blocks[item.block]!;
        const text = item.line ? lineText(item.line, item.key, role === "now") : itemBlock.kind === "again" ? `${itemBlock.name} · ${t("words.again")} ${itemBlock.lines[0]?.text ?? ""}…` : itemBlock.bars > 0 ? `${itemBlock.name} · ${t("words.instrumentalBars", { count: itemBlock.bars })}` : itemBlock.name;
        return (
          <p
            key={item.key}
            data-item={item.key}
            data-sung={role === "before" ? "sung" : role === "now" ? "now" : "coming"}
            className={cn("leading-snug transition-all", role === "before" && "text-[0.8em] text-muted-foreground/60", role === "now" && "text-[1.35em] font-bold", role === "after" && "font-medium text-foreground/80", !item.line && "text-muted-foreground italic")}
            data-testid="words-line"
          >
            {text}
          </p>
        );
      })}
      {following ? null : (
        <div className="mt-[0.5em] flex gap-2">
          <button type="button" onClick={() => onStep(-1)} disabled={here <= 0} className="flex size-11 items-center justify-center rounded-full border text-muted-foreground disabled:opacity-40" aria-label={t("words.previousLine")} data-testid="words-previous">
            <ChevronUp className="size-5" />
          </button>
          <button type="button" onClick={() => onStep(1)} disabled={here >= shown.length - 1} className="flex size-11 items-center justify-center rounded-full border text-muted-foreground disabled:opacity-40" aria-label={t("words.nextLine")} data-testid="words-forward">
            <ChevronDown className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}

/** A line's words, each its own element with its place (to fill as it's sung), under their chords when asked. */
function WordsText({ line, chords, fill }: { line: WordsLine; chords: boolean; fill: boolean }) {
  const words = (from: number, to: number) => {
    const out: ReactNode[] = [];
    const piece = line.text.slice(from, to);
    let offset = from;
    for (const token of piece.split(/(\s+)/)) {
      const start = offset;
      offset += token.length;
      if (!token) continue;
      if (!/\S/.test(token)) out.push(token);
      else
        out.push(
          <span key={start} data-from={start} data-to={offset} style={fill ? FILL : undefined}>
            {token}
          </span>,
        );
    }
    return out;
  };
  if (!chords || line.chords.length === 0) return <>{words(0, line.text.length)}</>;
  // Cut where each chord sits: each piece of words under its chord.
  const cuts = [...new Set([0, ...line.chords.map((chord) => chord.at)])].sort((a, b) => a - b);
  return (
    <>
      {cuts.map((from, index) => {
        const to = cuts[index + 1] ?? line.text.length;
        const chord = line.chords.filter((one) => one.at === from).map((one) => one.label).join(" ");
        return (
          <span key={from} className="inline-flex flex-col whitespace-pre-wrap">
            <span className="min-h-[1.1em] pr-[0.3em] text-[0.55em] leading-none font-semibold text-primary" data-testid="words-chord">
              {chord}
            </span>
            <span>{words(from, to)}</span>
          </span>
        );
      })}
    </>
  );
}

/** A word filled from the left as far as it's sung (`--f`, set frame by frame). */
const FILL: CSSProperties = {
  backgroundImage: "linear-gradient(90deg, var(--color-foreground) var(--f, 0%), color-mix(in oklab, var(--color-foreground) 40%, transparent) var(--f, 0%))",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};
