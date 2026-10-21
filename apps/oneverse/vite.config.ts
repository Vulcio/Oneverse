import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

// Oneverse (issue #303): where people sign in to every app, and manage
// their account. Served like Songverse's web app (see apps/web/vite.config.ts
// for preview's settings). It has BetterAuth's own session, so no
// __ONEVERSE_CLIENT__ (packages/app/src/oauth.ts).
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  preview: { allowedHosts: true, host: "127.0.0.1" },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
