import { useEffect } from "react";

/**
 * A panel down the right of a large screen (issues #209, #278): while it's
 * open, the page makes room for it rather than going under it
 * (`html[data-side-panel]` in app.css).
 */
export function useSidePanelRoom(open: boolean) {
  useEffect(() => {
    if (!open) return;
    document.documentElement.setAttribute("data-side-panel", "");
    return () => document.documentElement.removeAttribute("data-side-panel");
  }, [open]);
}
