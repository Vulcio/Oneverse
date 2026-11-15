import { useEffect } from "react";

/**
 * A panel down the right of a large screen (issues #209, #278): while it's
 * open, the page makes room for it rather than going under it
 * (`html[data-side-panel]` in app.css), 20rem or `width`.
 */
export function useSidePanelRoom(open: boolean, width?: string) {
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.setAttribute("data-side-panel", "");
    // A wider panel (the operator's screens, issue #358) makes as much room.
    if (width) root.style.setProperty("--side-panel-width", width);
    return () => {
      root.removeAttribute("data-side-panel");
      root.style.removeProperty("--side-panel-width");
    };
  }, [open, width]);
}
