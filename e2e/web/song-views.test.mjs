// A library song in each mode (issue #67): the editor in Edit, its chart in
// Practice (with Edit to go back), full screen in Live; swiping through a
// set in Live; the artists as a grid of round pictures; the theme in the
// account menu, not the header.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Viewer");
const song = (title, content, artist = "Someone") => api(me, "POST", "/song-versions", { title, language: "en", artists: [artist], key: "G", content, contentFormat: "CHORDPRO" });
// Long enough to scroll.
const verses = Array.from({ length: 40 }, (_, i) => `[G]First song [C]words, line ${i + 1}`).join("\n");
const first = await song(`First ${stamp}`, `{start_of_verse}\n${verses}\n{end_of_verse}\n`, `Grid One ${stamp}`);
// Long, and with a structure: V1 C V2 C.
const second = await song(
  `Second ${stamp}`,
  `{start_of_verse}\n${verses.replaceAll("First", "Second")}\n{end_of_verse}\n{start_of_chorus}\n[C]The chorus\n{end_of_chorus}\n{start_of_verse}\n[G]Verse two\n{end_of_verse}\n{chorus}\n`,
  `Grid Two ${stamp}`,
);
const set = await api(me, "POST", "/setlists", { name: `Swipe set ${stamp}` });
await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: first.id });
const items = (await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: second.id })).items;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
page = await context.newPage();
await signIn(page, me);
const setMode = (mode) => page.evaluate((m) => localStorage.setItem("songverse.mode", m), mode);

