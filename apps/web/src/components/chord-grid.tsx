import {
  barAt,
  barBeatPlaces,
  barLyricSpans,
  beatPlaceRange,
  chartBars,
  editableRhythm,
  insertRhythmBar,
  moveRhythmChord,
  placeRhythmBeat,
  removeRhythmBar,
  setRhythmBarBeats,
  structureOf,
  type BarLyricSpan,
  type BeatPlace,
  type ChartBar,
  type ChartBarChord,
  type RenderedChart,
  type Rhythm,
  type SongDocumentV2,
  type GridBarsPerRowValue,
} from "@oneverse/core";
import { Check, Minus, Pencil, Plus, Repeat, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { GROUP_COLORS } from "#/components/bars-row";
import { keepInView } from "#/lib/follow-view";
import { FAMILY_COLORS, passLabel } from "@oneverse/screen/components/song-chart";
import { useBarsClock } from "#/lib/bars-clock";
import { useGridPlayer } from "#/lib/grid-player";
import { useGridLyrics, type GridLyrics } from "#/lib/grid-lyrics";
import { registerGrid, type GridControls } from "#/lib/grid-controls";
import { Button } from "@oneverse/ui/components/button";
import { cn } from "@oneverse/ui/lib/utils";

type Sections = SongDocumentV2["sections"];

/** A pointer that went down on a chord, or on a beat in the words, in Edit: a drag once it's moved, else a tap. */
type ChordPress = { pointerId: number; x: number; y: number; dragging: boolean } & ({ sectionId: string; chordId: string } | { bar: number; beat: number });

/** A beat of a bar, picked in Edit to place in the words: 1-based. */
type PickedBeat = { bar: number; beat: number };

/** How far a pointer moves before a press on a chord is a drag (px). */
const DRAG_FROM = 6;

/** The narrowest a beat's block gets when the grid picks its bars a row (px, before the chart's zoom): a chord name and a word fit. */
const MIN_BEAT_WIDTH = 40;

/**
 * Bars a row (issue #408): the setting's, else as many of a pass's bars as
 * fit `width` with each beat at least MIN_BEAT_WIDTH wide - 4, 2 or 1, so
 * the rows' bar lines stay under one another.
 */
export function gridBarsPerRow(setting: GridBarsPerRowValue, width: number, beats: number): number {
  if (setting !== "auto") return Number(setting);
  // Before it's measured (on the server, say): one bar a row, a phone's.
  if (width <= 0) return 1;
  const fit = Math.floor(width / (Math.max(1, beats) * MIN_BEAT_WIDTH));
  return fit >= 4 ? 4 : fit >= 2 ? 2 : 1;
}

/**
 * The chord grid (issue #238), a way to read a song as Chart and PDF are:
 * its chords in bars, as many to a row as fit their beats (issue #408:
 * one 6/8 bar on a phone, four 4/4 bars on a laptop), each section under
 * its name, a bar's number over it, a block a beat with the chord in the
 * one it changes on (as the bars row), and the words sung in it underneath
 * (Moises' and Chordify's bars with the lyrics). The chords read as on the chart: transposed, capo,
 * names, colours. As the music plays (`useBarsClock`: the stems, the
 * metronome or the Sync leader's), the bar and the beat being played light
 * up, and the bar is kept in view.
 *
 * It plays too: a tap on a bar plays from there, and Loop goes over some
 * bars again - the stems the page has loaded, else the click
 * (`useGridPlayer`); the page's own play button plays it from the top.
 * Loop bars and Edit bars are started from the Display panel's Grid
 * section (issue #408, `registerGrid`). With `onSave` (whoever can edit the song), Edit bars
 * places its chords on beats (the right half of a beat is its "and"),
 * dragged or tapped there, and adds, removes or shortens bars (a pickup, a
 * 2/4 bar), saved as each section's rhythm - every pass of a section has
 * the same bars. The beats are placed in the words too (`barBeatPlaces`):
 * in Edit, each is a number before the letter it's sung on, to drag to
 * another (beat 1 moves the bar line).
 *
 * The words (issue #376) are in each bar, or a line between the rows, or
 * scroll under a row of bars pinned at the top (the row being played), or
 * aren't shown: the device's choice (`useGridLyrics`); Edit has them in the
 * bars, where its beats are placed.
 */
export function ChordGrid({
  songId,
  chart,
  document,
  chordColors = false,
  barsPerRow = "auto",
  emptyText,
  className,
  onSave,
}: {
  songId: string;
  chart: RenderedChart;
  /** The song itself, for its sections' own bars (`rhythm`); without it, bars are filled in from the chart. */
  document?: Pick<SongDocumentV2, "sections"> | null;
  chordColors?: boolean;
  /** Bars a row (issue #408): the mode's display setting. */
  barsPerRow?: GridBarsPerRowValue;
  emptyText?: string;
  className?: string;
  /** Saves the song's sections with the bars edited here; left out, the grid can't be edited. */
  onSave?: (sections: Sections) => Promise<void>;
}) {
  const { t } = useTranslation();
  // Edit bars: each section's rhythm as changed and not saved yet.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, Rhythm>>({});
  const [picked, setPicked] = useState<{ sectionId: string; chordId: string } | null>(null);
  const [pickedBar, setPickedBar] = useState<number | null>(null);
  const [pickedBeat, setPickedBeat] = useState<PickedBeat | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Loop: the first bar tapped, waiting for the last.
  const [choosingLoop, setChoosingLoop] = useState<{ first: number | null } | null>(null);
  const shown = useMemo(
    () => (document && Object.keys(draft).length > 0 ? { sections: document.sections.map((section) => (draft[section.id] ? { ...section, rhythm: draft[section.id] } : section)) } : document),
    [document, draft],
  );
  const bars = useMemo(() => chartBars(chart, shown), [chart, shown]);
  const spans = useMemo(() => barLyricSpans(chart, bars), [chart, bars]);
  const places = useMemo(() => barBeatPlaces(chart, bars), [chart, bars]);
  const steps = useMemo(() => structureOf(chart), [chart]);
  const { source, position } = useBarsClock(songId, bars);
  const player = useGridPlayer(songId, bars, chart);
  const grid = useRef<HTMLDivElement>(null);
  const press = useRef<ChordPress | null>(null);
  const changed = Object.keys(draft).length > 0;
  const canEdit = !!onSave && !!document;
  const lyricsChoice = useGridLyrics();
  const lyrics: GridLyrics = editing ? "bars" : lyricsChoice;
  // The grid's width, for the bars a row that fit (issue #408): in its own pixels, before the chart's zoom.
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The section a bar is in, and its rhythm as edited so far.
  const sectionOf = (bar: ChartBar) => document?.sections.find((section) => section.id === bar.sectionId) ?? null;
  const rhythmOf = (bar: ChartBar) => {
    const section = sectionOf(bar);
    return section ? (draft[section.id] ?? editableRhythm(section)) : null;
  };
  const beatsOf = (bar: ChartBar) => Math.max(1, (chart.passes[bar.passIndex]?.timeSignature ?? chart.timeSignature)?.numerator ?? 4);
  /** A pass whose bars are its section's rhythm, one for one: not one that leaves some of its lines out. */
  const editable = (bar: ChartBar) => editing && rhythmOf(bar)?.bars.length === bar.barsInPass;
  const change = (bar: ChartBar, next: Rhythm | null, refused: string) => {
    if (!next) return setProblem(refused);
    setProblem(null);
    setDraft((current) => ({ ...current, [bar.sectionId]: next }));
  };

  const place = (bar: ChartBar, beat: number, chord = picked) => {
    const section = sectionOf(bar);
    const rhythm = rhythmOf(bar);
    if (!chord) return setPickedBar(bar.index);
    if (!section || !rhythm) return;
    if (chord.sectionId !== bar.sectionId) return setProblem(t("chordGrid.otherSection"));
    change(bar, moveRhythmChord(section, rhythm, chord.chordId, bar.barInPass, beat, beatsOf(bar)), t("chordGrid.cantPlace"));
    setPicked(null);
    setPickedBar(bar.index);
  };
  // A beat put on a letter of the words: only where beatPlaceRange says it may go.
  const placeBeat = (target: PickedBeat, letter: { lineId: string; at: number }) => {
    const bar = bars[target.bar];
    const rhythm = bar ? rhythmOf(bar) : null;
    setPickedBeat(null);
    if (!bar || !rhythm || !editable(bar)) return;
    const range = beatPlaceRange(chart, bars, bar.index, target.beat);
    if (!range.some((span) => span.lineId === letter.lineId && letter.at >= span.from && letter.at < span.to)) return setProblem(t(target.beat === 1 ? "chordGrid.barLineOutside" : "chordGrid.beatOutside"));
    change(bar, placeRhythmBeat(rhythm, bar.barInPass, target.beat, letter, beatsOf(bar)), t("chordGrid.beatOutside"));
    setPickedBar(bar.index);
  };
  const placeBeatAuto = (target: PickedBeat) => {
    const bar = bars[target.bar];
    const rhythm = bar ? rhythmOf(bar) : null;
    setPickedBeat(null);
    if (bar && rhythm) change(bar, placeRhythmBeat(rhythm, bar.barInPass, target.beat, null, beatsOf(bar)), t("chordGrid.cantPlace"));
  };
  const barTools = (bar: ChartBar) => {
    const rhythm = rhythmOf(bar)!;
    const length = bar.beats;
    return {
      shorter: () => change(bar, setRhythmBarBeats(rhythm, bar.barInPass, length - 1, beatsOf(bar)), t("chordGrid.chordsInTheWay")),
      longer: () => change(bar, setRhythmBarBeats(rhythm, bar.barInPass, length + 1, beatsOf(bar)), t("chordGrid.cantPlace")),
      before: () => {
        change(bar, insertRhythmBar(rhythm, bar.barInPass), t("chordGrid.tooManyBars"));
        setPickedBar(bar.index);
      },
      after: () => {
        change(bar, insertRhythmBar(rhythm, bar.barInPass + 1), t("chordGrid.tooManyBars"));
        setPickedBar(bar.index + 1);
      },
      remove: () => {
        change(bar, removeRhythmBar(rhythm, bar.barInPass), t("chordGrid.moveChordsFirst"));
        setPickedBar(null);
      },
    };
  };

  // A chord dragged onto a beat, or tapped to pick it; a beat in the words dragged onto a letter, or tapped to pick it.
  const pressDown = (event: ReactPointerEvent, bar: ChartBar, what: { chordId: string } | { beat: number }) => {
    if (!editable(bar)) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const at = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    press.current = "chordId" in what ? { ...at, sectionId: bar.sectionId, chordId: what.chordId } : { ...at, bar: bar.index, beat: what.beat };
  };
  const chordDown = (event: ReactPointerEvent, bar: ChartBar, chord: ChartBarChord) => pressDown(event, bar, { chordId: chord.id });
  const beatDown = (event: ReactPointerEvent, bar: ChartBar, beat: number) => pressDown(event, bar, { beat });
  // What a pointer is over: a beat to put a chord on, a letter to put a beat on.
  const targetUnder = (x: number, y: number, current: ChordPress) => window.document.elementFromPoint(x, y)?.closest<HTMLElement>("chordId" in current ? "[data-grid-slot]" : "[data-letter]") ?? null;
  const chordMove = (event: ReactPointerEvent) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.dragging && Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_FROM) return;
    current.dragging = true;
    for (const element of grid.current?.querySelectorAll<HTMLElement>("[data-drop]") ?? []) delete element.dataset.drop;
    const target = targetUnder(event.clientX, event.clientY, current);
    if (target) target.dataset.drop = "";
  };
  const chordUp = (event: ReactPointerEvent) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    press.current = null;
    for (const element of grid.current?.querySelectorAll<HTMLElement>("[data-drop]") ?? []) delete element.dataset.drop;
    if (!("chordId" in current)) {
      const beat = { bar: current.bar, beat: current.beat };
      if (!current.dragging) {
        const same = pickedBeat?.bar === beat.bar && pickedBeat.beat === beat.beat;
        setPickedBeat(same ? null : beat);
        setPicked(null);
        setProblem(null);
        return;
      }
      const letter = targetUnder(event.clientX, event.clientY, current);
      if (letter) placeBeat(beat, { lineId: letter.dataset.line!, at: Number(letter.dataset.at) });
      return;
    }
    const chord = { sectionId: current.sectionId, chordId: current.chordId };
    if (!current.dragging) {
      const same = picked?.chordId === chord.chordId;
      setPicked(same ? null : chord);
      setPickedBeat(null);
      setProblem(null);
      return;
    }
    const slot = targetUnder(event.clientX, event.clientY, current);
    const bar = slot ? bars[Number(slot.dataset.bar)] : undefined;
    if (slot && bar) place(bar, Number(slot.dataset.beat), chord);
  };

  const chordCancel = () => {
    press.current = null;
    for (const element of grid.current?.querySelectorAll<HTMLElement>("[data-drop]") ?? []) delete element.dataset.drop;
  };

  const stopEditing = () => {
    setEditing(false);
    setDraft({});
    setPicked(null);
    setPickedBar(null);
    setPickedBeat(null);
    setProblem(null);
  };
  const save = async () => {
    if (!onSave || !shown) return;
    setSaving(true);
    try {
      await onSave(shown.sections as Sections);
      stopEditing();
    } catch {
      setProblem(t("chordGrid.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // A tap on a bar: in Edit, picks it (or puts the picked chord on its first beat); choosing a loop, its ends; else plays from it.
  const tapBar = (bar: ChartBar) => {
    if (editing) return editable(bar) ? (picked ? place(bar, 1) : setPickedBar(bar.index)) : undefined;
    if (choosingLoop) {
      if (choosingLoop.first === null) return setChoosingLoop({ first: bar.index });
      player.loop({ first: choosingLoop.first, last: bar.index });
      return setChoosingLoop(null);
    }
    player.playFrom(bar.index);
  };

  // The bars of each pass, in order.
  const passes = useMemo(() => {
    const grouped: { passIndex: number; bars: ChartBar[] }[] = [];
    for (const bar of bars) {
      const last = grouped.at(-1);
      if (last?.passIndex === bar.passIndex) last.bars.push(bar);
      else grouped.push({ passIndex: bar.passIndex, bars: [bar] });
    }
    return grouped;
  }, [bars]);
  // A pass's bars in rows, for the words between them or the row pinned at the top.
  const perRowOf = (passIndex: number) => gridBarsPerRow(barsPerRow, width, chart.passes[passIndex]?.timeSignature?.numerator ?? chart.timeSignature?.numerator ?? 4);
  const rowsOf = (passBars: ChartBar[]) => {
    const perRow = perRowOf(passBars[0]?.passIndex ?? 0);
    return Array.from({ length: Math.ceil(passBars.length / perRow) }, (_, row) => passBars.slice(row * perRow, row * perRow + perRow));
  };
  // Each row's bars side by side, as many columns as the pass has a row.
  const rowStyle = (passIndex: number) => ({ gridTemplateColumns: `repeat(${perRowOf(passIndex)}, minmax(0, 1fr))` });
  // The words of a bar: its pieces of its pass's lines, in order.
  const wordsOf = (bar: ChartBar) => {
    const lines = chart.passes[bar.passIndex]?.lines ?? [];
    return (spans[bar.index] ?? [])
      .map((span) => ({ lineId: span.lineId, text: lines.find((line) => line.id === span.lineId)?.text.slice(span.from, span.to) ?? "" }))
      .filter((piece) => piece.text.trim());
  };
  // The line a bar is sung in (its first words), for the lyrics under a pinned row.
  const lineOfBar = useMemo(
    () =>
      bars.map((bar) => {
        const pass = chart.passes[bar.passIndex];
        const lines = pass?.lines ?? [];
        const span = (spans[bar.index] ?? []).find((one) => lines.find((line) => line.id === one.lineId)?.text.slice(one.from, one.to).trim());
        return pass && span ? `${pass.id}:${span.lineId}` : null;
      }),
    [bars, spans, chart],
  );

  // Frame by frame, without rendering again: the bar and beat being played lit, the bar kept in view.
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    let litBar: HTMLElement | null = null;
    let litBeat: HTMLElement | null = null;
    let litWords: HTMLElement | null = null;
    let litLyrics: HTMLElement[] = [];
    let shownRow: HTMLElement | null = null;
    // The pinned row: the one with the bar being played, else the first.
    const showRow = (bar: number | null) => {
      if (lyrics !== "pinned") return;
      const row = (bar === null ? null : element.querySelector<HTMLElement>(`[data-grid-row][data-bars~="${bar}"]`)) ?? (shownRow ? null : element.querySelector<HTMLElement>("[data-grid-row]"));
      if (!row || row === shownRow) return;
      if (shownRow) delete shownRow.dataset.shown;
      shownRow = row;
      row.dataset.shown = "";
    };
    const light = (bar: number | null, beat: number) => {
      if (litBar) delete litBar.dataset.on;
      if (litBeat) delete litBeat.dataset.on;
      if (litWords) delete litWords.dataset.on;
      for (const one of litLyrics) delete one.dataset.on;
      showRow(bar);
      litBar = bar === null ? null : element.querySelector<HTMLElement>(`[data-grid-bar="${bar}"]`);
      litBeat = litBar?.querySelectorAll<HTMLElement>("[data-grid-beat]")[beat] ?? null;
      // The words being sung: from the last beat placed in them at or before this one.
      litWords = [...(litBar?.querySelectorAll<HTMLElement>("[data-word-beat]") ?? [])].filter((one) => Number(one.dataset.wordBeat) <= beat).at(-1) ?? null;
      if (litBar) litBar.dataset.on = "";
      if (litBeat) litBeat.dataset.on = "";
      if (litWords) litWords.dataset.on = "";
      // Between the rows, the bar's words; under a pinned row, the line it's sung in.
      const line = bar === null ? null : lineOfBar[bar];
      litLyrics = bar === null ? [] : [...element.querySelectorAll<HTMLElement>(`[data-lyric-bar="${bar}"]${line ? `, [data-lyric-line="${line}"]` : ""}`)];
      for (const one of litLyrics) one.dataset.on = "";
    };
    if (!position) {
      light(null, 0);
      element.dataset.position = "";
      return;
    }
    let shownBeat = Number.NaN;
    let shownBar = -1;
    let frame = requestAnimationFrame(function tick() {
      const whole = Math.floor(position());
      if (whole !== shownBeat) {
        shownBeat = whole;
        const where = barAt(bars, whole);
        element.dataset.position = where ? `${where.bar}:${where.beat}` : "";
        light(where?.bar ?? null, where?.beat ?? 0);
        if (where && where.bar !== shownBar) {
          // Kept in view, without moving the page under the reader for every bar: only when it nears an edge.
          // Under a pinned row, the line being sung is, the row staying where it is.
          const follow = lyrics === "pinned" ? element.querySelector<HTMLElement>("[data-lyric-line][data-on]") : litBar;
          if (follow) keepInView(follow);
        }
        shownBar = where?.bar ?? -1;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      light(null, 0);
    };
  }, [position, bars, lyrics, width, barsPerRow, lineOfBar]);

  // A pass's name over its bars (or over its words, under a pinned row).
  const passHeading = (passIndex: number) => {
    const pass = chart.passes[passIndex]!;
    const step = steps[passIndex];
    const heading = pass.section.showLabel === false ? null : passLabel(pass, t);
    return (
      <p className="mb-1 flex items-center gap-2 font-sans text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {step ? (
          <span className={cn("rounded-sm px-1 text-[10px] leading-4 font-bold text-white normal-case", GROUP_COLORS[step.group])}>
            {t(`live.short.${step.type}`)}
            {step.number ?? ""}
          </span>
        ) : null}
        {heading ? <span data-testid="chord-grid-heading">{heading}</span> : null}
        {pass.timeSignature && (passIndex === 0 || pass.timeSignature.numerator !== chart.passes[passIndex - 1]?.timeSignature?.numerator) ? (
          <span className="tabular-nums normal-case">
            {pass.timeSignature.numerator}/{pass.timeSignature.denominator}
          </span>
        ) : null}
      </p>
    );
  };
  const gridBar = (bar: ChartBar, at: number, row: readonly ChartBar[]) => (
    <GridBar
      key={bar.index}
      bar={bar}
      rowEnd={at === row.length - 1 || (at + 1) % perRowOf(bar.passIndex) === 0}
      words={spans[bar.index] ?? null}
      showWords={lyrics === "bars"}
      lines={chart.passes[bar.passIndex]!.lines}
      places={places[bar.index] ?? []}
      pickedBeat={editing && pickedBeat?.bar === bar.index ? pickedBeat.beat : null}
      chordColors={chordColors}
      editing={editable(bar)}
      locked={editing && !editable(bar)}
      picked={picked}
      pickedBar={editing && pickedBar === bar.index}
      looped={!!player.looped && bar.index >= player.looped.first && bar.index <= player.looped.last}
      playable={!editing && !player.following && player.source !== null}
      onTap={() => tapBar(bar)}
      onSlot={(beat) => place(bar, beat)}
      onLetter={pickedBeat ? (letter) => placeBeat(pickedBeat, letter) : undefined}
      chordEvents={{ down: chordDown, beatDown, move: chordMove, up: chordUp, cancel: chordCancel }}
    />
  );

  // Loop bars and Edit bars, for the Display panel's Grid section (issue #408).
  const controls: GridControls = {
    canLoop: player.canLoop && !editing,
    looped: player.looped,
    choosingLoop: !!choosingLoop,
    canEdit: canEdit && bars.length > 0,
    editing,
    loop: () => {
      if (player.looped) return player.loop(null);
      setChoosingLoop((current) => (current ? null : { first: null }));
    },
    edit: () => {
      setChoosingLoop(null);
      setEditing(true);
    },
  };
  const latest = useRef(controls);
  latest.current = controls;
  const registered = useRef<ReturnType<typeof registerGrid> | null>(null);
  useEffect(() => {
    // Calls go to this render's grid, whenever they're made.
    const live = (): GridControls => ({ ...latest.current, loop: () => latest.current.loop(), edit: () => latest.current.edit() });
    registered.current = registerGrid(live());
    return () => {
      registered.current?.remove();
      registered.current = null;
    };
  }, []);
  const { canLoop, looped, choosingLoop: choosing } = controls;
  useEffect(() => {
    registered.current?.update({ ...latest.current, loop: () => latest.current.loop(), edit: () => latest.current.edit() });
  }, [canLoop, looped?.first, looped?.last, choosing, controls.canEdit, editing]);

  if (bars.length === 0) return <p className="text-sm text-muted-foreground">{emptyText ?? t("chart.empty")}</p>;
  const tools = editing && pickedBar !== null && bars[pickedBar] && editable(bars[pickedBar]) ? { bar: bars[pickedBar], ...barTools(bars[pickedBar]) } : null;
  return (
    <div ref={area} className={cn("flex flex-col gap-3", className)} data-testid="chord-grid-area">
      {editing ? (
        // Editing: Cancel and Save kept in reach as the bars scroll by.
        <div className="sticky top-(--grid-sticky-top,0px) z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-card px-2 py-1.5" data-testid="chord-grid-toolbar">
          <Pencil className="size-4 text-primary" aria-hidden />
          <span className="mr-auto text-sm font-medium">{t("chordGrid.editing")}</span>
          <Button type="button" variant="outline" size="sm" onClick={stopEditing} disabled={saving} data-testid="chord-grid-cancel">
            <X />
            {t("chordGrid.cancel")}
          </Button>
          <Button type="button" size="sm" onClick={() => void save()} disabled={!changed || saving} data-testid="chord-grid-save">
            <Check />
            {t("chordGrid.save")}
          </Button>
        </div>
      ) : player.looped || choosingLoop ? (
        // Looping, or picking the bars to: what's happening, and Stop.
        <div className="sticky top-(--grid-sticky-top,0px) z-20 -mx-1 flex items-center gap-2 rounded-md border border-amber-500/60 bg-card px-2 py-1.5 text-sm" data-testid="chord-grid-loop-bar">
          <Repeat className="size-4 text-amber-500" aria-hidden />
          <span className="mr-auto" data-testid={choosingLoop ? "chord-grid-loop-hint" : "chord-grid-looping"}>
            {choosingLoop
              ? choosingLoop.first === null
                ? t("chordGrid.loopFirst")
                : t("chordGrid.loopLast", { n: choosingLoop.first + 1 })
              : t("chordGrid.looping", { first: player.looped!.first + 1, last: player.looped!.last + 1 })}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => (player.looped ? player.loop(null) : setChoosingLoop(null))} data-testid="chord-grid-loop-stop">
            <X />
            {player.looped ? t("chordGrid.stopLoop") : t("chordGrid.cancel")}
          </Button>
        </div>
      ) : null}
      {editing ? (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-2 text-sm" data-testid="chord-grid-edit">
          <p className="text-muted-foreground">{picked ? t("chordGrid.pickBeat") : pickedBeat ? t("chordGrid.pickLetter", { n: pickedBeat.beat }) : t("chordGrid.editHint")}</p>
          {pickedBeat && pickedBeat.beat > 1 && places[pickedBeat.bar]?.[pickedBeat.beat - 1]?.placed ? (
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => placeBeatAuto(pickedBeat)} data-testid="chord-grid-beat-auto">
                {t("chordGrid.placeAuto")}
              </Button>
            </div>
          ) : null}
          {tools ? (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="chord-grid-bar-tools">
              <span className="mr-1 font-medium">{t("bars.bar", { n: tools.bar.index + 1 })}</span>
              <Button type="button" variant="outline" size="icon" className="size-8" onClick={tools.shorter} disabled={tools.bar.beats <= 1} aria-label={t("chordGrid.shorter")} data-testid="chord-grid-shorter">
                <Minus />
              </Button>
              <span className="min-w-14 text-center tabular-nums" data-testid="chord-grid-beats">
                {t("chordGrid.beats", { count: tools.bar.beats })}
              </span>
              <Button type="button" variant="outline" size="icon" className="size-8" onClick={tools.longer} disabled={tools.bar.beats >= 32} aria-label={t("chordGrid.longer")} data-testid="chord-grid-longer">
                <Plus />
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={tools.before} data-testid="chord-grid-add-before">
                {t("chordGrid.addBefore")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={tools.after} data-testid="chord-grid-add-after">
                {t("chordGrid.addAfter")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={tools.remove} disabled={tools.bar.chords.length > 0 || tools.bar.barsInPass <= 1} data-testid="chord-grid-remove">
                <Trash2 />
                {t("chordGrid.remove")}
              </Button>
            </div>
          ) : null}
          {problem ? (
            <p className="text-destructive" role="alert" data-testid="chord-grid-problem">
              {problem}
            </p>
          ) : null}
        </div>
      ) : null}
      <div ref={grid} className="flex flex-col gap-5" data-testid="chord-grid" data-source={source ?? undefined} data-editing={editing ? "" : undefined} data-lyrics={lyrics}>
        {lyrics === "pinned" ? (
          <>
            {/* The row being played, pinned at the top; the words scrolling under it. */}
            <div className="sticky top-(--grid-sticky-top,0px) z-10 -mx-1 border-b bg-card px-1 pt-1 pb-2" data-testid="chord-grid-pinned">
              {passes.flatMap(({ passIndex, bars: passBars }) =>
                rowsOf(passBars).map((row) => (
                  <div key={row[0]!.index} className="hidden data-[shown]:block" data-grid-row="" data-bars={row.map((bar) => bar.index).join(" ")}>
                    {passHeading(passIndex)}
                    <div className="grid" style={rowStyle(passIndex)}>
                      {row.map(gridBar)}
                    </div>
                  </div>
                )),
              )}
            </div>
            <div className="flex flex-col gap-4" data-testid="chord-grid-lyrics">
              {chart.passes.map((pass, passIndex) => {
                const lines = pass.lines.filter((line) => line.text.trim());
                if (lines.length === 0) return null;
                return (
                  <section key={pass.id}>
                    {passHeading(passIndex)}
                    {lines.map((line) => (
                      <p
                        key={line.id}
                        className="py-0.5 text-2xl leading-snug text-muted-foreground transition-colors duration-100 data-[on]:font-semibold data-[on]:text-foreground"
                        data-lyric-line={`${pass.id}:${line.id}`}
                      >
                        {line.text}
                      </p>
                    ))}
                  </section>
                );
              })}
            </div>
          </>
        ) : (
          passes.map(({ passIndex, bars: passBars }) => (
            <section key={chart.passes[passIndex]!.id} data-pass={chart.passes[passIndex]!.id} data-testid="chord-grid-pass">
              {passHeading(passIndex)}
              {lyrics === "between" ? (
                rowsOf(passBars).map((row) => {
                  const pieces = row.flatMap((bar) => wordsOf(bar).map((piece) => ({ ...piece, bar: bar.index })));
                  return (
                    <div key={row[0]!.index}>
                      <div className="grid" style={rowStyle(passIndex)}>
                      {row.map(gridBar)}
                    </div>
                      {pieces.length > 0 ? (
                        <p className="px-1.5 pt-1 pb-3 text-lg leading-snug text-foreground/70" data-testid="chord-grid-lyric-row">
                          {pieces.map((piece, at) => (
                            <span
                              key={at}
                              className={cn("transition-colors duration-75 data-[on]:font-medium data-[on]:text-foreground", at > 0 && pieces[at - 1]!.lineId !== piece.lineId && "ml-3")}
                              data-lyric-bar={piece.bar}
                            >
                              {piece.text}
                            </span>
                          ))}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="grid gap-y-2" style={rowStyle(passIndex)} data-testid="chord-grid-bars" data-per-row={perRowOf(passIndex)}>
                  {passBars.map(gridBar)}
                </div>
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * One bar: its number, a block a beat - with the chord where it changes -
 * and its words. A bar line at its left, and at its right at the
 * end of a row or of its section. A tap plays from it; in Edit, each beat
 * is two places to put a chord (the beat and its "and").
 */
function GridBar({
  bar,
  rowEnd,
  words,
  showWords,
  lines,
  places,
  pickedBeat,
  chordColors,
  editing,
  locked,
  picked,
  pickedBar,
  looped,
  playable,
  onTap,
  onSlot,
  onLetter,
  chordEvents,
}: {
  bar: ChartBar;
  /** The last bar of its row: a bar line at its right too. */
  rowEnd: boolean;
  /** Where its words are in the lines (`barLyricSpans`); null for none to sing. */
  words: BarLyricSpan[] | null;
  /** Its words in it: not when they're between the rows, under a pinned row, or off. */
  showWords: boolean;
  lines: readonly { id: string; text: string }[];
  /** Where each of its beats is sung (`barBeatPlaces`). */
  places: readonly (BeatPlace | null)[];
  /** In Edit, its beat picked to place in the words (1-based). */
  pickedBeat: number | null;
  chordColors: boolean;
  editing: boolean;
  /** In Edit, a pass that can't be edited here (it leaves some of its section's lines out). */
  locked: boolean;
  picked: { chordId: string } | null;
  pickedBar: boolean;
  looped: boolean;
  playable: boolean;
  onTap: () => void;
  onSlot: (beat: number) => void;
  /** In Edit with a beat picked: a letter tapped to sing it on. */
  onLetter?: (letter: { lineId: string; at: number }) => void;
  chordEvents: {
    down: (event: ReactPointerEvent, bar: ChartBar, chord: ChartBarChord) => void;
    beatDown: (event: ReactPointerEvent, bar: ChartBar, beat: number) => void;
    move: (event: ReactPointerEvent) => void;
    up: (event: ReactPointerEvent) => void;
    cancel: () => void;
  };
}) {
  const { t } = useTranslation();
  const beats = Array.from({ length: bar.beats }, (_, beat) => bar.chords.filter((chord) => Math.floor(chord.beat) - 1 === beat));
  const chordLabel = (chord: ChartBarChord) => (
    <span
      key={chord.id}
      className={cn(
        "text-base font-bold whitespace-nowrap",
        chordColors && chord.family && FAMILY_COLORS[chord.family],
        editing && "cursor-grab touch-none rounded-sm px-0.5 ring-primary select-none hover:ring-1",
        editing && picked?.chordId === chord.id && "bg-primary text-primary-foreground ring-2",
      )}
      data-grid-chord={chord.label}
      data-beat-at={chord.beat}
      onPointerDown={editing ? (event) => chordEvents.down(event, bar, chord) : undefined}
      onPointerMove={editing ? chordEvents.move : undefined}
      onPointerUp={editing ? chordEvents.up : undefined}
      onPointerCancel={editing ? chordEvents.cancel : undefined}
      // Picked or dropped by the pointer's own handlers: not a tap on the beat it's in.
      onClick={editing ? (event) => event.stopPropagation() : undefined}
    >
      {chord.label}
    </span>
  );
  const interactive = playable || editing;
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col border-l-2 border-foreground/70 px-1 pt-3.5 pb-1 transition-colors duration-75",
        rowEnd && "border-r-2",
        "data-[on]:bg-primary/10",
        interactive && "cursor-pointer hover:bg-accent/60",
        looped && "bg-amber-500/10 shadow-[inset_0_-3px_0_0] shadow-amber-500",
        pickedBar && "outline-2 outline-primary",
        locked && "opacity-50",
      )}
      data-grid-bar={bar.index}
      data-looped={looped ? "" : undefined}
      role={playable ? "button" : undefined}
      tabIndex={playable ? 0 : undefined}
      aria-label={playable ? t("chordGrid.playFrom", { n: bar.index + 1 }) : t("bars.bar", { n: bar.index + 1 })}
      onClick={interactive ? onTap : undefined}
      onKeyDown={
        playable
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onTap();
            }
          : undefined
      }
    >
      <span className="absolute top-0 left-1 text-[10px] leading-3.5 text-muted-foreground tabular-nums">
        {bar.index + 1}
      </span>
      <div className="flex h-8 items-center">
        {beats.map((chords, beat) =>
          editing ? (
            // Two places a beat: on it, and its "and".
            <div key={beat} className="flex h-full min-w-0 flex-1 rounded-sm border border-dashed border-muted-foreground/30" data-grid-beat={beat}>
              {[1, 1.5].map((half) => {
                const at = beat + half;
                const here = chords.filter((chord) => (chord.beat - beat - 1 < 0.5 ? half === 1 : half === 1.5));
                return (
                  <div
                    key={half}
                    role="button"
                    tabIndex={0}
                    className={cn("flex min-w-0 flex-1 items-center justify-center data-[drop]:bg-primary/20", picked && "hover:bg-primary/10", half === 1.5 && "border-l border-dotted border-muted-foreground/20")}
                    data-grid-slot=""
                    data-bar={bar.index}
                    data-beat={at}
                    aria-label={half === 1 ? t("chordGrid.beat", { n: beat + 1 }) : t("chordGrid.and", { n: beat + 1 })}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSlot(at);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      onSlot(at);
                    }}
                  >
                    {here.length > 0 ? here.map(chordLabel) : <span className="text-[10px] text-muted-foreground/40">{half === 1 ? beat + 1 : "+"}</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              key={beat}
              className="mx-0.5 flex min-w-0 flex-1 items-center self-stretch rounded-sm bg-muted px-1 transition-colors duration-75 data-[on]:bg-foreground data-[on]:text-background"
              data-grid-beat={beat}
            >
              {chords.some((chord) => chord.beat - beat - 1 >= 0.5) ? (
                // A chord on the "and": the beat in two halves, a chord in each.
                [chords.filter((chord) => chord.beat - beat - 1 < 0.5), chords.filter((chord) => chord.beat - beat - 1 >= 0.5)].map((half, at) => (
                  <span key={at} className={cn("flex min-w-0 flex-1 items-center overflow-hidden text-sm [&>*]:text-sm", at === 1 && "border-l border-background/60 pl-1")} data-grid-half={at === 0 ? "beat" : "and"}>
                    {half.map(chordLabel)}
                  </span>
                ))
              ) : chords.length > 0 ? (
                chords.map(chordLabel)
              ) : beat === 0 && bar.carried ? (
                // Held on from the bar before: named again, quietly.
                <span className="text-base font-bold whitespace-nowrap text-muted-foreground/60" data-grid-carried={bar.carried.label}>
                  {bar.carried.label}
                </span>
              ) : null}
            </div>
          ),
        )}
      </div>
      {showWords ? <BarWords bar={bar} spans={words} lines={lines} places={places} editing={editing} pickedBeat={pickedBeat} onLetter={onLetter} chordEvents={chordEvents} /> : null}
    </div>
  );
}

/**
 * A bar's words, cut at the beats sung in them: the words of the beat being
 * played light up. In Edit, every letter is a place to put a beat, and each
 * beat is a number before the letter it's sung on - dragged or tapped, then
 * the letter - a beat held over a word right after the one before it.
 */
function BarWords({
  bar,
  spans,
  lines,
  places,
  editing,
  pickedBeat,
  onLetter,
  chordEvents,
}: {
  bar: ChartBar;
  spans: BarLyricSpan[] | null;
  lines: readonly { id: string; text: string }[];
  places: readonly (BeatPlace | null)[];
  editing: boolean;
  pickedBeat: number | null;
  onLetter?: (letter: { lineId: string; at: number }) => void;
  chordEvents: { beatDown: (event: ReactPointerEvent, bar: ChartBar, beat: number) => void; move: (event: ReactPointerEvent) => void; up: (event: ReactPointerEvent) => void; cancel: () => void };
}) {
  const { t } = useTranslation();
  const textOf = (lineId: string) => lines.find((line) => line.id === lineId)?.text ?? "";
  const pieces = (spans ?? []).map((span) => ({ ...span, text: textOf(span.lineId) }));
  const sung = pieces.some((piece) => piece.text.slice(piece.from, piece.to).trim());
  // Beats not placed in the words (held over a word) go with the one before.
  const held = (beat: number) => {
    const after: number[] = [];
    for (let next = beat + 1; next < places.length && !places[next]; next++) after.push(next);
    return after;
  };
  const tick = (beat: number) => {
    const place = places[beat] ?? null;
    return (
      <span
        key={`tick-${beat}`}
        role="button"
        tabIndex={0}
        className={cn(
          "mr-px inline-block cursor-grab touch-none rounded-sm px-0.5 align-super text-[9px] leading-3 font-semibold tabular-nums select-none",
          place ? (place.placed ? "bg-primary/80 text-primary-foreground" : "bg-muted-foreground/20 text-foreground") : "border border-dashed border-muted-foreground/50 text-muted-foreground",
          beat === 0 && "rounded-l-none border-l-2 border-foreground/70",
          pickedBeat === beat + 1 && "ring-2 ring-primary",
        )}
        data-beat-tick={beat + 1}
        data-placed={place?.placed ? "" : undefined}
        aria-label={t("chordGrid.beatTick", { n: beat + 1, bar: bar.index + 1 })}
        onPointerDown={(event) => chordEvents.beatDown(event, bar, beat + 1)}
        onPointerMove={chordEvents.move}
        onPointerUp={chordEvents.up}
        onPointerCancel={chordEvents.cancel}
        onClick={(event) => event.stopPropagation()}
      >
        {beat + 1}
      </span>
    );
  };
  if (editing && spans && (sung || bar.lineId !== null)) {
    const ticked = new Set<number>();
    const ticksAt = (lineId: string, at: number) =>
      places.flatMap((place, beat) => {
        if (!place || place.lineId !== lineId || place.at !== at || ticked.has(beat)) return [];
        for (const one of [beat, ...held(beat)]) ticked.add(one);
        return [tick(beat), ...held(beat).map(tick)];
      });
    const content = pieces.flatMap((piece) =>
      [...piece.text.slice(piece.from, piece.to)].map((letter, offset) => {
        const at = piece.from + offset;
        if (/\s/.test(letter)) return <span key={`${piece.lineId}-${at}`}> </span>;
        return (
          <span key={`${piece.lineId}-${at}`}>
            {ticksAt(piece.lineId, at)}
            <span
              className={cn("rounded-[2px] data-[drop]:bg-primary/30", onLetter && "cursor-pointer hover:bg-primary/15")}
              data-letter=""
              data-line={piece.lineId}
              data-at={at}
              onClick={
                onLetter
                  ? (event) => {
                      event.stopPropagation();
                      onLetter({ lineId: piece.lineId, at });
                    }
                  : undefined
              }
            >
              {letter}
            </span>
          </span>
        );
      }),
    );
    // A bar whose words carry on: its beats wait to be put in them.
    const rest = places.map((_, beat) => beat).filter((beat) => !ticked.has(beat));
    return (
      <p className="min-h-5 text-sm leading-6 break-words text-muted-foreground" data-grid-words="">
        {rest.length > 0 && !sung ? rest.map(tick) : null}
        {content}
        {rest.length > 0 && sung ? rest.map(tick) : null}
      </p>
    );
  }
  // Read: the words, a piece a beat sung in them.
  const parts: { beat: number; text: string }[] = [];
  for (const piece of pieces) {
    let from = piece.from;
    const cuts = places.flatMap((place, beat) => (place && place.lineId === piece.lineId && place.at > piece.from && place.at < piece.to ? [{ beat, at: place.at }] : []));
    let beat = parts.at(-1)?.beat ?? 0;
    // The words before a line's first bar line, sung on from the line above: a space between.
    if (parts.length > 0) parts.push({ beat, text: " " });
    for (const cut of cuts) {
      parts.push({ beat, text: piece.text.slice(from, cut.at) });
      from = cut.at;
      beat = cut.beat;
    }
    parts.push({ beat, text: piece.text.slice(from, piece.to) });
  }
  return (
    <p className="min-h-5 truncate text-sm text-muted-foreground" data-grid-words="">
      {parts.map((part, index) =>
        part.text.trim() ? (
          <span key={index} className="rounded-sm data-[on]:text-foreground data-[on]:underline data-[on]:decoration-primary data-[on]:decoration-2 data-[on]:underline-offset-4" data-word-beat={part.beat}>
            {part.text}
          </span>
        ) : (
          part.text && <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}
