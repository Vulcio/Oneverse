// The modes (issues #29, #47): Edit, Practice and Live at the top right of
// the header, each with its own look; Edit and Practice light or dark (the
// device's to start with), Live always dark, with a set's songs full screen,
// what's next, autoscroll and keys.
import { chromium } from "playwright";
import { WEB, api, check, finish, signIn, stamp, stepper, user, chooseMode } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Live player");
// Long enough to scroll, and quick (400 BPM) so autoscroll moves within the test.
const verses = Array.from({ length: 30 }, (_, i) => `[G]Line ${i + 1} of the [C]song and [D]on it goes`).join("\n");
const first = await api(me, "POST", "/song-versions", {
  title: `Opener ${stamp}`,
  language: "en",
  artists: ["Someone"],
  key: "G",
  tempo: 400,
  content: `{start_of_verse}\n${verses}\n{end_of_verse}\n`,
  contentFormat: "CHORDPRO",
});
const second = await api(me, "POST", "/song-versions", {
  title: `Closer ${stamp}`,
  language: "en",
  artists: ["Someone"],
  key: "C",
  content: "{start_of_chorus}\n[C]Last [F]song [G]tonight\n{end_of_chorus}\n",
  contentFormat: "CHORDPRO",
});
const set = await api(me, "POST", "/setlists", { name: `Gig ${stamp}` });
await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: first.id });
const items = (await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: second.id })).items;
const [firstItem, secondItem] = items;

// In a numbered songbook with a volume: Live shows "ABBR 12 · ABBR2" (issue #59).
const abbr = [...String(stamp).slice(-5)].map((digit) => "ABCDEFGHIJ"[Number(digit)]).join("");
const book = await api(me, "POST", "/songbooks", { name: `Live book ${stamp}`, kind: "NUMBERED", abbreviation: abbr });
await api(me, "PATCH", `/songbooks/${book.id}`, { sections: [{ label: `${abbr}2`, start: 10, end: 20 }] });
await api(me, "POST", `/songbooks/${book.id}/entries`, { songVersionId: first.id, entryCode: "12" });
const view = await api(me, "GET", `/setlists/${set.id}/items/${firstItem.id}/song`);
check("a set song tells what's next", view.nextTitle === `Closer ${stamp}` && view.nextItemId === secondItem.id, JSON.stringify(view.nextTitle));
const last = await api(me, "GET", `/setlists/${set.id}/items/${secondItem.id}/song`);
check("the last song has nothing next", last.nextTitle === null && last.nextItemId === null);

const browser = await chromium.launch();
// A device set to light, then one set to dark.
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
page = await context.newPage();
await signIn(page, me);

const html = () =>
  page.evaluate(() => ({
    mode: document.documentElement.dataset.mode,
    dark: document.documentElement.classList.contains("dark"),
    background: getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
    primary: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
  }));
// How dark the page is: 0 black, 255 white.
const brightness = () =>
  page.evaluate(() => {
    const canvas = document.createElement("canvas").getContext("2d");
    canvas.fillStyle = getComputedStyle(document.querySelector("[data-testid=live-view]") ?? document.body).backgroundColor;
    canvas.fillRect(0, 0, 1, 1);
    const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
    return (r + g + b) / 3;
  });
const modeSwitch = () => page.getByRole("radiogroup", { name: "Mode" }).or(page.getByTestId("mode-picker"));
// The switch's radio, or in Live its one button naming the mode (issue #359).
const checked = (name) => page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name }).and(page.locator("[aria-checked=true]")).or(page.getByRole("button", { name: `Mode: ${name}`, exact: true })).first().waitFor();
const looks = {};
// The light or dark theme: in the account menu at the bottom of the sidebar (issue #67).
const theme = async (name) => {
  await page.getByTestId("account-menu").click();
  await page.getByRole("button", { name }).click();
  await page.keyboard.press("Escape");
};

