import {
  barAt,
  barBeatPlaces,
  barLyricSpans,
  beatPlaceRange,
  chartBars,
  copyRhythmPlacement,
  editableRhythm,
  isKeyChord,
  matchingSections,
  moveChordInRhythm,
  nudgeChordInRhythm,
  pinRhythmChord,
  samePlacement,
  setRhythmBarCount,
  type RhythmMove,
  type RhythmMoveMode,
  insertRhythmBar,
  placeRhythmBeat,
  removeRhythmBar,
  setRhythmBarBeats,
  structureOf,
  wordStart,
  type BarLyricSpan,
  type BeatPlace,
  type ChartBar,
  type ChartBarChord,
  type RenderedChart,
  type Rhythm,
  type SongDocumentV2,
  type GridBarsPerRowValue,
} from "@oneverse/core";
import { Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Crosshair, Link2, Minus, Pencil, Pin, PinOff, Plus, Repeat, Trash2, Waves, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GROUP_COLORS } from "#/components/bars-row";
import { keepInView } from "#/lib/follow-view";
import { FAMILY_COLORS, passLabel } from "@oneverse/screen/components/song-chart";
import { useBarsClock } from "#/lib/bars-clock";
import { useFollowMusic } from "#/lib/follow-music";
import { useGridPlayer } from "#/lib/grid-player";
import { useGridLyrics, type GridLyrics } from "#/lib/grid-lyrics";
import { registerGrid, type GridControls } from "#/lib/grid-controls";
import { Button } from "@oneverse/ui/components/button";
import { cn } from "@oneverse/ui/lib/utils";

type Sections = SongDocumentV2["sections"];

/** A pointer that went down on a chord, or on a beat in the words, in Edit: a drag once it's moved, else a tap. */
type ChordPress = { pointerId: number; x: number; y: number; dragging: boolean } & ({ sectionId: string; chordId: string; passIndex: number } | { bar: number; beat: number });

/** A chord picked in Edit, in the pass it was picked in (a section's passes share its bars). */
type PickedChord = { sectionId: string; chordId: string; passIndex?: number };

