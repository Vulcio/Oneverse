import { resolve } from "node:path";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

/**
 * The console on Oneverse Pulse's own page (issue #247): client-only, served
 * by Pulse on the venue's network when the cloud is gone (apps/pulse,
 * PULSE_CONSOLE_DIR). The same console as /operate, from the same sources;
 * flat (pulse.html and assets/) for Pulse to serve.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  base: "/",
  // Not the screen app's public files: Pulse serves the page alone.
  publicDir: false,
  plugins: [tailwindcss(), viteReact()],
  build: {
    outDir: "dist/pulse",
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, "pulse.html") },
  },
});
