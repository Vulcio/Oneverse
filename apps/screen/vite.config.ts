import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

// Oneverse's screen app (issue #305): what a big screen opens, at
// screen.oneverse.top - pairing, then the set's stage (@oneverse/screen).
// Served like Songverse's web app (see apps/web/vite.config.ts for
// preview's settings).
export default defineConfig({
  // Its console (/operate) is an OAuth client of the API: operators sign in at
  // Oneverse (issue #303, packages/app/src/oauth.ts); its address from SCREEN_URL.
  // The screens themselves never sign in: they're paired.
  define: { __ONEVERSE_CLIENT__: JSON.stringify({ id: "screen", addressEnv: "SCREEN_URL" }) },
  resolve: {
    tsconfigPaths: true,
  },
  preview: { allowedHosts: true, host: "127.0.0.1" },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
