import { formatTimer, placeScreenWidget, readScreenTimer, SCREEN_FONT_FAMILIES, screenQrPayload, screenSlideCount, timerColors, type ScreenSlide, type ScreenTheme, type ScreenWidget, type ScreenLayersShown, type SyncTimer } from "@oneverse/core";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { renderSVG } from "uqr";
import { useTranslation } from "react-i18next";
import { cn } from "@oneverse/ui/lib/utils";

/**
 * What a screen's widgets read besides its song (issue #268): the set's next
 * song, when the item on screen came on, the operator's timer and message
 * (issue #269). Times are on the device's clock; `offset` turns it into the
 * server's, which the operator's timer is on.
 */
export interface StageLive {
  nextSong?: { title: string; slides: ScreenSlide[] } | null;
  /** The set's item on screen and the one after it (issue #272): a song's title, or another item's own; where it is in the set. */
  item?: { title: string; position: number; count: number } | null;
  nextItem?: { title: string } | null;
  /** The song on screen: its title, key and tempo, for the Song widget. */
  details?: { title: string; key: string | null; tempo: number | null } | null;
  itemStartedAt?: number | null;
  operator?: SyncTimer | null;
  message?: string | null;
  /** ms to add to the device's clock for the server's. */
  offset?: number;
  /** In the template editor: an empty message shows what it would look like. */
  preview?: boolean;
  /** What the screen draws (issues #280, #287): the operator's layers less the screen's own, as screenLayers works them out. */
  layers?: ScreenLayersShown;
  /** The set's songs' slide counts, in order, and the one on screen's place among them (issue #289): the Slide count widget's set. */
  setSlides?: { counts: number[]; item: number } | null;
  /** The overlay's title card: the set's name, and its team's. */
  title?: { title: string; subtitle: string | null } | null;
}

type Grid = NonNullable<ScreenTheme["grid"]>;

/**
 * A template's grid on a screen (issue #268): each widget in its cells,
 * drawn in order, over the template's background. `words` draws the
 * Lyrics or chart widget - the screen's words, as it always shows them.
 */
export function ScreenGrid({
  theme,
  grid,
  slides,
  index,
  black,
  live,
  words,
}: {
  theme: ScreenTheme;
  grid: Grid;
  /** The song on screen's slides, and the one shown; none when nothing's presented. */
  slides: ScreenSlide[] | null;
  index: number;
  /** Black, and the template hides only the words: the rest stays. */
  black: boolean;
  live: StageLive;
  words: ReactNode;
}) {
  const timed = grid.widgets.some((one) => one.kind === "clock" || one.kind === "analog-clock" || one.kind === "countdown" || one.kind === "count-up" || one.kind === "date");
  const now = useNow(timed);
  const margin = theme.layout.margin;
  return (
    <div
      className="absolute inset-0 z-[2] grid"
      style={{
        padding: `${margin}cqh ${margin}cqw`,
        gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
        gap: `${grid.gap}cqmin`,
      }}
      data-testid="screen-grid"
    >
      {grid.widgets.map((widget) => {
        const place = placeScreenWidget(widget, grid);
        const wordsKind = ["stage", "current-slide", "next-slide", "current-section", "next-section"].includes(widget.kind);
        return (
          <WidgetCell key={widget.id} widget={widget} theme={theme} place={place} data-kind={widget.kind}>
            {black && wordsKind ? null : <WidgetBody widget={widget} theme={theme} slides={slides} index={index} live={live} now={now} words={words} />}
          </WidgetCell>
        );
      })}
    </div>
  );
}

function WidgetCell({ widget, theme, place, children, ...rest }: { widget: ScreenWidget; theme: ScreenTheme; place: { x: number; y: number; w: number; h: number }; children: ReactNode; "data-kind": string }) {
  const { style } = widget;
  return (
    <div
      className="relative min-h-0 min-w-0 overflow-hidden [container-type:size]"
      style={{
        gridColumn: `${place.x + 1} / span ${place.w}`,
        gridRow: `${place.y + 1} / span ${place.h}`,
        borderRadius: `${style.radius}cqmin`,
        color: style.color ?? theme.text.color,
        fontFamily: style.font ? SCREEN_FONT_FAMILIES[style.font] : undefined,
        textAlign: style.align,
      }}
      data-testid={`widget-cell-${widget.id}`}
      {...rest}
    >
      {style.opacity > 0 ? <div className="absolute inset-0" style={{ background: style.background, opacity: style.opacity }} aria-hidden /> : null}
      {children}
    </div>
  );
}

