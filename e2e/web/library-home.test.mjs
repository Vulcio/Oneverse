// The Library's home (issue #81), in the browser: shelves of cards -
// newly added, recently viewed, favorites (once there are some), popular in
// your teams - each card with a cover of its own when the song has no
// image, and the songs changed last; the star on a song's page; Songs, the
// list on its own, for the favorites filter and a search.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Home");
const mate = await user("Mate");
const team = await api(me, "POST", "/teams", { name: `Home band ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "updatedAt") values ('tmw${stamp}', '${team.id}', '${mate.id}', 'MEMBER', now())`);
const older = await api(me, "POST", "/song-versions", { title: `Zephyr hymn ${stamp}`, language: "en", artists: ["Someone"], teamId: team.id });
const newer = await api(me, "POST", "/song-versions", { title: `Yonder song ${stamp}`, language: "en", artists: ["Someone Else"] });
const set = await api(me, "POST", "/setlists", { name: `Home set ${stamp}`, teamId: team.id });
await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: older.id });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);
const shelf = (id) => page.getByTestId(`shelf-${id}`);
const card = (id, title) => shelf(id).getByTestId("song-card").filter({ hasText: title });

await step("Library opens on its home: newly added first, with covers; popular in the team; the songs changed last", async () => {
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  const titles = await shelf("newest").getByTestId("song-card").allInnerTexts();
  if (!titles[0]?.includes(`Yonder song ${stamp}`)) throw new Error(titles.slice(0, 2).join(" | "));
  // No image yet: a cover with its initials.
  if ((await card("newest", `Yonder song ${stamp}`).getByTestId("song-cover").innerText()).trim() !== "YS") throw new Error("no cover");
  await card("popular", `Zephyr hymn ${stamp}`).waitFor();
  if (await shelf("favorites").count()) throw new Error("an empty favorites shelf");
  await page.getByTestId("library-recently-updated").getByRole("row").filter({ hasText: `Yonder song ${stamp}` }).waitFor();
  // Library is marked in the sidebar, not Songs.
  const sections = page.getByTestId("library-sections");
  if ((await sections.getByRole("link", { name: "Songs", exact: true }).getAttribute("data-active")) === "true") throw new Error("Songs is marked on the home");
});

await step("a shelf longer than the window: no scrollbar, buttons to go through it (issue #94)", async () => {
  for (let i = 0; i < 10; i++) await api(me, "POST", "/song-versions", { title: `Filler ${i} ${stamp}`, language: "en", artists: ["Someone"] });
  await page.reload();
  await page.waitForLoadState("networkidle");
  const row = shelf("newest").getByTestId("shelf-row");
  if ((await row.evaluate((el) => getComputedStyle(el).scrollbarWidth)) !== "none") throw new Error("a scrollbar");
  const back = shelf("newest").getByRole("button", { name: "Back in Newly added" });
  const on = shelf("newest").getByRole("button", { name: "More in Newly added" });
  if (!(await back.isDisabled()) || !(await on.isEnabled())) throw new Error("at the start: only on");
  await on.click();
  await page.waitForFunction((el) => el.scrollLeft > 0, await row.elementHandle());
  await back.waitFor({ state: "visible" });
  await page.waitForFunction((el) => !el.disabled, await back.elementHandle());
  await back.click();
  await page.waitForFunction((el) => el.scrollLeft === 0, await row.elementHandle());
  // Out to the main area's edges, not cut at the page's column; its first card lined up with the heading (issue #147).
  const edges = await row.evaluate((el) => {
    const main = document.querySelector('[data-slot="sidebar-inset"]').getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const heading = el.closest("section").querySelector("h2").getBoundingClientRect();
    return { left: box.left - main.left, right: main.right - box.right, first: el.firstElementChild.getBoundingClientRect().left - heading.left };
  });
  if (Math.abs(edges.left) > 1 || Math.abs(edges.right) > 1 || Math.abs(edges.first) > 1) throw new Error(JSON.stringify(edges));
  // Everything fits: no buttons.
  await page.setViewportSize({ width: 3800, height: 900 });
  await page.waitForFunction(() => {
    const shelf = document.querySelector('[data-testid="shelf-favorites"], [data-testid="shelf-popular"]');
    return shelf && !shelf.querySelector('[data-testid="shelf-on"]');
  });
  await page.setViewportSize({ width: 1280, height: 900 });
});

