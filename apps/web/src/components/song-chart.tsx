import {
  chordRowLabel,
  prettyChord,
  chordRowShowsShapes,
  layoutChordLine,
  type ChartCell,
  type ChordRow as ChordRowSettings,
  type SecondChordRow,
  renderChart,
  type RenderedChart,
  type RenderedChord,
  type ChordFamily,
  type RenderedLine,
  type RenderedPass,
  type SectionInstance,
  type SectionV2,
} from "@songverse/core";
import { AlertTriangle } from "lucide-react";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChartColumns } from "#/lib/chart-columns";
import type { DisplayFontValue, DisplaySpacingValue } from "@songverse/core";
import { cn } from "@songverse/ui/lib/utils";

// Section types with a heading of their own; "other" has none.
const LABELLED_SECTIONS = new Set(["intro", "verse", "pre-chorus", "chorus", "post-chorus", "bridge", "vamp", "breakdown", "instrumental", "interlude", "outro", "tag"]);

/** A chart of sections as written (the song editor's preview, a review): no arrangement, no player's view. */
export function chartOfSections(sections: SectionV2[], flow: SectionInstance[] = [], key: string | null = null): RenderedChart {
  return renderChart({ $schema: "song-document/v2", revision: 0, defaults: { key }, sections, flow }, null);
}

/**
 * Read-only chord chart, drawn from renderChart() (so it's the song as the
 * arrangement plays it and this player reads it): chords above the
 * characters they're pinned to, spaced so chords close together never
 * overlap (see layoutChordLine and docs/song-document-v2.md, "Rendering
 * chords above lyrics"). Monospace, so a chord's width is its length in `ch`.
 *
 * Each pass shows its label, note and key change; one the arrangement
 * changes is marked, with its replaced chords and line notes. With
 * `onChordClick`, chords are buttons: a player hiding one for themselves,
 * or opening its diagram (`chordClickAction`, issue #207).
 */
