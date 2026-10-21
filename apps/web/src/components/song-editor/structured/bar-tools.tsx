import { useEditorState, type Editor } from "@tiptap/react";
import { ChevronLeft, ChevronRight, Minus, Plus, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@oneverse/ui/components/popover";
import { cn } from "@oneverse/ui/lib/utils";
import { startChordDrag } from "./drag";
import { clearBarLines, currentSection, deleteBar, fillBarLines, hasBarLines, insertBarLine, nudgeBar, selectedBar, setBarCount } from "./extensions";

/**
 * Bar lines in the editor (issue #238): where each bar starts, placed in
 * the lyrics. These are their tools - the selected one's (moved a letter at
 * a time, bars after it, deleted), a bar line to drag in, and the menu that
 * fills them in from the chords or takes them away.
 */

/** A press that mustn't take the focus from the chart (and close the keyboard). */
const keepFocus = (event: SyntheticEvent) => event.preventDefault();

/** The bar line selected: its position and how many bars start there; null for none. */
export function useSelectedBar(editor: Editor | null): { pos: number; bars: number } | null {
  return (
    useEditorState({
      editor,
      selector: ({ editor: current }) => {
        const bar = current ? selectedBar(current.state) : null;
        return bar ? { pos: bar.pos, bars: (bar.node.attrs.bars as number) ?? 1 } : null;
      },
      equalityFn: (a, b) => a?.pos === b?.pos && a?.bars === b?.bars,
    }) ?? null
  );
}

/** The selected bar line's tools: left, right, bars after it (− n +), delete. `large`: a finger's size (the chord bar). */
export function BarLineTools({ editor, bar, large = false }: { editor: Editor; bar: { pos: number; bars: number }; large?: boolean }) {
  const { t } = useTranslation();
  const view = editor.view;
  const tool = (label: string, icon: ReactNode, onClick: () => void, testId: string, options: { disabled?: boolean; destructive?: boolean } = {}) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={options.disabled}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md border bg-background hover:bg-accent active:bg-muted disabled:opacity-40",
        large ? "size-12 rounded-lg [&_svg]:size-5" : "size-8 [&_svg]:size-4",
        options.destructive && "text-destructive",
      )}
      data-testid={testId}
    >
      {icon}
    </button>
  );
  return (
    <>
      {tool(t("structuredEditor.bars.moveLeft"), <ChevronLeft />, () => nudgeBar(view, bar.pos, -1), "bar-left")}
      {tool(t("structuredEditor.bars.moveRight"), <ChevronRight />, () => nudgeBar(view, bar.pos, 1), "bar-right")}
      <span className={cn("flex shrink-0 items-center gap-1 rounded-lg border px-1", large ? "h-12" : "h-8")} role="group" aria-label={t("structuredEditor.bars.count")}>
        {tool(t("structuredEditor.bars.fewer"), <Minus />, () => setBarCount(view, bar.pos, bar.bars - 1), "bar-fewer", { disabled: bar.bars <= 1 })}
        <span className={cn("min-w-14 text-center tabular-nums", large ? "text-sm" : "text-xs")} data-testid="bar-count">
          {t("structuredEditor.bars.barsHere", { count: bar.bars })}
        </span>
        {tool(t("structuredEditor.bars.more"), <Plus />, () => setBarCount(view, bar.pos, bar.bars + 1), "bar-more", { disabled: bar.bars >= 16 })}
      </span>
      {tool(t("structuredEditor.bars.delete"), <Trash2 />, () => deleteBar(view, bar.pos), "bar-delete", { destructive: true })}
    </>
  );
}