/** What the picked chord's toolbar does (issue #462): a beat or a bar earlier or later, pinned or unpinned, let go. */
type ChordTools = { nudge: (by: number) => void; pin: () => void; done: () => void; key: boolean; where: string; barBeats: number };

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
 * two lines pinned at the bottom, the one being sung and the next, the
 * grid taking the rest (issue #408), or
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
  onChange,
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
  /**
   * Edit bars always on, every change handed over as it's made (the song editor's Bars, issue #465): no Cancel or
   * Save of its own, the editor saves the song.
   */
  onChange?: (sections: Sections) => void;
}) {
  const { t } = useTranslation();
  // Edit bars: each section's rhythm as changed and not saved yet.
  const [editing, setEditing] = useState(!!onChange);
  const [draft, setDraft] = useState<Record<string, Rhythm>>({});
  const [picked, setPicked] = useState<PickedChord | null>(null);
  // Issue #462: how the chords around one move, where a dragged chord would go, the sections offered the same bars, the ones linked in this edit.
  const [mode, setMode] = useState<RhythmMoveMode>("inPlace");
  const [hover, setHoverState] = useState<{ bar: number; beat: number } | null>(null);
  // What Edit said as a drag started, keeping its room while the drag says what it would move.
  const dragIdle = useRef<string | null>(null);
  const hoverRef = useRef<{ bar: number; beat: number } | null>(null);
  const setHover = (next: { bar: number; beat: number } | null) => {
    if (hoverRef.current?.bar === next?.bar && hoverRef.current?.beat === next?.beat) return;
    hoverRef.current = next;
    setHoverState(next);
  };
  const [offer, setOffer] = useState<{ from: string; to: string[] } | null>(null);
  const [links, setLinks] = useState<string[][]>([]);
  const [keepLinked, setKeepLinked] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const refocus = useRef<{ chordId: string; passIndex?: number } | null>(null);
  const press = useRef<ChordPress | null>(null);
  // The chord being dragged (a press that moved), for the preview.
  const [dragged, setDragged] = useState<PickedChord | null>(null);
  // A chord pointed at or focused, or its syllable (issue #477): its syllable lit.
  const [pointedChord, setPointedChord] = useState<string | null>(null);
  const litChord = dragged?.chordId ?? pointedChord ?? picked?.chordId ?? null;
  // The bars without a drag's preview, for the drop targets under the pointer.
  const chartBarsRef = useRef<ChartBar[]>([]);
  const [pickedBar, setPickedBar] = useState<number | null>(null);
  const [pickedBeat, setPickedBeat] = useState<PickedBeat | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Loop: the first bar tapped, waiting for the last.
  const [choosingLoop, setChoosingLoop] = useState<{ first: number | null } | null>(null);
  const sectionById = (id: string) => document?.sections.find((section) => section.id === id) ?? null;
  // A section's time signature's top number: its first pass's.
  const timeBeatsOf = (sectionId: string) => Math.max(1, (chart.passes.find((pass) => pass.section.id === sectionId)?.timeSignature ?? chart.timeSignature)?.numerator ?? 4);
  const rhythmOfSection = (id: string) => {
    const section = sectionById(id);
    return section ? (draft[id] ?? editableRhythm(section, timeBeatsOf(id))) : null;
  };
  const moveOf = (chord: PickedChord, target: { bar: number; beat: number } | { by: number }): RhythmMove | null => {
    const section = sectionById(chord.sectionId);
    const rhythm = rhythmOfSection(chord.sectionId);
    if (!section || !rhythm) return null;
    const beats = timeBeatsOf(chord.sectionId);
    return "by" in target ? nudgeChordInRhythm(section, rhythm, chord.chordId, target.by, mode, beats) : moveChordInRhythm(section, rhythm, chord.chordId, target.bar, target.beat, mode, beats);
  };
  // While a chord is dragged: where it would go, and what moves with it.
  const preview = useMemo(() => {
    if (!hover || !dragged || !editing) return null;
    const bar = chartBarsRef.current[hover.bar];
    if (!bar || bar.sectionId !== dragged.sectionId) return null;
    return { ...dragged, move: moveOf(dragged, { bar: bar.barInPass, beat: hover.beat }), at: hover };
  }, [hover, dragged?.chordId, draft, mode, editing]);
  const shown = useMemo(() => {
    if (!document) return document;
    const extra: Record<string, Rhythm> = {};
    if (preview?.move?.ok) extra[preview.sectionId] = preview.move.rhythm;
    // The sections offered the same bars, shown as they would be (dashed).
    if (offer) {
      const from = document.sections.find((section) => section.id === offer.from);
      const rhythm = draft[offer.from];
      for (const id of offer.to) {
        const to = document.sections.find((section) => section.id === id);
        const copy = from && rhythm && to ? copyRhythmPlacement(from, rhythm, to) : null;
        if (copy) extra[id] = copy;
      }
    }
    const rhythms = { ...draft, ...extra };
    return Object.keys(rhythms).length > 0 ? { sections: document.sections.map((section) => (rhythms[section.id] ? { ...section, rhythm: rhythms[section.id] } : section)) } : document;
  }, [document, draft, preview, offer]);
  const bars = useMemo(() => chartBars(chart, shown), [chart, shown]);
  if (!preview) chartBarsRef.current = bars;
  // Key chords (issue #462): pinned, or on beat 1 unless unpinned - dark with a pin in Edit.
  const keyChords = useMemo(() => {
    const keys = new Set<string>();
    if (!editing || !shown) return keys;
    for (const section of shown.sections) for (const bar of editableRhythm(section, timeBeatsOf(section.id)).bars) for (const chord of bar.chords) if (isKeyChord(chord)) keys.add(chord.chordId);
    return keys;
  }, [editing, shown]);
  // The chords moving with a dragged one, shown so.
  const moving = useMemo(() => new Set(preview?.move?.ok ? preview.move.moved : []), [preview]);
  const spans = useMemo(() => barLyricSpans(chart, bars), [chart, bars]);
  const places = useMemo(() => barBeatPlaces(chart, bars), [chart, bars]);
  const steps = useMemo(() => structureOf(chart), [chart]);
  const { source, position } = useBarsClock(songId, bars);
  // Scrolled with the music unless that's turned off on the device (issue #501).
  const follow = useFollowMusic();
  const player = useGridPlayer(songId, bars, chart);
  const grid = useRef<HTMLDivElement>(null);
  const changed = Object.keys(draft).length > 0;
  const canEdit = (!!onSave || !!onChange) && !!document;
  // In the song editor, each change goes to it as it's made.
  const reported = useRef(draft);
  useEffect(() => {
    if (!onChange || !document || draft === reported.current) return;
    reported.current = draft;
    onChange(document.sections.map((section) => (draft[section.id] ? { ...section, rhythm: draft[section.id] } : section)) as Sections);
  }, [draft]);
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
  const rhythmOf = (bar: ChartBar) => rhythmOfSection(bar.sectionId);
  const beatsOf = (bar: ChartBar) => Math.max(1, (chart.passes[bar.passIndex]?.timeSignature ?? chart.timeSignature)?.numerator ?? 4);
  // Each section's bars as shown (a drag's preview too), to tell a pass that has them all.
  const shownBars = useMemo(() => new Map((shown?.sections ?? []).map((section) => [section.id, editableRhythm(section, timeBeatsOf(section.id)).bars.length])), [shown]);
  /** A pass whose bars are its section's rhythm, one for one: not one that leaves some of its lines out. */
  const editable = (bar: ChartBar) => editing && shownBars.get(bar.sectionId) === bar.barsInPass;
  // A section's name, as its first pass is headed.
  const sectionName = (id: string) => {
    const pass = chart.passes.find((one) => one.section.id === id);
    return (pass && passLabel(pass, t)) || t("chordGrid.thisSection");
  };
  const chordName = (id: string) => bars.flatMap((bar) => bar.chords).find((chord) => chord.id === id)?.label ?? "";
  const problemOf = (move: RhythmMove): string => {
    if (move.ok) return "";
    if (move.problem === "order") return t("chordGrid.passOrder", { chord: chordName(move.chordId) });
    if (move.problem === "pinned") return t("chordGrid.passPinned", { chord: chordName(move.chordId) });
    if (move.problem === "room") return t("chordGrid.noRoom");
    return t(mode === "inPlace" ? "chordGrid.outsideInPlace" : "chordGrid.cantPlace");
  };
  /**
   * A section's bars changed (issue #462): in the sections with the same
   * chords and words too, and in those linked to it in this edit; the ones
   * with the same chords to other words are offered them.
   */
  const commit = (sectionId: string, next: Rhythm) => {
    const section = sectionById(sectionId);
    if (!section || !document) return;
    const updates: Record<string, Rhythm> = { [sectionId]: next };
    const linked = new Set(links.find((group) => group.includes(sectionId)) ?? []);
    const followed: string[] = [];
    const offered: string[] = [];
    for (const match of matchingSections(document.sections, sectionId)) {
      const other = sectionById(match.sectionId)!;
      if (match.same === "words" || linked.has(match.sectionId)) {
        const copy = copyRhythmPlacement(section, next, other);
        if (copy) {
          updates[match.sectionId] = copy;
          followed.push(match.sectionId);
        }
      } else if (!samePlacement(section, next, other, rhythmOfSection(match.sectionId)!, timeBeatsOf(sectionId))) offered.push(match.sectionId);
    }
    setProblem(null);
    setDraft((current) => ({ ...current, ...updates }));
    setOffer(offered.length > 0 ? { from: sectionId, to: offered } : null);
    setNotice(followed.length > 0 ? t("chordGrid.alsoIn", { names: followed.map(sectionName).join(", ") }) : null);
  };
  const change = (bar: ChartBar, next: Rhythm | null, refused: string) => {
    if (!next) return setProblem(refused);
    commit(bar.sectionId, next);
  };
  const applyMove = (chord: PickedChord, move: RhythmMove | null) => {
    if (!move) return false;
    if (!move.ok) {
      setProblem(problemOf(move));
      return false;
    }
    commit(chord.sectionId, move.rhythm);
    return true;
  };

  const place = (bar: ChartBar, beat: number, chord = picked) => {
    if (!chord) return setPickedBar(bar.index);
    if (chord.sectionId !== bar.sectionId) return setProblem(t("chordGrid.otherSection"));
    applyMove(chord, moveOf(chord, { bar: bar.barInPass, beat }));
    setPicked(null);
    setPickedBar(bar.index);
  };
  // The picked chord a beat or a bar earlier or later (the arrows), kept picked.
  const nudge = (chord: PickedChord, by: number) => {
    setPicked(chord);
    setPickedBar(null);
    setPickedBeat(null);
    applyMove(chord, moveOf(chord, { by }));
    refocus.current = { chordId: chord.chordId, passIndex: chord.passIndex };
  };
  const pin = (chord: PickedChord) => {
    const rhythm = rhythmOfSection(chord.sectionId);
    const now = keyChords.has(chord.chordId);
    const next = rhythm ? pinRhythmChord(rhythm, chord.chordId, !now) : null;
    if (!next) return;
    commit(chord.sectionId, next);
    setNotice(t(now ? "chordGrid.unpinned" : "chordGrid.pinned", { chord: chordName(chord.chordId) }));
    refocus.current = { chordId: chord.chordId, passIndex: chord.passIndex };
  };
  const setBarCount = (sectionId: string, count: number) => {
    const rhythm = rhythmOfSection(sectionId);
    const section = sectionById(sectionId);
    // Fewer bars than its chords were in: they're shared out again over the bars left (issue #475).
    const next = rhythm && section ? setRhythmBarCount(rhythm, count, section, timeBeatsOf(sectionId)) : null;
    if (!next) return setProblem(count < 1 ? t("chordGrid.oneBar") : t("chordGrid.tooFewBars"));
    setPickedBar(null);
    commit(sectionId, next);
  };
  // The sections offered the same bars: given them, linked if wanted; or not.
  const applyOffer = () => {
    if (!offer || !document) return;
    const from = sectionById(offer.from);
    const rhythm = draft[offer.from];
    if (!from || !rhythm) return setOffer(null);
    const updates: Record<string, Rhythm> = {};
    for (const id of offer.to) {
      const copy = copyRhythmPlacement(from, rhythm, sectionById(id)!);
      if (copy) updates[id] = copy;
    }
    setDraft((current) => ({ ...current, ...updates }));
    if (keepLinked) {
      const members = new Set([offer.from, ...offer.to]);
      setLinks((current) => {
        const joined = current.filter((group) => group.some((id) => members.has(id)));
        for (const group of joined) for (const id of group) members.add(id);
        return [...current.filter((group) => !joined.includes(group)), [...members]];
      });
    }
    setNotice(t(keepLinked ? "chordGrid.appliedLinked" : "chordGrid.applied", { names: offer.to.map(sectionName).join(", ") }));
    setOffer(null);
  };
  const unlink = (sectionId: string) => setLinks((current) => current.map((group) => group.filter((id) => id !== sectionId)).filter((group) => group.length > 1));
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
  // The grid holds the pointer, as a dragged chord's preview moves it from block to block.
  const pressDown = (event: ReactPointerEvent, bar: ChartBar, what: { chordId: string } | { beat: number }) => {
    if (!editable(bar)) return;
    event.stopPropagation();
    (grid.current ?? (event.currentTarget as HTMLElement)).setPointerCapture(event.pointerId);
    const at = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    press.current = "chordId" in what ? { ...at, sectionId: bar.sectionId, chordId: what.chordId, passIndex: bar.passIndex } : { ...at, bar: bar.index, beat: what.beat };
  };
  const chordDown = (event: ReactPointerEvent, bar: ChartBar, chord: ChartBarChord) => pressDown(event, bar, { chordId: chord.id });
  const beatDown = (event: ReactPointerEvent, bar: ChartBar, beat: number) => pressDown(event, bar, { beat });
  // What a pointer is over: a beat to put a chord on, a letter to put a beat on.
  const targetUnder = (x: number, y: number, current: ChordPress) => window.document.elementFromPoint(x, y)?.closest<HTMLElement>("chordId" in current ? "[data-grid-slot]" : "[data-letter]") ?? null;
  const chordMove = (event: ReactPointerEvent) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.dragging && Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_FROM) return;
    if (!current.dragging && "chordId" in current) {
      dragIdle.current = idleText;
      setDragged({ sectionId: current.sectionId, chordId: current.chordId });
      setPicked(null);
      setOffer(null);
    }
    current.dragging = true;
    for (const element of grid.current?.querySelectorAll<HTMLElement>("[data-drop]") ?? []) delete element.dataset.drop;
    const target = targetUnder(event.clientX, event.clientY, current);
    if ("chordId" in current) {
      // Between two beats, or as the preview moves the bars about (its words, the line saying what moves), the
      // pointer can be over a bar but no beat: the preview stays where it was, so it doesn't flicker.
      if (target) setHover({ bar: Number(target.dataset.bar), beat: Number(target.dataset.beat) });
      else if (!window.document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-grid-bar]")) setHover(null);
    } else if (target) target.dataset.drop = "";
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
    const chord = { sectionId: current.sectionId, chordId: current.chordId, passIndex: current.passIndex };
    if (!current.dragging) {
      const same = picked?.chordId === chord.chordId && picked.passIndex === chord.passIndex;
      setPicked(same ? null : chord);
      setPickedBar(null);
      setPickedBeat(null);
      setProblem(null);
      setNotice(null);
      return;
    }
    // Dropped where the preview had it.
    const target = hoverRef.current;
    setHover(null);
    setDragged(null);
    const bar = target ? chartBarsRef.current[target.bar] : undefined;
    if (target && bar) place(bar, target.beat, chord);
  };

  const chordCancel = () => {
    press.current = null;
    setHover(null);
    setDragged(null);
    for (const element of grid.current?.querySelectorAll<HTMLElement>("[data-drop]") ?? []) delete element.dataset.drop;
  };

  // The keys on a chord in Edit (issue #462): Enter picks it, the arrows move it a beat (Shift: a bar), P pins it, Escape lets go.
  const chordKey = (event: ReactKeyboardEvent, bar: ChartBar, chord: ChartBarChord) => {
    if (!editable(bar)) return;
    const mine: PickedChord = { sectionId: bar.sectionId, chordId: chord.id, passIndex: bar.passIndex };
    const on = picked?.chordId === chord.id && picked.passIndex === bar.passIndex;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      setPicked(on ? null : mine);
      setPickedBar(null);
      setProblem(null);
      refocus.current = { chordId: chord.id, passIndex: bar.passIndex };
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      nudge(mine, (event.shiftKey ? beatsOf(bar) : 1) * (event.key === "ArrowLeft" ? -1 : 1));
    } else if (event.key === "p" || event.key === "P") {
      event.preventDefault();
      setPicked(mine);
      pin(mine);
    } else if (event.key === "Escape" && on) {
      event.stopPropagation();
      setPicked(null);
    }
  };

  // A chord moved with the keys keeps the focus, wherever it went.
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const found = [...(grid.current?.querySelectorAll<HTMLElement>(`[data-chord-id="${target.chordId}"]`) ?? [])];
    (found.find((one) => target.passIndex === undefined || one.closest<HTMLElement>("[data-pass-index]")?.dataset.passIndex === String(target.passIndex)) ?? found[0])?.focus();
  });

  const stopEditing = () => {
    setEditing(false);
    setDraft({});
    setPicked(null);
    setPickedBar(null);
    setPickedBeat(null);
    setProblem(null);
    setOffer(null);
    setLinks([]);
    setNotice(null);
    setHover(null);
    setDragged(null);
  };
  const save = async () => {
    if (!onSave || !document) return;
    setSaving(true);
    try {
      await onSave(document.sections.map((section) => (draft[section.id] ? { ...section, rhythm: draft[section.id] } : section)) as Sections);
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
  // A pass's bars in rows, for the words between them.
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
  // The line a bar is sung in (its first words), for the pinned lines.
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
    // The pinned lines (issue #408): the line being sung and the next, kept through bars that sing nothing; the first two before the music.
    const strip = element.parentElement?.querySelector<HTMLElement>("[data-testid=chord-grid-pinned]") ?? null;
    let stripLine: HTMLElement | null = null;
    const clearLine = () => {
      if (!stripLine) return;
      delete stripLine.dataset.on;
      if (stripLine.nextElementSibling instanceof HTMLElement) delete stripLine.nextElementSibling.dataset.next;
    };
    const showLine = (line: string | null) => {
      if (!strip) return;
      const next = (line ? strip.querySelector<HTMLElement>(`[data-lyric-line="${line}"]`) : null) ?? stripLine ?? strip.querySelector<HTMLElement>("[data-lyric-line]");
      if (!next || next === stripLine) return;
      clearLine();
      stripLine = next;
      next.dataset.on = "";
      if (next.nextElementSibling instanceof HTMLElement) next.nextElementSibling.dataset.next = "";
    };
    const light = (bar: number | null, beat: number) => {
      if (litBar) delete litBar.dataset.on;
      if (litBeat) delete litBeat.dataset.on;
      if (litWords) delete litWords.dataset.on;
      for (const one of litLyrics) delete one.dataset.on;
      litBar = bar === null ? null : element.querySelector<HTMLElement>(`[data-grid-bar="${bar}"]`);
      litBeat = litBar?.querySelectorAll<HTMLElement>("[data-grid-beat]")[beat] ?? null;
      // The words being sung: from the last beat placed in them at or before this one.
      litWords = [...(litBar?.querySelectorAll<HTMLElement>("[data-word-beat]") ?? [])].filter((one) => Number(one.dataset.wordBeat) <= beat).at(-1) ?? null;
      if (litBar) litBar.dataset.on = "";
      if (litBeat) litBeat.dataset.on = "";
      if (litWords) litWords.dataset.on = "";
      // Between the rows, the bar's words; in the pinned lines, the line it's sung in.
      litLyrics = bar === null ? [] : [...element.querySelectorAll<HTMLElement>(`[data-lyric-bar="${bar}"]`)];
      for (const one of litLyrics) one.dataset.on = "";
      showLine(bar === null ? null : (lineOfBar[bar] ?? null));
    };
    if (!position) {
      light(null, 0);
      element.dataset.position = "";
      return clearLine;
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
          if (litBar && follow) keepInView(litBar);
        }
        shownBar = where?.bar ?? -1;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      light(null, 0);
      clearLine();
    };
  }, [position, bars, lyrics, width, barsPerRow, lineOfBar, follow]);

  // A pass's name over its bars.
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
        {editing ? sectionTools(passIndex) : null}
      </p>
    );
  };
  // In Edit (issue #462): the section's number of bars, the sections linked to it, the preview of bars offered to it.
  const sectionTools = (passIndex: number) => {
    const pass = chart.passes[passIndex]!;
    const id = pass.section.id;
    const first = bars.find((bar) => bar.passIndex === passIndex);
    if (!first || !editable(first)) return null;
    const count = rhythmOfSection(id)?.bars.length ?? first.barsInPass;
    const linkedWith = (links.find((group) => group.includes(id)) ?? []).filter((one) => one !== id);
    const firstPass = chart.passes.findIndex((one) => one.section.id === id) === passIndex;
    return (
      <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5 font-normal tracking-normal normal-case">
        {offer?.to.includes(id) ? (
          <span className="font-medium text-primary" data-testid="chord-grid-preview">
            {t("chordGrid.preview")}
          </span>
        ) : null}
        {linkedWith.length > 0 ? (
          <span className="flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pr-0.5 pl-2 text-foreground" data-testid="chord-grid-linked">
            <Link2 className="size-3.5" aria-hidden />
            {t("chordGrid.linkedWith", { names: linkedWith.map(sectionName).join(", ") })}
            <button type="button" className="rounded-full bg-background px-2 py-0.5 hover:bg-accent" onClick={() => unlink(id)} data-testid="chord-grid-unlink">
              {t("chordGrid.unlink")}
            </button>
          </span>
        ) : null}
        {firstPass ? (
          <span className="flex items-center gap-1" data-testid="chord-grid-bar-count">
            <Button type="button" variant="outline" size="icon" className="size-7" onClick={() => setBarCount(id, count - 1)} disabled={count <= 1} aria-label={t("chordGrid.fewerBars")} data-testid="chord-grid-fewer-bars">
              <Minus />
            </Button>
            <span className="min-w-12 text-center tabular-nums" data-testid="chord-grid-bars-count">
              {t("chordGrid.barCount", { count })}
            </span>
            <Button type="button" variant="outline" size="icon" className="size-7" onClick={() => setBarCount(id, count + 1)} disabled={count >= 512} aria-label={t("chordGrid.moreBars")} data-testid="chord-grid-more-bars">
              <Plus />
            </Button>
          </span>
        ) : (
          <span>{t("chordGrid.sameBars")}</span>
        )}
      </span>
    );
  };
  // The picked chord's tools (issue #462), in the bar it was picked in.
  const toolsFor = (bar: ChartBar): ChordTools | null => {
    if (!picked || !editing || picked.sectionId !== bar.sectionId || (picked.passIndex !== undefined && picked.passIndex !== bar.passIndex)) return null;
    const chord = bar.chords.find((one) => one.id === picked.chordId);
    if (!chord) return null;
    return {
      nudge: (by) => nudge(picked, by),
      pin: () => pin(picked),
      done: () => setPicked(null),
      key: keyChords.has(chord.id),
      barBeats: beatsOf(bar),
      where: (() => {
        const word = chordWord(chart.passes[bar.passIndex]?.lines.find((line) => line.chords.some((one) => one.id === chord.id)), chord.id);
        const at = { bar: bar.barInPass + 1, beat: beatName(chord.beat) };
        return word ? t("chordGrid.whereWord", { ...at, word }) : t("chordGrid.where", at);
      })(),
    };
  };
  const beatName = (beat: number) => (Number.isInteger(beat) ? String(beat) : t("chordGrid.andOf", { n: Math.floor(beat) }));
  const pickedTools = (() => {
    if (!picked || !editing) return null;
    const bar = bars.find((one) => one.sectionId === picked.sectionId && (picked.passIndex === undefined || one.passIndex === picked.passIndex) && one.chords.some((chord) => chord.id === picked.chordId));
    return bar ? { label: bar.chords.find((chord) => chord.id === picked.chordId)!.label, ...toolsFor(bar)! } : null;
  })();
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
      keyChords={keyChords}
      moving={moving}
      dragged={dragged?.sectionId === bar.sectionId ? dragged.chordId : null}
      drop={editing && hover?.bar === bar.index ? { beat: hover.beat, bad: !!preview?.move && !preview.move.ok } : null}
      tools={toolsFor(bar)}
      onChordKey={(event, chord) => chordKey(event, bar, chord)}
      pickedBar={editing && pickedBar === bar.index}
      looped={!!player.looped && bar.index >= player.looped.first && bar.index <= player.looped.last}
      playable={!editing && !player.following && player.source !== null}
      onTap={() => tapBar(bar)}
      onSlot={(beat) => place(bar, beat)}
      onLetter={pickedBeat ? (letter) => placeBeat(pickedBeat, letter) : undefined}
      litChord={editing ? litChord : null}
      onPointChord={setPointedChord}
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
    // The song editor's grid isn't the Display panel's to start or loop.
    if (onChange) return;
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

  // What Edit says (issue #462): what a drag would move, else what was done, else what to do.
  const idleText = notice ?? (picked ? t("chordGrid.pickBeat") : pickedBeat ? t("chordGrid.pickLetter", { n: pickedBeat.beat }) : t("chordGrid.editHint"));
  const status = ((): { tone: "idle" | "live" | "bad"; text: string } => {
    const move = preview?.move;
    if (move) {
      if (!move.ok) return { tone: "bad", text: problemOf(move) };
      if (move.by === 0) return { tone: "live", text: t("chordGrid.staysHere") };
      if (mode === "ripple") {
        const parts = [move.moved.length > 0 ? t("chordGrid.rippleMoves", { count: move.moved.length }) : t("chordGrid.rippleNone")];
        if (move.bars > 0) parts.push(t("chordGrid.barsGained", { count: move.bars }));
        if (move.bars < 0) parts.push(t("chordGrid.barsLost", { count: -move.bars }));
        return { tone: "live", text: parts.join(" ") };
      }
      return { tone: "live", text: move.moved.length > 0 ? t("chordGrid.inPlaceMoves", { count: move.moved.length }) : t("chordGrid.inPlaceAlone") };
    }
    return { tone: "idle", text: idleText };
  })();
  if (bars.length === 0) return <p className="text-sm text-muted-foreground">{emptyText ?? t("chart.empty")}</p>;
  const tools = editing && pickedBar !== null && bars[pickedBar] && editable(bars[pickedBar]) ? { bar: bars[pickedBar], ...barTools(bars[pickedBar]) } : null;
  return (
    <div ref={area} className={cn("flex flex-col gap-3", className)} data-testid="chord-grid-area">
      {editing && !onChange ? (
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label={t("chordGrid.modeLabel")} data-testid="chord-grid-mode">
              {(["ripple", "inPlace"] as const).map((one) => (
                <button
                  key={one}
                  type="button"
                  className={cn("inline-flex h-9 items-center gap-1.5 rounded-md px-3 font-medium text-muted-foreground", mode === one && "bg-foreground text-background")}
                  aria-pressed={mode === one}
                  onClick={() => setMode(one)}
                  data-testid={`chord-grid-mode-${one}`}
                >
                  {one === "ripple" ? <Waves className="size-4" aria-hidden /> : <Crosshair className="size-4" aria-hidden />}
                  {t(`chordGrid.modes.${one}`)}
                </button>
              ))}
            </div>
            <p className="min-w-48 flex-1 text-muted-foreground">{t(`chordGrid.modeHints.${mode}`)}</p>
          </div>
          {/* While a chord is dragged, what it would move takes the place of what was said before, in the same room:
              the bars below mustn't move under the pointer. */}
          <div className="grid">
            <p className={cn("col-start-1 row-start-1 text-muted-foreground", status.tone === "live" && "text-sky-700 dark:text-sky-300", status.tone === "bad" && "text-destructive")} role="status" data-testid="chord-grid-status">
              {status.text}
            </p>
            {dragged ? (
              <p className="invisible col-start-1 row-start-1" aria-hidden>
                {dragIdle.current ?? idleText}
              </p>
            ) : null}
          </div>
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
      <div
        ref={grid}
        className="flex flex-col gap-5"
        data-testid="chord-grid"
        data-source={source ?? undefined}
        data-editing={editing ? "" : undefined}
        data-lyrics={lyrics}
        onPointerMove={editing ? chordMove : undefined}
        onPointerUp={editing ? chordUp : undefined}
        onPointerCancel={editing ? chordCancel : undefined}
      >
        {passes.map(({ passIndex, bars: passBars }) => (
            <section
              key={chart.passes[passIndex]!.id}
              className={cn(editing && offer?.to.includes(chart.passes[passIndex]!.section.id) && "rounded-md outline-2 outline-offset-4 outline-sky-600 outline-dashed")}
              data-pass={chart.passes[passIndex]!.id}
              data-pass-index={passIndex}
              data-testid="chord-grid-pass"
            >
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
        ))}
      </div>
      {editing && offer && !picked ? (
        // Sections with the same chords to other words (issue #462): given these bars too, or not.
        <div className="sticky bottom-(--grid-sticky-bottom,0px) z-20 -mx-1 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-sky-600/40 bg-card p-3 shadow-lg" role="dialog" aria-label={t("chordGrid.offerLabel")} data-testid="chord-grid-offer">
          <div className="min-w-56 flex-1">
            <p className="font-medium">{t("chordGrid.offerTitle", { names: offer.to.map(sectionName).join(", "), from: sectionName(offer.from) })}</p>
            <p className="text-sm text-muted-foreground">{t("chordGrid.offerBody")}</p>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-foreground" checked={keepLinked} onChange={(event) => setKeepLinked(event.target.checked)} data-testid="chord-grid-keep-linked" />
            {t("chordGrid.keepLinked")}
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setOffer(null)} data-testid="chord-grid-offer-skip">
              {t("chordGrid.onlyHere", { name: sectionName(offer.from) })}
            </Button>
            <Button type="button" onClick={applyOffer} data-testid="chord-grid-offer-apply">
              {t("chordGrid.applyTo", { names: offer.to.map(sectionName).join(", ") })}
            </Button>
          </div>
        </div>
      ) : null}
      {pickedTools ? (
        // A phone's: the picked chord's buttons in a bar at the bottom, as the chart editor's chord bar (issue #462).
        <div className="sticky bottom-(--grid-sticky-bottom,0px) z-20 -mx-1 flex flex-col gap-1.5 border-t bg-background/95 px-2 pt-1.5 pb-2 backdrop-blur pointer-fine:hidden" role="toolbar" aria-label={t("chordGrid.chordTools", { chord: pickedTools.label })} data-testid="chord-grid-chord-bar">
          <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
            <span>
              <span className="font-bold text-foreground">{pickedTools.label}</span> · {pickedTools.where}
            </span>
            <button type="button" className="h-8 px-2 font-semibold text-foreground" onClick={pickedTools.done} data-testid="chord-grid-chord-bar-done">
              {t("chordGrid.done")}
            </button>
          </div>
          <div className="flex gap-1.5">
            <ChordToolButtons tools={pickedTools} large />
          </div>
        </div>
      ) : null}
      {lyrics === "pinned" && !editing ? (
        // The words pinned at the bottom (issue #408): the line being sung and the next, the grid taking the rest.
        <div className="sticky bottom-(--grid-sticky-bottom,0px) z-10 -mx-1 border-t bg-card px-2 pt-1.5 pb-2" data-testid="chord-grid-pinned">
          {chart.passes.flatMap((pass) =>
            pass.lines
              .filter((line) => line.text.trim())
              .map((line) => (
                <p
                  key={`${pass.id}:${line.id}`}
                  className="hidden truncate leading-snug data-[next]:block data-[next]:text-base data-[next]:text-muted-foreground data-[on]:block data-[on]:text-lg data-[on]:font-semibold"
                  data-lyric-line={`${pass.id}:${line.id}`}
                >
                  {line.text}
                </p>
              )),
          )}
        </div>
      ) : null}
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
  keyChords,
  moving,
  dragged,
  drop,
  tools,
  onChordKey,
  pickedBar,
  looped,
  playable,
  onTap,
  onSlot,
  onLetter,
  litChord,
  onPointChord,
  chordEvents,
}: {
  bar: ChartBar;
  /** The last bar of its row: a bar line at its right too. */
  rowEnd: boolean;
  /** Where its words are in the lines (`barLyricSpans`); null for none to sing. */
  words: BarLyricSpan[] | null;
  /** Its words in it: not when they're between the rows, pinned, or off. */
  showWords: boolean;
  lines: readonly GridLine[];
  /** Where each of its beats is sung (`barBeatPlaces`). */
  places: readonly (BeatPlace | null)[];
  /** In Edit, its beat picked to place in the words (1-based). */
  pickedBeat: number | null;
  chordColors: boolean;
  editing: boolean;
  /** In Edit, a pass that can't be edited here (it leaves some of its section's lines out). */
  locked: boolean;
  picked: { chordId: string } | null;
  /** In Edit (issue #462): the key chords, dark with a pin; the chords moving with a dragged one; the one dragged; where it would go (refused: bad). */
  keyChords: ReadonlySet<string>;
  moving: ReadonlySet<string>;
  dragged: string | null;
  drop: { beat: number; bad: boolean } | null;
  /** The picked chord's floating toolbar, when it's in this bar (a laptop's: a phone has its bar at the bottom). */
  tools: ChordTools | null;
  onChordKey: (event: ReactKeyboardEvent, chord: ChartBarChord) => void;
  pickedBar: boolean;
  looped: boolean;
  playable: boolean;
  onTap: () => void;
  onSlot: (beat: number) => void;
  /** In Edit with a beat picked: a letter tapped to sing it on. */
  onLetter?: (letter: { lineId: string; at: number }) => void;
  /** In Edit, the chord whose syllable is lit (issue #477), and a chord or its syllable pointed at. */
  litChord: string | null;
  onPointChord: (chordId: string | null) => void;
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
  const chordLabel = (chord: ChartBarChord) => {
    const key = editing && keyChords.has(chord.id);
    const label = (
      <span
        key={chord.id}
        className={cn(
          "text-base font-bold whitespace-nowrap",
          chordColors && !key && chord.family && FAMILY_COLORS[chord.family],
          editing && "relative cursor-grab touch-none rounded-sm px-1 py-0.5 ring-primary outline-none select-none hover:ring-1 focus-visible:ring-2",
          key && "bg-foreground pr-2.5 text-background",
          editing && moving.has(chord.id) && "bg-sky-100 text-sky-950 ring-2 ring-sky-600 dark:bg-sky-950 dark:text-sky-50",
          editing && dragged === chord.id && "scale-110 bg-sky-600 text-white shadow-lg ring-0",
          editing && picked?.chordId === chord.id && !dragged && "ring-2 ring-sky-600 ring-offset-1 ring-offset-background",
          editing && litChord === chord.id && picked?.chordId !== chord.id && !dragged && "ring-2 ring-sky-600/60",
        )}
        data-grid-chord={chord.label}
        data-chord-id={editing ? chord.id : undefined}
        data-beat-at={chord.beat}
        data-key-chord={key ? "" : undefined}
        data-moving={editing && moving.has(chord.id) ? "" : undefined}
        data-lit={editing && litChord === chord.id ? "" : undefined}
        role={editing ? "button" : undefined}
        tabIndex={editing ? 0 : undefined}
        aria-label={editing ? t(key ? "chordGrid.keyChordLabel" : "chordGrid.chordLabel", { chord: chord.label }) : undefined}
        aria-pressed={editing ? picked?.chordId === chord.id : undefined}
        onPointerDown={editing ? (event) => chordEvents.down(event, bar, chord) : undefined}
        onKeyDown={editing ? (event) => onChordKey(event, chord) : undefined}
        onPointerEnter={editing ? () => onPointChord(chord.id) : undefined}
        onPointerLeave={editing ? () => onPointChord(null) : undefined}
        onFocus={editing ? () => onPointChord(chord.id) : undefined}
        onBlur={editing ? () => onPointChord(null) : undefined}
        // Picked or dropped by the pointer's own handlers: not a tap on the beat it's in.
        onClick={editing ? (event) => event.stopPropagation() : undefined}
      >
        {chord.label}
        {key ? <Pin className="absolute top-0.5 right-0.5 size-2 opacity-80" aria-hidden /> : null}
      </span>
    );
    if (!tools || picked?.chordId !== chord.id) return label;
    return (
      <span key={chord.id} className="relative inline-flex">
        {label}
        <FloatingChordTools tools={tools} label={chord.label} />
      </span>
    );
  };
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
      <div className={cn("flex items-center", editing ? "h-11" : "h-8")}>
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
                    className={cn(
                      "flex min-w-0 flex-1 items-center justify-center data-[drop]:bg-sky-500/25 data-[drop]:ring-2 data-[drop]:ring-sky-600 data-[drop]:ring-inset data-[bad]:bg-destructive/20 data-[bad]:ring-destructive",
                      picked && "hover:bg-primary/10",
                      half === 1.5 && "border-l border-dotted border-muted-foreground/20",
                    )}
                    data-grid-slot=""
                    data-drop={drop?.beat === at ? "" : undefined}
                    data-bad={drop?.beat === at && drop.bad ? "" : undefined}
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
      {showWords ? <BarWords bar={bar} spans={words} lines={lines} places={places} editing={editing} pickedBeat={pickedBeat} onLetter={onLetter} litChord={litChord} onPointChord={onPointChord} chordEvents={chordEvents} /> : null}
    </div>
  );
}