export function SongChart({
  chart,
  emptyText,
  onChordClick,
  chordClickAction = "hide",
  colors = false,
  columns = "1",
  font = "mono",
  spacing = "normal",
  hideChords = false,
  chordScale = 1,
  rows,
  passAside,
}: {
  chart: RenderedChart;
  emptyText?: string;
  /** The chord tapped: its ID (the same on every pass of its section), the element, and the chord as this pass shows it. */
  onChordClick?: (chordId: string, element: HTMLElement, chord: RenderedChord) => void;
  /** What tapping a chord does, for its label: hide it, or show its diagram. */
  chordClickAction?: "hide" | "diagram";
  /** Chords coloured by family (issues #9, #207): major, minor, sus, dim, aug, dominant 7th. */
  colors?: boolean;
  /** Flowed into columns on a wide screen (issue #177): as many as fit, or up to 2 or 3; a section never split. */
  columns?: ChartColumns;
  /** The player's Display settings (issue #209): the lettering, the space between lines, and lyrics only. */
  font?: DisplayFontValue;
  spacing?: DisplaySpacingValue;
  hideChords?: boolean;
  /** The chords' size against the lyrics' (issue #225): they stay over their letters at any size. */
  chordScale?: number;
  /** The rows of chords as the player set them (issue #230): the main one, and a second one or none. Without, the chords' own labels. */
  rows?: ChordRowsView;
  /** Something beside each pass's heading - its chord diagrams (issue #212); under it on a phone. */
  passAside?: (pass: RenderedPass) => ReactNode;
}) {
  const { t } = useTranslation();
  if (chart.passes.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText ?? t("chart.empty")}</p>;
  }
  const labelFor = (pass: RenderedPass) =>
    pass.label ?? pass.section.label ?? (LABELLED_SECTIONS.has(pass.section.type) ? t(`chart.sections.${pass.section.type}`) : null);

  const flowed = columns !== "1";
  // A second row that only repeats the main one (the capo's shapes with no capo, say) isn't shown.
  const shownRows = rows ? { ...rows, second: rows.second && secondRowDiffers(chart, rows) ? rows.second : null } : undefined;
  return (
    <div
      className={cn(
        "text-sm",
        font === "sans" ? "font-sans" : "font-mono",
        spacing === "compact" ? "leading-tight" : spacing === "relaxed" ? "leading-relaxed [&_[data-line]]:mb-1" : "leading-snug",
        // Chords named as capo shapes, not as they sound (issue #219): in italics, never mistaken for the sounding ones.
        !rows && chart.capoShapes && "[&_[data-chord]]:italic",
        flowed ? "gap-x-12 [column-rule:1px_solid_var(--color-border)] [&>[data-pass]]:mb-5 [&>[data-pass]]:break-inside-avoid" : "flex flex-col gap-5",
      )}
      // Auto: as many columns of at least 24rem as fit; 2 or 3: up to that many, never narrower than 18rem (a phone keeps one).
      style={{ ...(flowed && { columns: columns === "auto" ? "24rem" : `${columns} 18rem` }), ...(chordScale !== 1 && ({ "--chord-scale": chordScale } as CSSProperties)) }}
      data-chord-scale={chordScale}
      data-columns={columns}
      data-font={font}
      data-spacing={spacing}
      data-hide-chords={hideChords ? "" : undefined}
      data-capo-shapes={chart.capoShapes ? "" : undefined}
      data-testid="song-chart"
    >
      {chart.passes.map((pass) => {
        const heading = pass.section.showLabel === false ? null : labelFor(pass);
        const aside = passAside?.(pass) ?? null;
        return (
          <div
            key={pass.id}
            data-section={pass.section.type}
            data-pass={pass.id}
            data-differs={pass.differs ? "" : undefined}
            className={cn(pass.differs && "-ml-3 border-l-2 border-amber-500/70 pl-2.5")}
          >
            {heading || pass.keyChange || pass.differs || pass.changed || aside ? (
              <div className="mb-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <p className="flex flex-wrap items-baseline gap-x-2 font-sans text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {heading ? <span>{heading}</span> : null}
                {/* Its own chords, lines or transposition (issue #205). */}
                {pass.changed ? (
                  <span className="text-amber-600 dark:text-amber-400" title={t("chart.changed")} aria-label={t("chart.changed")} data-pass-changed="">
                    *
                  </span>
                ) : null}
                {pass.keyChange ? (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary normal-case" data-key-change={pass.keyChange}>
                    {t("chart.keyChange", { key: prettyChord(pass.keyChange) })}
                  </span>
                ) : null}
                {pass.differs ? <span className="font-normal text-amber-700 normal-case dark:text-amber-400">{t("chart.differs")}</span> : null}
              </p>
              {aside}
              </div>
            ) : null}
            {pass.note ? <p className="mb-1 font-sans text-xs text-muted-foreground italic">{pass.note}</p> : null}
            {pass.problems.length > 0 ? (
              <p className="mb-1 flex items-center gap-1 font-sans text-xs text-destructive" role="note">
                <AlertTriangle className="size-3" aria-hidden />
                {t("chart.problems", { count: pass.problems.length })}
              </p>
            ) : null}
            <div className="flex flex-col gap-1">
              {pass.lines.map((line) => (
                <ChartLine
                  key={line.id}
                  line={hideChords && line.kind !== "note" ? { ...line, chords: [] } : line}
                  onChordClick={onChordClick}
                  action={chordClickAction}
                  colors={colors}
                  rows={shownRows}
                  capo={chart.capo}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Each chord family's colour, readable in light and dark (Live): the scheme issue #9 proposed. */
const FAMILY_COLORS: Record<ChordFamily, string> = {
  major: "text-emerald-700 dark:text-emerald-400",
  minor: "text-blue-600 dark:text-sky-400",
  suspended: "text-amber-600 dark:text-yellow-300",
  diminished: "text-purple-600 dark:text-purple-400",
  augmented: "text-orange-600 dark:text-orange-400",
  dominant: "text-red-600 dark:text-red-400",
};

function ChartLine({
  line,
  onChordClick,
  action,
  colors,
  rows,
  capo,
}: {
  line: RenderedLine;
  onChordClick?: (chordId: string, element: HTMLElement, chord: RenderedChord) => void;
  action: "hide" | "diagram";
  colors: boolean;
  rows?: ChordRowsView;
  capo: number | null;
}) {
  const { t } = useTranslation();
  const note = line.note ? <span className="ml-2 font-sans text-xs text-amber-700 italic dark:text-amber-400">{line.note}</span> : null;
  if (line.kind === "note") return <p className="font-sans text-xs text-muted-foreground italic">{line.text}</p>;
  if (line.chords.length === 0) {
    return (
      <p className={cn("whitespace-pre-wrap", line.inserted && "text-amber-800 dark:text-amber-300")} data-line="" data-line-id={line.id}>
        {line.text || " "}
        {note}
      </p>
    );
  }

  const byId = new Map(line.chords.map((chord) => [chord.id, chord]));
  const replaced = new Set(line.chords.filter((chord) => chord.replaced).map((chord) => chord.id));
  // The rows: as the player set them, or the chords' own labels in the theme's colour (or by type).
  const main: RowLook = rows ? rows.main : { names: "LETTERS", source: "SOUNDING", size: 1, font: "same", weight: "bold", color: colors ? "family" : "theme" };
  const second = rows?.second ?? null;
  const labelOf = (row: RowLook, id: string | undefined, fallback: string) => {
    const chord = id ? byId.get(id) : undefined;
    return rows && chord ? chordRowLabel(chord, row, capo) : fallback;
  };
  const words = layoutChordLine(line.text, line.chords);

  /** One row's chords in a cell: their names (the main row's taps), or a diagram each. */
  const rowOf = (row: RowLook, cell: ChartCell, isMain: boolean) => {
    const shapes = rows ? chordRowShowsShapes(row, capo) : false;
    const size = isMain ? "calc(1em * var(--chord-scale, 1))" : `calc(1em * var(--chord-scale, 1) * ${row.size})`;
    const look = (id: string | undefined) => {
      const family = id ? byId.get(id)?.family : null;
      return cn(
        row.color === "theme" && "text-primary",
        row.color === "muted" && "text-muted-foreground",
        row.color === "family" && (family ? FAMILY_COLORS[family] : "text-primary"),
        id && replaced.has(id) && "underline decoration-amber-500 decoration-2",
      );
    };
    const custom = row.color.startsWith("#") ? { color: row.color } : undefined;
    const items = cell.chords.map((chord, k) => {
      // Sharps and flats as their symbols (issue #230).
      const label = prettyChord(labelOf(row, chord.id, chord.label));
      return (
        <Fragment key={chord.id ?? k}>
          {k > 0 ? " " : null}
          {isMain && onChordClick && chord.id ? (
            <button
              type="button"
              className={cn("rounded-sm hover:bg-primary/10", look(chord.id))}
              style={custom}
              data-chord-id={chord.id}
              data-family={byId.get(chord.id)?.family ?? undefined}
              aria-label={t(action === "hide" ? "chart.hideChord" : "chart.showDiagram", { chord: label })}
              onClick={(event) => onChordClick(chord.id!, event.currentTarget, byId.get(chord.id!)!)}
            >
              {label}
            </button>
          ) : (
            <span className={look(chord.id)} style={custom} data-family={(chord.id && byId.get(chord.id)?.family) || undefined}>
              {label}
            </span>
          )}
        </Fragment>
      );
    });
    return { items, shapes, size };
  };

  const lineHasText = words.some((word) => word.some((cell) => cell.text.length > 0));

  return (
    <p data-line="" data-line-id={line.id} className={cn(line.inserted && "text-amber-800 dark:text-amber-300")}>
      {words.map((word, w) => (
        <Fragment key={w}>
          {/* A place the line may wrap, between words (never inside one). */}
          {w > 0 ? "​" : null}
          {/* Words of different heights (a second row, diagrams) line up by their lyrics, at the bottom. */}
          <span className="inline-flex whitespace-pre align-bottom">
            {word.map((cell, c) => {
              const mainRow = rowOf(main, cell, true);
              const secondRow = second && cell.chords.length > 0 ? rowOf(second, cell, false) : null;
              // A chord wider than its text widens the cell, so the next chord stays over its own character (both rows' names).
              const length = (row: RowLook, items: { label: string; id?: string }[]) => items.map((chord) => labelOf(row, chord.id, chord.label)).join(" ").length;
              const mainLength = cell.chord ? length(main, cell.chords) : 0;
              const secondLength = second && cell.chord ? length(second, cell.chords) * second.size : 0;
              const side = second && (second.position === "beside" || second.position === "left" || second.position === "right");
              // The gap is in em; a character about 0.6em.
              const gapLength = second && side ? second.gap / 0.6 : 0;
              const width = cell.chord ? (side ? mainLength + secondLength + gapLength : Math.max(mainLength, secondLength)) + 1 : 0;
              const stretched = cell.midWord && width > cell.text.length;
              const rowClass = (row: RowLook, shapes: boolean) =>
                cn(row.font === "sans" && "font-sans", row.font === "mono" && "font-mono", row.weight === "bold" ? "font-bold" : "font-normal", shapes && "italic");
              const gap = `${second?.gap ?? 0}em`;
              const secondEl = secondRow ? (
                <span
                  className={rowClass(second!, secondRow.shapes)}
                  style={{
                    fontSize: secondRow.size,
                    ...(second!.position === "below" && { marginTop: gap }),
                    ...(second!.position === "above" && { marginBottom: gap }),
                    ...((second!.position === "right" || second!.position === "beside") && { marginLeft: gap }),
                    ...(second!.position === "left" && { marginRight: gap }),
                  }}
                  data-chord-second={cell.chord ?? undefined}
                >
                  {secondRow.items}
                </span>
              ) : null;
              return (
                <span key={c} className="inline-flex flex-col justify-end" style={width ? { minWidth: `calc(${Math.round(width * 100) / 100}ch * var(--chord-scale, 1))` } : undefined}>
                  {second?.position === "above" ? (secondEl ?? <span className="leading-none"> </span>) : null}
                  <span className={rowClass(main, mainRow.shapes)} style={{ fontSize: mainRow.size }} data-chord={cell.chord ?? undefined}>
                    {second?.position === "left" && secondEl ? secondEl : null}
                    {cell.chords.length === 0 ? " " : mainRow.items}
                    {second?.position === "right" && secondEl ? secondEl : null}
                    {second?.position === "beside" && secondEl ? <sup className="align-super">{secondEl}</sup> : null}
                  </span>
                  {second?.position === "below" ? (secondEl ?? <span> </span>) : null}
                  <span className="flex">
                    {/* Chords after the last letter: a blank under them, so they stay on the chords' row (not on a line of chords alone). */}
                    <span>{cell.text || (lineHasText ? " " : null)}</span>
                    {stretched ? (
                      <span aria-hidden className="flex-1 text-center text-muted-foreground">
                        -
                      </span>
                    ) : null}
                  </span>
                </span>
              );
            })}
          </span>
        </Fragment>
      ))}
      {note}
    </p>
  );
}

/** A row's settings, as a chart draws it. */
type RowLook = ChordRowSettings;

/** Whether a second row shows anything the main one doesn't, somewhere in the chart. */
function secondRowDiffers(chart: RenderedChart, rows: ChordRowsView): boolean {
  const second = rows.second;
  if (!second) return false;
  for (const pass of chart.passes)
    for (const line of pass.lines)
      for (const chord of line.chords) if (chordRowLabel(chord, second, chart.capo) !== chordRowLabel(chord, rows.main, chart.capo)) return true;
  return false;
}

/** The rows of chords a chart draws (issue #230). */
export interface ChordRowsView {
  main: ChordRowSettings;
  second: SecondChordRow | null;
}
