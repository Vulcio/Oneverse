import { formatTimer, placeScreenWidget, readScreenTimer, SCREEN_FONT_FAMILIES, type ScreenSlide, type ScreenTheme, type ScreenWidget, type SyncTimer } from "@songverse/core";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@songverse/ui/lib/utils";

/**
 * What a screen's widgets read besides its song (issue #268): the set's next
 * song, when the item on screen came on, the operator's timer and message
 * (issue #269). Times are on the device's clock; `offset` turns it into the
 * server's, which the operator's timer is on.
 */
export interface StageLive {
  nextSong?: { title: string; slides: ScreenSlide[] } | null;
  /** The song on screen: its title, key and tempo, for the Song widget. */
  details?: { title: string; key: string | null; tempo: number | null } | null;
  itemStartedAt?: number | null;
  operator?: SyncTimer | null;
  message?: string | null;
  /** ms to add to the device's clock for the server's. */
  offset?: number;
  /** In the template editor: an empty message shows what it would look like. */
  preview?: boolean;
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
  const timed = grid.widgets.some((one) => one.kind === "clock" || one.kind === "countdown" || one.kind === "count-up");
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
        const wordsKind = widget.kind === "stage" || widget.kind === "current-slide" || widget.kind === "next-slide";
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
  return `min(${most / lines}cqh, ${165 / Math.max(4, chars)}cqw)`;
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
      return box(
        <p className={cn("tabular-nums", !reading && "opacity-40")} data-overtime={reading?.overtime ? "" : undefined} data-running={reading?.running ? "" : undefined}>
          {text}
        </p>,
        `widget-${widget.kind}`,
        text.length,
        1,
        { color: reading?.overtime ? "#ef4444" : reading?.warn ? "#f59e0b" : undefined },
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
    case "text":
      return options.text ? box(<p className="whitespace-pre-line">{options.text}</p>, "widget-text", Math.min(options.text.length, 36), Math.ceil(options.text.length / 36)) : null;
  }
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
