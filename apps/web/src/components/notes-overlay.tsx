import type { NoteAnchor, NotePlacement } from "@oneverse/core";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * Notes beside what they're on, or in the margin (issue #264): drawn over the
 * chart, each one placed by measuring where its word, chord, line or section
 * is. Beside: under the word or chord (lines move apart for them), at the end
 * of a line, beside a section's name. Margin: in the room kept on the chart's
 * right, level with what it's on, a thin line leading to it - narrower when
 * room is short, and beside what they're on when there's none (the Display
 * panel says so).
 */

export interface OverlayNote {
  id: string;
  passId: string;
  anchor: NoteAnchor;
  /** The note as drawn (its look, size and colour already). */
  node: ReactNode;
}

interface Placed {
  x: number;
  y: number;
  /** Where its line leads from (margin), in the chart's coordinates. */
  from?: { x: number; y: number };
  target?: { x: number; y: number; width: number; height: number };
  /** In the margin: its number, also shown on what it's on. */
  number?: number;
}

/** Room under each line for the notes beside its words (px, by `${passId}|${lineId}`), and the margin's width (0: it doesn't fit). */
export interface OverlayLayout {
  room: Record<string, number>;
  margin: number;
}

/** The margin's width when there's room, and the narrowest it gets. */
const MARGIN_WIDTH = 256;
const MARGIN_MIN = 180;
/** Between the chart and the margin. */
export const MARGIN_GAP = 40;
/** The chart keeps at least this much beside the margin; with less, notes meant for it go beside what they're on. */
const MARGIN_MIN_CHART = 340;

/** The charts whose margin doesn't fit right now, for the Display panel to say so. */
const crowded = new Set<symbol>();
const crowdedListeners = new Set<() => void>();
function setCrowded(id: symbol, on: boolean) {
  if (crowded.has(id) === on) return;
  if (on) crowded.add(id);
  else crowded.delete(id);
  for (const listener of crowdedListeners) listener();
}
/** Whether a chart on the page has no room for its notes' margin (they're beside what they're on instead). */
export function useMarginCrowded(): boolean {
  return useSyncExternalStore(
    (listener) => {
      crowdedListeners.add(listener);
      return () => crowdedListeners.delete(listener);
    },
    () => crowded.size > 0,
    () => false,
  );
}
/** Between two notes side by side under a line: enough that two plain ones don't read as one. */
const GAP = 12;
/** A margin note's number, on it and on what it's on. */
const BADGE = 15;

