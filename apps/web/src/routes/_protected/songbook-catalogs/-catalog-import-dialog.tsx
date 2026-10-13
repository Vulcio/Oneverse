import { CATALOG_ENTRY_FIELDS, emptyCatalogEntry, serializeCatalogCsv, type SongbookCatalogImportResult } from "@songverse/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@songverse/ui/components/dialog";
import { Label } from "@songverse/ui/components/label";
import { Textarea } from "@songverse/ui/components/textarea";
import { apiClient } from "#/lib/api-client";
import { downloadBlob } from "#/lib/download";

const PREVIEW_DEBOUNCE_MS = 500;
const LIST_LIMIT = 50;

function templateCsv(): string {
  return serializeCatalogCsv([
    {
      ...emptyCatalogEntry("1", "Amazing Grace"),
      subtitle: "How sweet the sound",
      lyricist: "John Newton",
      year: 1779,
      key: "G",
      timeSignature: "3/4",
      tempo: 72,
      copyright: "Public domain",
      ccli: "22025",
      reference: "Ephesians 2:8",
      tags: ["grace", "hymn"],
    },
  ]);
}

/** Import a CSV or JSON file into a catalogue, with a preview (dry run) before anything is saved. */
export function CatalogImportDialog({
  catalogId,
  open,
  onOpenChange,
  onImported,
}: {
  catalogId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (result: SongbookCatalogImportResult) => Promise<void>;
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [preview, setPreview] = useState<SongbookCatalogImportResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start over each time it opens.
  useEffect(() => {
    if (!open) return;
    setContent("");
    setFilename(undefined);
    setMode("merge");
    setPreview(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!content.trim()) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(() => {
      apiClient
        .importSongbookCatalogEntries(catalogId, { content, filename, mode, dryRun: true })
        .then((result) => {
          if (cancelled) return;
          setPreview(result);
          setError(null);
        })
        .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
        .finally(() => !cancelled && setPreviewing(false));
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [catalogId, content, filename, mode]);

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setFilename(file.name);
    setContent(await file.text());
  }

  async function runImport() {
    setImporting(true);
    setError(null);
    try {
      const result = await apiClient.importSongbookCatalogEntries(catalogId, { content, filename, mode });
      await onImported(result);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  const changes = preview ? preview.created + preview.updated + preview.deleted : 0;
  const replaceBlocked = mode === "replace" && !!preview && preview.problems.length > 0;
  const canImport = !!preview && !previewing && changes > 0 && !replaceBlocked;

  return (
    <Dialog open={open} onOpenChange={(next) => !importing && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("songbookCatalog.importTitle")}</DialogTitle>
          <DialogDescription>{t("songbookCatalog.importFormatNote")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
              {t("songbookCatalog.chooseFile")}
            </Button>
            {filename ? <span className="truncate text-sm text-muted-foreground">{filename}</span> : null}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="ml-auto"
              onClick={() => downloadBlob(new Blob([templateCsv()], { type: "text/csv;charset=utf-8" }), "songbook-catalog-template.csv")}
            >
              {t("songbookCatalog.downloadTemplate")}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,.json,text/csv,application/json"
              className="hidden"
              data-testid="catalog-import-file"
              onChange={(event) => {
                void chooseFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-import-text" className="text-xs font-normal text-muted-foreground">
              {t("songbookCatalog.orPaste")}
            </Label>
            <Textarea
              id="catalog-import-text"
              value={content}
              rows={5}
              className="font-mono text-xs"
              onChange={(event) => {
                setContent(event.target.value);
                setFilename(undefined);
              }}
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            {(["merge", "replace"] as const).map((option) => (
              <label key={option} className="flex items-start gap-2 text-sm">
                <input type="radio" name="catalog-import-mode" value={option} checked={mode === option} onChange={() => setMode(option)} className="mt-1" />
                <span>
                  <span className="font-medium">{t(option === "merge" ? "songbookCatalog.modeMerge" : "songbookCatalog.modeReplace")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(option === "merge" ? "songbookCatalog.modeMergeHint" : "songbookCatalog.modeReplaceHint")}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {previewing ? <p className="text-sm text-muted-foreground">{t("songbookCatalog.previewing")}</p> : null}
          {preview && !previewing ? <Preview result={preview} replaceBlocked={replaceBlocked} /> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <details className="text-sm">
            <summary className="cursor-pointer font-medium">{t("songbookCatalog.columnReference")}</summary>
            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
              {CATALOG_ENTRY_FIELDS.map((field) => (
                <div key={field.key} className="contents">
                  <dt className="font-mono text-xs">{field.header}</dt>
                  <dd className="mb-1 text-xs text-muted-foreground sm:mb-0">{t(`songbookCatalog.fieldHints.${field.key}`)}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            {t("songbookCatalog.cancel")}
          </Button>
          <Button onClick={() => void runImport()} disabled={!canImport || importing}>
            {importing ? t("songbookCatalog.saving") : t("songbookCatalog.confirmImport")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Preview({ result, replaceBlocked }: { result: SongbookCatalogImportResult; replaceBlocked: boolean }) {
  const { t } = useTranslation();
  const counts = [
    t("songbookCatalog.willCreate", { count: result.created }),
    t("songbookCatalog.willUpdate", { count: result.updated }),
    t("songbookCatalog.willKeep", { count: result.unchanged }),
    ...(result.deleted > 0 ? [t("songbookCatalog.willDelete", { count: result.deleted })] : []),
  ];
  const fieldName = (key: string) => t(`songbookCatalog.fields.${key}`);

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3" data-testid="catalog-import-preview">
      <p className="text-sm font-medium">{counts.join(" · ")}</p>
      {result.unknownColumns.length > 0 ? (
        <p className="text-xs text-muted-foreground">{t("songbookCatalog.ignoredColumns", { columns: result.unknownColumns.join(", ") })}</p>
      ) : null}

      {result.problems.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-destructive">{t("songbookCatalog.problemsTitle", { count: result.problems.length })}</p>
          {replaceBlocked ? <p className="text-xs text-destructive">{t("songbookCatalog.replaceBlocked")}</p> : null}
          <ul className="flex flex-col gap-0.5 text-xs">
            {result.problems.slice(0, LIST_LIMIT).map((problem, index) => (
              <li key={index}>
                <span className="font-medium">{problem.row === null ? t("songbookCatalog.fileProblem") : t("songbookCatalog.rowLabel", { row: problem.row })}</span>
                {": "}
                {problem.message}
              </li>
            ))}
            {result.problems.length > LIST_LIMIT ? <li>{t("songbookCatalog.moreChanges", { count: result.problems.length - LIST_LIMIT })}</li> : null}
          </ul>
        </div>
      ) : null}

      {result.changes.length > 0 ? (
        <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto text-xs" data-testid="catalog-import-changes">
          {result.changes.slice(0, LIST_LIMIT).map((change) => (
            <li key={`${change.kind}-${change.entryCode}`}>
              <span className="font-medium tabular-nums">{change.entryCode}</span>{" "}
              <span className="text-muted-foreground">
                {change.kind === "create"
                  ? t("songbookCatalog.changeCreate")
                  : change.kind === "delete"
                    ? t("songbookCatalog.changeDelete")
                    : change.fields.map(fieldName).join(", ")}
              </span>
            </li>
          ))}
          {result.created + result.updated + result.deleted > LIST_LIMIT ? (
            <li className="text-muted-foreground">{t("songbookCatalog.moreChanges", { count: result.created + result.updated + result.deleted - LIST_LIMIT })}</li>
          ) : null}
        </ul>
      ) : result.problems.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("songbookCatalog.nothingToImport")}</p>
      ) : null}
    </div>
  );
}