await step("Edit: the editor, its tabs", async () => {
  await page.goto(`${WEB}/library/${first.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "Song info" }).waitFor();
});

await step("the header stays at the top as the page scrolls", async () => {
  await page.mouse.wheel(0, 2000);
  await page.waitForFunction(() => window.scrollY > 300);
  const header = await page.locator("header").first().boundingBox();
  if (Math.abs(header.y) > 1) throw new Error(`the header is at ${header.y}`);
  await page.evaluate(() => window.scrollTo(0, 0));
});

await step("Practice: the chart, no tabs; Edit goes back to the editor", async () => {
  await page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name: "Practice" }).click();
  const practice = page.getByTestId("practice-song");
  await practice.getByRole("heading", { name: `First ${stamp}` }).waitFor();
  await practice.locator('[data-chord="G"]').first().waitFor();
  await practice.getByText("First song").first().waitFor();
  if (await page.getByRole("tab", { name: "Song info" }).count()) throw new Error("the editor's tabs in Practice");
  await practice.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("tab", { name: "Song info" }).waitFor();
  if ((await page.evaluate(() => document.documentElement.dataset.mode)) !== "edit") throw new Error("not Edit");
});

await step("Live: a library song opens full screen, like a set's; × goes back to the library", async () => {
  await setMode("live");
  await page.goto(`${WEB}/library/${first.id}`);
  await page.waitForURL(`**/library/${first.id}/live?back=**`);
  await page.getByTestId("live-view").getByRole("heading", { name: `First ${stamp}` }).waitFor();
  if (await page.getByRole("tab", { name: "Song info" }).count()) throw new Error("the editor's tabs in Live");
  await page.getByRole("button", { name: "Back" }).click();
  await page.waitForURL(`${WEB}/library`);
});

await step("Live in a set: swiping left goes to the next song, right to the previous one", async () => {
  // In one column (issue #177: a wide screen flows the chart into several, too short to scroll).
  await page.evaluate(() => localStorage.setItem("songverse.chart.columns", "1"));
  await page.goto(`${WEB}/sets/${set.id}/live/${items[0].id}`);
  await page.getByTestId("live-view").getByRole("heading", { name: `First ${stamp}` }).waitFor();
  const swipe = (from, to) =>
    page.getByTestId("live-scroll").evaluate(
      (element, [x1, x2]) => {
        const touch = (x) => new Touch({ identifier: 1, target: element, clientX: x, clientY: 400 });
        element.dispatchEvent(new TouchEvent("touchstart", { touches: [touch(x1)], changedTouches: [touch(x1)], bubbles: true }));
        element.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [touch(x2)], bubbles: true }));
      },
      [from, to],
    );
  // Scrolled down the first song…
  // Scrolled again until it holds: the page may still be settling (a chart laid out, the last position restored).
  await page.waitForFunction(() => {
    const scroller = document.querySelector('[data-testid="live-scroll"]');
    if (scroller.scrollTop <= 500) scroller.scrollTo({ top: 600 });
    return scroller.scrollTop > 500;
  });
  await swipe(900, 300);
  await page.waitForURL(`**/sets/${set.id}/live/${items[1].id}`);
  // …the next one starts at its top.
  await page.waitForFunction(() => document.querySelector('[data-testid="live-scroll"]').scrollTop === 0);
  await page.getByTestId("live-view").getByRole("heading", { name: `Second ${stamp}` }).waitFor();
  // A short or mostly vertical move isn't a swipe.
  await swipe(600, 560);
  await page.waitForTimeout(300);
  if (!page.url().includes(items[1].id)) throw new Error("moved on a short swipe");
  await swipe(300, 900);
  await page.waitForURL(`**/sets/${set.id}/live/${items[0].id}`);
  await page.evaluate(() => localStorage.removeItem("songverse.chart.columns"));
  await setMode("edit");
});

await step("Live: the set's name alone in the header; title, artist and key at the top of the song", async () => {
  await setMode("live");
  await page.goto(`${WEB}/sets/${set.id}/live/${items[1].id}`);
  const live = page.getByTestId("live-view");
  await live.getByRole("heading", { name: `Second ${stamp}` }).waitFor();
  if ((await page.getByTestId("live-set").innerText()).trim() !== `Swipe set ${stamp}`) throw new Error(await page.getByTestId("live-set").innerText());
  const header = await live.locator("header").boundingBox();
  if (Math.round(header.height) !== 56) throw new Error(`header ${header.height}px`);
  const top = page.getByTestId("live-song-top");
  await top.getByText(`Grid Two ${stamp}`).waitFor();
  if ((await page.getByTestId("live-key").innerText()).trim() !== "G") throw new Error(await page.getByTestId("live-key").innerText());
  // The title scrolls with the chart.
  await page.getByTestId("live-scroll").evaluate((el) => el.scrollTo({ top: 400 }));
  await page.waitForFunction(() => document.querySelector('[data-testid="live-song-top"]').getBoundingClientRect().bottom < 150);
});

await step("Live: the structure bar - V1 C V2 C, coloured by kind, following the song; a tap goes there", async () => {
  const bar = page.getByTestId("live-structure");
  const chips = await bar.getByRole("button").evaluateAll((els) => els.map((el) => `${el.textContent}:${el.dataset.group}`));
  if (chips.join() !== "V1:verse,C:chorus,V2:verse,C:chorus") throw new Error(chips.join());
  await page.getByTestId("live-scroll").evaluate((el) => el.scrollTo({ top: 0 }));
  await bar.locator('[aria-current="step"]').getByText("V1").waitFor();
  await bar.getByRole("button", { name: "Go to Verse 2" }).click();
  await bar.locator('[aria-current="step"]').getByText("V2").waitFor();
});

await step("Live: the key transposes for now, G+1 shown; back to the set's key", async () => {
  await page.getByTestId("live-key").click();
  const panel = page.getByTestId("live-transpose");
  await panel.getByRole("button", { name: "Up a semitone" }).click();
  await page.getByTestId("live-key").getByText("+1").waitFor();
  // Flats and sharps as their signs (issue #230): A♭.
  if (!(await page.getByTestId("live-key").innerText()).startsWith("A♭")) throw new Error(await page.getByTestId("live-key").innerText());
  await page.locator('[data-chord="Ab"]').first().waitFor();
  await panel.getByRole("button", { name: "Back to the set's key" }).click();
  if ((await page.getByTestId("live-key").innerText()).trim() !== "G") throw new Error("not back");
  // …and it's for this song only: the next one is in its own key. (The panel is still open.)
  await panel.getByRole("button", { name: "Up a semitone" }).click();
  await page.getByTestId("live-key").getByText("+1").waitFor();
  await page.keyboard.press("ArrowLeft");
  await page.waitForURL(`**/sets/${set.id}/live/${items[0].id}`);
  await page.getByTestId("live-view").getByRole("heading", { name: `First ${stamp}` }).waitFor();
  if ((await page.getByTestId("live-key").innerText()).trim() !== "G") throw new Error("the transpose followed");
  await setMode("edit");
});

await step("Artists: a grid of round pictures, the name and the number of songs under each", async () => {
  await page.goto(`${WEB}/library/artists?q=Grid`);
  await page.waitForLoadState("networkidle");
  const one = page.getByTestId("artist-list").getByRole("link", { name: new RegExp(`Grid One ${stamp}`) });
  const two = page.getByTestId("artist-list").getByRole("link", { name: new RegExp(`Grid Two ${stamp}`) });
  await one.getByText("1 song").waitFor();
  const [a, b] = await Promise.all([one.boundingBox(), two.boundingBox()]);
  if (Math.abs(a.y - b.y) > 2) throw new Error("not side by side");
  const picture = await one.locator("span").first().evaluate((el) => {
    const style = getComputedStyle(el);
    return { radius: style.borderRadius, width: el.offsetWidth, height: el.offsetHeight, text: el.textContent };
  });
  if (picture.width !== picture.height || !picture.radius.includes("px") || picture.text !== "GO") throw new Error(JSON.stringify(picture));
});

await step("no breadcrumb; the theme is in the account menu", async () => {
  if (await page.getByRole("navigation", { name: "breadcrumb" }).count()) throw new Error("a breadcrumb");
  if (await page.locator("header").getByRole("button", { name: /Light theme|Dark theme/ }).count()) throw new Error("a theme button in the header");
  await page.getByTestId("account-menu").click();
  await page.getByRole("menu").getByRole("button", { name: /Light theme|Dark theme/ }).waitFor();
  await page.keyboard.press("Escape");
});

await browser.close();
finish();