export function NotesOverlay({
  notes,
  placement,
  color,
  onLayout,
}: {
  notes: OverlayNote[];
  placement: Exclude<NotePlacement, "below">;
  /** The connectors' colour (margin). */
  color: string;
  onLayout: (layout: OverlayLayout) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const noteRefs = useRef(new Map<string, HTMLDivElement>());
  const [placed, setPlaced] = useState<Record<string, Placed>>({});
  const [hovered, setHovered] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;
  const last = useRef("");
  // The room each line has now (measured lines include it).
  const lastRoom = useRef<Record<string, number>>({});
  const [margin, setMargin] = useState(0);
  const [crowdedId] = useState(() => Symbol("chart"));
  useLayoutEffect(() => () => setCrowded(crowdedId, false), [crowdedId]);

  // Measured again as the chart changes size (a window resized, fonts loaded, lines moved apart).
  useLayoutEffect(() => {
    const root = ref.current?.parentElement;
    if (!root) return;
    const observer = new ResizeObserver(() => setTick((n) => n + 1));
    observer.observe(root);
    void document.fonts?.ready.then(() => setTick((n) => n + 1));
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const root = ref.current?.parentElement;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    // Zoomed (Practice's and Live's text size): what's measured is scaled, what's placed isn't.
    const scale = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1;
    const local = (rect: DOMRect) => ({
      x: (rect.left - rootRect.left) / scale,
      y: (rect.top - rootRect.top) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    });
    const width = root.offsetWidth;
    // As wide as it can be up to MARGIN_WIDTH, leaving the chart its room; too narrow, and the notes go beside what they're on.
    const marginWidth = Math.min(MARGIN_WIDTH, width - MARGIN_GAP - MARGIN_MIN_CHART);
    const marginFits = placement === "margin" && marginWidth >= MARGIN_MIN;
    setCrowded(crowdedId, placement === "margin" && !marginFits);
    const next: Record<string, Placed> = {};
    const room: Record<string, number> = {};
    // Beside: under each line, rows of notes that don't overlap.
    const rows = new Map<string, { right: number; height: number }[]>();
    const marginQueue: { id: string; y: number; from: { x: number; y: number }; target: Placed["target"] }[] = [];

    for (const note of notes) {
      const element = noteRefs.current.get(note.id);
      if (!element) continue;
      const size = { width: element.offsetWidth, height: element.offsetHeight };
      const pass = root.querySelector<HTMLElement>(`[data-pass="${CSS.escape(note.passId)}"]`);
      if (!pass) continue;
      const anchor = note.anchor;
      const lineEl = "lineId" in anchor ? pass.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(anchor.lineId)}"]`) : null;
      const target = targetRect(pass, lineEl, anchor);
      if (!target) continue;
      const box = local(target);
      if (marginFits) {
        // From the end of the line's text (nothing crossed), level with what it's on.
        const end = lineEl ? lineEnd(lineEl) : null;
        // A section's: after all of its heading (its name, "changed", a key change), nothing crossed.
        const heading = anchor.kind === "section" ? pass.querySelector<HTMLElement>("[data-pass-heading] p") : null;
        const endBox = end ? local(end.getBoundingClientRect()) : heading ? local(contentRect(heading)) : null;
        const fromX = endBox ? endBox.x + endBox.width + 6 : box.x + box.width + 6;
        const midY = box.y + box.height / 2;
        marginQueue.push({ id: note.id, y: midY - size.height / 2, from: { x: fromX, y: midY }, target: box });
        continue;
      }
      if ((anchor.kind === "chord" || anchor.kind === "word") && lineEl) {
        // Under the word or chord, in the room under its line.
        const line = local(lineEl.getBoundingClientRect());
        const key = `${note.passId}|${anchor.lineId}`;
        const lineRows = rows.get(key) ?? [];
        const x = Math.max(0, Math.min(box.x, width - size.width));
        let row = lineRows.findIndex((one) => one.right + GAP <= x);
        if (row < 0) {
          row = lineRows.length;
          lineRows.push({ right: 0, height: size.height });
        }
        const top = lineRows.slice(0, row).reduce((sum, one) => sum + one.height + GAP, 0);
        lineRows[row] = { right: x + size.width, height: Math.max(lineRows[row]!.height, size.height) };
        rows.set(key, lineRows);
        // The room asked for is under the line as drawn without it.
        const lineBottom = line.y + line.height - (lastRoom.current[key] ?? 0);
        next[note.id] = { x, y: lineBottom + 2 + top, target: box };
      } else if (anchor.kind === "line" && lineEl) {
        // At the end of the line, else under it.
        const end = lineEnd(lineEl);
        const at = end ? local(end.getBoundingClientRect()) : box;
        const x = at.x + at.width + 8;
        next[note.id] = x + size.width <= width ? { x, y: at.y + at.height - size.height, target: box } : { x: 0, y: box.y + box.height + 2, target: box };
      } else if (anchor.kind === "section") {
        const heading = pass.querySelector<HTMLElement>("[data-pass-heading] span") ?? pass;
        const at = local(heading.getBoundingClientRect());
        next[note.id] = { x: at.x + at.width + 8, y: at.y + (at.height - size.height) / 2, target: box };
      } else {
        next[note.id] = { x: 0, y: box.y + box.height + 2, target: box };
      }
    }
    for (const [key, lineRows] of rows) room[key] = lineRows.reduce((sum, one) => sum + one.height + GAP, 0) + 2;

    if (marginFits) {
      // Level with what they're on, one under the other where they'd overlap.
      let bottom = -Infinity;
      let number = 0;
      for (const item of marginQueue.sort((a, b) => a.y - b.y)) {
        const height = noteRefs.current.get(item.id)?.offsetHeight ?? 0;
        const y = Math.max(item.y, bottom + 6, 0);
        bottom = y + height;
        next[item.id] = { x: width - marginWidth + BADGE + 6, y, from: item.from, target: item.target, number: ++number };
      }
    }

    setPlaced(next);
    const margin = marginFits ? marginWidth : 0;
    setMargin(margin);
    const layout = JSON.stringify({ room, margin });
    if (layout !== last.current) {
      last.current = layout;
      lastRoom.current = room;
      onLayoutRef.current({ room, margin });
    }
  }, [notes, placement, tick, crowdedId]);

  const hoveredPlace = hovered ? placed[hovered] : undefined;
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0" data-notes-overlay={margin ? "margin" : "beside"} aria-hidden={false}>
      <svg className="absolute inset-0 size-full overflow-visible" aria-hidden>
        {Object.entries(placed).map(([id, place]) =>
          place.from ? (
            <path
              key={id}
              d={connector(place.from, { x: place.x - BADGE - 8, y: place.y + 10 })}
              fill="none"
              stroke={color}
              strokeWidth={hovered === id ? 2 : 1}
              strokeOpacity={hovered === id ? 0.9 : 0.45}
              strokeDasharray={hovered === id ? undefined : "3 3"}
              data-note-connector={id}
            />
          ) : null,
        )}
        {/* What the note under the pointer is on. */}
        {hoveredPlace?.target ? (
          <rect x={hoveredPlace.target.x - 2} y={hoveredPlace.target.y - 1} width={hoveredPlace.target.width + 4} height={hoveredPlace.target.height + 2} rx={3} fill={color} fillOpacity={0.15} stroke={color} strokeOpacity={0.7} />
        ) : null}
      </svg>
      {/* In the margin, each note's number: beside it, and on what it's on. */}
      {Object.entries(placed).map(([id, place]) =>
        place.number && place.target ? (
          <span key={`${id}:numbers`}>
            <Badge x={place.target.x + place.target.width - 3} y={place.target.y - BADGE / 2 - 1} color={color} number={place.number} hovered={hovered === id} testId={`note-number-target-${place.number}`} />
            <Badge x={place.x - BADGE - 5} y={place.y + 10 - BADGE / 2} color={color} number={place.number} hovered={hovered === id} testId={`note-number-${place.number}`} />
          </span>
        ) : null,
      )}
      {notes.map((note) => {
        const place = placed[note.id];
        return (
          <div
            key={note.id}
            ref={(element) => {
              if (element) noteRefs.current.set(note.id, element);
              else noteRefs.current.delete(note.id);
            }}
            className="pointer-events-auto absolute"
            style={{
              left: place?.x ?? 0,
              top: place?.y ?? 0,
              visibility: place ? "visible" : "hidden",
              maxWidth: margin ? margin - BADGE - 6 : 256,
            }}
            onPointerEnter={() => setHovered(note.id)}
            onPointerLeave={() => setHovered((current) => (current === note.id ? null : current))}
            onFocus={() => setHovered(note.id)}
            onBlur={() => setHovered((current) => (current === note.id ? null : current))}
            data-note-placed={note.id}
          >
            {note.node}
          </div>
        );
      })}
    </div>
  );
}