/** The selected bar line's tools just under it, where the chord bar along the bottom (which has them otherwise) is hidden: a wide screen with a mouse. */
export function BarPopover({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const bar = useSelectedBar(editor);
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!bar) return;
    const measure = () => {
      const mark = editor.view.nodeDOM(bar.pos) as HTMLElement | null;
      const container = box.current?.parentElement;
      if (!mark || !container) return;
      const [c, r] = [container.getBoundingClientRect(), mark.getBoundingClientRect()];
      const width = box.current?.offsetWidth ?? 320;
      setPlace({ top: r.bottom - c.top + 22, left: Math.max(0, Math.min(r.left - c.left - 16, c.width - width)) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [editor, bar?.pos, bar?.bars]);
  if (!bar) return null;
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={t("structuredEditor.bars.barLine")}
      data-testid="bar-popover"
      className="absolute z-20 hidden max-w-full flex-col gap-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg lg:pointer-fine:flex"
      style={place ? { top: place.top, left: place.left } : { visibility: "hidden" }}
      onMouseDown={keepFocus}
    >
      <div className="flex items-center gap-1.5">
        <BarLineTools editor={editor} bar={bar} />
      </div>
      <p className="max-w-72 text-xs text-muted-foreground">{t("structuredEditor.bars.toolsHint")}</p>
    </div>
  );
}

/** A bar line to add: a click (or a tap) puts one at the cursor, a drag onto the words where it's let go. */
export function NewBarLine({ editor, large = false }: { editor: Editor; large?: boolean }) {
  const { t } = useTranslation();
  const add = () => insertBarLine(editor.view);
  return (
    <button
      type="button"
      className={cn(
        "flex shrink-0 touch-pan-x items-center gap-1.5 rounded-md border px-2 font-sans text-sm text-foreground hover:bg-accent",
        large ? "h-12 rounded-lg px-3 active:bg-muted" : "py-1",
      )}
      title={t("structuredEditor.bars.addHint")}
      onMouseDown={keepFocus}
      onPointerDown={(event) => startChordDrag(editor.view, event.nativeEvent, { kind: "newBar" }, add, event.currentTarget)}
      // Keyboard activation (a pointer press is handled above).
      onClick={(event) => event.detail === 0 && add()}
      data-testid="bar-new"
    >
      <span className="h-4 w-0.5 rounded-full bg-foreground/70" aria-hidden />
      {t("structuredEditor.bars.barLine")}
    </button>
  );
}

/**
 * The toolbar's Bars menu: bar lines filled in from the chords (where the
 * chart's own bars are) for the section with the cursor or the whole song,
 * or taken away (the bars then come from the chart again).
 */
export function BarsMenu({ editor, disabled, children }: { editor: Editor | null; disabled?: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return { any: false, section: null as number | null, sectionHas: false };
      const section = currentSection(current.state);
      return { any: hasBarLines(current.state.doc), section: section?.node.type.name === "section" ? section.pos : null, sectionHas: section ? hasBarLines(current.state.doc, section.pos) : false };
    },
    equalityFn: (a, b) => a?.any === b?.any && a?.section === b?.section && a?.sectionHas === b?.sectionHas,
  });
  const run = (action: () => void) => {
    action();
    setOpen(false);
  };
  const item = (label: string, onClick: () => void, testId: string, itemDisabled = false) => (
    <Button type="button" variant="ghost" className="h-auto justify-start py-2 text-left whitespace-normal pointer-coarse:min-h-11" disabled={itemDisabled} onClick={() => run(onClick)} data-testid={testId}>
      {label}
    </Button>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled || !editor}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 pointer-coarse:size-11"
            aria-label={t("structuredEditor.bars.menu")}
            title={t("structuredEditor.bars.menu")}
            data-testid="editor-bars"
          />
        }
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-1 p-2">
        <p className="px-2 pt-1 text-xs text-muted-foreground">{t("structuredEditor.bars.menuHint")}</p>
        {editor && state ? (
          <>
            {item(t("structuredEditor.bars.fillSection"), () => fillBarLines(editor.view, state.section), "bars-fill-section", state.section === null)}
            {item(t("structuredEditor.bars.fillSong"), () => fillBarLines(editor.view), "bars-fill-song")}
            {item(t("structuredEditor.bars.clearSection"), () => clearBarLines(editor.view, state.section), "bars-clear-section", !state.sectionHas)}
            {item(t("structuredEditor.bars.clearSong"), () => clearBarLines(editor.view), "bars-clear-song", !state.any)}
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
