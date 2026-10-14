import { SECTION_TYPES, type SectionType } from "@songverse/core";
import type { Editor } from "@tiptap/react";
import { Link2, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@songverse/ui/components/dropdown-menu";
import { cn } from "@songverse/ui/lib/utils";
import { insertLinked, insertSection } from "./extensions";

/** The song's sections, by name, for "Sing … again". */
function sectionsOf(editor: Editor, name: (type: SectionType, label: string | null) => string) {
  const found: { id: string; name: string; type: SectionType }[] = [];
  editor.state.doc.forEach((node) => {
    // An empty section isn't kept: nothing to sing again yet.
    if (node.type.name === "section" && node.attrs.sung !== false && node.textContent.trim()) {
      found.push({ id: node.attrs.id as string, name: name(node.attrs.type as SectionType, node.attrs.label as string | null), type: node.attrs.type as SectionType });
    }
  });
  return found;
}

/**
 * Adding a section where it's wanted (issue #250): the "+" in the gap
 * between two blocks (`edge`: over the gap above or below the block it's
 * in), or the button at the end (`edge` left out). Its menu: a new section
 * of any type, or a linked copy of one already in the song - sung again
 * there. It opens over the page; nothing moves when it shows.
 */
export function SectionInserter({ editor, at, edge, testId }: { editor: Editor; at: () => number; edge?: "top" | "bottom"; testId?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const typeName = (type: SectionType) => t(`chart.sections.${type}`);
  const sections = open ? sectionsOf(editor, (type, label) => label || typeName(type)) : [];

  const trigger = edge ? (
    <button
      type="button"
      aria-label={t("structuredEditor.addHere")}
      title={t("structuredEditor.addHere")}
      className="flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs hover:border-foreground hover:text-foreground pointer-coarse:size-9 [&_svg]:size-3.5"
    />
  ) : (
    <button
      type="button"
      className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground pointer-coarse:h-12 [&_svg]:size-4"
    />
  );

  const menu = (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={trigger} data-testid={testId}>
        <Plus aria-hidden />
        {edge ? null : t("structuredEditor.addSectionAtEnd")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-72" data-testid="section-inserter-menu">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("structuredEditor.newSection")}</DropdownMenuLabel>
        <div className="grid grid-cols-2 gap-0.5">
          {SECTION_TYPES.map((type) => (
            <DropdownMenuItem key={type} className="pointer-coarse:min-h-11" onClick={() => insertSection(editor.view, type, at())} data-insert-type={type}>
              <span className="size-2 shrink-0 rounded-full bg-[var(--section-ink)]" data-section-color={type} aria-hidden />
              {typeName(type)}
            </DropdownMenuItem>
          ))}
        </div>
        {sections.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("structuredEditor.singAgain")}</DropdownMenuLabel>
            {sections.map((section) => (
              <DropdownMenuItem key={section.id} className="pointer-coarse:min-h-11" onClick={() => insertLinked(editor.view, section.id, at())} data-insert-linked={section.id}>
                <Link2 className="text-[var(--section-ink)]" data-section-color={section.type} />
                {section.name}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (!edge) return <div contentEditable={false} className="mt-4 font-sans select-none">{menu}</div>;
  // Over the gap between blocks: it takes no room, and shows where the pointer is (always on a touch screen).
  return (
    <div
      contentEditable={false}
      className={cn(
        "group/inserter absolute inset-x-0 z-10 flex h-5 items-center justify-center font-sans opacity-0 transition-opacity select-none hover:opacity-100 focus-within:opacity-100 has-[[data-popup-open]]:opacity-100 pointer-coarse:opacity-70",
        edge === "bottom" ? "-bottom-5" : "-top-5",
      )}
      data-section-inserter={edge}
    >
      <span className="absolute inset-x-6 top-1/2 h-px bg-border" aria-hidden />
      <span className="relative">{menu}</span>
    </div>
  );
}
