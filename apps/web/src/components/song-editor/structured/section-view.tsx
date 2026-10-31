import { SECTION_TYPES, sectionName } from "@oneverse/core";
import { NodeViewContent, NodeViewWrapper, useEditorState, type ReactNodeViewProps } from "@tiptap/react";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Link2, ListMinus, ListPlus, MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@oneverse/ui/components/dropdown-menu";
import { cn } from "@oneverse/ui/lib/utils";
import { BlockTools, ToolButton } from "./block-tools";
import { deleteSection, duplicateLinked, duplicateSection, moveBlock, setSung } from "./extensions";
import { SectionInserter } from "./section-inserter";
import { sectionNumberIn } from "./document";

/** Whether the editor's cursor or selection is in the block at `pos`: its tools show (issue #250). */
export function useBlockActive(editor: ReactNodeViewProps["editor"], getPos: () => number | undefined) {
  return (
    useEditorState({
      editor,
      selector: ({ editor: current }) => {
        const pos = getPos();
        if (!current || pos === undefined) return false;
        const node = current.state.doc.nodeAt(pos);
        const { from } = current.state.selection;
        return !!node && from >= pos && from <= pos + node.nodeSize;
      },
    }) ?? false
  );
}

/**
 * A section in the editor (issue #250): its name, edited in place, and its
 * type as a small coloured tag; its lines in a faint wash of its type's
 * colour. Its tools show on the section being edited, or under the
 * pointer - their room is always kept, so nothing moves when they show.
 * A "+" over the gap below it adds a section there (and above the first).
 */