/** A size for text in a cell: the widget's own (% of the cell's height), or one that fits `chars` across and `lines` down. */
function fit(widget: ScreenWidget, chars: number, lines = 1, most = 70): string {
  if (widget.style.size !== "auto") return `${widget.style.size}cqh`;
  // A character is about 0.6em wide (wider for digits in some fonts), and the box keeps 8cqw of padding.
  return `min(${most / lines}cqh, ${140 / Math.max(4, chars)}cqw)`;
}

function WidgetBody({ widget, theme, slides, index, live, now, words }: { widget: ScreenWidget; theme: ScreenTheme; slides: ScreenSlide[] | null; index: number; live: StageLive; now: number | null; words: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { options } = widget;
  const label = options.label.trim();
  const justify = { left: "items-start", center: "items-center", right: "items-end" }[widget.style.align];
  const box = (content: ReactNode, testId: string, chars: number, lines = 1, extra?: CSSProperties) => (
    <div className={cn("absolute inset-0 flex flex-col justify-center px-[4cqw] py-[3cqh]", justify)} data-testid={testId}>
      {label ? (
        <p className="mb-[2cqh] text-[16cqh] leading-none font-semibold tracking-wide uppercase opacity-70" data-testid="widget-label">
          {label}
        </p>
      ) : null}
      <div className="w-full leading-[1.1]" style={{ fontSize: fit(widget, chars, lines, label ? 52 : 70), fontWeight: theme.text.weight, ...extra }}>
        {content}
      </div>
    </div>
  );

  switch (widget.kind) {
    case "stage":
      return words;
    case "current-slide":
    case "next-slide": {
      const slide = widget.kind === "current-slide" ? slides?.[index] : slides && index + 1 < slides.length ? slides[index + 1] : live.nextSong?.slides[0];
      const lines = slide?.lines ?? [];
      if (lines.length === 0) return null;
      const longest = Math.max(...lines.map((line) => line.length));
      return box(
        lines.map((line, i) => (
          <p key={i} style={{ textTransform: theme.text.upperCase ? "uppercase" : undefined }}>
            {line}
          </p>
        )),
        `widget-${widget.kind}`,
        longest,
        lines.length + 0.3,
      );
    }
    case "clock": {
      if (now === null) return null;
      const date = new Date(now);
      const time = date.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", ...(options.seconds && { second: "2-digit" }), hour12: options.format === "12h" });
      return box(
        <>
          <p className="tabular-nums">{time}</p>
          {options.date ? <p className="mt-[2cqh] text-[0.4em] opacity-75">{date.toLocaleDateString(i18n.language, { weekday: "long", day: "numeric", month: "long" })}</p> : null}
        </>,
        "widget-clock",
        time.length,
        options.date ? 1.5 : 1,
      );
    }
    case "countdown":
    case "count-up": {
      if (now === null) return null;
      const offset = live.offset ?? 0;
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      const reading = readScreenTimer(widget, {
        now: now + offset,
        itemStartedAt: live.itemStartedAt == null ? null : live.itemStartedAt + offset,
        operator: live.operator ?? null,
        localMidnight: midnight.getTime() + offset,
      });
      const text = reading ? formatTimer(reading.seconds, reading.overtime) : "–:––";
      // Its colours by time (issue #272): the break points it has, else amber near the end and red past zero.
      const colors = reading ? timerColors(widget, reading) : null;
      return (
        <>
          {colors?.background ? <div className="absolute inset-0" style={{ background: colors.background }} data-testid="widget-timer-background" data-color={colors.background} aria-hidden /> : null}
          {box(
            <p className={cn("tabular-nums", !reading && "opacity-40")} data-overtime={reading?.overtime ? "" : undefined} data-running={reading?.running ? "" : undefined} data-color={colors?.color ?? undefined}>
              {text}
            </p>,
            `widget-${widget.kind}`,
            text.length,
            1,
            { color: colors?.color ?? undefined },
          )}
        </>
      );
    }
    case "message": {
      const message = live.message?.trim() || (live.preview ? t("screens.widgetSample.message") : "");
      if (!message) return null;
      return box(<p className={cn(!live.message && "opacity-60")}>{message}</p>, "widget-message", Math.min(message.length, 40), Math.ceil(message.length / 40));
    }
    case "song": {
      const song = slides?.[index] ? live.details : null;
      if (!song) return null;
      const details = [song.key, song.tempo ? t("screens.widgetSample.bpm", { tempo: song.tempo }) : null].filter(Boolean).join(" · ");
      return box(
        <>
          <p className="truncate">{song.title}</p>
          {options.details && details ? <p className="mt-[2cqh] text-[0.5em] opacity-75">{details}</p> : null}
        </>,
        "widget-song",
        Math.min(song.title.length, 24),
        options.details && details ? 1.6 : 1,
      );
    }
    case "next-song": {
      const title = live.nextSong?.title;
      if (!title) return null;
      return box(<p className="truncate">{label ? title : t("screens.widgetSample.nextSong", { title })}</p>, "widget-next-song", title.length + 6);
    }
    case "analog-clock":
      return now === null ? null : <AnalogClock now={now} seconds={options.seconds} label={label} />;
    case "current-section":
    case "next-section": {
      // The whole section (issue #272): every slide of the pass, the one on screen picked out in the current one.
      const current = slides?.[index];
      if (!slides || !current) return null;
      let pass: ScreenSlide[];
      if (widget.kind === "current-section") pass = slides.filter((one) => one.passIndex === current.passIndex);
      else {
        const next = slides.find((one) => one.passIndex > current.passIndex);
        pass = next ? slides.filter((one) => one.passIndex === next.passIndex) : (live.nextSong?.slides.filter((one) => one.passIndex === live.nextSong!.slides[0]?.passIndex) ?? []);
      }
      const lines = pass.flatMap((one) => one.lines.map((line) => ({ line, now: widget.kind === "current-section" && one === current })));
      if (lines.length === 0) return null;
      const name = pass[0]?.label;
      return box(
        <>
          {name && !label ? <p className="mb-[0.3em] text-[0.55em] font-semibold tracking-wide uppercase opacity-60">{name}</p> : null}
          {lines.map(({ line, now: shown }, i) => (
            <p key={i} className={cn(widget.kind === "current-section" && !shown && "opacity-45")} data-now={shown ? "" : undefined} style={{ textTransform: theme.text.upperCase ? "uppercase" : undefined }}>
              {line}
            </p>
          ))}
        </>,
        `widget-${widget.kind}`,
        Math.max(...lines.map(({ line }) => line.length)),
        lines.length + 0.5,
      );
    }
    case "song-structure": {
      // The song's passes in the order they're sung (issue #272), the one on screen picked out, and how far through it is.
      const current = slides?.[index];
      if (!slides || !current) return null;
      const passes = slides.filter((one, i) => i === 0 || slides[i - 1]!.passIndex !== one.passIndex);
      const progress = slides.length > 1 ? index / (slides.length - 1) : 1;
      return (
        <div className={cn("absolute inset-0 flex flex-col justify-center gap-[6cqh] px-[4cqw] py-[3cqh]", justify)} data-testid="widget-song-structure">
          {label ? <p className="text-[16cqh] leading-none font-semibold tracking-wide uppercase opacity-70">{label}</p> : null}
          <div className="flex w-full flex-wrap gap-[1.5cqw]" style={{ justifyContent: { left: "flex-start", center: "center", right: "flex-end" }[widget.style.align] }}>
            {passes.map((pass, i) => {
              const now = pass.passIndex === current.passIndex;
              const sung = pass.passIndex < current.passIndex;
              return (
                <span
                  key={i}
                  className={cn("rounded-[1cqh] border px-[1.2cqw] py-[1cqh] leading-none font-semibold", now ? "border-current" : "border-transparent", sung ? "opacity-35" : !now && "opacity-70")}
                  style={{ fontSize: widget.style.size === "auto" ? `min(${(label ? 34 : 42) / Math.max(1, Math.ceil(passes.length / 8))}cqh, ${60 / Math.min(passes.length, 8)}cqw)` : `${widget.style.size}cqh`, ...(now && { background: "color-mix(in srgb, currentColor 20%, transparent)" }) }}
                  data-now={now ? "" : undefined}
                >
                  {shortLabel(pass.label, i)}
                </span>
              );
            })}
          </div>
          {options.details ? (
            <div className="h-[5cqh] w-full overflow-hidden rounded-full bg-current/20" aria-hidden>
              <div className="h-full rounded-full bg-current transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} data-testid="widget-song-progress" data-progress={Math.round(progress * 100)} />
            </div>
          ) : null}
        </div>
      );
    }
    case "current-item":
    case "next-item": {
      // The set's items (issue #272), songs or not.
      const item = widget.kind === "current-item" ? live.item : live.nextItem;
      if (!item) return null;
      const where = widget.kind === "current-item" && options.details && live.item ? t("screens.widgetSample.itemOf", { position: live.item.position, count: live.item.count }) : null;
      return box(
        <>
          <p className="truncate">{label || widget.kind === "current-item" ? item.title : t("screens.widgetSample.nextSong", { title: item.title })}</p>
          {where ? <p className="mt-[2cqh] text-[0.5em] opacity-75">{where}</p> : null}
        </>,
        `widget-${widget.kind}`,
        Math.min(item.title.length + (widget.kind === "next-item" ? 8 : 0), 28),
        where ? 1.6 : 1,
      );
    }
    case "date": {
      // The day (issue #289), written as asked, the time under it if asked.
      if (now === null) return null;
      const date = new Date(now);
      const day = formatScreenDate(date, options.dateFormat, i18n.language);
      const time = options.time ? date.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", hour12: options.format === "12h" }) : null;
      return box(
        <>
          <p>{day}</p>
          {time ? <p className="mt-[2cqh] text-[0.5em] tabular-nums opacity-75">{time}</p> : null}
        </>,
        "widget-date",
        day.length,
        time ? 1.6 : 1,
      );
    }
    case "slide-count": {
      // Where the screens are (issue #289): the song's slide, or the set's, and a bar.
      const counts = options.scope === "set" ? live.setSlides : slides ? { counts: [slides.length], item: 0 } : null;
      const at = counts ? screenSlideCount(options.scope, counts.counts, counts.item, index) : null;
      if (!at) return null;
      const text = `${at.position} / ${at.count}`;
      return (
        <div className={cn("absolute inset-0 flex flex-col justify-center gap-[4cqh] px-[4cqw] py-[3cqh]", justify)} data-testid="widget-slide-count" data-position={at.position} data-count={at.count}>
          {label ? <p className="text-[16cqh] leading-none font-semibold tracking-wide uppercase opacity-70">{label}</p> : null}
          <p className="leading-none tabular-nums" style={{ fontSize: fit(widget, text.length, options.progress === "none" ? 1 : 1.4, label ? 52 : 70), fontWeight: theme.text.weight }}>
            {text}
          </p>
          {options.progress !== "none" ? (
            <div className={cn("w-full overflow-hidden rounded-full bg-current/25", options.progress === "thick" ? "h-[12cqh]" : "h-[4cqh]")} aria-hidden>
              <div className="h-full rounded-full bg-current" style={{ width: `${(at.position / at.count) * 100}%` }} data-testid="widget-slide-progress" />
            </div>
          ) : null}
        </div>
      );
    }
    case "qr-code":
      return <QrCode widget={widget} preview={!!live.preview} label={label} />;
    case "text":
    {
      // In a preview, words to show what it looks like.
      const text = options.text || (live.preview ? t("screens.widgetSample.text") : "");
      return text ? box(<p className={cn("whitespace-pre-line", !options.text && "opacity-60")}>{text}</p>, "widget-text", Math.min(text.length, 36), Math.ceil(text.length / 36)) : null;
    }
  }
}

/** The day written as a Date widget asks (issue #289), in the screen's language. */
function formatScreenDate(date: Date, format: ScreenWidget["options"]["dateFormat"], language: string): string {
  switch (format) {
    case "long":
      return date.toLocaleDateString(language, { weekday: "long", day: "numeric", month: "long" });
    case "medium":
      return date.toLocaleDateString(language, { day: "numeric", month: "short", year: "numeric" });
    case "short":
      return date.toLocaleDateString(language, { day: "2-digit", month: "2-digit", year: "numeric" });
    case "iso":
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    case "weekday":
      return date.toLocaleDateString(language, { weekday: "long" });
  }
}

/** A QR code widget (issue #289): the code on white, as big as the cell allows, its caption under it; in a preview, a sample until it holds something. */
function QrCode({ widget, preview, label }: { widget: ScreenWidget; preview: boolean; label: string }) {
  const own = screenQrPayload(widget.options.qr);
  const payload = own ?? (preview ? "https://songverse.one" : null);
  const svg = useMemo(() => (payload ? renderSVG(payload, { pixelSize: 8, whiteColor: "#ffffff", blackColor: "#000000" }) : ""), [payload]);
  if (!payload) return null;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3cqh] p-[4cqmin]" data-testid="widget-qr-code" data-payload={payload}>
      <div className={cn("aspect-square max-h-full min-h-0 flex-1 rounded-[2cqmin] bg-white p-[3cqmin] [&>svg]:size-full", !own && "opacity-60")} dangerouslySetInnerHTML={{ __html: svg }} />
      {label ? <p className="shrink-0 truncate text-[10cqh] leading-none font-semibold">{label}</p> : null}
    </div>
  );
}

