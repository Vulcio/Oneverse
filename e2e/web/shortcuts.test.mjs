// Home screen shortcuts (issue #404): the web manifest's `shortcuts` - Current
// set, Library, Metronome, Tuner - each with its icons, and each opening its
// page; Current set opens today's or the next set (or Sets when none is coming
// up), after signing in too.
import { chromium } from "playwright";
import { ONEVERSE, WEB, api, check, finish, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

// The browser's own date: the shortcut picks the set on the device's day.
const localDate = (offsetDays) => {
  const day = new Date(Date.now() + offsetDays * 86400000);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
};

// --- the manifest
const manifest = await (await fetch(`${WEB}/manifest.webmanifest`)).json();
const shortcuts = manifest.shortcuts ?? [];
check(
  "the manifest offers Current set, Library, Metronome and Tuner",
  shortcuts.map((shortcut) => `${shortcut.name} ${shortcut.url}`).join(", ") === "Current set /sets/current, Library /library, Metronome /metronome, Tuner /tuner",
  JSON.stringify(shortcuts.map((shortcut) => shortcut.url)),
);
// In French too (the page's language picks it), the same shortcuts with their names in French.
const french = await (await fetch(`${WEB}/manifest.fr.webmanifest`)).json();
check(
  "the French manifest: the same app and shortcuts, in French",
  french.id === manifest.id &&
    french.start_url === manifest.start_url &&
    JSON.stringify(french.shortcuts.map((shortcut) => [shortcut.url, shortcut.icons])) === JSON.stringify(shortcuts.map((shortcut) => [shortcut.url, shortcut.icons])) &&
    french.shortcuts.map((shortcut) => shortcut.name).join(", ") === "Liste en cours, Bibliothèque, Métronome, Accordeur",
  JSON.stringify(french.shortcuts.map((shortcut) => shortcut.name)),
);
for (const shortcut of shortcuts) {
  const sizes = shortcut.icons.map((icon) => icon.sizes).join(" ");
  check(`${shortcut.name}: an SVG and 96 and 192 px PNGs`, sizes === "any 96x96 192x192", sizes);
  for (const icon of shortcut.icons) {
    const res = await fetch(`${WEB}${icon.src}`);
    check(`${icon.src} is served as ${icon.type}`, res.ok && res.headers.get("content-type")?.startsWith(icon.type), `${res.status} ${res.headers.get("content-type")}`);
  }
}

// --- where they go
const me = await user("Shortcut");
const past = await api(me, "POST", "/setlists", { name: `Last week ${stamp}`, eventDate: localDate(-1) });
const later = await api(me, "POST", "/setlists", { name: `Later ${stamp}`, eventDate: localDate(10) });
const soon = await api(me, "POST", "/setlists", { name: `Soon ${stamp}`, eventDate: localDate(3) });
await api(me, "POST", "/setlists", { name: `Undated ${stamp}` });
const idle = await user("No sets");
await api(idle, "POST", "/setlists", { name: `Done ${stamp}`, eventDate: localDate(-2) });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 412, height: 860 } });

await step("signed out, Current set signs in first and then opens the next set", async () => {
  await page.goto(`${WEB}/sets/current`);
  await page.waitForURL(`${ONEVERSE}/sign-in**`);
  await page.waitForLoadState("networkidle");
  await page.fill("#signin-email", me.email);
  await page.fill("#signin-password", "hunter2pass");
  await page.getByRole("button", { name: /Sign in|Se connecter/, exact: false }).first().click();
  await page.waitForURL(`${WEB}/sets/${soon.id}`);
  if (past.id === soon.id || later.id === soon.id) throw new Error("sets not made");
});

await step("Current set: today's set when there is one", async () => {
  const today = await api(me, "POST", "/setlists", { name: `Today ${stamp}`, eventDate: localDate(0) });
  await page.goto(`${WEB}/sets/current`);
  await page.waitForURL(`${WEB}/sets/${today.id}`);
  await page.getByText(`Today ${stamp}`).first().waitFor();
});

await step("the page links the manifest in its language", async () => {
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  if (href !== "/manifest.webmanifest") throw new Error(href);
  await api(me, "PATCH", "/users/me", { locale: "fr" });
  await page.goto(`${WEB}/library`);
  const french = await page.locator('link[rel="manifest"]').getAttribute("href");
  await api(me, "PATCH", "/users/me", { locale: "en" });
  if (french !== "/manifest.fr.webmanifest") throw new Error(french);
});

await step("Library, Metronome and Tuner open their pages", async () => {
  await page.goto(`${WEB}/library`);
  await page.getByTestId("library-recently-updated").or(page.getByRole("heading", { name: "Library" })).first().waitFor();
  await page.goto(`${WEB}/metronome`);
  await page.getByTestId("metronome-page").waitFor();
  await page.goto(`${WEB}/tuner`);
  await page.getByTestId("tuner").waitFor();
});

await step("Current set with nothing coming up: the Sets page", async () => {
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(`${WEB}/sets/current`);
  await other.waitForURL(`${ONEVERSE}/sign-in**`);
  await other.waitForLoadState("networkidle");
  await other.fill("#signin-email", idle.email);
  await other.fill("#signin-password", "hunter2pass");
  await other.getByRole("button", { name: /Sign in|Se connecter/, exact: false }).first().click();
  await other.waitForURL(`${WEB}/sets`);
  await context.close();
});

await browser.close();
finish();
