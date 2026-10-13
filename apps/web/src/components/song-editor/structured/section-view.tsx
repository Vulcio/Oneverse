import { SECTION_TYPES } from "@songverse/core";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Link2, ListMinus, ListPlus, MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@songverse/ui/components/dropdown-menu";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { cn } from "@songverse/ui/lib/utils";
import { BlockTools, ToolButton } from "./block-tools";
import { deleteSection, duplicateLinked, duplicateSection, moveBlock, setSung } from "./extensions";

/** A section in the editor: its heading controls (type, label, shown or not, menu) above its lines. */
export function SectionView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const type = node.attrs.type as (typeof SECTION_TYPES)[number];
  const label = (node.attrs.label as string | null) ?? "";
  const showLabel = node.attrs.showLabel !== false;
  const typeName = t(`chart.sections.${type}`);
  const at = () => getPos() ?? -1;
  const index = editor.state.doc.resolve(Math.max(0, at())).index(0);
  const count = editor.state.doc.childCount;
  // Not in the song's order (issue #205): at the end, the first of them under a heading.
  const sung = node.attrs.sung !== false;
  const firstUnsung = !sung && (index === 0 || editor.state.doc.child(index - 1).attrs.sung !== false || editor.state.doc.child(index - 1).type.name !== "section");

  return (
    <NodeViewWrapper as="section" className={cn("sv-section group/section", !sung && "opacity-70")} data-section-type={type} data-section-id={node.attrs.id} data-unsung={sung ? undefined : ""}>
      {firstUnsung ? (
        <p contentEditable={false} className="mb-2 border-t pt-3 font-sans text-xs font-semibold tracking-wide text-muted-foreground uppercase select-none" data-testid="unsung-heading">
          {t("structuredEditor.notInOrder")}
        </p>
      ) : null}
      <div
        data-sv-section-header=""
        contentEditable={false}
        // Its tools at the right, on the same edge as a linked copy's (its border and padding).
        className="@container/block mb-1.5 flex flex-wrap items-center gap-1.5 pr-3.25 pb-1 font-sans select-none"
      >
        <NativeSelect
          compact
          aria-label={t("structuredEditor.sectionType")}
          value={type}
          onChange={(event) => updateAttributes({ type: event.target.value })}
          className="h-7 font-semibold tracking-wide uppercase"
        >
          {SECTION_TYPES.map((option) => (
            <option key={option} value={option}>
              {t(`chart.sections.${option}`)}
            </option>
          ))}
        </NativeSelect>
        <input
          aria-label={t("structuredEditor.sectionLabel")}
          value={label}
          placeholder={t("structuredEditor.sectionLabelPlaceholder", { type: typeName })}
          maxLength={100}
          onChange={(event) => updateAttributes({ label: event.target.value || null })}
          className={cn(
            "h-7 w-36 min-w-0 rounded-md border border-transparent bg-transparent px-2 text-xs outline-none hover:border-input focus:border-ring",
            !showLabel && "text-muted-foreground line-through",
          )}
        />
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
            <DropdownMenuTrigger render={<button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("structuredEditor.sectionMenu", { section: label || typeName })} />}>
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
      <NodeViewContent className="sv-lines" />
    </NodeViewWrapper>
  );
}