/** What a note is on, on the page: the chord, the word's first character to its last, the line, the section's name, the pass. */
function targetRect(pass: HTMLElement, lineEl: HTMLElement | null, anchor: NoteAnchor): DOMRect | null {
  switch (anchor.kind) {
    case "chord":
      return lineEl?.querySelector(`[data-chord-ref="${CSS.escape(anchor.chordId)}"]`)?.getBoundingClientRect() ?? lineEl?.getBoundingClientRect() ?? null;
    case "word": {
      if (!lineEl) return null;
      return wordRect(lineEl, anchor.at) ?? lineEl.getBoundingClientRect();
    }
    case "line":
      return (lineEl && (lineEnd(lineEl) ? textRect(lineEl) : lineEl.getBoundingClientRect())) ?? null;
    case "section":
      return (pass.querySelector("[data-pass-heading] span") ?? pass).getBoundingClientRect();
    default:
      return pass.getBoundingClientRect();
  }
}

/** The word starting at character `at` of a line, as drawn (it may run across pieces of the line, a chord in the middle). */
function wordRect(lineEl: HTMLElement, at: number): DOMRect | null {
  const pieces = [...lineEl.querySelectorAll<HTMLElement>("[data-at]")]
    .map((element) => ({ from: Number(element.dataset.at), node: element.firstChild }))
    .filter((piece): piece is { from: number; node: Text } => piece.node?.nodeType === Node.TEXT_NODE);
  const text = (index: number) => {
    const piece = pieces.find((one) => index >= one.from && index < one.from + one.node.length);
    return piece ? { piece, char: piece.node.data[index - piece.from]! } : null;
  };
  const first = text(at);
  if (!first) return null;
  // To the word's last character: the next space, or the line's end.
  let last = at;
  while (true) {
    const next = text(last + 1);
    if (!next || /\s/.test(next.char)) break;
    last++;
  }
  const end = text(last)!;
  const range = document.createRange();
  range.setStart(first.piece.node, at - first.piece.from);
  range.setEnd(end.piece.node, last - end.piece.from + 1);
  return range.getBoundingClientRect();
}

/** The last piece of a line's text: where the line ends. */
function lineEnd(lineEl: HTMLElement): HTMLElement | null {
  const pieces = [...lineEl.querySelectorAll<HTMLElement>("[data-at]")].filter((piece) => piece.textContent?.trim());
  return pieces.at(-1) ?? null;
}

/** A line's text, first character to last. */
function textRect(lineEl: HTMLElement): DOMRect {
  const pieces = [...lineEl.querySelectorAll<HTMLElement>("[data-at]")].filter((piece) => piece.textContent?.trim());
  if (pieces.length === 0) return lineEl.getBoundingClientRect();
  const range = document.createRange();
  range.setStartBefore(pieces[0]!);
  range.setEndAfter(pieces.at(-1)!);
  return range.getBoundingClientRect();
}

/** A line from the end of a line's text to its note: across, then down or up to it. */
function connector(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const bend = to.x - 14;
  if (Math.abs(to.y - from.y) < 2) return `M ${from.x} ${from.y} H ${to.x}`;
  return `M ${from.x} ${from.y} H ${bend} V ${to.y} H ${to.x}`;
}

/** A margin note's number (issue #264): in its colour, bolder while the note is pointed at. */
function Badge({ x, y, color, number, hovered, testId }: { x: number; y: number; color: string; number: number; hovered: boolean; testId: string }) {
  return (
    <span
      className="absolute flex items-center justify-center rounded-full font-sans text-[9px] leading-none font-bold text-white tabular-nums"
      style={{ left: x, top: y, width: BADGE, height: BADGE, backgroundColor: color, opacity: hovered ? 1 : 0.85, boxShadow: hovered ? `0 0 0 2px ${color}55` : undefined }}
      data-testid={testId}
    >
      {number}
    </span>
  );
}

/** What's written in an element, first character to last (not the element's full width). */
function contentRect(element: HTMLElement): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect();
}