export function SectionView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const type = node.attrs.type as (typeof SECTION_TYPES)[number];
  const label = (node.attrs.label as string | null) ?? "";
  const showLabel = node.attrs.showLabel !== false;
  // Its name when it has no label of its own, by the one rule (issue #344): "Chorus", "Verse 2".
  const number = useEditorState({ editor, selector: ({ editor: current }) => (current ? sectionNumberIn(current.state.doc, node.attrs.id as string) : null) });
  const typeName = sectionName({ type, label: null }, number, (one) => t(`chart.sections.${one}`)) ?? t(`chart.sections.${type}`);
  const at = () => getPos() ?? -1;
  const index = editor.state.doc.resolve(Math.max(0, at())).index(0);
  const count = editor.state.doc.childCount;
  const active = useBlockActive(editor, getPos);
  // Not in the song's order (issue #205): at the end, the first of them under a heading.
  const sung = node.attrs.sung !== false;
  const firstUnsung = !sung && (index === 0 || editor.state.doc.child(index - 1).attrs.sung !== false || editor.state.doc.child(index - 1).type.name !== "section");

  return (
    <NodeViewWrapper
      as="section"
      className={cn("sv-section group/section relative", !sung && "opacity-70")}
      data-section-type={type}
      data-section-color={type}
      data-section-id={node.attrs.id}
      data-active={active ? "" : undefined}
      data-unsung={sung ? undefined : ""}
    >
      {index === 0 ? <SectionInserter editor={editor} at={() => 0} edge="top" testId="section-insert-top" /> : null}
      {firstUnsung ? (
        <p contentEditable={false} className="mb-2 font-sans text-xs font-semibold tracking-wide text-muted-foreground uppercase select-none" data-testid="unsung-heading">
          {t("structuredEditor.notInOrder")}
        </p>
      ) : null}
      <div
        data-sv-section-header=""
        contentEditable={false}
        // Its tools at the right, on the same edge as a linked copy's.
        className="@container/block mb-1 flex min-h-8 flex-wrap items-center gap-2 font-sans select-none pointer-coarse:min-h-11"
      >
        <input
          aria-label={t("structuredEditor.sectionLabel")}
          value={label}
          placeholder={typeName}
          maxLength={100}
          onChange={(event) => updateAttributes({ label: event.target.value || null })}
          className={cn(
            "h-7 max-w-full min-w-12 rounded-md border border-transparent bg-transparent px-1.5 text-[15px] font-semibold outline-none [field-sizing:content] placeholder:text-foreground hover:border-input focus:border-ring pointer-coarse:h-10",
            !showLabel && "text-muted-foreground line-through placeholder:text-muted-foreground",
          )}
          data-testid="section-name"
        />
        {/* Its type, as a tag in its colour: it opens the list of types. */}
        <select
          aria-label={t("structuredEditor.sectionType")}
          value={type}
          onChange={(event) => updateAttributes({ type: event.target.value })}
          className="h-6 cursor-pointer appearance-none rounded-md border-0 [field-sizing:content] bg-[var(--section-tag)] px-2 text-[11px] font-semibold tracking-wide text-[var(--section-ink)] uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:h-9 pointer-coarse:text-xs"
          data-testid="section-type"
        >
          {SECTION_TYPES.map((option) => (
            <option key={option} value={option}>
              {t(`chart.sections.${option}`)}
            </option>
          ))}
        </select>
        {/* Kept in place whether they show or not: showing them moves nothing. */}
        <div className={cn("ml-auto flex items-center", active ? "visible" : "invisible group-hover/section:visible pointer-coarse:visible")} data-section-tools="">
          <BlockTools
            editor={editor}
            at={at}
            tools={
              <>
                {/* The section's name ("Chorus") shown on the chart or not, in Practice and Live. */}
                <ToolButton label={showLabel ? t("structuredEditor.hideLabel") : t("structuredEditor.showLabel")} pressed={!showLabel} onClick={() => updateAttributes({ showLabel: !showLabel })} testId="section-label-shown">
                  {showLabel ? <Eye /> : <EyeOff />}
                </ToolButton>
                {sung ? (
                  <ToolButton className="hidden @xl/block:flex" label={t("structuredEditor.duplicateLinked")} onClick={() => duplicateLinked(editor.view, at())} testId="block-duplicate-linked">
                    <Link2 />
                  </ToolButton>
                ) : null}
                <ToolButton className="hidden @xl/block:flex" label={t("structuredEditor.duplicateSection")} onClick={() => duplicateSection(editor.view, at())} testId="block-duplicate">
                  <Copy />
                </ToolButton>
              </>
            }
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<button type="button" className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11" aria-label={t("structuredEditor.sectionMenu", { section: label || typeName })} />}
              >
                <MoreHorizontal className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={index === 0} onClick={() => moveBlock(editor.view, at(), -1)}>
                  <ArrowUp />
                  {t("structuredEditor.moveUp")}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index === count - 1} onClick={() => moveBlock(editor.view, at(), 1)}>
                  <ArrowDown />
                  {t("structuredEditor.moveDown")}
                </DropdownMenuItem>
                {/* Sung again where it's put, following this one (issue #205). */}
                {sung ? (
                  <DropdownMenuItem onClick={() => duplicateLinked(editor.view, at())} data-testid="section-duplicate-linked">
                    <Link2 />
                    {t("structuredEditor.duplicateLinked")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => duplicateSection(editor.view, at())} data-testid="section-duplicate">
                  <Copy />
                  {t("structuredEditor.duplicateSection")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSung(editor.view, at(), !sung)} data-testid="section-toggle-sung">
                  {sung ? <ListMinus /> : <ListPlus />}
                  {sung ? t("structuredEditor.takeOutOfOrder") : t("structuredEditor.putBackInOrder")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => deleteSection(editor.view, at())}>
                  <Trash2 />
                  {t("structuredEditor.deleteSection")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </BlockTools>
        </div>
      </div>
      <NodeViewContent className="sv-lines" />
      {sung ? <SectionInserter editor={editor} at={() => at() + node.nodeSize} edge="bottom" testId="section-insert" /> : null}
    </NodeViewWrapper>
  );
}
