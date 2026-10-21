// The sidebar (issue #80): the full one on a section's pages and lists; on
// one item (a song, a set, a songbook), after shadcn's sidebar-09, a rail of
// sections and a panel listing what it was opened from - your favorites,
// Songs as searched, a set's or a songbook's songs - to go from one to the
// next; filtering it; collapsing either (remembered).
import { chromium } from "playwright";
import { WEB, api, finish, railLink, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Sidebar");
const first = await api(me, "POST", "/song-versions", { title: `Aardvark hymn ${stamp}`, language: "en", artists: ["Someone"] });
const second = await api(me, "POST", "/song-versions", { title: `Aardvark psalm ${stamp}`, language: "en", artists: ["Someone Else"] });
const set = await api(me, "POST", "/setlists", { name: `Sidebar set ${stamp}` });
await api(me, "POST", "/setlists", { name: `Other set ${stamp}` });
for (const song of [first, second]) await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
const { items } = await api(me, "GET", `/setlists/${set.id}`);
const book = await api(me, "POST", "/songbooks", { name: `Sidebar book ${stamp}`, kind: "NUMBERED" });
await api(me, "POST", `/songbooks/${book.id}/entries`, { songVersionId: first.id, entryCode: "7" });
await api(me, "POST", `/songbooks/${book.id}/entries`, { songVersionId: second.id, entryCode: "12" });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);
const panel = () => page.getByTestId("sidebar-panel");
const state = () => page.locator('[data-slot="sidebar"]').getAttribute("data-state");
const until = (want) => page.waitForFunction((w) => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === w, want);

await step("a section's own page has the full sidebar, its lists under each section", async () => {
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  if ((await state()) !== "expanded") throw new Error(await state());
  if (await page.getByTestId("sidebar-rail").count()) throw new Error("the rail on Library's home");
  await page.getByTestId("library-sections").getByRole("link", { name: "Artists", exact: true }).waitFor();
  await page.locator('[data-slot="sidebar"]').getByRole("link", { name: `Sidebar set ${stamp}` }).waitFor();
});

const noRail = async () => {
  await page.waitForLoadState("networkidle");
  if (await page.getByTestId("sidebar-rail").count()) throw new Error(`the rail on ${page.url()}`);
};

await step("lists keep the full sidebar; a song opened from Favorites has your favorites beside it", async () => {
  await api(me, "PUT", `/song-versions/${second.id}/favorite`);
  await page.getByTestId("library-sections").getByRole("link", { name: "Favorites", exact: true }).click();
  await page.waitForURL(/\/library\/songs\?favorites=true/);
  await page.getByTestId("library-range").waitFor(); // Songs, not the home's table still showing
  await noRail();
  await page.getByRole("row").filter({ hasText: `Aardvark psalm ${stamp}` }).click();
  await page.waitForURL(new RegExp(`/library/${second.id}\\?from=`));
  if ((await railLink(page, "Library").getAttribute("data-active")) !== "true") throw new Error("Library isn't marked");
  await panel().getByTestId("sidebar-panel-title").getByText("Favorites", { exact: true }).waitFor();
  await panel().getByRole("link", { name: `Aardvark psalm ${stamp}` }).waitFor();
  if (await panel().getByRole("link", { name: `Aardvark hymn ${stamp}` }).count()) throw new Error("not only the favorites");
});

await step("a song opened from Songs has the songs as searched; one marked, the next one click away, still from there", async () => {
  await page.goto(`${WEB}/library/songs?q=Aardvark`);
  await noRail();
  await page.getByRole("row").filter({ hasText: `Aardvark hymn ${stamp}` }).click();
  await page.waitForURL(new RegExp(`/library/${first.id}\\?from=q%3DAardvark`));
  await panel().getByTestId("sidebar-panel-title").getByText("Songs", { exact: true }).waitFor();
  if ((await panel().getByRole("link", { name: `Aardvark hymn ${stamp}` }).getAttribute("aria-current")) !== "page") throw new Error("not marked");
  await panel().getByRole("link", { name: `Aardvark psalm ${stamp}` }).click();
  await page.waitForURL(new RegExp(`/library/${second.id}\\?from=q%3DAardvark`));
  await page.getByRole("heading", { name: `Aardvark psalm ${stamp}` }).first().waitFor();
  // Back to the list, as it was: the full sidebar again.
  await panel().getByTestId("sidebar-panel-back").click();
  await page.waitForURL(/\/library\/songs\?q=Aardvark/);
  await noRail();
});

await step("from the home's Favorites shelf, the favorites; Artists and Sets are lists too", async () => {
  await page.goto(`${WEB}/library`);
  await page.getByTestId("shelf-favorites").getByTestId("song-card").first().click();
  await panel().getByTestId("sidebar-panel-title").getByText("Favorites", { exact: true }).waitFor();
  await page.goto(`${WEB}/library/artists`);
  await noRail();
  await page.goto(`${WEB}/sets`);
  await noRail();
  await page.locator('[data-slot="sidebar"]').getByRole("link", { name: `Sidebar set ${stamp}` }).click();
  await page.waitForURL(`${WEB}/sets/${set.id}`);
});

