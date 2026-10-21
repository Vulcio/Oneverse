import { diatonicChords } from "@oneverse/core";
import { useEditorState, type Editor } from "@tiptap/react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@oneverse/ui/components/popover";
import { deleteChord, insertChord, nudgeChord, selectedChord, setChordSymbol } from "./extensions";
import { BarLineTools, NewBarLine, useSelectedBar } from "./bar-tools";

const VARIATIONS = ["", "m", "7", "maj7", "m7", "sus2", "sus4", "add9"];

/** How far the on-screen keyboard covers the page from the bottom (iOS keeps fixed bars under it). */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

/** Adds `raw` at the cursor, or puts it in place of the chord selected. */
export function applyChord(editor: Editor, raw: string) {
  const selected = selectedChord(editor.state);
  if (selected) setChordSymbol(editor.view, selected.pos, raw);
  else insertChord(editor.view, raw);
}

/** A press that mustn't take the focus from the chart (and close the keyboard). */
const keepFocus = (event: SyntheticEvent) => event.preventDefault();

/**
 * The chords on a touch screen (issue #253): a bar along the bottom of the
 * screen, above the keyboard and the save bar - the key's chords with
 * their degree, then the song's others. A tap adds one at the cursor, or
 * puts it in place of the chord selected; no typing [G]. A chord selected
 * gets its tools at the start of the bar - moved a letter left or right,
 * deleted - and its variations after the key's chords (here, not in a
 * popover over the chart). It scrolls sideways; every chord is a finger wide.
 * A bar line (issue #238) is added from its end, and one selected gets its
 * tools there instead of the chords.
 */
export function ChordBar({ editor, songKey, used }: { editor: Editor; songKey: string; used: string[] }) {
  const { t } = useTranslation();
  const inset = useKeyboardInset();
  const [other, setOther] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const selected = useEditorState({ editor, selector: ({ editor: current }) => (current ? ((selectedChord(current.state)?.node.attrs.raw as string | undefined) ?? null) : null) });
  const bar = useSelectedBar(editor);
  const inKey = diatonicChords(songKey);
  const others = used.filter((raw) => !inKey.some((chord) => chord.chord === raw));
  const root = selected ? /^\(?([A-G][#b]?)/.exec(selected)?.[1] : undefined;
  const variations = root ? VARIATIONS.map((suffix) => root + suffix).filter((raw) => raw !== selected && !inKey.some((chord) => chord.chord === raw)) : [];
  const atSelected = () => selectedChord(editor.state)?.pos;
  const tool = (label: string, icon: ReactNode, onClick: (pos: number) => void, testId: string, destructive = false) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={() => {
        const pos = atSelected();
        if (pos !== undefined) onClick(pos);
      }}
      className={`flex size-12 shrink-0 items-center justify-center rounded-lg border bg-background active:bg-muted [&_svg]:size-5 ${destructive ? "text-destructive" : ""}`}
      data-testid={testId}
    >
      {icon}
    </button>
  );

  const chip = (raw: string, degree?: string) => (
    <button
      key={`${raw}:${degree ?? ""}`}
      type="button"
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={() => applyChord(editor, raw)}
      className="flex h-12 min-w-12 shrink-0 flex-col items-center justify-center rounded-lg border bg-background px-2 active:bg-muted"
      data-bar-chord={raw}
    >
      <span className="text-[15px] leading-tight font-bold text-primary">{raw}</span>
      {degree ? <span className="text-[10px] leading-tight text-muted-foreground">{degree}</span> : null}
    </button>
  );

  return (
    <div
      role="toolbar"
      aria-label={t("structuredEditor.chords")}
      data-testid="chord-bar"
      // Over the save bar on a phone (its height in --save-bar-h), over the keyboard when it's open.
      className="fixed inset-x-0 z-30 border-t bg-background/95 px-2 pt-1.5 pb-2 font-sans backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:pointer-fine:hidden"
      style={{ bottom: inset > 0 ? inset : "var(--save-bar-h, 0px)" }}
    >
      <div className="mb-1 flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
        <span className="truncate">{bar ? t("structuredEditor.bars.toolsHint") : selected ? t("structuredEditor.barReplace", { chord: selected }) : t("structuredEditor.barHint")}</span>
        {songKey && inKey.length ? <span className="shrink-0">{t("structuredEditor.inKey", { key: songKey })}</span> : null}
      </div>
      {bar ? (
        <div className="flex touch-pan-x gap-1.5 overflow-x-auto" data-testid="bar-tools">
          <BarLineTools editor={editor} bar={bar} large />
        </div>
      ) : (
      <div className="flex touch-pan-x gap-1.5 overflow-x-auto">
        {selected ? (
          <>
            {tool(t("structuredEditor.moveLeft"), <ChevronLeft />, (pos) => nudgeChord(editor.view, pos, -1), "chord-bar-left")}
            {tool(t("structuredEditor.moveRight"), <ChevronRight />, (pos) => nudgeChord(editor.view, pos, 1), "chord-bar-right")}
            {tool(t("structuredEditor.deleteChord"), <Trash2 />, (pos) => deleteChord(editor.view, pos), "chord-bar-delete", true)}
            <span className="mx-0.5 w-px shrink-0 self-stretch bg-border" aria-hidden />
          </>
        ) : null}
        {inKey.map((chord) => chip(chord.chord, chord.degree))}
        {variations.map((raw) => chip(raw))}
        {others.map((raw) => chip(raw))}
        <Popover open={otherOpen} onOpenChange={setOtherOpen}>
          <PopoverTrigger
            render={<button type="button" className="flex h-12 shrink-0 items-center gap-1 rounded-lg border border-dashed px-3 text-sm text-muted-foreground" data-testid="chord-bar-other" />}
          >
            <Plus className="size-4" aria-hidden />
            {t("structuredEditor.otherChord")}
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="flex w-64 gap-2">
            <input
              value={other}
              onChange={(event) => setOther(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && other.trim()) {
                  event.preventDefault();
                  applyChord(editor, other.trim());
                  setOther("");
                  setOtherOpen(false);
                }
              }}
              aria-label={t("structuredEditor.otherChord")}
              placeholder="Cadd9"
              maxLength={64}
              className="h-11 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 font-mono text-sm outline-none focus-visible:border-ring"
            />
            <Button
              type="button"
              className="h-11"
              disabled={!other.trim()}
              onClick={() => {
                applyChord(editor, other.trim());
                setOther("");
                setOtherOpen(false);
              }}
            >
              {t("structuredEditor.addChord")}
            </Button>
          </PopoverContent>
        </Popover>
        <span className="mx-0.5 w-px shrink-0 self-stretch bg-border" aria-hidden />
        <NewBarLine editor={editor} large />
      </div>
      )}
    </div>
  );
}
