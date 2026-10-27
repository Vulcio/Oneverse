// The Quick selection (issue #334): filled from a library row, a song's Add to set and by dragging; then added to a set, or made a new set.
import { chromium } from "playwright";
import { api, finish, signIn, stepper, tag, user, WEB } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

const me = await user("Quick");
const one = await api(me, "POST", "/song-versions", { artists: ["Test Artist"], title: `Quick One ${tag}`, language: "en" });
const two = await api(me, "POST", "/song-versions", { artists: ["Test Artist"], title: `Quick Two ${tag}`, language: "en" });
const three = await api(me, "POST", "/song-versions", { artists: ["Test Artist"], title: `Quick Three ${tag}`, language: "en" });
const sunday = await api(me, "POST", "/setlists", { name: `Sunday ${tag}` });
const selection = async () => (await api(me, "GET", "/quick-selection")).songs.map((song) => song.id);

const browser = await chromium.launch();
page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const row = (title) => page.getByTestId("library-song-row").filter({ hasText: title });
const sidebarEntry = () => page.locator('[data-slot="sidebar"]').getByRole("link", { name: /Quick selection/ });

await step("a library row's button puts the song in the Quick selection; the sidebar shows it", async () => {
  await signIn(page, me);
  await page.goto(`${WEB}/library/songs?q=${encodeURIComponent(`Quick One ${tag}`)}`);
  await row(`Quick One ${tag}`).getByTestId("quick-select-toggle").click();
  await row(`Quick One ${tag}`).locator('[data-testid="quick-select-toggle"][aria-pressed="true"]').waitFor();
  await sidebarEntry().filter({ hasText: "(1)" }).waitFor();
  if (page.url().includes(`/library/${one.id}`)) throw new Error("the song was opened");
  if ((await selection()).join() !== one.id) throw new Error("not kept");
});

await step("a song's Add to set: Quick selection first", async () => {
  await page.goto(`${WEB}/library/${two.id}`);
  await page.getByTestId("add-to-set").click();
  await page.locator('[data-testid="add-to-quick-selection"][data-state="out"]').click();
  await page.locator('[data-testid="add-to-quick-selection"][data-state="in"]').waitFor();
  await page.keyboard.press("Escape");
});

await step("a song dragged onto Quick selection in the sidebar", async () => {
  await page.goto(`${WEB}/library/songs?q=${encodeURIComponent(`Quick Three ${tag}`)}`);
  await row(`Quick Three ${tag}`).hover();
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 4 });
  const target = page.locator('[data-slot="sidebar"] [data-drop-state="addable"]').filter({ hasText: "Quick selection" });
  await target.waitFor();
  const box = await target.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId("set-drop-notice").getByText(`Quick Three ${tag} added to Quick selection`).waitFor();
  if ((await selection()).join() !== [one.id, two.id, three.id].join()) throw new Error(JSON.stringify(await selection()));
});

await step("its page: a song taken out, the rest added to a set", async () => {
  await sidebarEntry().click();
  await page.waitForURL("**/quick-selection");
  const songs = page.getByTestId("quick-selection-songs");
  await songs.getByText(`Quick Three ${tag}`).waitFor();
  await page.getByRole("button", { name: `Take Quick Three ${tag} out` }).click();
  await songs.getByText(`Quick Three ${tag}`).waitFor({ state: "detached" });
  await page.locator(`[data-testid="quick-selection-set"][data-set-id="${sunday.id}"]`).click();
  await page.getByTestId("quick-selection-result").getByText(`2 songs added to Sunday ${tag}.`).waitFor();
  const items = (await api(me, "GET", `/setlists/${sunday.id}`)).items.map((item) => item.song.id);
  if (items.join() !== [one.id, two.id].join()) throw new Error(JSON.stringify(items));
  await page.getByText("Nothing yet.").waitFor();
});

await step("New set with these songs", async () => {
  await api(me, "PUT", `/quick-selection/songs/${three.id}`);
  await page.reload();
  await page.getByTestId("quick-selection-new-set").click();
  await page.waitForURL("**/sets/new?**");
  await page.getByLabel("Name (optional)").fill(`From quick ${tag}`);
  await page.getByRole("button", { name: "Create set" }).click();
  await page.waitForURL(/\/sets\/(?!new)[^/?]+$/);
  await page.getByTestId("set-song-row").filter({ hasText: `Quick Three ${tag}` }).waitFor();
  if ((await selection()).length !== 0) throw new Error("still in the selection");
});

await browser.close();
finish();
