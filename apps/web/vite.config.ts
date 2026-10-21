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

export default defineConfig({
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
  plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), viteReact(), pdfjsWasm()],
});
