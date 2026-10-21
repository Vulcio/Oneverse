import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

// Planiverse (issue #241): Songverse's planning, on its own. Served like
// Songverse's web app (see apps/web/vite.config.ts for preview's settings).
export default defineConfig({
  // An OAuth client of the API: people sign in at Oneverse (issue #303,
  // packages/app/src/oauth.ts); its address from PLANIVERSE_URL.
  define: { __ONEVERSE_CLIENT__: JSON.stringify({ id: "planiverse", addressEnv: "PLANIVERSE_URL" }) },
  resolve: {
    tsconfigPaths: true,
  },
  preview: { allowedHosts: true, host: "127.0.0.1" },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
