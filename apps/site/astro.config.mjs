// @ts-check
import { defineConfig } from "astro/config";

// Oneverse's website at the root of oneverse.top (#43, #303): one static
// page, in English (/) and French (/fr/), pointing to the apps and the docs.
export default defineConfig({
  site: "https://oneverse.top",
});
