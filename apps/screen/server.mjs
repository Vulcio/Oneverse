// The screen app's production server: the web apps' shared one
// (packages/app/server/web-server.mjs).
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serveWebApp } from "@oneverse/app/server";

// Its service worker keeps the app for a reload with no network (issue #195): every font as WOFF2, which every
// browser a screen runs takes, not their WOFF copies too.
await serveWebApp({ dir: dirname(fileURLToPath(import.meta.url)), name: "Screen", precacheSkip: /\.woff$/ });
