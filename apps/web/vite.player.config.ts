import { resolve } from "node:path";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

/**
 * Standalone, client-only screen bundle for the Rust mini-PC player.
 * Uses the exact same ScreenStage and @songverse/core sources as the web app.
 * Output is intentionally flat (index.html and assets/) for the Rust bundle server.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  base: "/",
  plugins: [tailwindcss(), viteReact()],
  build: {
    outDir: "dist/player-screen",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "player-screen.html"),
    },
  },
});