/**
 * The picked chord's buttons (issue #462): a bar or a beat earlier or later,
 * pinned or unpinned, let go. Floating over the chord on a laptop, so the
 * mouse hardly travels; a phone has them in a bar at the bottom instead.
 */
function ChordToolButtons({ tools, large = false }: { tools: ChordTools; large?: boolean }) {
  const { t } = useTranslation();
  const button = (label: string, icon: ReactNode, onClick: () => void, testId: string, extra?: string) => (
    <button
      type="button"
      className={cn("inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium", large ? "h-12 min-w-12 flex-1 border bg-background px-2 text-sm active:bg-muted" : "size-8 hover:bg-white/15", extra)}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      data-testid={testId}
    >
      {icon}
    </button>
  );
  return (
    <>
      {button(t("chordGrid.barEarlier"), <ChevronsLeft className="size-4" aria-hidden />, () => tools.nudge(-tools.barBeats), "chord-tools-bar-earlier")}
      {button(t("chordGrid.beatEarlier"), <ChevronLeft className="size-4" aria-hidden />, () => tools.nudge(-1), "chord-tools-earlier")}
      {large ? null : <span className="px-1.5 text-xs whitespace-nowrap text-white/75 tabular-nums">{tools.where}</span>}
      {button(t("chordGrid.beatLater"), <ChevronRight className="size-4" aria-hidden />, () => tools.nudge(1), "chord-tools-later")}
      {button(t("chordGrid.barLater"), <ChevronsRight className="size-4" aria-hidden />, () => tools.nudge(tools.barBeats), "chord-tools-bar-later")}
      {large ? null : <span className="mx-0.5 h-5 w-px bg-white/25" aria-hidden />}
      <button
        type="button"
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-2 font-medium whitespace-nowrap",
          large ? "h-12 flex-[2] border text-sm" : "h-8 text-xs",
          tools.key ? (large ? "border-foreground bg-foreground text-background" : "bg-white text-neutral-900") : large ? "bg-background" : "hover:bg-white/15",
        )}
        aria-pressed={tools.key}
        onClick={(event) => {
          event.stopPropagation();
          tools.pin();
        }}
        data-testid="chord-tools-pin"
      >
        {tools.key ? <PinOff className="size-3.5" aria-hidden /> : <Pin className="size-3.5" aria-hidden />}
        {tools.key ? t("chordGrid.unpin") : t("chordGrid.pin")}
      </button>
    </>
  );
}

