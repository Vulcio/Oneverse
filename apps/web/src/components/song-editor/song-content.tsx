import { chordProFromPdfText, detectImportFormatDetails, SUPPORTED_IMPORT_FORMATS, type SupportedImportFormat } from "@oneverse/core";
import { ClipboardPaste, FileText, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Label } from "@oneverse/ui/components/label";
import { Textarea } from "@oneverse/ui/components/textarea";
import { cn } from "@oneverse/ui/lib/utils";
import { formatBytes } from "#/lib/format-bytes";
import { pdfTextItems } from "#/lib/pdf-text";
import { isPdf } from "./attachment-types";
import { FindChords } from "./find-chords";
import type { ChordContent, MetadataMatch } from "@oneverse/core";

export const SOURCE_FILE_ACCEPT = ".cho,.chordpro,.chopro,.crd,.pro,.txt,.pdf,text/plain,application/pdf";
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export interface SourceFile {
  file: File;
  /** Also keep it under Files when the song's saved. */
  keep: boolean;
}


/** ChordPro / Chords over lyrics / Lyrics only, as a segmented control; with "Auto" when a guess is in use. */
export function FormatToggle({
  content,
  format,
  onChange,
}: {
  content: string;
  format: SupportedImportFormat | null;
  onChange: (format: SupportedImportFormat | null) => void;
}) {
  const { t } = useTranslation();
  const detected = detectImportFormatDetails(content);
  const current = format ?? detected.format;
  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label={t("songEditor.format")} className="inline-flex w-full rounded-md border p-0.5 sm:w-fit">
        {SUPPORTED_IMPORT_FORMATS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={current === option}
            onClick={() => onChange(option)}
            className={cn(
              "flex-1 rounded-sm px-2.5 py-1 text-xs font-medium whitespace-nowrap sm:flex-none",
              current === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t(`songEditor.formats.${option}`)}
          </button>
        ))}
      </div>
      {content.trim() ? (
        <p className="text-xs text-muted-foreground" role="status">
          {format === null ? (
            t("songEditor.detected", {
              format: t(`songEditor.formats.${detected.format}`),
              confidence: t(`songEditor.confidence.${detected.confidence}`),
            })
          ) : (
            <>
              {t("songEditor.formatChosen")}{" "}
              <button type="button" className="text-primary hover:underline" onClick={() => onChange(null)}>
                {t("songEditor.detectAgain")}
              </button>
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}

/** The chart text box with its counts and "Paste from clipboard". */
export function ContentTextarea({
  id,
  content,
  format,
  onChange,
  rows,
}: {
  id: string;
  content: string;
  format: SupportedImportFormat | null;
  onChange: (content: string) => void;
  rows: number;
}) {
  const { t } = useTranslation();
  const [clipboardError, setClipboardError] = useState(false);
  const lines = content ? content.replace(/\n$/, "").split("\n").length : 0;
  const placeholderFormat = format ?? "CHORDPRO";

  async function pasteFromClipboard() {
    setClipboardError(false);
    try {
      const text = await navigator.clipboard.readText();
      if (text) onChange(text);
    } catch {
      setClipboardError(true);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{t("songEditor.pasteLabel")}</Label>
        <Button type="button" variant="ghost" size="sm" onClick={() => void pasteFromClipboard()}>
          <ClipboardPaste />
          {t("songEditor.pasteFromClipboard")}
        </Button>
      </div>
      <Textarea
        id={id}
        rows={rows}
        value={content}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t(`songEditor.placeholders.${placeholderFormat}`)}
        className="min-h-40 font-mono text-sm"
        spellCheck={false}
      />
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>{t("songEditor.counts", { characters: content.length, lines })}</span>
        {clipboardError ? (
          <span className="text-destructive" role="alert">
            {t("songEditor.clipboardDenied")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Song Info's "Song content": a source file to read the chart from, the
 * text box, and its format. A PDF is kept, and its text read when it has
 * some (issue #124): chords placed on the syllables printed under them.
 */
export function SongContentCard({
  content,
  format,
  onContentChange,
  onFormatChange,
  sourceFile,
  onSourceFile,
  find,
}: {
  content: string;
  format: SupportedImportFormat | null;
  onContentChange: (content: string) => void;
  onFormatChange: (format: SupportedImportFormat | null) => void;
  sourceFile: SourceFile | null;
  onSourceFile: (file: SourceFile | null) => void;
  /** Find chords at the song providers (issue #157): the song looked for, and what to do with a chart's details. */
  find?: { title: string; artist?: string; language?: string; onDetails?: (chart: ChordContent, match: MetadataMatch | null) => void };
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pdfState, setPdfState] = useState<"reading" | "read" | "noText" | "unreadable" | null>(null);

  async function take(file: File) {
    setFileError(null);
    setPdfState(null);
    if (file.size > MAX_SOURCE_BYTES) {
      setFileError(t("songEditor.fileTooBig", { size: "10 MB" }));
      return;
    }
    if (isPdf(file)) {
      onSourceFile({ file, keep: true });
      setPdfState("reading");
      try {
        const chart = chordProFromPdfText(await pdfTextItems(file));
        if (!chart) return setPdfState("noText");
        onContentChange(chart);
        onFormatChange(null);
        setPdfState("read");
      } catch {
        setPdfState("unreadable");
      }
      return;
    }
    try {
      onContentChange(await file.text());
      onFormatChange(null);
      onSourceFile({ file, keep: true });
    } catch {
      setFileError(t("songEditor.fileUnreadable"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {find ? (
        <FindChords
          title={find.title}
          artist={find.artist}
          language={find.language}
          onChart={(chart, match) => {
            onContentChange(chart.content);
            onFormatChange("CHORDPRO");
            onSourceFile(null);
            find.onDetails?.(chart, match);
          }}
        />
      ) : null}
      <div
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center text-sm transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-input",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void take(file);
        }}
      >
        <Upload className="size-5 text-muted-foreground" aria-hidden />
        <p>
          {t("songEditor.dropFile")}{" "}
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => inputRef.current?.click()}>
            {t("songEditor.browse")}
          </button>
        </p>
        <p className="text-xs text-muted-foreground">{t("songEditor.sourceFileHint")}</p>
        <input
          ref={inputRef}
          type="file"
          accept={SOURCE_FILE_ACCEPT}
          className="sr-only"
          aria-label={t("songEditor.uploadSourceFile")}
          data-testid="source-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void take(file);
          }}
        />
      </div>
      {fileError ? (
        <p className="text-sm text-destructive" role="alert">
          {fileError}
        </p>
      ) : null}
      {sourceFile ? (
        <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
          <div className="flex items-center gap-2">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{sourceFile.file.name}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(sourceFile.file.size)}</span>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("songEditor.removeSourceFile")}
              onClick={() => onSourceFile(null)}
            >
              <X className="size-4" />
            </button>
          </div>
          {isPdf(sourceFile.file) ? (
            <p className="text-xs text-muted-foreground" data-testid="pdf-state" data-state={pdfState ?? "kept"} role={pdfState === "noText" || pdfState === "unreadable" ? "status" : undefined}>
              {t("songEditor.pdfKept")}
              {pdfState === "reading" ? ` ${t("songEditor.pdfReading")}` : null}
              {pdfState === "read" ? ` ${t("songEditor.pdfRead")}` : null}
              {pdfState === "noText" ? ` ${t("songEditor.pdfNoText")}` : null}
              {pdfState === "unreadable" ? ` ${t("songEditor.pdfUnreadable")}` : null}
            </p>
          ) : (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={sourceFile.keep} onChange={(event) => onSourceFile({ ...sourceFile, keep: event.target.checked })} />
              {t("songEditor.keepSourceFile")}
            </label>
          )}
        </div>
      ) : null}

      <ContentTextarea id="song-content" content={content} format={format} onChange={onContentChange} rows={12} />
      <FormatToggle content={content} format={format} onChange={onFormatChange} />
      <p className="text-xs text-muted-foreground">{t("songEditor.contentHint")}</p>
    </div>
  );
}
