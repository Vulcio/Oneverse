import type { Attachment, SupportedImportFormat } from "@oneverse/core";
import { FileText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { downloadOnce } from "#/lib/song-files";
import { SongContentCard, type SourceFile } from "./song-content";

/** A song's files a chart can be read from (issue #124): its PDFs and its pictures (photos, scans). */
const readableFiles = (attachments: Attachment[]) =>
  attachments.filter((file) => file.type === "PDF" || file.mimeType === "application/pdf" || /^image\/(?:png|jpe?g|webp|gif|bmp)$/.test(file.mimeType));

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
  song,
  songVersionId,
  attachments = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace: (content: string, format: SupportedImportFormat | null, file: SourceFile | null) => void;
  /** The song, for Find chords (issue #157). */
  song?: { title: string; artist?: string; language?: string };
  /** The song's own files (a PDF uploaded earlier, issue #124): read from one without uploading it again. */
  songVersionId?: string;
  attachments?: Attachment[];
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<SupportedImportFormat | null>(null);
  const [file, setFile] = useState<SourceFile | null>(null);
  // One of the song's files, read as if dropped here; already kept, so never kept again.
  const [incoming, setIncoming] = useState<File | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const readable = songVersionId ? readableFiles(attachments) : [];
  async function readSongFile(attachment: Attachment) {
    if (!songVersionId) return;
    setFetching(attachment.id);
    setFetchFailed(false);
    try {
      const blob = await downloadOnce(songVersionId, attachment);
      setIncoming(new File([blob], attachment.filename, { type: attachment.mimeType }));
    } catch {
      setFetchFailed(true);
    } finally {
      setFetching(null);
    }
  }
  const close = (next: boolean) => {
    if (!next) {
      setContent("");
      setFormat(null);
      setFile(null);
      setIncoming(null);
      setFetchFailed(false);
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
        {readable.length ? (
          <div className="flex flex-col gap-2" data-testid="replace-chart-song-files">
            <p className="text-sm text-muted-foreground">{t("structuredEditor.replaceFromSongFiles")}</p>
            <div className="flex flex-wrap gap-2">
              {readable.map((attachment) => (
                <Button key={attachment.id} type="button" variant="outline" size="sm" disabled={fetching !== null} onClick={() => void readSongFile(attachment)}>
                  <FileText aria-hidden />
                  <span className="max-w-56 truncate">{attachment.filename}</span>
                </Button>
              ))}
            </div>
            {fetchFailed ? <p className="text-sm text-destructive">{t("structuredEditor.replaceSongFileFailed")}</p> : null}
          </div>
        ) : null}
        <SongContentCard
          content={content}
          format={format}
          onContentChange={setContent}
          onFormatChange={setFormat}
          sourceFile={file}
          onSourceFile={setFile}
          find={song}
          incoming={incoming}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {t("songEditor.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!content.trim()}
            onClick={() => {
              // A file of the song's own is under Files already: not uploaded again.
              onReplace(content, format, file && file.file === incoming ? null : file);
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