function FloatingChordTools({ tools, label }: { tools: ChordTools; label: string }) {
  const { t } = useTranslation();
  return (
    <span
      role="toolbar"
      aria-label={t("chordGrid.chordTools", { chord: label })}
      className="absolute bottom-full left-1/2 z-30 mb-2 hidden -translate-x-1/2 items-center gap-0.5 rounded-lg bg-neutral-900 p-1 text-white shadow-lg pointer-fine:flex dark:bg-neutral-800"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      data-testid="chord-tools"
    >
      <ChordToolButtons tools={tools} />
      <button
        type="button"
        className="inline-flex size-8 items-center justify-center rounded-md hover:bg-white/15"
        aria-label={t("chordGrid.letGo")}
        title={t("chordGrid.letGo")}
        onClick={(event) => {
          event.stopPropagation();
          tools.done();
        }}
        data-testid="chord-tools-done"
      >
        <X className="size-4" aria-hidden />
      </button>
    </span>
  );
}

type GridLine = { id: string; text: string; chords: readonly { id: string; at: number }[] };

type ChordLetter = { syllable: { chordId: string; first: boolean } | null; words: string[] };

/**
 * Where a line's chords are sung (issue #477), indexed by letter: each
 * chord's syllable, from its letter (the next one, when it's on a space) to
 * the next chord or the word's end, `first` on its first letter; and the
 * chords sung in each letter's word.
 */
