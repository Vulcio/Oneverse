import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { insertChord, moveChord, setDropTarget } from "./extensions";

/** What's being dragged: a chord already in the song, or a new one from the palette. */
export type DragSource = { kind: "move"; pos: number; raw: string } | { kind: "new"; raw: string };

const THRESHOLD = 5;
const EDGE = 48;
/** How long a finger rests on a chord before it lifts to be dragged (issues #32, #253); a quicker swipe scrolls. */
const HOLD_MS = 350;
/** How far a finger may wander while holding. */
const HOLD_SLOP = 8;

/**
 * Drags a chord from a pointer press on `handle` (its chip, or a palette
 * chord): a ghost chip follows the pointer, the character it would sit over
 * is highlighted, and letting go pins it there. A press without a drag is a
 * click (`onClick`). With a mouse or a pen it starts as it moves; a finger
 * holds it a moment first - the chip lifts - so a swipe still scrolls.
 */
export function startChordDrag(view: EditorView, event: PointerEvent, source: DragSource, onClick: () => void, pressed?: HTMLElement) {
  if (event.button !== 0 || !view.editable) return;
  // React's own event knows the element pressed; its native event's currentTarget is wherever React listens.
  const handle = pressed ?? (event.currentTarget as HTMLElement);
  const rect = handle.getBoundingClientRect();
  const grab = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const start = { x: event.clientX, y: event.clientY };
  // A chip's own press is ours: no text selection, no focus change.
  if (source.kind === "move") event.preventDefault();
  handle.setPointerCapture(event.pointerId);

  let ghost: HTMLElement | null = null;
  let target: number | null = null;
  let frame = 0;
  // A finger: not dragging until it has held still a moment.
  const touch = event.pointerType === "touch";
  let holding = touch;
  let last = { x: event.clientX, y: event.clientY };
  const hold = touch
    ? window.setTimeout(() => {
        holding = false;
        navigator.vibrate?.(10);
        lift(last.x, last.y);
      }, HOLD_MS)
    : 0;
  // Once lifted, the finger no longer scrolls the page.
  const noScroll = (e: TouchEvent) => {
    if (ghost) e.preventDefault();
  };
  if (touch) window.addEventListener("touchmove", noScroll, { passive: false });
  const fontSize = parseFloat(getComputedStyle(view.dom).fontSize) || 16;

  function targetAt(x: number, y: number): number | null {
    // The ghost's left edge, over the middle of the lyric row below it.
    const found = view.posAtCoords({ left: x - grab.x + 1, top: y - grab.y + rect.height + fontSize * 0.6 });
    if (!found) return null;
    const $pos = view.state.doc.resolve(found.pos);
    return $pos.parent.type.name === "line" && $pos.parent.attrs.kind !== "note" ? found.pos : null;
  }

  function autoScroll(y: number) {
    cancelAnimationFrame(frame);
    const speed = y < EDGE ? -(EDGE - y) / 3 : y > window.innerHeight - EDGE ? (y - (window.innerHeight - EDGE)) / 3 : 0;
    if (speed) {
      window.scrollBy(0, speed);
      frame = requestAnimationFrame(() => autoScroll(y));
    }
  }

  /** The chip lifted under the pointer: the ghost that follows it. */
  function lift(x: number, y: number) {
    if (ghost) return;
    ghost = document.createElement("div");
    ghost.className = touch ? "sv-drag-ghost sv-drag-ghost-lifted" : "sv-drag-ghost";
    ghost.textContent = source.raw;
    document.body.append(ghost);
    document.body.classList.add("sv-dragging");
    if (source.kind === "move") view.dom.querySelector(`[data-id="${CSS.escape(String(view.state.doc.nodeAt(source.pos)?.attrs.id))}"]`)?.classList.add("sv-chord-moving");
    follow(x, y);
  }

  function follow(x: number, y: number) {
    if (!ghost) return;
    ghost.style.transform = `translate(${x - grab.x}px, ${y - grab.y}px)`;
    target = targetAt(x, y);
    setDropTarget(view, target);
    autoScroll(y);
  }

  function move(e: PointerEvent) {
    last = { x: e.clientX, y: e.clientY };
    if (holding) {
      // Moved before the hold: a swipe, not a drag (nor a tap).
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > HOLD_SLOP) finish(e, true);
      return;
    }
    if (!ghost) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return;
      lift(e.clientX, e.clientY);
    }
    follow(e.clientX, e.clientY);
  }

  function finish(e: PointerEvent, cancelled: boolean) {
    window.clearTimeout(hold);
    window.removeEventListener("touchmove", noScroll);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", cancel);
    cancelAnimationFrame(frame);
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    const dragged = !!ghost;
    ghost?.remove();
    document.body.classList.remove("sv-dragging");
    view.dom.querySelectorAll(".sv-chord-moving").forEach((el) => el.classList.remove("sv-chord-moving"));
    setDropTarget(view, null);
    if (cancelled) return;
    if (!dragged) {
      onClick();
      return;
    }
    if (target === null) return;
    if (source.kind === "move") {
      if (!moveChord(view, source.pos, target)) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, source.pos)));
    } else {
      insertChord(view, source.raw, target);
    }
    view.focus();
  }
  const up = (e: PointerEvent) => finish(e, false);
  const cancel = (e: PointerEvent) => finish(e, true);

  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", cancel);
}
