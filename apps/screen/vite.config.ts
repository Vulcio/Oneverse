import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

// Oneverse's screen app (issue #305): what a big screen opens, at
// screen.oneverse.top - pairing, then the set's stage (@oneverse/screen).
// Served like Songverse's web app (see apps/web/vite.config.ts for
// preview's settings).
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  preview: { allowedHosts: true, host: "127.0.0.1" },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
