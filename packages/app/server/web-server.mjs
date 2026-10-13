// The web apps' production server (Songverse's, Planiverse's, issue #241),
// each starting it with what's its own (see serveWebApp below). `vite preview` (used previously) is explicitly a
// preview/dev tool — it serves static assets with `Cache-Control: no-cache`,
// so every visitor's browser re-fetches the stylesheet on every page load
// instead of caching it. Over real network latency that shows up as a
// flash of unstyled content before the CSS arrives; imperceptible on
// localhost, which is why it wasn't caught until testing against the
// actual deployed domain. This replaces it with a small real server that
// caches Vite's content-hashed /assets/* files forever (safe, since a new
// build gets new hashes) and defers everything else to the built SSR
// handler.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { brotliCompressSync, constants as zlib, createBrotliCompress, createGzip, gzipSync } from "node:zlib";
import { createServerAdapter } from "@whatwg-node/server";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Serves a built TanStack Start app from `dir` (its dist/): `name` in the
 * log; the outside sources its pages may load scripts and frames from
 * (Songverse's YouTube player); which built files the service worker
 * doesn't keep (`precacheSkip`); and requests it answers itself first
 * (`redirect`: Songverse's old hosts).
 */
export async function serveWebApp({ dir, name, scriptSources = [], frameSources = [], precacheSkip = null, redirect = () => null }) {
  const clientDir = join(dir, "dist", "client");

  // __root.tsx imports the stylesheet as `app.css?url`, which Vite resolves
  // separately in the client build and the SSR build (two independent Rollup
  // passes — see the "building client environment" / "building ssr
  // environment" lines in `vite build` output). Nothing guarantees Tailwind's
  // generated CSS is byte-identical across those two passes, so the
  // content-hashed filename baked into the SSR-rendered <link> tag can point
  // at a file that was never actually written to dist/client/assets (a 404
  // in production, seen and confirmed on songverse.one 2026-09-16 — the SSR
  // bundle referenced app-DxESX405.css while only app-Cg7lp79W.css existed on
  // disk, reproduced even on a from-scratch `docker build --no-cache`). Read
  // the filename Vite actually emitted and correct any stale reference to it.
  const actualAppCssHref = await (async () => {
    const assetsDir = join(clientDir, "assets");
    const files = await readdir(assetsDir).catch(() => []);
    const match = files.find((f) => /^app-.*\.css$/.test(f));
    return match ? `/assets/${match}` : null;
  })();
  const staleAppCssPattern = /\/assets\/app-[^"'.]*\.css/g;

  const MIME_TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".txt": "text/plain",
    // pdf.js's image decoders (vite.config.ts's pdfjsWasm).
    ".wasm": "application/wasm",
  };

  async function tryServeStatic(pathname) {
    const resolved = join(clientDir, pathname);
    // Guard against path traversal escaping dist/client.
    if (!(resolved + sep).startsWith(clientDir + sep) && resolved !== clientDir) return null;

    let fileStat;
    try {
      fileStat = await stat(resolved);
    } catch {
      return null;
    }
    if (!fileStat.isFile()) return null;

    const body = await readFile(resolved);
    const headers = new Headers({
      "Content-Type": MIME_TYPES[extname(resolved)] ?? "application/octet-stream",
      "Content-Length": String(fileStat.size),
    });

    // Vite content-hashes everything under /assets/ (a new build gets new
    // filenames), so it's safe to cache forever. Everything else
    // (manifest.webmanifest, sw.js, favicons) keeps the same URL across
    // deploys and must be revalidated instead.
    headers.set(
      "Cache-Control",
      pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
    );

    return new Response(body, { headers });
  }

  // Offline (issue #49): the app shell - the page TanStack Start prerenders
  // at build time (spa mode in vite.config.ts) to boot the app in the browser
  // without the server - and the service worker that keeps it and the app's
  // code. Both are filled in here, for this server's environment and build.
  const shellHtml = await readFile(join(clientDir, "_shell.html"), "utf8").catch(() => null);
  // The API URL is read at runtime (see packages/app/src/public-env.ts), but the shell
  // was drawn at build time: put this server's in.
  const publicEnvScript = `window.__PUBLIC_ENV__=${JSON.stringify({ apiUrl: process.env.API_URL ?? "http://localhost:3001" })};`;
  const shell =
    shellHtml &&
    shellHtml
      .replace(/window\.__PUBLIC_ENV__=\{[^<]*?\};/, publicEnvScript)
      .replace(staleAppCssPattern, actualAppCssHref ?? "$&");
  // Everything the app needs offline: its content-hashed code (Songverse's
  // pdf.js image decoders too: a scanned chart's PDF, issue #208) - files
  // only, a folder can't be fetched and would fail the whole install - and
  // the web app manifest; not what the app leaves out (`precacheSkip`).
  const precache = [
    ...(await readdir(join(clientDir, "assets"), { recursive: true, withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile())
      .map((entry) => relative(join(clientDir, "assets"), join(entry.parentPath, entry.name)).split(sep).join("/"))
      .filter((file) => !precacheSkip?.test(file))
      .sort()
      .map((file) => `/assets/${file}`),
    "/manifest.webmanifest",
    "/icon.svg",
  ];
  // Changes with every build, so browsers install the new service worker.
  const build = createHash("sha256").update(precache.join("\n")).update(shell ?? "").digest("hex").slice(0, 16);
  const serviceWorker = await readFile(join(clientDir, "sw.js"), "utf8")
    .then((source) => source.replace('"__SONGVERSE_BUILD__"', JSON.stringify(build)).replace('["__SONGVERSE_PRECACHE__"]', JSON.stringify(precache)))
    .catch(() => null);

  async function offlineResponse(pathname) {
    // Never cached by the browser itself: the service worker decides when a new one applies.
    const headers = { "Cache-Control": "no-cache" };
    if (pathname === "/_shell" && shell) {
      const shellHeaders = new Headers({ ...headers, "Content-Type": "text/html; charset=utf-8" });
      await withPolicy(shellHeaders, inlineScriptHashes(shell));
      return new Response(shell, { headers: shellHeaders });
    }
    if (pathname === "/sw.js" && serviceWorker) return new Response(serviceWorker, { headers: { ...headers, "Content-Type": "text/javascript" } });
    return null;
  }

  const { default: appHandler } = await import(pathToFileURL(join(dir, "dist", "server", "server.js")).href);

  // The Content-Security-Policy (issue #114): the one header that stops an
  // injected script from running, should one ever get past React's escaping.
  // Scripts only from here, or inline with this response's nonce - the
  // server-rendered pages' own (hydration, the public env, the mode and the
  // service worker's), which get it here - or, for the offline shell the
  // service worker keeps (no server to give it a nonce), by their hashes;
  // blob: for the audio worklets, and WebAssembly (the stretch nodes). Admin
  // > Security says whether it's enforced, only reported, or off.
  const apiUrl = process.env.API_URL ?? "http://localhost:3001";
  const apiOrigin = (() => {
    try {
      return new URL(apiUrl).origin;
    } catch {
      return apiUrl;
    }
  })();
  const apiSocket = apiOrigin.replace(/^http/, "ws");

  function contentSecurityPolicy(scripts) {
    return [
      "default-src 'self'",
      `script-src 'self' 'report-sample' ${scripts} blob: 'wasm-unsafe-eval'${scriptSources.map((source) => ` ${source}`).join("")}`,
      "style-src 'self' 'unsafe-inline'",
      // Images from anywhere: artwork candidates come straight from the providers, and an image can't run a script.
      `img-src 'self' data: blob: https: ${apiOrigin}`,
      `media-src 'self' blob: ${apiOrigin}`,
      // blob: - a file kept on the device, read back (offline).
      `connect-src 'self' blob: ${apiOrigin} ${apiSocket}`,
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      frameSources.length ? `frame-src ${frameSources.join(" ")}` : "frame-src 'none'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      `form-action 'self' ${apiOrigin}`,
      "frame-ancestors 'self'",
      "report-uri /csp-report",
    ].join("; ");
  }

  // Enforced, only reported, or off: Admin > Security's, asked of the API a few seconds at a time
  // (every page would otherwise wait on it); enforced when it can't be asked.
  let policyMode = { mode: "ENFORCE", at: 0 };
  async function cspMode() {
    if (Date.now() - policyMode.at < 15_000) return policyMode.mode;
    try {
      const response = await fetch(`${apiUrl}/security/web`, { signal: AbortSignal.timeout(2000) });
      const { contentSecurityPolicy } = await response.json();
      if (["ENFORCE", "REPORT_ONLY", "OFF"].includes(contentSecurityPolicy)) policyMode = { mode: contentSecurityPolicy, at: Date.now() };
    } catch {
      policyMode = { mode: policyMode.mode, at: Date.now() };
    }
    return policyMode.mode;
  }

  async function withPolicy(headers, scripts) {
    const mode = await cspMode();
    if (mode === "OFF") return;
    headers.set(mode === "REPORT_ONLY" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", contentSecurityPolicy(scripts));
  }

  /** The inline scripts in a page, each with the nonce, and the nonce's source for the policy. */
  function withNonce(html) {
    const nonce = randomBytes(16).toString("base64");
    return { html: html.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`), scripts: `'nonce-${nonce}'` };
  }

  /** The offline shell's inline scripts, by their hashes: it's served as it was built, with no one to give it a nonce. */
  function inlineScriptHashes(html) {
    // As the browser hashes it: its HTML parser reads a NUL as U+FFFD (TanStack's stream barrier carries one).
    const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
      ([, body]) => `'sha256-${createHash("sha256").update(body.replaceAll("\0", "\uFFFD")).digest("base64")}'`,
    );
    return [...new Set(hashes)].join(" ");
  }

  // Security headers on every page and file (issue #112): not framed by
  // another site, no type sniffing, only the origin sent on as a referrer.
  const SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };

  function secured(response) {
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!headers.has(name)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  // Compression (issue #120): text is sent brotli- or gzip-compressed when
  // the browser takes it (a JS bundle is about a third of its size). The
  // content-hashed assets never change, so each is compressed once, at the
  // best setting, and kept; pages are compressed as they stream out, at a
  // fast one.
  const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest\+json)|image\/svg\+xml)/;
  const MIN_COMPRESS_BYTES = 1024;
  const compressedAssets = new Map();

  function encodingFor(request) {
    const accepted = request.headers.get("accept-encoding") ?? "";
    if (/\bbr\b/.test(accepted)) return "br";
    if (/\bgzip\b/.test(accepted)) return "gzip";
    return null;
  }

  async function compressed(request, response) {
    const encoding = encodingFor(request);
    const type = response.headers.get("content-type") ?? "";
    const length = Number(response.headers.get("content-length") ?? Infinity);
    if (
      !encoding ||
      !response.body ||
      request.method === "HEAD" ||
      response.status === 204 ||
      response.status === 304 ||
      response.headers.has("content-encoding") ||
      !COMPRESSIBLE.test(type) ||
      length < MIN_COMPRESS_BYTES
    ) {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.set("Content-Encoding", encoding);
    headers.append("Vary", "Accept-Encoding");
    headers.delete("Content-Length");
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/assets/")) {
      const key = `${encoding}:${pathname}`;
      let body = compressedAssets.get(key);
      if (!body) {
        const raw = Buffer.from(await response.arrayBuffer());
        body = encoding === "br" ? brotliCompressSync(raw, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : gzipSync(raw, { level: 9 });
        compressedAssets.set(key, body);
      }
      headers.set("Content-Length", String(body.length));
      return new Response(body, { status: response.status, statusText: response.statusText, headers });
    }
    const stream = encoding === "br" ? createBrotliCompress({ params: { [zlib.BROTLI_PARAM_QUALITY]: 4 } }) : createGzip({ level: 6 });
    const body = Readable.toWeb(Readable.fromWeb(response.body).pipe(stream));
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }

  const adapter = createServerAdapter(async (request) => compressed(request, secured(await handle(request))));

  async function handle(request) {
    const redirected = redirect(request);
    if (redirected) return redirected;

    // What the policy refused (issue #114), in the server's log: a few lines, never the whole report.
    if (request.method === "POST" && new URL(request.url).pathname === "/csp-report") {
      const report = await request.text().catch(() => "");
      console.warn(`CSP: ${report.slice(0, 1500)}`);
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const { pathname } = new URL(request.url);
      const offline = await offlineResponse(pathname);
      if (offline) return offline;
      const staticResponse = await tryServeStatic(decodeURIComponent(pathname));
      if (staticResponse) return staticResponse;
    }

    const response = await appHandler.fetch(request);
    if (!response.headers.get("content-type")?.includes("text/html")) {
      return response;
    }

    // A page: its stylesheet's name put right, and its inline scripts given this response's nonce (issue #114).
    const body = await response.text();
    const { html, scripts } = withNonce(actualAppCssHref ? body.replace(staleAppCssPattern, actualAppCssHref) : body);
    const headers = new Headers(response.headers);
    headers.set("Content-Length", String(Buffer.byteLength(html)));
    await withPolicy(headers, scripts);
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  }

  const port = Number(process.env.PORT ?? 3000);
  createServer(adapter).listen(port, () => {
    console.log(`${name} listening on :${port}`);
  });
}
