// Oneverse Plan's production server (Planiverse until #539): the web apps'
// shared one (packages/app/server/web-server.mjs), sending its old hosts
// (REDIRECT_HOSTS=planiverse.top) on to its address, PLANIVERSE_URL.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serveWebApp } from "@oneverse/app/server";
import { redirectToWebUrl } from "@oneverse/app/server/redirect-hosts";

await serveWebApp({ dir: dirname(fileURLToPath(import.meta.url)), name: "Oneverse Plan", redirect: (request) => redirectToWebUrl(request, process.env, "PLANIVERSE_URL") });
