import type { PdfTextItem } from "@oneverse/core";
import { loadPdfjs, pdfjsWasmUrl } from "#/lib/pdfjs";

/**
 * A PDF's text with where each piece is on its page (issue #124), read in
 * the browser with pdf.js - loaded only when a PDF is dropped, as it's big.
 * Coordinates are in points from the page's top left, so `y` grows down
 * the page, as `chordProFromPdfText` expects. A scanned PDF has none.
 */
export async function pdfTextItems(file: Blob): Promise<PdfTextItem[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), wasmUrl: pdfjsWasmUrl(pdfjs) });
  try {
    const pdf = await task.promise;
    const items: PdfTextItem[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || item.str === "") continue;
        // The page's own transform turns PDF space (y up) into the viewport's (y down).
        const [, , c, d, x, y] = pdfjs.Util.transform(viewport.transform, item.transform);
        items.push({ page: number, text: item.str, x, y, width: item.width, height: Math.hypot(c, d) || item.height });
      }
    }
    return items;
  } finally {
    // Ends pdf.js's worker for this document.
    void task.destroy();
  }
}
