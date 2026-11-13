import { useEffect, useState, type RefObject } from "react";

/**
 * Whether the tools box shown for the chord or bar line selected (`key`)
 * was closed: by a press outside it, or Escape. It shows again for another
 * chord, or when the same one is pressed again (`anchor`). The selection
 * stays as it was; the box only gets out of the way.
 */
export function useDismissed(key: string | null, box: RefObject<HTMLElement | null>, anchor: () => Element | null): boolean {
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    const press = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || box.current?.contains(target)) return;
      // A menu or popover opened from the box is still the box.
      if (target.closest('[data-slot="popover-content"], [role="menu"], [role="listbox"]')) return;
      setDismissed(anchor()?.contains(target) ? null : key);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(key);
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("keydown", escape);
    };
  }, [key, box, anchor]);
  return !!key && dismissed === key;
}
