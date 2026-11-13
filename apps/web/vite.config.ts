import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite-plus";

/**
 * pdf.js's image decoders (WebAssembly, with a JavaScript fallback): JBIG2
 * and CCITT fax scans - sheet music scanned to 1-bit, say - and JPEG 2000.
 * pdf.js fetches them by name from a folder it's told about (`wasmUrl`,
 * lib/pdfjs.ts); without them it leaves those images out and draws only the
 * page's text. Served at /assets/pdfjs-<version>/, so they're cached for good
 * and kept for offline use like the rest of /assets/.
 */
function pdfjsWasm(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
  const folder = join(root, "wasm");
  // Not quickjs-eval: that's pdf.js's sandbox for scripts in a PDF, which Songverse never runs.
  const files = readdirSync(folder).filter((name) => (name.endsWith(".wasm") || name.endsWith(".js")) && !name.startsWith("quickjs"));
  const base = `/assets/pdfjs-${version}/`;
  return {
    name: "songverse-pdfjs-wasm",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = request.url?.startsWith(base) ? request.url.slice(base.length).split("?")[0] : null;
        if (!name || !files.includes(name)) return next();
        response.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        response.end(readFileSync(join(folder, name)));
      });
    },
    generateBundle() {
      if (this.environment?.name !== "client") return;
      for (const name of files) this.emitFile({ type: "asset", fileName: `${base.slice(1)}${name}`, source: readFileSync(join(folder, name)) });
    },
  };
}

/**
 * Tesseract (tesseract.js, Apache 2.0), the OCR that reads a scanned chart
 * or a photo of one (issue #124): its Web Worker, its WebAssembly core (the
 * LSTM-only builds, one picked by what the device's browser can do) and the
 * English and French language data, served at /assets/tesseract-<version>/
 * rather than fetched from a CDN. Loaded only when a scan is read, and left
 * out of the offline precache (server.mjs's precacheSkip): 4 MB of core and
 * 3.6 MB of language data.
 */
function tesseractAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("tesseract.js/package.json"));
  const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
  const core = dirname(createRequire(join(root, "package.json")).resolve("tesseract.js-core/package.json"));
  const files = new Map<string, string>([["worker.min.js", join(root, "dist", "worker.min.js")]]);
  for (const name of readdirSync(core).filter((name) => name.endsWith("-lstm.wasm.js"))) files.set(`core/${name}`, join(core, name));
  for (const language of ["eng", "fra"]) {
    files.set(`lang/${language}.traineddata.gz`, join(dirname(require.resolve(`@tesseract.js-data/${language}/package.json`)), "4.0.0_best_int", `${language}.traineddata.gz`));
  }
  const base = `/assets/tesseract-${version}/`;
  return {
    name: "songverse-tesseract",
    config: () => ({ define: { __TESSERACT_ASSETS__: JSON.stringify(base) } }),
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = request.url?.startsWith(base) ? request.url.slice(base.length).split("?")[0]! : null;
        const file = name ? files.get(name) : undefined;
        if (!file) return next();
        response.setHeader("Content-Type", name!.endsWith(".gz") ? "application/gzip" : "text/javascript");
        response.end(readFileSync(file));
      });
    },
    generateBundle() {
      if (this.environment?.name !== "client") return;
      for (const [name, file] of files) this.emitFile({ type: "asset", fileName: `${base.slice(1)}${name}`, source: readFileSync(file) });
    },
  };
}

export default defineConfig({
  // An OAuth client of the API: people sign in at Oneverse (issue #303,
  // packages/app/src/oauth.ts); its address from WEB_URL.
  define: { __ONEVERSE_CLIENT__: JSON.stringify({ id: "songverse", addressEnv: "WEB_URL" }) },
  resolve: {
    tsconfigPaths: true,
  },
  // `vite preview` (our production server — see Dockerfile.songverse) rejects
  // requests whose Host header it doesn't recognize, as a DNS-rebinding
  // defense meant for a developer's own machine. In production this
  // container only ever receives traffic that Dokploy's reverse proxy has
  // already routed for a domain we explicitly configured there, so that
  // protection is redundant here — allow every host rather than hardcode
  // one domain and hit this again for the next subdomain we add.
  //
  // The build also runs a preview server itself, to prerender the offline
  // app shell (spa mode below, issue #49). It listens on 127.0.0.1, not
  // "localhost": in some build sandboxes (Dokploy's Docker builds) localhost
  // resolves to ::1 for the server and 127.0.0.1 for the prerender's fetch,
  // and the build failed with ECONNREFUSED.
  preview: { allowedHosts: true, host: "127.0.0.1" },
  plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), viteReact(), pdfjsWasm(), tesseractAssets()],
});
