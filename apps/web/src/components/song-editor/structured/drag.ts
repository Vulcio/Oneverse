import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { insertChord, moveChord, setDropTarget } from "./extensions";

/** What's being dragged: a chord already in the song, or a new one from the palette. */
export type DragSource = { kind: "move"; pos: number; raw: string } | { kind: "new"; raw: string };

const THRESHOLD = 5;
const EDGE = 48;

/**
 * Drags a chord from a pointer press on `handle` (its chip, or a palette
 * chord): a ghost chip follows the pointer, the character it would sit over
 * is highlighted, and letting go pins it there. A press without a drag is a
 * click (`onClick`). Works the same with a mouse, a pen or a finger.
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

  function move(e: PointerEvent) {
    if (!ghost) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return;
      ghost = document.createElement("div");
      ghost.className = "sv-drag-ghost";
      ghost.textContent = source.raw;
      document.body.append(ghost);
      document.body.classList.add("sv-dragging");
      if (source.kind === "move") view.dom.querySelector(`[data-id="${CSS.escape(String(view.state.doc.nodeAt(source.pos)?.attrs.id))}"]`)?.classList.add("sv-chord-moving");
    }
    ghost.style.transform = `translate(${e.clientX - grab.x}px, ${e.clientY - grab.y}px)`;
    target = targetAt(e.clientX, e.clientY);
    setDropTarget(view, target);
    autoScroll(e.clientY);
  }

  function finish(e: PointerEvent, cancelled: boolean) {
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
