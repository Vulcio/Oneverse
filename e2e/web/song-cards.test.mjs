// The Library's song cards (issues #434, #445): with a mouse, a star, Add to set and a preview come over a
// card's cover, and a favorite keeps its star; the preview shows the song at a glance (its chorus), goes
// through the shelf (buttons, keys, a swipe) without its buttons moving, plays the song's recording or its
// YouTube video, and links to the song and its artist; on a touch screen a long press on a card opens it.
// The home has no search box of its own, and the sidebar no scrollbar.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { API, SP, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";
import { toneWav } from "../lib/fake-demucs.mjs";

let page;
const step = stepper(() => page);
const me = await user("Cards");
const content = "{sov}\n[G]Morning has [C]broken\n[G]Like the first [D]morning\n{eov}\n{soc}\n[G]Praise with elation\n[C]Praise every morning\n{eoc}\n";
// Newest first on the shelf: Carol, Hymn, Anthem.
const anthem = await api(me, "POST", "/song-versions", { title: `Anthem ${stamp}`, language: "en", artists: ["Someone"] });
const hymn = await api(me, "POST", "/song-versions", { title: `Hymn ${stamp}`, language: "en", artists: ["Eleanor Farjeon"], key: "G", tempo: 96, timeSignature: "3/4", content, contentFormat: "CHORDPRO" });
const carol = await api(me, "POST", "/song-versions", { title: `Carol ${stamp}`, language: "en", artists: ["Someone"] });
const set = await api(me, "POST", "/setlists", { name: `Cards set ${stamp}` });
// Carol has a recording of its own; Anthem only a YouTube video; Hymn nothing to listen to.
const form = new FormData();
form.append("type", "AUDIO");
form.append("file", new Blob([toneWav(440, 20)], { type: "audio/wav" }), "Carol.wav");
const uploaded = await fetch(`${API}/song-versions/${carol.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
if (uploaded.status !== 201) throw new Error(`${uploaded.status} ${await uploaded.text()}`);
const VIDEO = "aqz-KE-bpKQ";
await api(me, "PUT", `/song-versions/${anthem.id}/links/YOUTUBE`, { url: `https://www.youtube.com/watch?v=${VIDEO}` });
const shots = `${SP}/song-cards`;
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await signIn(page, me);

const shelf = (id) => page.getByTestId(`shelf-${id}`);
const card = (id, song) => shelf(id).locator(`[data-testid="song-card"][data-song="${song.id}"]`);
const peek = () => page.getByTestId("song-peek");
const shown = async (song) => peek().and(page.locator(`[data-song="${song.id}"]`)).waitFor();
const opacity = (locator) => locator.evaluate((el) => getComputedStyle(el).opacity);
const settled = async (locator) => {
  // Where it is once the dialog's opening has finished.
  await page.waitForTimeout(250);
  const box = await locator.boundingBox();
  return `${Math.round(box.x)},${Math.round(box.y)}`;
};

await step("the home has no search box of its own, and the sidebar no scrollbar", async () => {
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  if (await page.getByRole("main").getByRole("searchbox").count()) throw new Error("a search box on the home");
  const bar = await page.locator('[data-slot="sidebar-content"]').first().evaluate((el) => ({ width: getComputedStyle(el).scrollbarWidth, y: getComputedStyle(el).overflowY }));
  if (bar.width !== "none" || bar.y !== "auto") throw new Error(JSON.stringify(bar));
});

await step("a card's actions come with the mouse; its star puts the song on the Favorites shelf, and stays on the cover", async () => {
  const star = card("newest", hymn).getByTestId("song-card-star");
  const more = card("newest", hymn).getByTestId("song-card-more");
  if ((await opacity(star)) !== "0" || (await opacity(more)) !== "0") throw new Error("shown before the mouse is there");
  await card("newest", hymn).hover();
  await page.waitForFunction((el) => getComputedStyle(el).opacity === "1", await more.elementHandle());
  if (await shelf("favorites").count()) throw new Error("a Favorites shelf already");
  await star.getByRole("button", { name: "Add to favorites" }).click();
  await card("favorites", hymn).waitFor();
  // Still on the home: the star isn't the card's link.
  if (!page.url().endsWith("/library")) throw new Error(page.url());
  await card("newest", hymn).getByRole("button", { name: "Remove from favorites", pressed: true }).waitFor();
  // The mouse gone: the star stays, the other buttons go.
  await page.mouse.move(5, 5);
  await page.waitForFunction((el) => getComputedStyle(el).opacity === "0", await more.elementHandle());
  if ((await opacity(star)) !== "1") throw new Error("a favorite's star went with the mouse");
  if ((await opacity(card("newest", carol).getByTestId("song-card-star"))) !== "0") throw new Error("a star on a song that isn't a favorite");
  await page.screenshot({ path: `${shots}/card-favorite.png`, clip: { x: 256, y: 560, width: 700, height: 320 } });
  await card("newest", hymn).hover();
  await page.screenshot({ path: `${shots}/card-hover.png`, clip: { x: 256, y: 560, width: 700, height: 320 } });
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

await step("the preview: the song at a glance, with its chorus, starred as on its card", async () => {
  await card("newest", hymn).hover();
  await card("newest", hymn).getByTestId("song-card-expand").click();
  await shown(hymn);
  await peek().getByTestId("song-peek-facts").getByText("Key G · 96 BPM · 3/4").waitFor();
  if ((await peek().getByTestId("song-peek-section").innerText()).toLowerCase() !== "chorus") throw new Error(await peek().getByTestId("song-peek-section").innerText());
  const lines = await peek().getByTestId("song-peek-lines").locator("p").allInnerTexts();
  if (lines.slice(1).join("|") !== "Praise with elation|Praise every morning") throw new Error(lines.join("|"));
  await peek().getByTestId("song-peek-artist").getByText("Eleanor Farjeon").waitFor();
  await peek().getByRole("button", { name: "Remove from favorites", pressed: true }).waitFor();
  if (!(await peek().getByTestId("song-peek-listen").isDisabled())) throw new Error("Listen with nothing to hear");
  if ((await peek().getByTestId("song-peek-position").innerText()) !== `2 of ${await shelf("newest").getByTestId("song-card").count()}`) throw new Error(await peek().getByTestId("song-peek-position").innerText());
  await page.waitForTimeout(400); // the dialog's fade
  await page.screenshot({ path: `${shots}/preview-light.png` });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: `${shots}/preview-dark.png` });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
});

await step("previous and next: the buttons and the keys, stopping at the shelf's ends, the buttons where they were", async () => {
  const where = await settled(peek().getByTestId("song-peek-next"));
  await peek().getByTestId("song-peek-previous").click();
  await shown(carol);
  if (!(await peek().getByTestId("song-peek-previous").isDisabled())) throw new Error("before the first");
  if ((await settled(peek().getByTestId("song-peek-next"))) !== where) throw new Error("Next moved");
  await page.keyboard.press("ArrowLeft");
  await shown(carol);
  await page.keyboard.press("ArrowRight");
  await shown(hymn);
  await page.keyboard.press("ArrowDown");
  await shown(anthem);
  await peek().getByText("No words yet.").waitFor();
  if ((await settled(peek().getByTestId("song-peek-next"))) !== where) throw new Error("Next moved");
  await page.keyboard.press("ArrowUp");
  await shown(hymn);
  await page.keyboard.press("Home");
  await shown(carol);
  await page.keyboard.press("End");
  await peek().getByTestId("song-peek-next").and(page.locator(":disabled")).waitFor();
  await page.keyboard.press("Home");
  await shown(carol);
});

await step("a quick listen: the song's recording, then (going on) a video, then nothing; L and Stop end it", async () => {
  await page.keyboard.press("l");
  await peek().getByTestId("quick-listen-recording").waitFor();
  await page.waitForFunction(() => {
    const audio = document.querySelector('[data-testid="quick-listen-audio"]');
    return audio && !audio.paused && audio.currentTime > 0.2;
  });
  await peek().getByTestId("song-peek-listen").and(page.locator('[aria-pressed="true"]')).waitFor();
  await page.screenshot({ path: `${shots}/preview-listen.png` });
  // Listening goes on: Hymn has nothing (its chorus shows), Anthem plays its video.
  await page.keyboard.press("ArrowRight");
  await shown(hymn);
  await peek().getByTestId("quick-listen-audio").waitFor({ state: "detached" });
  await peek().getByTestId("song-peek-section").waitFor();
  await page.keyboard.press("ArrowRight");
  await shown(anthem);
  const src = await peek().getByTestId("quick-listen-youtube").getAttribute("src");
  if (!src.startsWith(`https://www.youtube-nocookie.com/embed/${VIDEO}`)) throw new Error(src);
  await peek().getByTestId("song-peek-listen").click();
  await peek().getByTestId("quick-listen-youtube").waitFor({ state: "detached" });
  await peek().getByText("No words yet.").waitFor();
  await page.keyboard.press("Home");
  await shown(carol);
  if (await peek().getByTestId("quick-listen-recording").count()) throw new Error("still listening after Stop");
});

await step("keys: F stars, Enter opens the song; Escape gives the focus back to the last song's card", async () => {
  await peek().getByRole("button", { name: "Add to favorites", pressed: false }).waitFor();
  await page.keyboard.press("f");
  await peek().getByRole("button", { name: "Remove from favorites", pressed: true }).waitFor();
  await card("favorites", carol).waitFor();
  await page.keyboard.press("f");
  await peek().getByRole("button", { name: "Add to favorites", pressed: false }).waitFor();
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await peek().waitFor({ state: "detached" });
  const last = await shelf("newest").getByTestId("song-card").last().getAttribute("data-song");
  const focused = await page.evaluate(() => document.activeElement?.closest("[data-testid=song-card]")?.getAttribute("data-song"));
  if (focused !== last) throw new Error(`focus on ${focused}, not ${last}`);
  await card("newest", hymn).hover();
  await card("newest", hymn).getByTestId("song-card-expand").click();
  await shown(hymn);
  await page.keyboard.press("Enter");
  await page.waitForURL(new RegExp(`/library/${hymn.id}`));
});

await step("the title opens the song, an artist opens their page; a star taken in the preview leaves the Favorites shelf", async () => {
  await page.goto(`${WEB}/library`);
  await card("newest", hymn).hover();
  await card("newest", hymn).getByTestId("song-card-expand").click();
  await shown(hymn);
  await peek().getByTestId("song-peek-artist").click();
  await page.waitForURL(new RegExp(`/library/artists/${encodeURIComponent("Eleanor Farjeon")}`));
  await page.goto(`${WEB}/library`);
  await card("newest", hymn).hover();
  await card("newest", hymn).getByTestId("song-card-expand").click();
  await shown(hymn);
  await peek().getByRole("button", { name: "Remove from favorites" }).click();
  await peek().getByRole("button", { name: "Add to favorites", pressed: false }).waitFor();
  await shelf("favorites").waitFor({ state: "detached" });
  await peek().getByTestId("song-peek-title").click();
  await page.waitForURL(new RegExp(`/library/${hymn.id}`));
});

await step("a laptop with a touch screen and a mouse: the cards still come alive under the mouse", async () => {
  // Its touch screen is the main pointer (no hover, as the browser says), but its mouse or trackpad hovers.
  const laptop = await chromium.launch({ args: ["--blink-settings=primaryHoverType=1,primaryPointerType=2,availableHoverTypes=3,availablePointerTypes=6"] });
  try {
    const context = await laptop.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(await page.context().cookies());
    const tab = await context.newPage();
    await tab.goto(`${WEB}/library`);
    if (!(await tab.evaluate(() => matchMedia("(hover: none) and (any-hover: hover)").matches))) throw new Error("not a touch laptop");
    const there = tab.getByTestId("shelf-newest").locator(`[data-testid="song-card"][data-song="${carol.id}"]`);
    // The shelves are drawn again once the page has its data: hover the card that's there then.
    await tab.waitForLoadState("networkidle");
    await there.hover();
    await tab.waitForFunction((id) => {
      const more = document.querySelector(`[data-testid="shelf-newest"] [data-song="${id}"] [data-testid="song-card-more"]`);
      return !!more && getComputedStyle(more).opacity === "1";
    }, carol.id);
    await there.getByTestId("song-card-expand").click();
    await tab.getByTestId("song-peek").and(tab.locator(`[data-song="${carol.id}"]`)).waitFor();
  } finally {
    await laptop.close();
  }
});

await step("on a touch screen: a favorite's star on its cover, no buttons; a long press opens the preview, a swipe goes on with the buttons in place, a tap still opens the song", async () => {
  await api(me, "PUT", `/song-versions/${hymn.id}/favorite`);
  await page.context().close();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  if (await card("newest", hymn).getByTestId("song-card-star").isVisible()) throw new Error("hover buttons on a touch screen");
  if (await card("newest", carol).getByTestId("song-card-favorite-mark").count()) throw new Error("a star on a song that isn't a favorite");
  await card("newest", hymn).getByTestId("song-card-favorite-mark").waitFor();
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
  await peek().getByRole("button", { name: "Remove from favorites" }).waitFor();
  await peek().getByTestId("add-to-set").waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/preview-phone.png` });
  const where = await settled(peek().getByTestId("song-peek-next"));
  // A swipe to the left: the next song, its buttons where they were.
  const middle = await centre(peek().getByTestId("song-peek-lines"));
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [middle] });
  for (const dx of [-40, -90, -140]) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: middle.x + dx, y: middle.y }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await shown(anthem);
  if ((await settled(peek().getByTestId("song-peek-next"))) !== where) throw new Error("Next moved on a phone");
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
