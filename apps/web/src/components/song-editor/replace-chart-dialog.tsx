import type { SupportedImportFormat } from "@songverse/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@songverse/ui/components/dialog";
import { SongContentCard, type SourceFile } from "./song-content";

/**
 * A song's chart replaced from a file or pasted text (issue #254), from the
 * Editor: what Song info's Song content card does for a new song. The
 * chart read in keeps the IDs it can (songDocumentFromText), so linked
 * copies, arrangements and cue points follow what stays the same.
 */
export function ReplaceChartDialog({
  open,
  onOpenChange,
  onReplace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace: (content: string, format: SupportedImportFormat | null, file: SourceFile | null) => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<SupportedImportFormat | null>(null);
  const [file, setFile] = useState<SourceFile | null>(null);
  const close = (next: boolean) => {
    if (!next) {
      setContent("");
      setFormat(null);
      setFile(null);
    }
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl" data-testid="replace-chart">
        <DialogHeader>
          <DialogTitle>{t("structuredEditor.replaceTitle")}</DialogTitle>
          <DialogDescription>{t("structuredEditor.replaceDescription")}</DialogDescription>
        </DialogHeader>
        <SongContentCard content={content} format={format} onContentChange={setContent} onFormatChange={setFormat} sourceFile={file} onSourceFile={setFile} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {t("songEditor.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!content.trim()}
            onClick={() => {
              onReplace(content, format, file);
              close(false);
            }}
            data-testid="replace-chart-confirm"
          >
            {t("structuredEditor.replaceConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