function chordSyllables(line: GridLine | undefined): (ChordLetter | undefined)[] {
  const out: (ChordLetter | undefined)[] = [];
  if (!line) return out;
  const letter = (at: number) => (out[at] ??= { syllable: null, words: [] });
  const { text } = line;
  const starts = line.chords
    .map((chord) => {
      let at = Math.max(0, chord.at);
      while (at < text.length && /\s/.test(text[at]!)) at++;
      return { id: chord.id, at };
    })
    .filter((chord) => chord.at < text.length)
    .sort((a, b) => a.at - b.at);
  starts.forEach((chord, index) => {
    const next = starts[index + 1]?.at ?? text.length;
    for (let at = chord.at; at < next && /\S/.test(text[at]!); at++) letter(at).syllable = { chordId: chord.id, first: at === chord.at };
    for (let at = wordStart(text, chord.at); at < text.length && /\S/.test(text[at]!); at++) letter(at).words.push(chord.id);
  });
  return out;
}

/** The word a chord is sung on, as written; null when it's after the words. */
function chordWord(line: GridLine | undefined, chordId: string): string | null {
  const chord = line?.chords.find((one) => one.id === chordId);
  if (!line || !chord) return null;
  let at = Math.max(0, chord.at);
  while (at < line.text.length && /\s/.test(line.text[at]!)) at++;
  if (at >= line.text.length) return null;
  const start = wordStart(line.text, at);
  let end = at;
  while (end < line.text.length && /\S/.test(line.text[end]!)) end++;
  return line.text.slice(start, end).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") || null;
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
  litChord,
  onPointChord,
  chordEvents,
}: {
  bar: ChartBar;
  spans: BarLyricSpan[] | null;
  lines: readonly GridLine[];
  places: readonly (BeatPlace | null)[];
  editing: boolean;
  pickedBeat: number | null;
  onLetter?: (letter: { lineId: string; at: number }) => void;
  /** In Edit, the chord picked, dragged or pointed at: its syllable lit. */
  litChord: string | null;
  onPointChord: (chordId: string | null) => void;
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
    // Each chord's syllable (issue #477): the chord stays on it wherever it's moved in the bars.
    const syllables = new Map(pieces.map((piece) => [piece.lineId, chordSyllables(lines.find((line) => line.id === piece.lineId))]));
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
        const letters = syllables.get(piece.lineId);
        const syllable = letters?.[at]?.syllable ?? null;
        const lit = !!syllable && syllable.chordId === litChord;
        const litWord = !!litChord && !!letters?.[at]?.words.includes(litChord);
        return (
          <span key={`${piece.lineId}-${at}`}>
            {ticksAt(piece.lineId, at)}
            <span
              className={cn(
                "rounded-[2px] data-[drop]:bg-primary/30",
                // Every chord's syllable underlined; the lit chord's word in its colour, its syllable underlined strong.
                syllable && "rounded-b-none border-b-2 border-sky-600/45 text-foreground",
                syllable?.first && at > piece.from && letters?.[at - 1]?.syllable && "ml-0.5",
                litWord && "text-sky-700 dark:text-sky-300",
                lit && "border-sky-600 bg-sky-500/20 dark:border-sky-400",
                onLetter && "cursor-pointer hover:bg-primary/15",
              )}
              data-letter=""
              data-line={piece.lineId}
              data-at={at}
              data-chord-word={syllable?.chordId}
              data-lit={lit ? "" : undefined}
              data-lit-word={litWord ? "" : undefined}
              onPointerEnter={syllable ? () => onPointChord(syllable.chordId) : undefined}
              onPointerLeave={syllable ? () => onPointChord(null) : undefined}
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