await step("a song opened is recently viewed; starred, it's a favorite", async () => {
  // The view is noted in the background: waited for, or leaving the page can beat it (CI).
  const viewed = page.waitForResponse((response) => response.url().endsWith(`/song-versions/${older.id}/views`) && response.request().method() === "POST");
  await card("newest", `Zephyr hymn ${stamp}`).click();
  await page.waitForURL(new RegExp(`/library/${older.id}(\\?|$)`)); // with where it was opened from
  await viewed;
  const star = page.getByRole("button", { name: "Add to favorites" });
  await star.click();
  await page.getByRole("button", { name: "Remove from favorites" }).waitFor();
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  await card("recent", `Zephyr hymn ${stamp}`).waitFor();
  await card("favorites", `Zephyr hymn ${stamp}`).waitFor();
});

await step("a song opened from further along Recently viewed: back on the home, the shelf starts lined up with its heading", async () => {
  const fillers = (await api(me, "GET", `/song-versions?q=${encodeURIComponent(`Filler`)}&pageSize=50`)).items.filter((song) => song.title.endsWith(String(stamp)));
  for (const song of fillers.slice(0, 8)) {
    await page.goto(`${WEB}/library/${song.id}`);
    await page.waitForLoadState("networkidle");
  }
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  const row = shelf("recent").getByTestId("shelf-row");
  await row.getByTestId("song-card").nth(3).click();
  await page.waitForLoadState("networkidle");
  await page.goBack();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  // It moved to the front: the row starts again, its new first card where the heading is - not out in the margin.
  const offset = await row.evaluate((el) => ({ scrolled: el.scrollLeft, first: el.firstElementChild.getBoundingClientRect().left - el.closest("section").querySelector("h2").getBoundingClientRect().left }));
  if (offset.scrolled !== 0 || Math.abs(offset.first) > 1) throw new Error(JSON.stringify(offset));
});

await step("See all favorites: Songs, filtered to them, with no shelves", async () => {
  await shelf("favorites").getByRole("link", { name: "See all" }).click();
  await page.waitForURL(/\/library\/songs\?favorites=true/);
  await page.getByTestId("library-range").getByText("1–1 of 1").waitFor();
  if (await page.getByTestId("library-home").count()) throw new Error("shelves on Songs");
  await page.getByRole("button", { name: "Favorites", pressed: true }).click();
  await page.waitForURL(`${WEB}/library/songs`);
  if (await page.getByTestId("library-home").count()) throw new Error("shelves on Songs");
  await page.getByRole("heading", { name: "Songs", exact: true }).waitFor();
});

await step("searching from the home opens Songs; an old /library?q= address too", async () => {
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("searchbox").fill(`Yonder song ${stamp}`);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/library\/songs\?q=/);
  await page.getByTestId("library-range").getByText("1–1 of 1").waitFor();
  await page.goto(`${WEB}/library?q=${encodeURIComponent(`Zephyr hymn ${stamp}`)}`);
  await page.waitForURL(/\/library\/songs\?q=/);
  await page.getByTestId("library-range").getByText("1–1 of 1").waitFor();
});

await step("unstarred, the favorites shelf goes", async () => {
  await page.goto(`${WEB}/library/${older.id}`);
  await page.getByRole("button", { name: "Remove from favorites" }).click();
  await page.getByRole("button", { name: "Add to favorites" }).waitFor();
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  await shelf("recent").waitFor();
  if (await shelf("favorites").count()) throw new Error("still a favorite");
});

await browser.close();
finish();
