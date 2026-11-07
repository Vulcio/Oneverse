// Draws the icons of the app's home screen shortcuts (issue #404), from the
// sidebar's Lucide icons in the app icon's colours: public/shortcuts/<name>.svg,
// and the PNGs Android needs (96 and 192 px), rendered by Playwright.
//
// A new shortcut: a page for it (a route; `sets/current.tsx` picks a set
// and goes there), its entry in public/manifest.webmanifest's `shortcuts`
// and in each language's (manifest.fr.webmanifest), with icons at
// /shortcuts/<name>.svg, -96.png and -192.png, its Lucide icon in ICONS here,
// then `node scripts/shortcut-icons.mjs` from apps/web (CHROMIUM=/path/to/chrome
// for a Chromium other than the one Playwright downloads), and its name in
// e2e/web/shortcuts.test.mjs.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ICONS = {
  "current-set": "list-music",
  library: "music-2",
  metronome: "metronome",
  tuner: "gauge",
};

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "shortcuts");
// Playwright is the e2e suites' (it isn't one of the web app's dependencies).
const { chromium } = createRequire(join(here, "..", "..", "..", "e2e", "package.json"))("playwright");
const lucide = join(dirname(createRequire(import.meta.url).resolve("lucide-react")), "..", "esm", "icons");

function attributes(props) {
  return Object.entries(props)
    .filter(([key]) => key !== "key")
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
}

async function svg(icon) {
  const { __iconData } = await import(pathToFileURL(join(lucide, `${icon}.mjs`)).href);
  const shapes = __iconData.node.map(([tag, props]) => `<${tag} ${attributes(props)}/>`).join("");
  // The glyph in the middle 60%, so a launcher's round mask leaves it whole.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="21" fill="#111827"/><g transform="translate(19.2 19.2) scale(2.4)" fill="none" stroke="#8fd0ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</g></svg>\n`;
}

await mkdir(out, { recursive: true });
const manifest = JSON.parse(await readFile(join(here, "..", "public", "manifest.webmanifest"), "utf8"));
// A Chromium of its own when the one Playwright expects isn't there (CHROMIUM=/path/to/chrome).
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
try {
  for (const shortcut of manifest.shortcuts) {
    const name = shortcut.icons[0].src.replace(/^\/shortcuts\/|\.svg$/g, "");
    if (!ICONS[name]) throw new Error(`No Lucide icon for the shortcut "${name}": add it to ICONS.`);
    const drawn = await svg(ICONS[name]);
    await writeFile(join(out, `${name}.svg`), drawn);
    for (const size of [96, 192]) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${drawn}`);
      await page.screenshot({ path: join(out, `${name}-${size}.png`), omitBackground: true });
      await page.close();
    }
    console.log(`public/shortcuts/${name}: svg, 96, 192`);
  }
} finally {
  await browser.close();
}
