import { OCR_LANGUAGES, CHORD_CHARACTERS, ocrLinesFromTesseract, pageNeedsOcr, readOcrPage, readPdfChart, shownText, type OcrBox, type OcrReader, type PdfChart, type PdfPageSize, type PdfTextItem } from "@oneverse/core";
import type { Worker as Tesseract } from "tesseract.js";
import { isChartImage } from "#/components/song-editor/attachment-types";
import { apiClient } from "#/lib/api-client";
import { loadPdfjs, pdfjsWasmUrl } from "#/lib/pdfjs";

declare const __TESSERACT_ASSETS__: string;

/**
 * A chart read from a PDF or a photo of one, on the device (issue #124): a
 * page with text through its text, read by pdf.js with each piece's place;
 * a page without (a scan) and a photo through Tesseract's OCR, which gives
 * each letter's box. Both go to core's `readPdfChart`, which leaves the
 * header and footer out, reads columns, places each chord on the letter
 * printed under it and takes the title, artist, key… as details.
 *
 * pdf.js and Tesseract are loaded only when needed (they're big, and kept
 * out of the offline precache). When the device can't (an old browser,
 * too little memory), `readChartOnServer` asks the API to.
 */

/** What's being done, for the screen: "reading page 2 of 3", "recognising the text of page 1". */
export interface ReadProgress {
  page: number;
  pages: number;
  ocr: boolean;
}

let tesseract: Promise<Tesseract> | null = null;

/** The one OCR engine, made the first time a scan is read; English and French. */
function ocrEngine(): Promise<Tesseract> {
  tesseract ??= (async () => {
    const { createWorker, OEM } = await import("tesseract.js");
    return createWorker([...OCR_LANGUAGES], OEM.LSTM_ONLY, {
      workerPath: `${__TESSERACT_ASSETS__}worker.min.js`,
      corePath: `${__TESSERACT_ASSETS__}core`,
      langPath: `${__TESSERACT_ASSETS__}lang`,
      // Our own worker file, not a blob made from it; the language data cached by the browser like the rest of /assets/.
      workerBlobURL: false,
      cacheMethod: "none",
    });
  })();
  // A failed start is tried again next time.
  tesseract.catch(() => (tesseract = null));
  return tesseract;
}

/** The OCR reader for one image, as core's `readOcrPage` asks for it. */
async function ocrReader(image: HTMLCanvasElement): Promise<OcrReader> {
  const engine = await ocrEngine();
  const { PSM } = await import("tesseract.js");
  return async (strip?: OcrBox) => {
    // A page as one block of lines (Tesseract's own default), which finds a chord alone at a line's start; a word again as one chord.
    await engine.setParameters(strip ? { tessedit_pageseg_mode: PSM.SINGLE_WORD, tessedit_char_whitelist: CHORD_CHARACTERS } : { tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: "" });
    const rectangle = strip && { left: Math.round(strip.x0), top: Math.round(strip.y0), width: Math.round(strip.x1 - strip.x0), height: Math.round(strip.y1 - strip.y0) };
    const { data } = await engine.recognize(image, rectangle ? { rectangle } : {}, { blocks: true, text: false });
    return ocrLinesFromTesseract(data);
  };
}

/** About 300 dpi for an A4 page, as OCR reads best: a page's width in pixels when it's drawn. */
const OCR_WIDTH = 2400;

/** A PDF's charts: each page's text, or its picture read by OCR. */
async function readPdf(file: Blob, onProgress?: (progress: ReadProgress) => void): Promise<PdfChart & { ocr: boolean }> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), wasmUrl: pdfjsWasmUrl(pdfjs) });
  try {
    const pdf = await task.promise;
    const items: PdfTextItem[] = [];
    const pages: PdfPageSize[] = [];
    let ocr = false;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const text: PdfTextItem[] = [];
      const content = (await page.getTextContent()).items.filter((item) => "str" in item && item.str !== "") as { str: string; transform: number[]; width: number; height: number }[];
      // Only what the page shows: some charts join words with white full stops, or hide a summary outside the page.
      const shown = shownText(content, await page.getOperatorList(), pdfjs.OPS);
      for (const [index, item] of content.entries()) {
        if (shown[index]!.trim() === "") continue;
        // The page's own transform turns PDF space (y up) into the viewport's (y down).
        const [, , c, d, x, y] = pdfjs.Util.transform(viewport.transform, item.transform);
        text.push({ page: number, text: shown[index]!, x, y, width: item.width, height: Math.hypot(c, d) || item.height });
      }
      if (!pageNeedsOcr(text)) {
        onProgress?.({ page: number, pages: pdf.numPages, ocr: false });
        items.push(...text);
        pages.push({ page: number, width: viewport.width, height: viewport.height });
        continue;
      }
      // A scanned page: drawn, then read by OCR.
      ocr = true;
      onProgress?.({ page: number, pages: pdf.numPages, ocr: true });
      const drawn = page.getViewport({ scale: Math.min(4, OCR_WIDTH / viewport.width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(drawn.width);
      canvas.height = Math.round(drawn.height);
      await page.render({ canvas, viewport: drawn, background: "#ffffff" }).promise;
      items.push(...(await readOcrPage(number, await ocrReader(canvas))));
      pages.push({ page: number, width: canvas.width, height: canvas.height });
      page.cleanup();
    }
    return { ...readPdfChart(items, pages), ocr };
  } finally {
    // Ends pdf.js's worker for this document.
    void task.destroy();
  }
}

/** A photo or a picture of a chart, read by OCR: turned upright as the camera said, and made no bigger than OCR needs. */
async function readImage(file: Blob, onProgress?: (progress: ReadProgress) => void): Promise<PdfChart & { ocr: boolean }> {
  onProgress?.({ page: 1, pages: 1, ocr: true });
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, (OCR_WIDTH * 1.4) / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const items = await readOcrPage(1, await ocrReader(canvas));
  return { ...readPdfChart(items, [{ page: 1, width: canvas.width, height: canvas.height }]), ocr: true };
}

/** A PDF's or a picture's chart, read on this device. */
export function readChartOnDevice(file: File, onProgress?: (progress: ReadProgress) => void): Promise<PdfChart & { ocr: boolean }> {
  return isChartImage(file) ? readImage(file, onProgress) : readPdf(file, onProgress);
}

/** How long the server is waited for: a few pages of OCR, behind other people's. */
const SERVER_WAIT_MS = 3 * 60 * 1000;

/**
 * The same, read by the API in a background job: for a device that couldn't
 * (Tesseract didn't load, ran out of memory). Followed until it's read.
 */
export async function readChartOnServer(file: File, onProgress?: (progress: ReadProgress) => void, signal?: AbortSignal): Promise<PdfChart & { ocr: boolean }> {
  const { id } = await apiClient.readChartFile(file, file.name);
  const until = Date.now() + SERVER_WAIT_MS;
  while (Date.now() < until) {
    if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
    const reading = await apiClient.chartReading(id);
    if (reading.state === "read" && reading.result) return reading.result;
    if (reading.state === "failed") throw new Error("The server couldn't read the file");
    if (reading.progress) onProgress?.({ ...reading.progress, ocr: true });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The server took too long to read the file");
}
