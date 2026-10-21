// Oneverse's production server: the web apps' shared one
// (packages/app/server/web-server.mjs).
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serveWebApp } from "@oneverse/app/server";

await serveWebApp({ dir: dirname(fileURLToPath(import.meta.url)), name: "Oneverse" });
