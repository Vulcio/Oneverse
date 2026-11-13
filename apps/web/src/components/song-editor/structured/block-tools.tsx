import type { Editor } from "@tiptap/react";
import { ArrowDown, ArrowUp, Minus, Plus, Repeat } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@oneverse/ui/lib/utils";
import { MAX_REPEATS } from "./document";
import { moveBlock, setRepeatCount } from "./extensions";

/**
 * The tools at the right of a block's heading - a section's or a linked
 * copy's, lined up on the same edge: the block's own controls
 * (`leading`), its own tools (`tools`: duplicates, say), moving it up or
 * down, then its menu (`children`). Tools that only show with room hide
 * by a container query on the heading (`@container/block`); each of
 * those is in the menu too.
 */
export function BlockTools({ editor, at, leading, tools, children }: { editor: Editor; at: () => number; leading?: ReactNode; tools?: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  const index = editor.state.doc.resolve(Math.max(0, at())).index(0);
  const count = editor.state.doc.childCount;
  return (
    <div className="ml-auto flex items-center gap-0.5" data-block-tools="">
      {leading}
      {tools}
      <ToolButton className="hidden @md/block:flex" label={t("structuredEditor.moveUp")} disabled={index === 0} onClick={() => moveBlock(editor.view, at(), -1)} testId="block-move-up">
        <ArrowUp />
      </ToolButton>
      <ToolButton className="hidden @md/block:flex" label={t("structuredEditor.moveDown")} disabled={index === count - 1} onClick={() => moveBlock(editor.view, at(), 1)} testId="block-move-down">
        <ArrowDown />
      </ToolButton>
      {children}
    </div>
  );
}

/** One of a block heading's icon tools; `className` decides when it shows (`hidden @xl/block:flex`), else always. */
export function ToolButton({
  label,
  onClick,
  disabled,
  pressed,
  className = "flex",
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn("size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 pointer-coarse:size-11 [&_svg]:size-3.5", className)}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/**
 * How many times in a row a block is sung (×2, ×3), with one more and one
 * fewer: shown once it's sung more than once, by its name. A block sung
 * once has the "sing it again" tool instead (`RepeatAddTool`).
 */
export function RepeatCounter({ editor, at, repeats }: { editor: Editor; at: () => number; repeats: string[] }) {
  const { t } = useTranslation();
  const times = repeats.length + 1;
  if (times < 2) return null;
  const button = "flex size-6 items-center justify-center rounded-full text-[var(--section-ink)] hover:bg-background/80 disabled:pointer-events-none disabled:opacity-30 pointer-coarse:size-8 [&_svg]:size-3.5";
  return (
    <span
      className="flex h-7 items-center rounded-full border border-[var(--section-line)] bg-[var(--section-tag)] pointer-coarse:h-9"
      role="group"
      aria-label={t("structuredEditor.repeat.count", { count: times })}
      data-testid="repeat-counter"
    >
      <button type="button" className={button} onClick={() => setRepeatCount(editor.view, at(), times - 1)} aria-label={t("structuredEditor.repeat.fewer")} title={t("structuredEditor.repeat.fewer")} data-testid="repeat-fewer">
        <Minus />
      </button>
      <span className="min-w-6 text-center text-xs font-semibold text-[var(--section-ink)] tabular-nums" title={t("structuredEditor.repeat.count", { count: times })} data-testid="repeat-times">
        ×{times}
      </span>
      <button type="button" className={button} onClick={() => setRepeatCount(editor.view, at(), times + 1)} disabled={times >= MAX_REPEATS} aria-label={t("structuredEditor.repeat.more")} title={t("structuredEditor.repeat.more")} data-testid="repeat-more">
        <Plus />
      </button>
    </span>
  );
}

/** A block's tool to sing it again straight after (×2), while it's sung once. */
export function RepeatAddTool({ editor, at, repeats }: { editor: Editor; at: () => number; repeats: string[] }) {
  const { t } = useTranslation();
  if (repeats.length > 0) return null;
  return (
    <ToolButton label={t("structuredEditor.repeat.add")} onClick={() => setRepeatCount(editor.view, at(), 2)} testId="repeat-add">
      <Repeat />
    </ToolButton>
  );
}
