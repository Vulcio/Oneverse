import type { Editor } from "@tiptap/react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@songverse/ui/lib/utils";
import { moveBlock } from "./extensions";

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