await step("in a set, the panel lists its songs; one opens, and is marked; back to the sets", async () => {
  await panel().getByRole("link", { name: new RegExp(`^Sidebar set ${stamp}`) }).waitFor();
  const songs = panel().getByTestId("sidebar-panel-list");
  await songs.getByRole("link", { name: `1. Aardvark hymn ${stamp}` }).waitFor();
  await songs.getByRole("link", { name: `2. Aardvark psalm ${stamp}` }).click();
  await page.waitForURL(`${WEB}/sets/${set.id}/songs/${items[1].id}`);
  if ((await songs.getByRole("link", { name: `2. Aardvark psalm ${stamp}` }).getAttribute("aria-current")) !== "page") throw new Error("not marked");
  await songs.getByRole("link", { name: `1. Aardvark hymn ${stamp}` }).click();
  await page.waitForURL(`${WEB}/sets/${set.id}/songs/${items[0].id}`);
  // Back lists the sets again, without leaving the song.
  await panel().getByTestId("sidebar-panel-back").click();
  await panel().getByLabel("Filter…").fill(""); // still what was typed before
  await panel().getByRole("link", { name: new RegExp(`Other set ${stamp}`) }).waitFor();
  if (!page.url().endsWith(`/songs/${items[0].id}`)) throw new Error(page.url());
  await panel().getByRole("link", { name: new RegExp(`Sidebar set ${stamp}`) }).click();
  await page.waitForURL(`${WEB}/sets/${set.id}`);
  await panel().getByTestId("sidebar-panel-list").getByRole("link", { name: `1. Aardvark hymn ${stamp}` }).waitFor();
});

await step("in a songbook, the panel lists its songs by number; a song opened from it stays in it", async () => {
  await page.goto(`${WEB}/songbooks/${book.id}`);
  await page.waitForLoadState("networkidle");
  const songs = panel().getByTestId("sidebar-panel-list");
  await songs.getByRole("link", { name: `12. Aardvark psalm ${stamp}` }).waitFor();
  await panel().getByLabel("Filter…").fill("7");
  await songs.getByRole("link", { name: `7. Aardvark hymn ${stamp}` }).waitFor();
  if (await songs.getByRole("link", { name: `12. Aardvark psalm ${stamp}` }).count()) throw new Error("not filtered by number");
  await songs.getByRole("link", { name: `7. Aardvark hymn ${stamp}` }).click();
  await page.waitForURL(`${WEB}/library/${first.id}?songbook=${book.id}`);
  // Still the songbook, the song marked, and Songbooks on the rail.
  if ((await songs.getByRole("link", { name: `7. Aardvark hymn ${stamp}` }).getAttribute("aria-current")) !== "page") throw new Error("not marked");
  if ((await railLink(page, "Songbooks").getAttribute("data-active")) !== "true") throw new Error("Songbooks isn't marked");
  // Changing tab on the song keeps it.
  await page.getByRole("tab", { name: "History" }).click();
  await page.waitForURL(/tab=history/);
  if (!page.url().includes(`songbook=${book.id}`)) throw new Error(page.url());
  await panel().getByTestId("sidebar-panel-back").click();
  await panel().getByRole("link", { name: new RegExp(`Sidebar book ${stamp}`) }).waitFor();
});

await step("collapsed, remembered: the panel hides, and the full sidebar is icons; the header's button opens both", async () => {
  await page.keyboard.press("Control+b");
  await until("collapsed");
  // The panel's container closes to nothing; the rail stays.
  await page.waitForFunction(() => document.querySelector('[data-testid="sidebar-panel"]').parentElement.getBoundingClientRect().width < 1);
  await railLink(page, "Library").waitFor();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await until("collapsed");
  await page.goto(`${WEB}/songbooks`);
  await page.waitForLoadState("networkidle");
  await until("collapsed");
  const labelShown = () => page.locator('[data-slot="sidebar"]').getByText("Songbooks", { exact: true }).evaluateAll((els) => els.some((el) => el.checkVisibility()));
  if (await labelShown()) throw new Error("labels while collapsed");
  // The account's avatar stays, as the icon for the account menu (issue #147).
  if (!(await page.getByTestId("account-menu").locator('[data-slot="avatar"]').isVisible())) throw new Error("no avatar while collapsed");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await until("expanded");
  if (!(await labelShown())) throw new Error("no labels once expanded");
  await page.locator('[data-slot="sidebar-rail"]').click();
  await until("collapsed");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await until("expanded");
});

await step("sub-items have icons (a team's or a songbook's avatar, issue #161); Tools has the metronome and the tuner; the documentation is docked at the bottom (issue #147)", async () => {
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  const sidebar = page.locator('[data-slot="sidebar"]');
  const subItems = await sidebar.locator('[data-slot="sidebar-menu-sub-button"]').evaluateAll((links) => links.map((link) => `${link.textContent.trim()}:${!!link.querySelector('svg, [data-testid="entity-avatar"]')}`));
  if (!subItems.length || subItems.some((item) => item.endsWith(":false") && !/^View all/.test(item))) throw new Error(subItems.join(" "));
  await sidebar.getByText("Tools", { exact: true }).waitFor();
  await sidebar.getByRole("link", { name: "Tuner" }).click();
  await page.getByTestId("tuner").getByText("Coming soon").waitFor();
  // Docked: below everything else, above the account.
  const docs = await sidebar.getByTestId("sidebar-docs").boundingBox();
  const tuner = await sidebar.getByRole("link", { name: "Tuner" }).boundingBox();
  const account = await sidebar.getByTestId("account-menu").boundingBox();
  if (!(docs.y > tuner.y && docs.y < account.y)) throw new Error(`docs at ${docs.y}, tuner ${tuner.y}, account ${account.y}`);
  if (!(await sidebar.getByTestId("sidebar-docs").getAttribute("href")).startsWith("https://docs.oneverse.top/")) throw new Error("not the docs");
});

await browser.close();
finish();
