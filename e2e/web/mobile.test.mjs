// Browser test for issue #21: mobile sidebar closes on navigation; no horizontal scroll on phones.
import { chromium } from "playwright";
import { WEB, SP, tag, sql, stepper, user, api, signIn, finish } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
async function headerBadges(expected) {
  let got;
  for (let i = 0; i < 40; i++) {
    got = (await page.getByRole("list", { name: "Roles" }).first().locator("li").allInnerTexts().catch(() => [])).join("|");
    if (got === expected) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`header badges: ${got}`);
}


const WIDTH = Number(process.env.WIDTH ?? 360);
const admin = await user("Mobile Auditor");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await api(admin, "PATCH", "/users/me", { instruments: ["LEAD_VOCALS", "ACOUSTIC_GUITAR", "ELECTRIC_GUITAR", "BASS_GUITAR"], techRoles: ["SOUND_ENGINEER", "MEDIA_OPERATOR"] });
const team = await api(admin, "POST", "/teams", { name: `International Worship Collective of Somewhere Rather Long ${tag}` });
const song = await api(admin, "POST", "/song-versions", { artists: ["Test Artist"], title: `A Remarkably Long Song Title That Keeps Going And Going ${tag}`, language: "en" });
await api(admin, "PATCH", `/song-versions/${song.id}`, { key: "G", tempo: 72 });
await api(admin, "PATCH", `/song-versions/${song.id}`, {
  contentFormat: "CHORDPRO",
  content: "{title: Long}\n{start_of_verse}\n[G]Amazing grace how [D/F#]sweet the [Em7]sound that [Cadd9]saved a [G]wretch like [D]me I [Em]once was [C]lost but [G]now am [D]found\n{end_of_verse}\n{start_of_chorus}\n[C]Supercalifragilisticexpialidocious[G]Antidisestablishmentarianism\n{end_of_chorus}\n",
});
await api(admin, "PATCH", `/song-versions/${song.id}`, { composers: ["Somebody With A Very Long Name Indeed"], lyricists: ["Somebody With A Very Long Name Indeed"] });
const teamSong = await api(admin, "POST", "/song-versions", { artists: ["Test Artist"], title: `Team Song ${tag}`, language: "fr", teamId: team.id });
const songbook = await api(admin, "POST", "/songbooks", { name: `Hymns and Spiritual Songs for Every Season ${tag}`, kind: "NUMBERED", abbreviation: "HSS" });
await api(admin, "POST", `/songbooks/${songbook.id}/entries`, { songVersionId: song.id, entryCode: "123" });
const catalog = await api(admin, "POST", "/songbook-catalogs", { name: `Official Catalogue of Long Names ${tag}`, abbreviation: "OCLN", publisher: "Publisher With A Long Name Ltd", isbn: "978-3-16-148410-0" });
await api(admin, "POST", `/songbook-catalogs/${catalog.id}/entries`, { entryCode: "1", title: "Entry with a fairly long title for a catalogue row", composer: "Johann Sebastian Bach", author: "Someone Else", ccli: "1234567" });
const set = await api(admin, "POST", "/setlists", { name: `Sunday Morning Celebration Service ${tag}`, teamId: team.id });
await api(admin, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id, transposeSteps: 2 });
await api(admin, "POST", `/setlists/${set.id}/items`, { songVersionId: teamSong.id });

const routes = [
  "/dashboard", "/library", "/library/new", `/library/${song.id}`,
  "/sets", "/sets/new", `/sets/${set.id}`,
  "/songbooks", "/songbooks/new", `/songbooks/${songbook.id}`,
  "/songbook-catalogs", "/songbook-catalogs/new", `/songbook-catalogs/${catalog.id}`,
  "/teams", "/teams/new", `/teams/${team.id}`,
  "/admin", "/admin/users", "/admin/storage", "/admin/auth", "/admin/catalogs", "/admin/metadata",
];

