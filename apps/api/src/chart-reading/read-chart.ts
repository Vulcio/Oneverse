import { createCanvas } from "@napi-rs/canvas";
import { CHORD_CHARACTERS, OCR_LANGUAGES, ocrLinesFromTesseract, pageNeedsOcr, readOcrPage, readPdfChart, shownText, type OcrBox, type OcrReader, type PdfChart, type PdfPageSize, type PdfTextItem } from "@oneverse/core";
import { copyFile, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorker, OEM, PSM, type Worker as Tesseract } from "tesseract.js";

/**
 * A PDF's or a picture's chart read on the server (issue #124), for a
 * device that couldn't: the same as the web app's lib/read-chart.ts - pdf.js
 * for a page's text, Tesseract for a scanned page or a photo, core's
 * `readPdfChart` for the rest - with pdf.js drawing pages on @napi-rs/canvas.
 */

const require = createRequire(import.meta.url);

/** About 300 dpi for an A4 page, as OCR reads best. */
const OCR_WIDTH = 2400;

let engine: Promise<Tesseract> | null = null;

/** The language data, from their packages, in one folder as Tesseract wants it. */
async function languageFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "songverse-tessdata-"));
  for (const language of OCR_LANGUAGES) {
    const file = `${language}.traineddata.gz`;
    await copyFile(path.join(path.dirname(require.resolve(`@tesseract.js-data/${language}/package.json`)), "4.0.0_best_int", file), path.join(folder, file));
  }
  return folder;
}

/** This process's OCR engine, made the first time it's needed and kept. */
function ocrEngine(): Promise<Tesseract> {
  engine ??= languageFolder().then((langPath) => createWorker([...OCR_LANGUAGES], OEM.LSTM_ONLY, { langPath, cacheMethod: "none" }));
  engine.catch(() => (engine = null));
  return engine;
}

function ocrReader(tesseract: Tesseract, image: Buffer): OcrReader {
  return async (strip?: OcrBox) => {
    // A page as one block of lines (Tesseract's own default), which finds a chord alone at a line's start; a word again as one chord.
    await tesseract.setParameters(strip ? { tessedit_pageseg_mode: PSM.SINGLE_WORD, tessedit_char_whitelist: CHORD_CHARACTERS } : { tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: "" });
    const rectangle = strip && { left: Math.round(strip.x0), top: Math.round(strip.y0), width: Math.round(strip.x1 - strip.x0), height: Math.round(strip.y1 - strip.y0) };
    const { data } = await tesseract.recognize(image, rectangle ? { rectangle } : {}, { blocks: true, text: false });
    return ocrLinesFromTesseract(data);
  };
}

export type ChartProgress = (progress: { page: number; pages: number }) => void | Promise<void>;

async function readPdf(bytes: Uint8Array, onProgress: ChartProgress): Promise<PdfChart & { ocr: boolean }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Its text and its pictures, scanned ones too (JBIG2, CCITT fax, JPEG 2000: pdf.js's decoders); no system fonts.
  const wasmUrl = `${path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "wasm")}${path.sep}`;
  const task = pdfjs.getDocument({ data: bytes, wasmUrl, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try {
    const pdf = await task.promise;
    const items: PdfTextItem[] = [];
    const pages: PdfPageSize[] = [];
    let ocr = false;
    for (let number = 1; number <= pdf.numPages; number++) {
      await onProgress({ page: number, pages: pdf.numPages });
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const text: PdfTextItem[] = [];
      const content = (await page.getTextContent()).items.filter((item) => "str" in item && item.str !== "") as { str: string; transform: number[]; width: number; height: number }[];
      // Only what the page shows: some charts join words with white full stops, or hide a summary outside the page.
      const shown = shownText(content, await page.getOperatorList(), pdfjs.OPS);
      for (const [index, item] of content.entries()) {
        if (shown[index]!.trim() === "") continue;
        const [, , c, d, x, y] = pdfjs.Util.transform(viewport.transform, item.transform) as number[];
        text.push({ page: number, text: shown[index]!, x: x!, y: y!, width: item.width, height: Math.hypot(c!, d!) || item.height });
      }
      if (!pageNeedsOcr(text)) {
        items.push(...text);
        pages.push({ page: number, width: viewport.width, height: viewport.height });
        continue;
      }
      ocr = true;
      const drawn = page.getViewport({ scale: Math.min(4, OCR_WIDTH / viewport.width) });
      const canvas = createCanvas(Math.round(drawn.width), Math.round(drawn.height));
      const context = canvas.getContext("2d");
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport: drawn, background: "#ffffff" }).promise;
      items.push(...(await readOcrPage(number, ocrReader(await ocrEngine(), canvas.toBuffer("image/png")))));
      pages.push({ page: number, width: canvas.width, height: canvas.height });
      page.cleanup();
    }
    return { ...readPdfChart(items, pages), ocr };
  } finally {
    await task.destroy();
  }
}

/** A picture: Tesseract reads PNG, JPEG, WebP, GIF and BMP itself (and turns a photo upright by its EXIF). */
async function readImage(bytes: Buffer, onProgress: ChartProgress): Promise<PdfChart & { ocr: boolean }> {
  await onProgress({ page: 1, pages: 1 });
  const tesseract = await ocrEngine();
  const items = await readOcrPage(1, ocrReader(tesseract, bytes));
  return { ...readPdfChart(items), ocr: true };
}

export const isPdfBytes = (bytes: Buffer) => bytes.subarray(0, 5).toString("latin1") === "%PDF-";

/** A chart from a PDF's or a picture's bytes. */
export function readChart(bytes: Buffer, onProgress: ChartProgress = () => undefined): Promise<PdfChart & { ocr: boolean }> {
  return isPdfBytes(bytes) ? readPdf(new Uint8Array(bytes), onProgress) : readImage(bytes, onProgress);
}
