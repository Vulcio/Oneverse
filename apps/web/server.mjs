// Songverse's production server: the web apps' shared one
// (packages/app/server/web-server.mjs), with what's Songverse's own.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serveWebApp } from "@oneverse/app/server";
import { redirectToWebUrl } from "./redirect-hosts.mjs";

await serveWebApp({
  dir: dirname(fileURLToPath(import.meta.url)),
  name: "Songverse web",
  // A song's YouTube video, played in the page.
  scriptSources: ["https://www.youtube.com", "https://s.ytimg.com"],
  frameSources: ["https://www.youtube-nocookie.com", "https://www.youtube.com"],
  // Not pdf.js itself (1.7 MB, issue #124) nor Tesseract, the OCR (its code,
  // core and language data, 8 MB): they read a PDF or a photo dropped on a
  // new song, which is online only, so they're fetched when that happens.
  precacheSkip: /^(?:pdf[.-]|tesseract)/,
  redirect: redirectToWebUrl,
});
