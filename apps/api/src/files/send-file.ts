import { inlineSafeType } from "@songverse/core";
import type { Request, Response } from "express";
import { pipeline } from "node:stream/promises";
import type { StorageService } from "../storage/storage.service.js";
import { parseByteRange } from "./byte-range.js";

export interface StoredFile {
  storageKey: string;
  mimeType: string;
  filename: string;
  sizeBytes: number | null;
}

/**
 * Streams a stored file to the response (issue #33), never holding it
 * whole: byte ranges (206) so audio starts and seeks before it has all
 * arrived, and cached for good - a file's content never changes, its
 * storage key being the hash of its bytes.
 *
 * Its type is what the uploader's browser said: only one that can't carry
 * a script is shown inline, anything else is a download, and the response
 * is sandboxed either way (issue #112) - an uploaded HTML or SVG file
 * mustn't run on the API's origin as whoever opened it. An SVG cleaned when
 * it came in (`cleanSvg`: a brand's, issue #295) is shown as a picture,
 * still sandboxed.
 */
export async function sendFile(
  storage: StorageService,
  file: StoredFile,
  req: Request,
  res: Response,
  disposition: "attachment" | "inline",
  options: { cleanSvg?: boolean } = {},
): Promise<void> {
  const size = file.sizeBytes ?? (await storage.size(file.storageKey));
  const etag = `"${file.storageKey}"`;
  const safe = options.cleanSvg && file.mimeType === "image/svg+xml" ? "image/svg+xml" : inlineSafeType(file.mimeType);
  res.set({
    "Content-Type": safe ?? "application/octet-stream",
    "Content-Disposition": `${safe ? disposition : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    "Content-Security-Policy": "sandbox",
    "Accept-Ranges": "bytes",
    // Readable across origins (the web app's): pdf.js reads them to fetch a PDF by ranges, its first page first (issue #156).
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Length, Content-Encoding",
    ETag: etag,
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  const range = parseByteRange(req.headers.range, size);
  if (range === "unsatisfiable") {
    res.status(416).set("Content-Range", `bytes */${size}`).end();
    return;
  }
  if (range) {
    res.status(206).set({ "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(range.end - range.start + 1) });
  } else {
    res.status(200).set("Content-Length", String(size));
  }
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const body = await storage.stream(file.storageKey, range ?? undefined);
  try {
    await pipeline(body, res);
  } catch {
    // The listener went away (a seek cancels the request it replaced): nothing to answer.
    body.destroy();
  }
}