await step("Edit to start with, following the device (light), switch at the top right", async () => {
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.waitForLoadState("networkidle");
  await checked("Edit");
  const box = await modeSwitch().boundingBox();
  if (box.x + box.width < 1280 - 80 || box.y > 56) throw new Error(`the switch is at ${JSON.stringify(box)}`);
  const state = await html();
  if (state.mode !== "edit" || state.dark) throw new Error(JSON.stringify(state));
  looks.editLight = state;
});

await step("the account menu's moon makes Edit dark, remembered; the sun follows the device again", async () => {
  if (await page.locator("header").getByRole("button", { name: /Light theme|Dark theme/ }).count()) throw new Error("a theme button in the header");
  await theme("Dark theme");
  let state = await html();
  if (!state.dark) throw new Error("not dark");
  looks.editDark = state;
  await page.reload();
  await page.waitForLoadState("networkidle");
  if (!(await html()).dark) throw new Error("light again after reloading");
  await theme("Light theme");
  state = await html();
  const stored = await page.evaluate(() => localStorage.getItem("songverse.theme"));
  if (state.dark || stored !== null) throw new Error(`dark: ${state.dark}, stored theme: ${stored}`);
});

await step("Practice has its own look, light and dark, and a set's songs open as usual", async () => {
  await chooseMode(page, "Practice");
  let state = await html();
  if (state.mode !== "practice" || state.dark) throw new Error(JSON.stringify(state));
  if (state.primary === looks.editLight.primary) throw new Error("the same colours as Edit");
  await theme("Dark theme");
  state = await html();
  if (!state.dark) throw new Error("not dark");
  looks.practiceDark = state;
  await page.getByTestId("set-song-row").getByRole("link", { name: `Opener ${stamp}` }).click();
  await page.waitForURL(`**/sets/${set.id}/songs/${firstItem.id}`);
  await page.getByText("My view").waitFor();
  await theme("Light theme");
});

await step("Live on a set opens its first song full screen, dark, with no theme button", async () => {
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Live", exact: true }).click();
  await page.waitForURL(`**/sets/${set.id}/live/${firstItem.id}`);
  await page.getByTestId("live-view").waitFor();
  await page.getByRole("heading", { name: `Opener ${stamp}` }).waitFor();
  const state = await html();
  if (state.mode !== "live" || !state.dark) throw new Error(JSON.stringify(state));
  if ((await brightness()) > 60) throw new Error(`background brightness ${await brightness()}`);
  // Live's dark isn't Edit's or Practice's.
  if (new Set([state.background, looks.editDark.background, looks.practiceDark.background]).size !== 3) throw new Error("dark themes not all different");
  if (await page.getByRole("button", { name: /Light theme|Dark theme/ }).count()) throw new Error("Live has a theme button");
  // Beside it, the sidebar with the set's songs, this one marked (issue #154); no site header.
  const list = page.getByTestId("sidebar-panel-list");
  await list.getByRole("link", { name: new RegExp(`Closer ${stamp}`) }).waitFor();
  if (!(await list.getByRole("link", { name: new RegExp(`Opener ${stamp}`) }).getAttribute("href"))?.includes(`/live/${firstItem.id}`)) throw new Error("the sidebar's songs aren't Live's");
  await checked("Live");
  await page.getByTestId("live-next").getByText(`Next: Closer ${stamp}`).waitFor();
  await page.locator('[data-chord="G"]').first().waitFor();
  const details = await page.getByTestId("live-details").innerText();
  if (!details.includes("400 BPM") || !details.includes(`${abbr} 12 · ${abbr}2`)) throw new Error(details);
  // The key, top right of the song (issue #68).
  if ((await page.getByTestId("live-key").innerText()).trim() !== "G") throw new Error(await page.getByTestId("live-key").innerText());
});

await step("the chart is big: bigger text, smaller text", async () => {
  const size = () => page.locator("[data-line]").first().evaluate((el) => el.getBoundingClientRect().height);
  const before = await size();
  await page.getByRole("button", { name: "Bigger text" }).click();
  const after = await size();
  if (after <= before) throw new Error(`${before} -> ${after}`);
  await page.getByRole("button", { name: "Smaller text" }).click();
});

