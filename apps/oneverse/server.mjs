// Oneverse's production server: the web apps' shared one
// (packages/app/server/web-server.mjs), sending its old hosts
// (REDIRECT_HOSTS=account.oneverse.top, before #538) on to its address, ONEVERSE_URL.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serveWebApp } from "@oneverse/app/server";
import { redirectToWebUrl } from "@oneverse/app/server/redirect-hosts";

await serveWebApp({ dir: dirname(fileURLToPath(import.meta.url)), name: "Oneverse", redirect: (request) => redirectToWebUrl(request, process.env, "ONEVERSE_URL") });
