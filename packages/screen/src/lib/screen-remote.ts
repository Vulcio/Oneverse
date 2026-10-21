import { useEffect, useRef, type RefObject } from "react";

/** Back on a remote, a keyboard or a TV browser. */
export const isBackKey = (key: string) => key === "Escape" || key === "Backspace" || key === "GoBack";

/**
 * A list on the screen driven by a TV remote - the D-pad, OK and Back, as a
 * Chromecast's - or the arrow keys, Enter and Escape (issues #274, #276): the
 * whole page's keys while it's open, so a press counts before an entry has
 * the focus. Its entries are the `[data-pick]` buttons inside `list`. OK still
 * held from opening it (the key repeating) picks nothing.
 */
export function useRemoteList(list: RefObject<HTMLElement | null>, onBack?: () => void) {
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.repeat && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        return;
      }
      const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("[data-pick]:not(:disabled)") ?? [])];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: buttons.length - 1, PageDown: at + 5, PageUp: at - 5 }[event.key];
      if (to !== undefined) {
        event.preventDefault();
        const target = buttons[Math.max(0, Math.min(buttons.length - 1, to))];
        target?.focus();
        target?.scrollIntoView({ block: "nearest" });
      } else if (isBackKey(event.key) && back.current) {
        event.preventDefault();
        back.current();
      }
    };
    // Captured: before a focused button takes a repeated OK as a click.
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, [list]);
}