await step("autoscroll: Space starts and pauses it, faster nudges it", async () => {
  const scrollTop = () => page.getByTestId("live-scroll").evaluate((el) => el.scrollTop);
  await page.getByRole("button", { name: "Faster" }).click();
  await page.getByTestId("live-speed").getByText("110%").waitFor();
  await page.locator("body").click({ position: { x: 640, y: 400 } });
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Pause scrolling" }).waitFor();
  await page.waitForTimeout(1500);
  if ((await scrollTop()) <= 0) throw new Error("didn't scroll");
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Start scrolling" }).waitFor();
  const paused = await scrollTop();
  await page.waitForTimeout(500);
  if ((await scrollTop()) !== paused) throw new Error("still scrolling after pausing");
});

await step("the right arrow goes to the next song; the last says the set ends", async () => {
  await page.keyboard.press("ArrowRight");
  await page.waitForURL(`**/live/${secondItem.id}`);
  await page.getByRole("heading", { name: `Closer ${stamp}` }).waitFor();
  await page.getByTestId("live-next").getByText("End of the set").waitFor();
  await page.keyboard.press("ArrowLeft");
  await page.waitForURL(`**/live/${firstItem.id}`);
  await page.getByRole("heading", { name: `Opener ${stamp}` }).waitFor();
});

await step("leaving Live for Practice goes back to the song's page, in Practice's look", async () => {
  await chooseMode(page, "Practice");
  await page.waitForURL(`**/sets/${set.id}/songs/${firstItem.id}`);
  await page.getByText("My view").waitFor();
  const state = await html();
  if (state.mode !== "practice" || state.dark) throw new Error(JSON.stringify(state));
  await page.reload();
  await page.waitForLoadState("networkidle");
  if ((await html()).mode !== "practice") throw new Error("not Practice after reloading");
});

await step("a song counts as played once its chart is scrolled to the end, not just opened (issue #153)", async () => {
  const number = (index) => page.getByTestId("set-song-number").nth(index);
  // Both opened above: the first autoscrolled to its end, the second (short enough to fit) left backwards - not played; the first where Live is.
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="set-song-number"][data-current]').waitFor();
  if ((await number(0).getAttribute("data-current")) !== "true" || (await number(1).getAttribute("data-played")) !== null) throw new Error(`played by opening: ${await page.evaluate((id) => localStorage.getItem(`songverse.sets.progress.${id}`), set.id)} (${firstItem.id}, ${secondItem.id})`);
  // Afresh, for the first.
  await page.evaluate((id) => localStorage.removeItem(`songverse.sets.progress.${id}`), set.id);
  await page.goto(`${WEB}/sets/${set.id}/live/${firstItem.id}`);
  await page.getByTestId("live-view").waitFor();
  await page.locator('[data-chord="G"]').first().waitFor();
  const scrollTo = (share) => page.getByTestId("live-scroll").evaluate((el, s) => el.scrollTo({ top: (el.scrollHeight - el.clientHeight) * s }), share);
  const played = () => page.evaluate((id) => JSON.parse(localStorage.getItem(`songverse.sets.progress.${id}`) ?? "{}").played ?? [], set.id);
  await scrollTo(0.9);
  await page.waitForTimeout(300);
  if ((await played()).length) throw new Error("played at 90%");
  await scrollTo(1);
  await page.waitForFunction((id) => (JSON.parse(localStorage.getItem(`songverse.sets.progress.${id}`) ?? "{}").played ?? []).length === 1, set.id);
  // On to the second: where Live is now, not played yet.
  await page.getByTestId("live-next").click();
  await page.waitForURL(`**/live/${secondItem.id}`);
  await page.getByRole("heading", { name: `Closer ${stamp}` }).waitFor();
});