const browser = await chromium.launch();
const phone = { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
let context = await browser.newContext(phone);
page = await context.newPage();
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push(`pageerror ${e.message} ${String(e.stack).slice(0, 400)} @ ${p.url()}`));
  p.on("console", async (m) => {
    if (m.type() !== "error") return;
    const args = await Promise.all(m.args().map((a) => a.jsonValue().catch(() => "?")));
    errors.push(`${m.text()} ${JSON.stringify(args).slice(0, 300)} @ ${p.url()}`);
  });
};
watch(page);

const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const sheet = () => page.locator('[data-slot="sidebar"][role="dialog"]');
async function openSidebar() {
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await sheet().waitFor({ state: "visible" });
}
async function expectClosed() {
  await sheet().waitFor({ state: "detached", timeout: 3000 });
}

await signIn(page, admin);

await step("phone: following a nav link closes the sidebar", async () => {
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await openSidebar();
  await sheet().getByRole("link", { name: "Library", exact: true }).click();
  await page.waitForURL("**/library");
  await expectClosed();
});

await step("phone: expanding a section keeps the sidebar open", async () => {
  await openSidebar();
  const toggles = sheet().getByRole("button", { name: "Toggle" });
  await toggles.first().click();
  await page.waitForTimeout(300);
  if (!(await sheet().isVisible())) throw new Error("sidebar closed on a section toggle");
  await toggles.first().click();
});

await step("phone: a team link in a section closes it too", async () => {
  await sheet().getByRole("link", { name: team.name }).click();
  await page.waitForURL(`**/teams/${team.id}`);
  await expectClosed();
});

await step("phone: user menu link closes it", async () => {
  await openSidebar();
  // On a team's page the sheet opens on the teams' list; Menu is the full sidebar (#80).
  await sheet().getByTestId("sidebar-menu").click();
  await sheet().locator("[data-slot=sidebar-footer] button").first().click();
  await page.getByRole("menuitem", { name: "Dashboard" }).click();
  await page.waitForURL("**/dashboard");
  await expectClosed();
});

await step("phone: link to the page you're on still closes it", async () => {
  await openSidebar();
  await sheet().locator("[data-slot=sidebar-footer] button").first().click();
  await page.getByRole("menuitem", { name: "Dashboard" }).click();
  await expectClosed();
});

