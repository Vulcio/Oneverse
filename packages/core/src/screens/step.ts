import type { SyncPresenting } from "../sync/index.js";

/**
 * A screen moved by hand while it has lost the sync (issue #195): a TV
 * remote, a keyboard or a presenter clicker on the screen itself. The slides
 * are cut on the screen, so this needs nothing from the server; when the sync
 * comes back, the session's slide wins and nothing moved here is sent back.
 */
export type ScreenStep = "next" | "previous" | "next-item" | "previous-item" | "black";

/** The set's items as the screen cut them: each one's id and how many slides it has. */
export interface ScreenStepItem {
  id: string;
  slides: number;
}

/**
 * Where `step` goes from `presenting`, through the set's `items` in order -
 * the slides of one, then the next's (items with no slides skipped); it stays
 * put at either end. From black, Next or Previous shows the slide that was
 * black; Black goes black, or back. Null when the set has nothing to show.
 */
export function stepPresenting(items: readonly ScreenStepItem[], presenting: Pick<SyncPresenting, "itemId" | "slide" | "black"> | null, step: ScreenStep): SyncPresenting | null {
  const shown = items.filter((item) => item.slides > 0);
  if (shown.length === 0) return null;
  const at = presenting ? shown.findIndex((item) => item.id === presenting.itemId) : -1;
  // Nothing presented, or an item it can't show: the set's first slide.
  if (!presenting || at < 0) return { itemId: shown[0]!.id, slide: 0, black: step === "black" };
  const item = shown[at]!;
  const slide = Math.max(0, Math.min(item.slides - 1, presenting.slide));
  const to = (index: number, slideIn: number): SyncPresenting => ({ itemId: shown[index]!.id, slide: slideIn, black: false });
  if (step === "black") return { itemId: item.id, slide, black: !presenting.black };
  if (presenting.black && (step === "next" || step === "previous")) return to(at, slide);
  switch (step) {
    case "next":
      return slide < item.slides - 1 ? to(at, slide + 1) : at < shown.length - 1 ? to(at + 1, 0) : to(at, slide);
    case "previous":
      return slide > 0 ? to(at, slide - 1) : at > 0 ? to(at - 1, shown[at - 1]!.slides - 1) : to(at, 0);
    case "next-item":
      return at < shown.length - 1 ? to(at + 1, 0) : to(at, slide);
    case "previous-item":
      return at > 0 ? to(at - 1, 0) : to(at, 0);
  }
}

/** A remote's, a keyboard's or a clicker's key as a step (issue #195); null for any other key. */
export function screenStepKey(key: string): ScreenStep | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case "Enter":
    case " ":
      return "next";
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
      return "previous";
    case "ChannelUp":
    case "MediaTrackNext":
    case "MediaFastForward":
      return "next-item";
    case "ChannelDown":
    case "MediaTrackPrevious":
    case "MediaRewind":
      return "previous-item";
    // A clicker's black key sends "." or "b"; a remote's Back.
    case ".":
    case "b":
    case "B":
    case "Escape":
    case "Backspace":
    case "GoBack":
    case "BrowserBack":
      return "black";
    default:
      return null;
  }
}
