import { defaultGrooveVariant, grooveStyle, groovesFor, GROOVE_VARIANTS, type GrooveVariant, type SectionType, type TimeSignature } from "@oneverse/core";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Drum, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { cn } from "@oneverse/ui/lib/utils";
import { stopGroovePreview, toggleGroovePreview, useGroovePreview } from "#/lib/groove-preview";
import { ToolButton } from "./block-tools";
import { sectionNumberIn } from "./document";

/** A section's groove, as the document keeps it (issue #105). */
interface SectionGrooveAttr {
  styleId: string;
  variant: string;
  tempoRelative?: number;
  fill?: boolean;
}

interface GrooveRow {
  pos: number;
  id: string;
  type: SectionType;
  label: string | null;
  number: number | null;
  groove: SectionGrooveAttr | null;
}

/** Asks the toolbar's Drum groove panel to open, from a section's groove tag. */
const OPEN_EVENT = "sv-groove-open";

function readRows(editor: Editor): GrooveRow[] {
  const rows: GrooveRow[] = [];
  const { doc } = editor.state;
  doc.forEach((node, offset) => {
    if (node.type.name !== "section" || node.attrs.sung === false) return;
    rows.push({ pos: offset, id: node.attrs.id as string, type: node.attrs.type as SectionType, label: (node.attrs.label as string | null) || null, number: sectionNumberIn(doc, node.attrs.id as string), groove: (node.attrs.groove as SectionGrooveAttr | null) ?? null });
  });
  return rows;
}

/** A fill on a section's last bar, for the sections that lead into another. */
const fillsByDefault = (type: SectionType) => type === "verse" || type === "chorus" || type === "pre-chorus" || type === "bridge";

/** "6/8" as written in the toolbar. */
export function readTimeSignature(text: string): TimeSignature | null {
  const match = /^(\d+)\/(\d+)$/.exec(text.trim());
  return match ? { numerator: Number(match[1]), denominator: Number(match[2]) } : null;
}

/**
 * The song's drum groove (issue #105): a style for the whole song, each
 * section's variation (Light, Simple, Full, Half-time or none) and a fill on
 * its last bar, each heard on its own before it's chosen. Kept in the
 * sections, saved with the chart.
 */
