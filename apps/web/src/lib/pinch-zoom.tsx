import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Pinch to zoom a chart (issue #508), in Practice and in Live: two fingers on
 * a touch screen, a trackpad's pinch (which browsers send as a wheel with
 * Ctrl held, or as Safari's gesture events), or Ctrl and a mouse wheel. The
 * size moves a step at a time through the Display sizes - the lines wrap again
 * only when a step is crossed - and what's under the fingers stays there.
 * The browser's own zoom of the page is kept off the chart meanwhile.
 */

/** How far fingers spread (or close) for one step: about the gap between two sizes. */
const STEP_RATIO = 1.2;
/** How much of a Ctrl-wheel (a trackpad's pinch) makes one step, in pixels of its deltaY. */
const WHEEL_STEP = 60;
/** A Ctrl-wheel pause this long starts its count again, in ms. */
const WHEEL_IDLE_MS = 250;
/** How long the size stays shown after the last step, in ms. */
const LABEL_MS = 900;

export interface PinchZoomOptions {
  /** Off (a PDF, nothing to zoom): the browser keeps its own pinch. */
  enabled: boolean;
  /** One step bigger (1) or smaller (-1): the size reached, as a share (1.25), or null when there's no further step. */
  onStep: (step: 1 | -1) => number | null;
}

/**
 * Pinch on the element given to `ref` steps its size; `label` is the size to
 * show while pinching ("125%"), or null. (A ref callback: an element shown
 * later, another view, is picked up when it's there.)
 */
export function usePinchZoom(options: PinchZoomOptions): { ref: (element: HTMLElement | null) => void; label: string | null } {
  const latest = useRef(options);
  latest.current = options;
  const [label, setLabel] = useState<string | null>(null);
  const attached = useRef<{ element: HTMLElement; detach: () => void } | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    if (attached.current?.element === element) return;
    attached.current?.detach();
    attached.current = element ? { element, detach: attach(element, latest, setLabel) } : null;
  }, []);
  // The browser's pinch off on the chart, scrolling kept; back on when off (a PDF).
  const { enabled } = options;
  useEffect(() => {
    const element = attached.current?.element;
    if (element) element.style.touchAction = enabled ? "pan-x pan-y" : "";
  });
  useEffect(() => () => attached.current?.detach(), []);
  return { ref, label: enabled ? label : null };
}