/** The time, ticking while something on screen shows it; null until the page runs in the browser (the server's time would differ). */
function useNow(ticking: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/** A section's label made short for a row of them (Verse 1 → V1, Chorus → C); its place when it has none. */
function shortLabel(label: string | null, index: number): string {
  if (!label) return String(index + 1);
  const words = label.trim().split(/\s+/);
  if (label.length <= 3) return label;
  const number = words.find((word) => /^\d+$/.test(word)) ?? "";
  const first = words.find((word) => !/^\d+$/.test(word)) ?? label;
  return `${first.slice(0, first.toLowerCase().startsWith("pre") ? 3 : 1).toUpperCase()}${number}`;
}

/** An analog clock (issue #272): a face, the hours marked, its hands - the second hand if asked - in the cell's text colour. */
function AnalogClock({ now, seconds, label }: { now: number; seconds: boolean; label: string }) {
  const date = new Date(now);
  const s = date.getSeconds();
  const m = date.getMinutes() + s / 60;
  const h = (date.getHours() % 12) + m / 60;
  const hand = (angle: number, length: number, width: number, opacity = 1) => {
    const radians = (angle - 90) * (Math.PI / 180);
    return <line x1={50} y1={50} x2={50 + Math.cos(radians) * length} y2={50 + Math.sin(radians) * length} stroke="currentColor" strokeWidth={width} strokeLinecap="round" opacity={opacity} />;
  };
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[2cqh] p-[4cqmin]" data-testid="widget-analog-clock" data-time={`${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`}>
      {label ? <p className="text-[12cqh] leading-none font-semibold tracking-wide uppercase opacity-70">{label}</p> : null}
      <svg viewBox="0 0 100 100" className="min-h-0 w-full flex-1" role="img" aria-label={date.toLocaleTimeString()}>
        <circle cx={50} cy={50} r={47} fill="none" stroke="currentColor" strokeWidth={2} opacity={0.6} />
        {Array.from({ length: 12 }, (_, i) => {
          const radians = (i * 30 - 90) * (Math.PI / 180);
          const inner = i % 3 === 0 ? 37 : 40;
          return <line key={i} x1={50 + Math.cos(radians) * inner} y1={50 + Math.sin(radians) * inner} x2={50 + Math.cos(radians) * 44} y2={50 + Math.sin(radians) * 44} stroke="currentColor" strokeWidth={i % 3 === 0 ? 2.5 : 1.2} opacity={0.8} />;
        })}
        {hand(h * 30, 24, 4.5)}
        {hand(m * 6, 35, 3)}
        {seconds ? hand(s * 6, 39, 1.2, 0.85) : null}
        <circle cx={50} cy={50} r={2.5} fill="currentColor" />
      </svg>
    </div>
  );
}
