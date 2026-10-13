// @ts-check
import { readFileSync } from "node:fs";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";

// Songverse's user documentation (docs.songverse.one), in the app's
// languages: English at the root, French under /fr/. Each page's French
// version lives at the same path under src/content/docs/fr/; a page not
// translated yet shows the English one with a notice.
export default defineConfig({
  site: "https://docs.songverse.one",
  // Arrangements are called versions since #78: old links still land.
  redirects: { "/arrangements/": "/versions/", "/fr/arrangements/": "/fr/versions/" },
  integrations: [
    starlight({
      title: "Songverse",
      // A link to a page or heading that doesn't exist fails the build.
      plugins: [starlightLinksValidator()],
      description: "How to use Songverse: songs, versions, sets and songbooks for worship teams and bands.",
      logo: { light: "./src/assets/logo-light.svg", dark: "./src/assets/logo-dark.svg", alt: "Songverse" },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/theme.css"],
      // The parts for some readers only (issue #160): what the reader can use,
      // known before the page is drawn, then the contents list and the switch.
      head: [
        { tag: "script", content: readFileSync(new URL("./src/scripts/audience-head.js", import.meta.url), "utf8") },
        { tag: "script", attrs: { src: "/audience.js", defer: true } },
      ],
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        fr: { label: "Français", lang: "fr" },
      },
      social: [{ icon: "external", label: "Songverse", href: "https://songverse.one" }],
      sidebar: [
        {
          label: "Start here",
          translations: { fr: "Pour commencer" },
          items: [
            { slug: "getting-started" },
            { slug: "account" },
          ],
        },
        {
          label: "Songs",
          translations: { fr: "Chants" },
          items: [
            { slug: "library" },
            { slug: "song-editor" },
            { slug: "versions" },
            { slug: "display" },
          ],
        },
        {
          label: "Playing together",
          translations: { fr: "Jouer ensemble" },
          items: [
            { slug: "sets" },
            { slug: "screens" },
            { slug: "metronome" },
            { slug: "songbooks" },
            { slug: "teams" },
            { slug: "organizations" },
            { slug: "people" },
            { slug: "offline" },
          ],
        },
        // For reviewers and admins (issue #160): hidden for others, still reachable by link.
        { slug: "admin", attrs: { "data-audience": "admin reviewer" } },
      ],
    }),
  ],
});