export function GrooveButton({ editor, disabled, timeSignature, tempo }: { editor: Editor | null; disabled?: boolean; timeSignature: string; tempo: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const preview = useGroovePreview();
  const rows =
    useEditorState({
      editor,
      selector: ({ editor: current }) => (current ? readRows(current) : []),
      equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    }) ?? [];
  const signature = readTimeSignature(timeSignature);
  const styles = groovesFor(signature);
  const used = rows.find((row) => row.groove && grooveStyle(row.groove.styleId))?.groove?.styleId ?? "";
  const bpm = /^\d+$/.test(tempo.trim()) ? Math.min(300, Math.max(20, Number(tempo))) : 90;

  useEffect(() => {
    const show = () => !disabled && setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, [disabled]);
  useEffect(() => {
    if (!open) stopGroovePreview();
  }, [open]);

  function write(change: (row: GrooveRow) => SectionGrooveAttr | null) {
    if (!editor) return;
    editor
      .chain()
      .command(({ tr }) => {
        for (const row of readRows(editor)) {
          const node = tr.doc.nodeAt(row.pos);
          if (node) tr.setNodeMarkup(row.pos, undefined, { ...node.attrs, groove: change(row) });
        }
        return true;
      })
      .run();
  }
  function pickStyle(styleId: string) {
    stopGroovePreview();
    write((row) => (styleId ? { styleId, variant: row.groove?.variant ?? defaultGrooveVariant(row.type), tempoRelative: 1, fill: row.groove?.fill ?? fillsByDefault(row.type) } : null));
  }
  function setRow(id: string, change: Partial<SectionGrooveAttr> | null) {
    write((row) => {
      if (row.id !== id) return row.groove;
      if (!change) return null;
      return { styleId: used, variant: row.groove?.variant ?? defaultGrooveVariant(row.type), tempoRelative: 1, fill: row.groove?.fill ?? fillsByDefault(row.type), ...row.groove, ...change };
    });
  }
  const nameOf = (row: GrooveRow) => row.label ?? `${t(`chart.sections.${row.type}`)}${row.number ? ` ${row.number}` : ""}`;
  const style = grooveStyle(used);

  return (
    <>
      <ToolButton label={t("grooves.title")} disabled={disabled || !editor} pressed={!!used} onClick={() => setOpen(true)} testId="editor-groove">
        <Drum />
      </ToolButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" data-testid="groove-dialog">
          <DialogHeader>
            <DialogTitle>{t("grooves.title")}</DialogTitle>
            <DialogDescription>{t("grooves.description")}</DialogDescription>
          </DialogHeader>
          {styles.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="groove-none">
              {t("grooves.noStyles", { time: timeSignature || "4/4" })}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {t("grooves.style")}
                <NativeSelect value={used} onChange={(event) => pickStyle(event.target.value)} className="w-56" data-testid="groove-style">
                  <option value="">{t("grooves.noGroove")}</option>
                  {styles.map((one) => (
                    <option key={one.id} value={one.id}>
                      {t(`grooves.styles.${one.id}`)}
                    </option>
                  ))}
                </NativeSelect>
                {style ? <span className="text-xs font-normal text-muted-foreground">{t(`grooves.about.${style.id}`)}</span> : null}
              </label>
              {style ? (
                <ul className="flex flex-col divide-y rounded-lg border">
                  {rows.map((row) => {
                    const variant = row.groove ? (row.groove.variant as GrooveVariant) : null;
                    const previewId = `${row.id}:${variant}`;
                    return (
                      <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2" data-testid="groove-row" data-section={row.id}>
                        <span className="w-28 shrink-0 truncate text-sm font-semibold">{nameOf(row)}</span>
                        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("grooves.variation", { section: nameOf(row) })}>
                          {[...GROOVE_VARIANTS, null].map((one) => {
                            const on = one === variant;
                            return (
                              <button
                                key={one ?? "off"}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => setRow(row.id, one ? { variant: one } : null)}
                                className={cn("h-7 rounded-full border px-2.5 text-xs pointer-coarse:h-9", on ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
                                data-testid={`groove-variant-${one ?? "off"}`}
                              >
                                {one ? t(`grooves.variants.${one}`) : t("grooves.off")}
                              </button>
                            );
                          })}
                        </div>
                        <label className={cn("flex items-center gap-1.5 text-xs", !variant && "opacity-40")}>
                          <input type="checkbox" disabled={!variant} checked={!!row.groove?.fill} onChange={(event) => setRow(row.id, { fill: event.target.checked })} data-testid="groove-fill" />
                          {t("grooves.fill")}
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="ml-auto size-8"
                          disabled={!variant}
                          aria-label={t("grooves.listen", { section: nameOf(row) })}
                          aria-pressed={preview === previewId}
                          onClick={() => variant && toggleGroovePreview(previewId, style, style.variants[variant], bpm)}
                          data-testid="groove-listen"
                        >
                          {preview === previewId ? <Pause /> : <Play />}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("grooves.hint")}</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" onClick={() => setOpen(false)} data-testid="groove-done">
              {t("grooves.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A section's groove by its name in the editor: its variation, a tap opens the song's Drum groove panel. */
export function SectionGrooveTag({ groove }: { groove: SectionGrooveAttr | null | undefined }) {
  const { t } = useTranslation();
  if (!groove || !grooveStyle(groove.styleId)) return null;
  const variant = (GROOVE_VARIANTS as readonly string[]).includes(groove.variant) ? t(`grooves.variants.${groove.variant}`) : groove.variant;
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className="flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:h-9"
      title={t("grooves.title")}
      data-testid="section-groove"
    >
      <Drum className="size-3" aria-hidden />
      {variant}
      {groove.fill ? ` · ${t("grooves.fill")}` : ""}
    </button>
  );
}
