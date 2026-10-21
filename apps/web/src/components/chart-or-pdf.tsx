import type { Attachment, ChartPreferences, LiveViewValue } from "@songverse/core";
import { FileText, LayoutGrid, Loader2, Music } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@songverse/ui/components/card";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";
import { loadPdfjs, pdfjsWasmUrl } from "#/lib/pdfjs";
import { fileLoader, songFiles } from "#/lib/song-files";
import { cn } from "@songverse/ui/lib/utils";

/** A song's PDFs: its sheet music, its original chart. */
function pdfsOf(attachments: Attachment[]): Attachment[] {
  return attachments.filter((file) => file.type === "PDF" || file.mimeType === "application/pdf");
}

type ViewChoice = Pick<ChartPreferences, "view" | "pdfId">;

/**
 * Where a player's choice of view for a song is kept (issue #155): with
 * their chart preferences, on the server - for a song of a set, as the set
 * plays it; else the song as written. A field left out keeps its value.
 */
export interface ViewStore {
  /** Known already (a set's song view carries it); else loaded. */
  initial?: ViewChoice | null;
  load?: () => Promise<ViewChoice | null>;
  save: (choice: ViewChoice) => Promise<unknown>;
}

export function setSongViewStore(setId: string, itemId: string, initial: ChartPreferences | null | undefined): ViewStore {
  return { initial: initial ?? null, save: (choice) => apiClient.setSetlistChartPreferences(setId, itemId, choice) };
}

export function songViewStore(songVersionId: string): ViewStore {
  return {
    load: () => apiClient.getChartPreferences(songVersionId),
    save: (choice) => apiClient.saveChartPreferences(songVersionId, null, choice),
  };
}

/** How a player reads a song, chosen for it or else their default: its chart, its chord grid (issue #238), or one of its PDFs - the chart when it has none. */
export interface ReadingView {
  pdfs: Attachment[];
  /** The PDF shown; null: the chart or the grid. */
  shown: Attachment | null;
  /** The chord grid shown, rather than the chart (never with a PDF). */
  grid: boolean;
  choose: (view: LiveViewValue, pdfId?: string) => void;
  /** Where to read a PDF from: its signed address online (streamed by ranges), its bytes offline. */
  source: (file: Attachment) => Promise<PdfSource>;
}

/**
 * The view a player reads a song in (issue #155), in Practice and in Live
 * alike: as chosen for the song, else their default (account settings).
 * `attachments` when the page has them; else they're listed here (the API's,
 * or the device's copy offline).
 */
