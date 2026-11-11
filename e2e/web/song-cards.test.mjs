// The Library's song cards (issue #434): with a mouse, a star, Add to set and a preview come over a
// card's cover; the preview shows the song at a glance and goes through the shelf (buttons, arrow
// keys, a swipe); on a touch screen a long press on a card opens it. The home has no search box of
// its own, and the sidebar no scrollbar.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { SP, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Cards");
const content = "{sov}\n[G]Morning has [C]broken\n[G]Like the first [D]morning\nBlackbird has spoken\nLike the first bird\n{eov}\n";
// Newest first on the shelf: Carol, Hymn, Anthem.
const anthem = await api(me, "POST", "/song-versions", { title: `Anthem ${stamp}`, language: "en", artists: ["Someone"] });
const hymn = await api(me, "POST", "/song-versions", { title: `Hymn ${stamp}`, language: "en", artists: ["Eleanor Farjeon"], key: "G", tempo: 96, timeSignature: "3/4", content, contentFormat: "CHORDPRO" });
const carol = await api(me, "POST", "/song-versions", { title: `Carol ${stamp}`, language: "en", artists: ["Someone"] });
const set = await api(me, "POST", "/setlists", { name: `Cards set ${stamp}` });
const shots = `${SP}/song-cards`;
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await signIn(page, me);

const shelf = (id) => page.getByTestId(`shelf-${id}`);
const card = (id, song) => shelf(id).locator(`[data-testid="song-card"][data-song="${song.id}"]`);
const peek = () => page.getByTestId("song-peek");
const shown = async (song) => peek().and(page.locator(`[data-song="${song.id}"]`)).waitFor();

await step("the home has no search box of its own, and the sidebar no scrollbar", async () => {
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  if (await page.getByRole("main").getByRole("searchbox").count()) throw new Error("a search box on the home");
  const bar = await page.locator('[data-slot="sidebar-content"]').first().evaluate((el) => ({ width: getComputedStyle(el).scrollbarWidth, y: getComputedStyle(el).overflowY }));
  if (bar.width !== "none" || bar.y !== "auto") throw new Error(JSON.stringify(bar));
});

await step("a card's actions come with the mouse; its star puts the song on the Favorites shelf", async () => {
  const actions = card("newest", hymn).getByTestId("song-card-actions");
  if ((await actions.evaluate((el) => getComputedStyle(el).opacity)) !== "0") throw new Error("shown before the mouse is there");
  await card("newest", hymn).hover();
  await page.waitForFunction((el) => getComputedStyle(el).opacity === "1", await actions.elementHandle());
  await page.screenshot({ path: `${shots}/card-hover.png`, clip: { x: 256, y: 560, width: 700, height: 320 } });
  if (await shelf("favorites").count()) throw new Error("a Favorites shelf already");
  await actions.getByRole("button", { name: "Add to favorites" }).click();
  await card("favorites", hymn).waitFor();
  // Still on the home: the star isn't the card's link.
  if (!page.url().endsWith("/library")) throw new Error(page.url());
  await card("newest", hymn).getByRole("button", { name: "Remove from favorites", pressed: true }).waitFor();
});

await step("Add to set, from the card", async () => {
  await card("newest", hymn).hover();
  await card("newest", hymn).getByTestId("song-card-add-to-set").click();
  await page.getByTestId("add-to-set-list").locator(`[data-set-id="${set.id}"]`).click();
  await page.getByTestId("add-to-set-list").locator(`[data-set-id="${set.id}"][data-state="in"]`).waitFor();
  const items = (await api(me, "GET", `/setlists/${set.id}`)).items;
  if (items.length !== 1 || items[0].song.id !== hymn.id) throw new Error(JSON.stringify(items.map((item) => item.song?.id)));
  await page.keyboard.press("Escape");
  if (!page.url().endsWith("/library")) throw new Error(page.url());
});

await step("the preview: the song at a glance, starred as on its card", async () => {
  await card("newest", hymn).hover();
  await card("newest", hymn).getByTestId("song-card-expand").click();
  await shown(hymn);
  const facts = (await peek().getByTestId("song-peek-facts").innerText()).replace(/\s+/g, " ");
  if (!/Key G/.test(facts) || !/Tempo 96 BPM/.test(facts) || !/Time 3\/4/.test(facts)) throw new Error(facts);
  const lines = await peek().getByTestId("song-peek-lines").locator("p").allInnerTexts();
  if (lines.join("|") !== "Morning has broken|Like the first morning|Blackbird has spoken|Like the first bird") throw new Error(lines.join("|"));
  await peek().getByText("Eleanor Farjeon").waitFor();
  await peek().getByRole("button", { name: "Remove from favorites", pressed: true }).waitFor();
  if ((await peek().getByTestId("song-peek-position").innerText()) !== `2 of ${await shelf("newest").getByTestId("song-card").count()}`) throw new Error(await peek().getByTestId("song-peek-position").innerText());
  await page.waitForTimeout(400); // the dialog's fade
  await page.screenshot({ path: `${shots}/preview-light.png` });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: `${shots}/preview-dark.png` });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
});

await step("previous and next: the buttons and the arrow keys, stopping at the shelf's ends", async () => {
  await peek().getByTestId("song-peek-previous").click();
  await shown(carol);
  if (!(await peek().getByTestId("song-peek-previous").isDisabled())) throw new Error("before the first");
  await page.keyboard.press("ArrowLeft");
  await shown(carol);
  await page.keyboard.press("ArrowRight");
  await shown(hymn);
  await page.keyboard.press("ArrowRight");
  await shown(anthem);
  await peek().getByText("No words yet.").waitFor();
  await page.keyboard.press("ArrowLeft");
  await shown(hymn);
});

await step("a star taken in the preview leaves the Favorites shelf; Open goes to the song", async () => {
  await peek().getByRole("button", { name: "Remove from favorites" }).click();
  await peek().getByRole("button", { name: "Add to favorites", pressed: false }).waitFor();
  await shelf("favorites").waitFor({ state: "detached" });
  await peek().getByTestId("song-peek-open").click();
  await page.waitForURL(new RegExp(`/library/${hymn.id}`));
});

await step("on a touch screen: no buttons on the cards, a long press opens the preview, a swipe goes on, a tap still opens the song", async () => {
  await page.context().close();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  if (await card("newest", hymn).getByTestId("song-card-actions").isVisible()) throw new Error("hover buttons on a touch screen");
  const touch = await context.newCDPSession(page);
  const centre = async (locator) => {
    const box = await locator.boundingBox();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  };
  const at = await centre(card("newest", hymn).getByTestId("song-cover"));
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
  await page.waitForTimeout(700);
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await shown(hymn);
  // The finger lifting didn't follow the card's link.
  if (!page.url().endsWith("/library")) throw new Error(page.url());
  await peek().getByRole("button", { name: "Add to favorites" }).waitFor();
  await peek().getByTestId("add-to-set").waitFor();
  await page.screenshot({ path: `${shots}/preview-phone.png` });
  // A swipe to the left: the next song.
  const middle = await centre(peek().getByTestId("song-peek-lines"));
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [middle] });
  for (const dx of [-40, -90, -140]) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: middle.x + dx, y: middle.y }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await shown(anthem);
  await page.keyboard.press("Escape");
  await peek().waitFor({ state: "detached" });
  // A tap, as before.
  await card("newest", carol).tap();
  await page.waitForURL(new RegExp(`/library/${carol.id}`));
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});

await browser.close();
finish();
