// Practice's header on a phone (issue #390): the title, the artist and its actions on one row - Display, the notes
// and a menu with Add to set, Edit and Live - then the key, the metronome with the tempo and the version as pills;
// what plays chosen in the dock at the bottom. Screenshots go to e2e/.artifacts.
import { chromium } from "playwright";
import { SP, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Header");
const content = "{start_of_verse}\n[G]Morning has [C]broken\n[G]Like the first [D]morning\n{end_of_verse}\n";
const song = await api(me, "POST", "/song-versions", { title: `Morning ${stamp}`, versionName: "Live", language: "fr", artists: [`Band ${stamp}`], key: "G", tempo: 120, timeSignature: "4/4", content, contentFormat: "CHORDPRO" });
const acoustic = await api(me, "POST", "/song-versions", { title: `Morning ${stamp}`, versionName: "Acoustic", workId: song.workId, language: "fr", artists: [`Band ${stamp}`], key: "G", tempo: 90, timeSignature: "4/4", content, contentFormat: "CHORDPRO" });

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await signIn(page, me);
await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));

await step("the title row: the artist, not the language; Display and the notes as icons; no Live button", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  await page.waitForLoadState("networkidle");
  if ((await page.getByTestId("practice-artists").innerText()) !== `Band ${stamp}`) throw new Error(await page.getByTestId("practice-artists").innerText());
  if (await page.getByTestId("practice-song").getByText("French").count()) throw new Error("the language shows");
  if (await page.getByTestId("practice-song").getByRole("link", { name: "Live", exact: true }).isVisible()) throw new Error("a Live button");
  for (const id of ["display-open", "notes-button"]) {
    const box = await page.getByTestId(id).boundingBox();
    if (!box || box.width > 48) throw new Error(`${id} isn't an icon: ${JSON.stringify(box)}`);
  }
  if (await page.getByTestId("add-to-set").isVisible()) throw new Error("Add to set as a button on a phone");
  await page.screenshot({ path: `${SP}/practice-header-phone.png` });
});

await step("the menu: Add to set, Edit and Live", async () => {
  await page.getByTestId("practice-more").click();
  for (const id of ["practice-menu-add-to-set", "practice-menu-edit", "practice-menu-live"]) await page.getByTestId(id).waitFor();
  await page.keyboard.press("Escape");
});

await step("the pills: the key, the tempo with the metronome, the version; the metronome clicks at the song's tempo", async () => {
  const pills = page.getByTestId("practice-pills");
  await pills.getByText("G", { exact: true }).waitFor();
  if (!(await page.getByTestId("practice-tempo").innerText()).includes("120")) throw new Error(await page.getByTestId("practice-tempo").innerText());
  await page.getByTestId("practice-version").locator("span", { hasText: "Live" }).first().waitFor();
  const from = await page.evaluate(() => window.songverseMetronome?.now() ?? 0);
  await page.getByTestId("practice-metronome").click();
  await page.locator('[data-testid="practice-metronome"][aria-pressed="true"]').waitFor();
  await page.waitForFunction((at) => (window.songverseMetronome?.clicks ?? []).filter((c) => c.time >= at).length >= 3, from, { timeout: 10000 });
  const gaps = await page.evaluate((at) => {
    const list = window.songverseMetronome.clicks.filter((c) => c.time >= at);
    return list.slice(1).map((c, i) => Math.round((c.time - list[i].time) * 1000) / 1000);
  }, from);
  if (!gaps.every((gap) => Math.abs(gap - 0.5) < 0.002)) throw new Error(`not 120 BPM: ${gaps}`);
  await page.getByTestId("practice-metronome").click();
  await page.locator('[data-testid="practice-metronome"][aria-pressed="false"]').waitFor();
});

await step("what plays, chosen in the dock", async () => {
  // At the bottom of the screen, not in the header.
  const box = await page.getByTestId("playback-source").boundingBox();
  if (!box || box.y < 700) throw new Error(`not in the dock: ${JSON.stringify(box)}`);
});

await step("the other version, from the version pill", async () => {
  await page.getByTestId("practice-version-select").selectOption(acoustic.id);
  await page.waitForURL(`${WEB}/library/${acoustic.id}`);
  await page.getByTestId("practice-version").locator("span", { hasText: "Acoustic" }).first().waitFor();
});

await browser.close();
finish();