export function useReadingView(songVersionId: string, attachments: Attachment[] | undefined, defaultView: LiveViewValue, store: ViewStore): ReadingView {
  const [listed, setListed] = useState<{ attachments: Attachment[]; offline: boolean } | null>(null);
  useEffect(() => {
    // A song hidden from this player (a set's): nothing to list.
    if (attachments || !songVersionId) return;
    let cancelled = false;
    songFiles(songVersionId)
      .then((files) => {
        if (!cancelled) setListed(files);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [songVersionId, attachments]);
  const pdfs = pdfsOf(attachments ?? listed?.attachments ?? []);
  const offline = !attachments && !!listed?.offline;

  const [choice, setChoice] = useState<ViewChoice | null>(store.initial ?? null);
  // Chosen here before the saved choice arrived: that one's older.
  const chosen = useRef(false);
  const initialKey = JSON.stringify([store.initial?.view, store.initial?.pdfId]);
  useEffect(() => {
    setChoice(store.initial ?? null);
    chosen.current = false;
    if (!store.load || !songVersionId) return;
    let cancelled = false;
    store
      .load()
      .then((saved) => {
        if (!cancelled && saved && !chosen.current) setChoice({ view: saved.view, pdfId: saved.pdfId });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Another song, or its saved choice changed (the page reloaded it).
  }, [songVersionId, initialKey]);

  const view = choice?.view ?? defaultView;
  const shown = view === "PDF" ? (pdfs.find((file) => file.id === choice?.pdfId) ?? pdfs[0] ?? null) : null;
  return {
    pdfs,
    shown,
    grid: view === "GRID",
    choose: (next, pdfId) => {
      chosen.current = true;
      const change: ViewChoice = next === "PDF" ? { view: next, ...(pdfId ? { pdfId } : {}) } : { view: next };
      setChoice((before) => ({ ...before, ...change }));
      // Offline, it holds for this page.
      store.save(change).catch(() => {});
    },
    source: async (file) => {
      if (!offline) {
        try {
          return { url: (await apiClient.getAttachmentLink(songVersionId, file.id)).url };
        } catch {
          // No link: the whole file, downloaded, below.
        }
      }
      return { data: new Uint8Array(await (await fileLoader(songVersionId, offline)(file)).arrayBuffer()) };
    },
  };
}

/** The Chart / Grid / PDF switch - PDF when the song has one - and which PDF when there are several. */
export function ViewSwitch({ reading, compact = false }: { reading: ReadingView; compact?: boolean }) {
  const { t } = useTranslation();
  const { pdfs, shown, grid, choose } = reading;
  const chart = !shown && !grid;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="chart-view">
      <div className="inline-flex rounded-md border p-0.5" role="group" aria-label={t("chartView.label")}>
        <button
          type="button"
          aria-pressed={chart}
          onClick={() => choose("CHART")}
          className={cn("flex items-center gap-1.5 rounded-sm py-1 text-sm [&_svg]:size-4", compact ? "px-1.5 sm:px-2.5" : "px-2.5", chart ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}
          title={compact ? t("chartView.chart") : undefined}
          data-testid="chart-view-chart"
        >
          <Music />
          <span className={compact ? "sr-only sm:not-sr-only" : undefined}>{t("chartView.chart")}</span>
        </button>
        <button
          type="button"
          aria-pressed={grid}
          onClick={() => choose("GRID")}
          className={cn("flex items-center gap-1.5 rounded-sm py-1 text-sm [&_svg]:size-4", compact ? "px-1.5 sm:px-2.5" : "px-2.5", grid ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}
          title={compact ? t("chartView.grid") : undefined}
          data-testid="chart-view-grid"
        >
          <LayoutGrid />
          <span className={compact ? "sr-only sm:not-sr-only" : undefined}>{t("chartView.grid")}</span>
        </button>
        {pdfs.length > 0 ? (
          <button
            type="button"
            aria-pressed={!!shown}
            onClick={() => choose("PDF", shown?.id ?? pdfs[0]!.id)}
            className={cn("flex items-center gap-1.5 rounded-sm py-1 text-sm [&_svg]:size-4", compact ? "px-1.5 sm:px-2.5" : "px-2.5", shown ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}
            title={compact ? t("chartView.pdf") : undefined}
            data-testid="chart-view-pdf"
          >
            <FileText />
            <span className={compact ? "sr-only sm:not-sr-only" : undefined}>{t("chartView.pdf")}</span>
          </button>
        ) : null}
      </div>
      {shown && pdfs.length > 1 && !compact ? (
        <NativeSelect compact value={shown.id} onChange={(event) => choose("PDF", event.target.value)} aria-label={t("chartView.which")}>
          {pdfs.map((file) => (
            <option key={file.id} value={file.id}>
              {file.filename}
            </option>
          ))}
        </NativeSelect>
      ) : null}
    </div>
  );
}

/**
 * A song's chart - or, when the player reads it as its chord grid or a
 * PDF, that instead (issues #152, #155, #238): the switch above it, the
 * choice kept with their chart preferences, so Live shows the same.
 */
export function ChartOrPdf({
  songVersionId,
  attachments,
  defaultView,
  store,
  grid,
  children,
}: {
  songVersionId: string;
  attachments?: Attachment[];
  defaultView: LiveViewValue;
  store: ViewStore;
  /** The song's chord grid; without one (no chart), the chart's place shows. */
  grid?: ReactNode;
  children: ReactNode;
}) {
  const reading = useReadingView(songVersionId, attachments, defaultView, store);
  const { shown } = reading;
  return (
    <div className="flex flex-col gap-3">
      <ViewSwitch reading={reading} />
      {/* On a phone, out to the screen's edges (the page's gutter, --gutter). */}
      {shown ? <PdfPages key={shown.id} source={() => reading.source(shown)} name={shown.filename} className="max-sm:-mx-(--gutter)" /> : reading.grid && grid ? grid : children}
    </div>
  );
}

/** Where pdf.js reads a PDF from: a signed address it fetches by byte ranges (streamed), or bytes already here (offline). */
export type PdfSource = { url: string } | { data: Uint8Array };

type PdfDocument = Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfjs>>["getDocument"]>["promise"]>;

/**
 * A PDF's pages, drawn with pdf.js as wide as there's room (sharp on a
 * high-density screen), streamed (issue #156): pdf.js reads the file by
 * byte ranges, so the first page shows before the rest has arrived (the
 * rest follows in the background). Every page gets its place at once, the
 * first page's size, and is drawn as it comes near the screen.
 */
export function PdfPages({ source, name, className }: { source: () => Promise<PdfSource>; name: string; className?: string }) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [width, setWidth] = useState(0);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Opened once: by its address when there's one (ranges, the first page first), else from its bytes.
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    (async () => {
      try {
        const [pdfjs, from] = await Promise.all([loadPdfjs(), source()]);
        const task = pdfjs.getDocument({ ...("url" in from ? { url: from.url, rangeChunkSize: 128 * 1024 } : { data: from.data }), wasmUrl: pdfjsWasmUrl(pdfjs) });
        destroy = () => void task.destroy();
        const opened = await task.promise;
        if (!cancelled) setPdf(opened);
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
    // `source` is the same file for this component (keyed by it).
  }, []);

  // Laid out again when the room changes: a place per page, each drawn once it's near.
  useEffect(() => {
    const el = box.current;
    if (!el || !pdf || width === 0) return;
    let cancelled = false;
    let observer: IntersectionObserver | null = null;
    const ratio = window.devicePixelRatio || 1;
    const drawn = new Set<number>();
    const draw = async (canvas: HTMLCanvasElement, number: number) => {
      if (drawn.has(number)) return;
      drawn.add(number);
      const page = await pdf.getPage(number);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
      if (!cancelled) canvas.dataset.state = "drawn";
    };
    (async () => {
      try {
        const first = await pdf.getPage(1);
        if (cancelled) return;
        const size = first.getViewport({ scale: (width / first.getViewport({ scale: 1 }).width) * ratio });
        const canvases = Array.from({ length: pdf.numPages }, (_, index) => {
          const canvas = document.createElement("canvas");
          // Its place, the first page's size, until it's drawn at its own.
          canvas.width = Math.floor(size.width);
          canvas.height = Math.floor(size.height);
          // On a phone, edge to edge: every pixel of its width for the page.
          canvas.className = "w-full bg-white sm:rounded-md sm:border sm:shadow-sm";
          canvas.setAttribute("aria-label", t("chartView.page", { page: index + 1, pages: pdf.numPages }));
          canvas.setAttribute("role", "img");
          canvas.dataset.testid = "pdf-page";
          canvas.dataset.page = String(index + 1);
          return canvas;
        });
        el.replaceChildren(...canvases);
        await draw(canvases[0]!, 1);
        if (cancelled) return;
        setState("ready");
        // The rest as they come within a screen's height of being seen.
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const canvas = entry.target as HTMLCanvasElement;
              void draw(canvas, Number(canvas.dataset.page)).catch(() => {});
            }
          },
          { rootMargin: "100% 0px" },
        );
        for (const canvas of canvases.slice(1)) observer.observe(canvas);
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [pdf, width]);

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="pdf-view" data-state={state}>
      {state === "loading" ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("chartView.loading", { name })}
          </CardContent>
        </Card>
      ) : null}
      {state === "failed" ? <p className="text-sm text-destructive">{t("chartView.failed", { name })}</p> : null}
      <div ref={box} className="flex flex-col gap-1 sm:gap-3" />
    </div>
  );
}
