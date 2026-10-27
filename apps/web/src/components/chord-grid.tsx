import {
  barAt,
  barLyrics,
  chartBars,
  editableRhythm,
  insertRhythmBar,
  moveRhythmChord,
  removeRhythmBar,
  setRhythmBarBeats,
  structureOf,
  type ChartBar,
  type ChartBarChord,
  type RenderedChart,
  type Rhythm,
  type SongDocumentV2,
} from "@oneverse/core";
import { Check, Minus, Pause, Pencil, Play, Plus, Repeat, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { GROUP_COLORS } from "#/components/bars-row";
import { FAMILY_COLORS, passLabel } from "@oneverse/screen/components/song-chart";
import { useBarsClock } from "#/lib/bars-clock";
import { useGridPlayer, type GridPlayer } from "#/lib/grid-player";
import { Button } from "@oneverse/ui/components/button";
import { cn } from "@oneverse/ui/lib/utils";

type Sections = SongDocumentV2["sections"];

/** A pointer that went down on a chord in Edit: a drag once it's moved, else a tap. */
type ChordPress = { pointerId: number; x: number; y: number; sectionId: string; chordId: string; dragging: boolean };

/** How far a pointer moves before a press on a chord is a drag (px). */
const DRAG_FROM = 6;

/**
 * The chord grid (issue #238), a way to read a song as Chart and PDF are:
 * its chords in bars, four to a row (two on a phone), each section under
 * its name, a bar's number over it, its beats as slashes with the chord on
 * the beat it changes on, and the words sung in it underneath (Moises' bars
 * with the lyrics). The chords read as on the chart: transposed, capo,
 * names, colours. As the music plays (`useBarsClock`: the stems, the
 * metronome or the Sync leader's), the bar and the beat being played light
 * up, and the bar is kept in view.
 *
 * It plays too: Play, a tap on a bar to play from there, and Loop to go
 * over some bars again - the stems the page has loaded, else the click
 * (`useGridPlayer`). With `onSave` (whoever can edit the song), Edit bars
 * places its chords on beats (the right half of a beat is its "and"),
 * dragged or tapped there, and adds, removes or shortens bars (a pickup, a
 * 2/4 bar), saved as each section's rhythm - every pass of a section has
 * the same bars.
 */
export function ChordGrid({
  songId,
  chart,
  document,
  chordColors = false,
  emptyText,
  className,
  onSave,
}: {
  songId: string;
  chart: RenderedChart;
  /** The song itself, for its sections' own bars (`rhythm`); without it, bars are filled in from the chart. */
  document?: Pick<SongDocumentV2, "sections"> | null;
  chordColors?: boolean;
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
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Loop: the first bar tapped, waiting for the last.
  const [choosingLoop, setChoosingLoop] = useState<{ first: number | null } | null>(null);
  const shown = useMemo(
    () => (document && Object.keys(draft).length > 0 ? { sections: document.sections.map((section) => (draft[section.id] ? { ...section, rhythm: draft[section.id] } : section)) } : document),
    [document, draft],
  );
  const bars = useMemo(() => chartBars(chart, shown), [chart, shown]);
  const words = useMemo(() => barLyrics(chart, bars), [chart, bars]);
  const steps = useMemo(() => structureOf(chart), [chart]);
  const { source, position } = useBarsClock(songId, bars);
  const player = useGridPlayer(songId, bars, chart);
  const grid = useRef<HTMLDivElement>(null);
  const press = useRef<ChordPress | null>(null);
  const changed = Object.keys(draft).length > 0;
  const canEdit = !!onSave && !!document;

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

  // A chord dragged onto a beat, or tapped to pick it.
  const chordDown = (event: ReactPointerEvent, bar: ChartBar, chord: ChartBarChord) => {
    if (!editable(bar)) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    press.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, sectionId: bar.sectionId, chordId: chord.id, dragging: false };
  };
  const slotUnder = (x: number, y: number) => window.document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-grid-slot]") ?? null;
  const chordMove = (event: ReactPointerEvent) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.dragging && Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_FROM) return;
    current.dragging = true;
    for (const element of grid.current?.querySelectorAll<HTMLElement>("[data-drop]") ?? []) delete element.dataset.drop;
    const slot = slotUnder(event.clientX, event.clientY);
    if (slot) slot.dataset.drop = "";
  };
  const chordUp = (event: ReactPointerEvent) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    press.current = null;
    for (const element of grid.current?.querySelectorAll<HTMLElement>("[data-drop]") ?? []) delete element.dataset.drop;
    const chord = { sectionId: current.sectionId, chordId: current.chordId };
    if (!current.dragging) {
      const same = picked?.chordId === chord.chordId;
      setPicked(same ? null : chord);
      setProblem(null);
      return;
    }
    const slot = slotUnder(event.clientX, event.clientY);
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

  // Frame by frame, without rendering again: the bar and beat being played lit, the bar kept in view.
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const barElements = element.querySelectorAll<HTMLElement>("[data-grid-bar]");
    let litBar: HTMLElement | null = null;
    let litBeat: HTMLElement | null = null;
    const light = (bar: number | null, beat: number) => {
      if (litBar) delete litBar.dataset.on;
      if (litBeat) delete litBeat.dataset.on;
      litBar = bar === null ? null : (barElements[bar] ?? null);
      litBeat = litBar?.querySelectorAll<HTMLElement>("[data-grid-beat]")[beat] ?? null;
      if (litBar) litBar.dataset.on = "";
      if (litBeat) litBeat.dataset.on = "";
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
        if (where && where.bar !== shownBar && litBar) {
          // Kept in view, without moving the page under the reader for every bar: only when it nears an edge.
          const box = litBar.getBoundingClientRect();
          if (box.top < window.innerHeight * 0.15 || box.bottom > window.innerHeight * 0.75) litBar.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        shownBar = where?.bar ?? -1;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      light(null, 0);
    };
  }, [position, bars]);

  if (bars.length === 0) return <p className="text-sm text-muted-foreground">{emptyText ?? t("chart.empty")}</p>;
  const tools = editing && pickedBar !== null && bars[pickedBar] && editable(bars[pickedBar]) ? { bar: bars[pickedBar], ...barTools(bars[pickedBar]) } : null;
  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="chord-grid-area">
      <GridToolbar
        player={player}
        editing={editing}
        canEdit={canEdit}
        changed={changed}
        saving={saving}
        choosingLoop={choosingLoop}
        onLoop={() => (player.looped ? player.loop(null) : setChoosingLoop(choosingLoop ? null : { first: null }))}
        onEdit={() => {
          setChoosingLoop(null);
          setEditing(true);
        }}
        onCancel={stopEditing}
        onSave={() => void save()}
      />
      {editing ? (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-2 text-sm" data-testid="chord-grid-edit">
          <p className="text-muted-foreground">{picked ? t("chordGrid.pickBeat") : t("chordGrid.editHint")}</p>
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
      ) : choosingLoop ? (
        <p className="rounded-md border bg-muted/40 p-2 text-sm text-muted-foreground" data-testid="chord-grid-loop-hint">
          {choosingLoop.first === null ? t("chordGrid.loopFirst") : t("chordGrid.loopLast", { n: choosingLoop.first + 1 })}
        </p>
      ) : null}
      <div ref={grid} className="flex flex-col gap-5" data-testid="chord-grid" data-source={source ?? undefined} data-editing={editing ? "" : undefined}>
        {passes.map(({ passIndex, bars: passBars }) => {
          const pass = chart.passes[passIndex]!;
          const step = steps[passIndex];
          const heading = pass.section.showLabel === false ? null : passLabel(pass, t);
          return (
            <section key={pass.id} data-pass={pass.id} data-testid="chord-grid-pass">
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
              <div className="grid grid-cols-2 gap-y-2 sm:grid-cols-4">
                {passBars.map((bar) => (
                  <GridBar
                    key={bar.index}
                    bar={bar}
                    words={words[bar.index] ?? null}
                    chordColors={chordColors}
                    editing={editable(bar)}
                    locked={editing && !editable(bar)}
                    picked={picked}
                    pickedBar={editing && pickedBar === bar.index}
                    looped={!!player.looped && bar.index >= player.looped.first && bar.index <= player.looped.last}
                    playable={!editing && !player.following && player.source !== null}
                    onTap={() => tapBar(bar)}
                    onSlot={(beat) => place(bar, beat)}
                    chordEvents={{ down: chordDown, move: chordMove, up: chordUp, cancel: chordCancel }}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Play, Loop and Edit bars over the grid; in Edit, Save and Cancel. */
function GridToolbar({
  player,
  editing,
  canEdit,
  changed,
  saving,
  choosingLoop,
  onLoop,
  onEdit,
  onCancel,
  onSave,
}: {
  player: GridPlayer;
  editing: boolean;
  canEdit: boolean;
  changed: boolean;
  saving: boolean;
  choosingLoop: { first: number | null } | null;
  onLoop: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  if (editing)
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="chord-grid-toolbar">
        <span className="mr-auto text-sm font-medium">{t("chordGrid.editing")}</span>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving} data-testid="chord-grid-cancel">
          <X />
          {t("chordGrid.cancel")}
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={!changed || saving} data-testid="chord-grid-save">
          <Check />
          {t("chordGrid.save")}
        </Button>
      </div>
    );
  const label = player.following
    ? t("bars.followingLeader", { name: player.following })
    : player.playing
      ? t("chordGrid.pause")
      : player.source === "stems"
        ? t("chordGrid.playRecording")
        : player.source === "click"
          ? t("chordGrid.playClick")
          : t("bars.noTempo");
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="chord-grid-toolbar">
      <Button type="button" variant="outline" size="sm" onClick={player.toggle} disabled={!player.source && !player.following} aria-pressed={player.playing} data-testid="chord-grid-play">
        {player.playing ? <Pause /> : <Play />}
        {label}
      </Button>
      {player.canLoop ? (
        <Button type="button" variant={player.looped || choosingLoop ? "secondary" : "outline"} size="sm" onClick={onLoop} aria-pressed={!!player.looped} data-testid="chord-grid-loop">
          <Repeat />
          {player.looped ? t("chordGrid.loopOff", { first: player.looped.first + 1, last: player.looped.last + 1 }) : t("chordGrid.loop")}
        </Button>
      ) : null}
      {player.source && !player.following ? <span className="text-xs text-muted-foreground max-sm:hidden">{t("chordGrid.tapHint")}</span> : null}
      {canEdit ? (
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onEdit} data-testid="chord-grid-edit-start">
          <Pencil />
          {t("chordGrid.edit")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * One bar: its number, a cell a beat - the chord where it changes, else a
 * slash - and its words. A bar line at its left, and at its right at the
 * end of a row or of its section. A tap plays from it; in Edit, each beat
 * is two places to put a chord (the beat and its "and").
 */
function GridBar({
  bar,
  words,
  chordColors,
  editing,
  locked,
  picked,
  pickedBar,
  looped,
  playable,
  onTap,
  onSlot,
  chordEvents,
}: {
  bar: ChartBar;
  words: string | null;
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
  chordEvents: { down: (event: ReactPointerEvent, bar: ChartBar, chord: ChartBarChord) => void; move: (event: ReactPointerEvent) => void; up: (event: ReactPointerEvent) => void; cancel: () => void };
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
        "last:border-r-2 max-sm:even:border-r-2 sm:nth-[4n]:border-r-2",
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
            <div key={beat} className="flex min-w-0 flex-1 items-center rounded-sm px-0.5 data-[on]:bg-foreground data-[on]:text-background" data-grid-beat={beat}>
              {chords.length > 0 ? (
                chords.map(chordLabel)
              ) : beat === 0 && bar.carried ? (
                // Held on from the bar before: named again, quietly.
                <span className="text-base font-bold whitespace-nowrap text-muted-foreground/60" data-grid-carried={bar.carried.label}>
                  {bar.carried.label}
                </span>
              ) : (
                <span className="text-muted-foreground/50" aria-hidden>
                  /
                </span>
              )}
            </div>
          ),
        )}
      </div>
      <p className="min-h-5 truncate text-sm text-muted-foreground" data-grid-words="">
        {words}
      </p>
    </div>
  );
}