function attach(element: HTMLElement, latest: RefObject<PinchZoomOptions>, setLabel: (label: string | null) => void): () => void {
  let hide: ReturnType<typeof setTimeout> | undefined;
  const step = (direction: 1 | -1, focusX: number, focusY: number) => {
    // What's under the fingers: the line there, or else whatever is.
    const hit = document.elementFromPoint(focusX, focusY);
    const under = (hit?.closest<HTMLElement>("[data-line-id]") ?? (hit instanceof HTMLElement && element.contains(hit) ? hit : element));
    const before = under.getBoundingClientRect();
    const share = before.height > 0 ? Math.min(1, Math.max(0, (focusY - before.top) / before.height)) : 0;
    const size = latest.current.onStep(direction);
    if (size == null) return;
    setLabel(`${Math.round(size * 100)}%`);
    clearTimeout(hide);
    hide = setTimeout(() => setLabel(null), LABEL_MS);
    // Laid out again at the new size: what was under the fingers goes back under them.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!under.isConnected) return;
        const after = under.getBoundingClientRect();
        const by = after.top + share * after.height - focusY;
        if (Math.abs(by) >= 1) scrollerOf(under).scrollBy({ top: by, behavior: "instant" });
      }),
    );
  };

  // Two fingers.
  let pinch: { distance: number } | null = null;
  const spread = (touches: TouchList) => Math.hypot(touches[0]!.clientX - touches[1]!.clientX, touches[0]!.clientY - touches[1]!.clientY);
  const middle = (touches: TouchList, axis: "clientX" | "clientY") => (touches[0]![axis] + touches[1]![axis]) / 2;
  const onTouchStart = (event: TouchEvent) => {
    pinch = event.touches.length === 2 ? { distance: spread(event.touches) } : null;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (!pinch || event.touches.length !== 2 || !latest.current.enabled) return;
    event.preventDefault();
    const distance = spread(event.touches);
    const ratio = distance / pinch.distance;
    if (ratio >= STEP_RATIO || ratio <= 1 / STEP_RATIO) {
      pinch.distance = distance;
      step(ratio > 1 ? 1 : -1, middle(event.touches, "clientX"), middle(event.touches, "clientY"));
    }
  };
  const onTouchEnd = (event: TouchEvent) => {
    if (event.touches.length < 2) pinch = null;
  };

  // A trackpad's pinch, or Ctrl and the wheel.
  let wheel = 0;
  let wheelAt = 0;
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey || !latest.current.enabled) return;
    event.preventDefault();
    if (event.timeStamp - wheelAt > WHEEL_IDLE_MS) wheel = 0;
    wheelAt = event.timeStamp;
    // A line or a page of wheel, in pixels, as a trackpad's are.
    wheel -= event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? 400 : 1);
    if (Math.abs(wheel) >= WHEEL_STEP) {
      step(wheel > 0 ? 1 : -1, event.clientX, event.clientY);
      wheel = 0;
    }
  };

  // Safari's gestures: a Mac's trackpad pinch (an iPhone's comes as touches above; its page zoom is kept off).
  let gesture: { scale: number; x: number; y: number } | null = null;
  const onGestureStart = (event: Event) => {
    if (!latest.current.enabled) return;
    event.preventDefault();
    gesture = { scale: 1, x: (event as MouseEvent).clientX ?? 0, y: (event as MouseEvent).clientY ?? 0 };
  };
  const onGestureChange = (event: Event) => {
    if (!gesture) return;
    event.preventDefault();
    if (pinch) return;
    const scale = (event as Event & { scale: number }).scale;
    const ratio = scale / gesture.scale;
    if (ratio >= STEP_RATIO || ratio <= 1 / STEP_RATIO) {
      gesture.scale = scale;
      step(ratio > 1 ? 1 : -1, gesture.x, gesture.y);
    }
  };
  const onGestureEnd = (event: Event) => {
    if (gesture) event.preventDefault();
    gesture = null;
  };

  element.addEventListener("touchstart", onTouchStart, { passive: true });
  element.addEventListener("touchmove", onTouchMove, { passive: false });
  element.addEventListener("touchend", onTouchEnd, { passive: true });
  element.addEventListener("touchcancel", onTouchEnd, { passive: true });
  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("gesturestart", onGestureStart);
  element.addEventListener("gesturechange", onGestureChange);
  element.addEventListener("gestureend", onGestureEnd);
  element.style.touchAction = latest.current.enabled ? "pan-x pan-y" : "";
  return () => {
    clearTimeout(hide);
    element.removeEventListener("touchstart", onTouchStart);
    element.removeEventListener("touchmove", onTouchMove);
    element.removeEventListener("touchend", onTouchEnd);
    element.removeEventListener("touchcancel", onTouchEnd);
    element.removeEventListener("wheel", onWheel);
    element.removeEventListener("gesturestart", onGestureStart);
    element.removeEventListener("gesturechange", onGestureChange);
    element.removeEventListener("gestureend", onGestureEnd);
    element.style.touchAction = "";
  };
}

/** The size reached, shown over the chart while pinching. */
export function PinchZoomLabel({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <div className="pointer-events-none fixed top-1/3 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground/85 px-4 py-1.5 text-base font-semibold text-background tabular-nums shadow-lg" role="status" data-testid="pinch-zoom-size">
      {label}
    </div>
  );
}

/** What scrolls an element: the nearest scrolling box around it, or the page. */
function scrollerOf(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}