await step("the songs played are ticked on the set's page; Live resumes where it was", async () => {
  const number = (index) => page.getByTestId("set-song-number").nth(index);
  await chooseMode(page, "Practice");
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="set-song-number"][data-played]').waitFor();
  if ((await number(0).getAttribute("data-played")) !== "true" || (await number(1).getAttribute("data-played")) !== null) throw new Error("not ticked as played");
  if ((await number(1).getAttribute("data-current")) !== "true") throw new Error(`not where Live is: ${await page.evaluate((id) => localStorage.getItem(`songverse.sets.progress.${id}`), set.id)} (${firstItem.id}, ${secondItem.id})`);
  await page.getByTestId("set-live").getByText("Resume Live").waitFor();
  if ((await page.getByTestId("set-live").getAttribute("href")) !== `/sets/${set.id}/live/${secondItem.id}`) throw new Error(await page.getByTestId("set-live").getAttribute("href"));
  // From the top: nothing played, Live from the first song.
  await page.getByTestId("set-progress-clear").click();
  await page.getByTestId("set-live").getByText("Live", { exact: true }).waitFor();
  if (await page.locator("[data-played]").count()) throw new Error("still ticked");
  if ((await page.getByTestId("set-live").getAttribute("href")) !== `/sets/${set.id}/live/${firstItem.id}`) throw new Error("not from the top");
});

await step("in Live, picking a set opens it straight into Live, at the song last played; its × goes back to the sets", async () => {
  await chooseMode(page, "Live");
  await page.waitForURL(`**/sets/${set.id}/live/${firstItem.id}`);
  await page.getByTestId("live-view").waitFor();
  await page.getByTestId("live-next").click();
  await page.waitForURL(`**/live/${secondItem.id}`);
  await page.getByRole("heading", { name: `Closer ${stamp}` }).waitFor();
  // To the sets, as from the sidebar.
  await page.goto(`${WEB}/sets`);
  await page.getByRole("main").getByText(`Gig ${stamp}`, { exact: true }).click();
  await page.waitForURL(`**/sets/${set.id}/live/${secondItem.id}`);
  await page.getByRole("heading", { name: `Closer ${stamp}` }).waitFor();
  // Progress from another day: forgotten, the first song again.
  await page.evaluate((id) => {
    const key = `songverse.sets.progress.${id}`;
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)), at: Date.now() - 13 * 3600 * 1000 }));
  }, set.id);
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.waitForURL(`**/sets/${set.id}/live/${firstItem.id}`);
});

await step("on a phone: no sideways scroll, the switch still in the header", async () => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`${WEB}/sets/${set.id}/live/${firstItem.id}`);
  await page.getByTestId("live-view").waitFor();
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) throw new Error(`${overflow}px sideways scroll`);
  const box = await modeSwitch().boundingBox();
  if (box.x + box.width > 360 || box.y > 60) throw new Error(`the switch is at ${JSON.stringify(box)}`);
  // No sidebar beside it, but its button (issue #154): the set's songs in a sheet, one tap to another.
  if (await page.getByTestId("sidebar-panel-list").isVisible()) throw new Error("the sidebar takes the phone's screen");
  await page.getByTestId("live-sidebar").click();
  await page.getByRole("dialog").getByRole("link", { name: new RegExp(`Closer ${stamp}`) }).click();
  await page.waitForURL(`**/live/${secondItem.id}`);
  await page.getByRole("heading", { name: `Closer ${stamp}` }).waitFor();
  await chooseMode(page, "Edit");
  await page.waitForURL(`**/songs/${secondItem.id}`);
});
await context.close();

await step("on a dark device, Edit starts dark; the saved mode comes back, an unknown one is Edit", async () => {
  const dark = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  page = await dark.newPage();
  await signIn(page, me);
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.waitForLoadState("networkidle");
  let state = await html();
  if (state.mode !== "edit" || !state.dark) throw new Error(JSON.stringify(state));
  await page.evaluate(() => localStorage.setItem("songverse.mode", "live"));
  await page.reload();
  await page.waitForLoadState("networkidle");
  state = await html();
  if (state.mode !== "live") throw new Error(JSON.stringify(state));
  await checked("Live");
  await page.evaluate(() => localStorage.setItem("songverse.mode", "perform"));
  // (A set opens Live in Live: its page again.)
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.waitForLoadState("networkidle");
  state = await html();
  if (state.mode !== "edit") throw new Error(JSON.stringify(state));
  await checked("Edit");
  await dark.close();
});

await browser.close();
finish();