await step("phone: on a song opened from Songs, the sheet opens on those songs; one tap opens the next", async () => {
  await page.goto(`${WEB}/library/songs?q=${tag}`);
  await page.getByTestId("library-range").waitFor();
  // Rendered on the server first: its sidebar button works once the page has loaded.
  await page.waitForLoadState("networkidle");
  // The list page: the full sidebar.
  await openSidebar();
  await sheet().getByRole("link", { name: "Library", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await expectClosed();
  await page.getByRole("row").filter({ hasText: `Team Song ${tag}` }).click();
  await page.waitForURL(new RegExp(`/library/${teamSong.id}\\?from=`));
  await openSidebar();
  const list = sheet().getByTestId("sidebar-panel");
  await list.getByTestId("sidebar-panel-title").getByText("Songs", { exact: true }).waitFor();
  if ((await list.getByRole("link", { name: new RegExp(`^Team Song ${tag}`) }).getAttribute("aria-current")) !== "page") throw new Error("not marked");
  await list.getByRole("link", { name: new RegExp(`^A Remarkably Long Song Title`) }).click();
  await page.waitForURL(new RegExp(`/library/${song.id}\\?from=`));
  await expectClosed();
  if ((await overflow()) > 0) throw new Error("scrolls sideways");
});

await step("phone: Menu switches the sheet to the full sidebar; it opens on the list again next time", async () => {
  await openSidebar();
  await sheet().getByTestId("sidebar-menu").click();
  await sheet().getByRole("link", { name: "Library", exact: true }).waitFor();
  if (await sheet().getByTestId("sidebar-panel").count()) throw new Error("still the list");
  await page.keyboard.press("Escape");
  await expectClosed();
  await openSidebar();
  await sheet().getByTestId("sidebar-panel").waitFor();
  await page.keyboard.press("Escape");
  await expectClosed();
});

for (const width of [360, 320]) {
  await step(`no horizontal scroll at ${width}px on any signed-in page`, async () => {
    await page.setViewportSize({ width, height: 780 });
    const bad = [];
    for (const route of routes) {
      await page.goto(`${WEB}${route}`);
      await page.waitForLoadState("networkidle");
      const over = await overflow();
      if (over > 0) bad.push(`${route} +${over}px`);
    }
    if (bad.length) throw new Error(bad.join(", "));
  });
}
await page.setViewportSize({ width: 360, height: 780 });

await step("phone: admin users shows status and the actions menu on screen", async () => {
  await page.goto(`${WEB}/admin/users`);
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder(/Search/).fill(admin.email);
  const row = page.locator("tbody tr").first();
  await row.getByText("Verified").first().waitFor();
  const button = await row.getByRole("button", { name: /Actions for/ }).boundingBox();
  if (!button || button.x + button.width > 360) throw new Error(`actions button at ${JSON.stringify(button)}`);
  const scroller = await page.evaluate(() => {
    const el = document.querySelector("table")?.parentElement;
    return el ? el.scrollWidth - el.clientWidth : -1;
  });
  if (scroller > 0) throw new Error(`table scrolls by ${scroller}px`);
  await page.screenshot({ path: `${SP}/mobile-admin-users.png` });
});

await step("phone: library table shows title and artist without scrolling", async () => {
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  const headers = (await page.locator("thead th:visible").allInnerTexts()).map((h) => h.trim());
  if (headers.join("|") !== "Title|Artist") throw new Error(headers.join("|"));
  await page.screenshot({ path: `${SP}/mobile-library.png` });
});

await step("phone: long chord run on the song page wraps", async () => {
  // The chart is in the Editor (Song info's Song content is for a new song, issue #254).
  await page.goto(`${WEB}/library/${song.id}?tab=editor`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("structured-editor").getByText(/Antidisestablishmentarianism/).first().waitFor();
  if ((await overflow()) > 0) throw new Error("overflows");
  await page.screenshot({ path: `${SP}/mobile-song.png`, fullPage: true });
});

await step("desktop: clicking a link leaves the sidebar in place", async () => {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await desktop.newPage();
  watch(p);
  const saved = page;
  page = p;
  try {
    await signIn(p, admin);
    await p.locator('[data-slot="sidebar"]').getByRole("link", { name: "Sets", exact: true }).click();
    await p.waitForURL("**/sets");
    if (!(await p.locator('[data-slot="sidebar"]').getByRole("link", { name: "Library", exact: true }).isVisible())) throw new Error("sidebar hidden");
  } finally {
    page = saved;
    await desktop.close();
  }
});

await step("signed-out pages don't scroll sideways", async () => {
  const anon = await browser.newContext(phone);
  const p = await anon.newPage();
  const bad = [];
  for (const route of ["/", "/reset-password?token=x", "/join/not-a-token", "/transfer/not-a-token"]) {
    await p.goto(`${WEB}${route}`);
    await p.waitForLoadState("networkidle");
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) bad.push(`${route} +${over}px`);
  }
  await p.screenshot({ path: `${SP}/mobile-signin.png` });
  await anon.close();
  if (bad.length) throw new Error(bad.join(", "));
});

await step("no console errors", async () => {
  // Known and unrelated: headless Chromium's trimmed ICU data names languages
  // by code ("aa") where Node says "Afar", so the language picker's option
  // order differs between server and client; and a data request the test's
  // own next page.goto() aborts.
  const relevant = errors.filter(
    (e) => !/favicon|status of 404|Failed to load resource|Failed to fetch/.test(e) && !(e.includes("Hydration failed") && e.includes("Abkhazian")),
  );
  if (relevant.length) {
    (await import("node:fs")).writeFileSync(`${SP}/mobile-errors.txt`, relevant.join("\n----\n"));
    throw new Error(`${relevant.length} error(s), see mobile-errors.txt`);
  }
});

await browser.close();
finish();
