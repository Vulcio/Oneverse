// Songs played often (issue #335): a team's admin sets the limit on the team's page, and a song past it is flagged in the set and in Add to set.
import { chromium } from "playwright";
import { api, finish, signIn, sql, stepper, tag, user, WEB } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

const leader = await user("Leader");
const team = await api(leader, "POST", "/teams", { name: `Often Team ${tag}` });
const song = await api(leader, "POST", "/song-versions", { artists: ["Test Artist"], title: `Often ${tag}`, language: "en", teamId: team.id });
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
for (const daysAgo of [7, 14]) {
  const set = await api(leader, "POST", "/setlists", { name: `Played ${daysAgo} ${tag}`, eventDate: isoDate(2), teamId: team.id });
  await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
  sql(`update "Setlist" set "eventDate"='${isoDate(-daysAgo)}' where id='${set.id}'`);
}
const next = await api(leader, "POST", "/setlists", { name: `Next ${tag}`, eventDate: isoDate(5), teamId: team.id });

const browser = await chromium.launch();
page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();

await step("Add to set says how often the song was played, quietly while there's no limit", async () => {
  await signIn(page, leader);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  await page.goto(`${WEB}/library/${song.id}`);
  await page.getByTestId("add-to-set").click();
  const plays = page.locator(`[data-testid="add-to-set-choice"][data-set-id="${next.id}"] [data-testid="recent-plays"]`);
  await plays.getByText("Played 2 times in 6 weeks").waitFor();
  if ((await plays.getAttribute("data-over")) !== null) throw new Error("flagged with no limit");
  await page.keyboard.press("Escape");
});

await step("the team's admin sets a limit on the team's page", async () => {
  await page.goto(`${WEB}/teams/${team.id}`);
  await page.waitForLoadState("networkidle"); // hydrated: the box ticked stays ticked
  const card = page.getByTestId("repeat-limit-card");
  await card.getByText("Songs played often").waitFor();
  await card.getByTestId("repeat-limit-on").check();
  await card.getByTestId("repeat-limit").fill("2");
  await card.getByTestId("repeat-save").click();
  await card.getByText("Saved").waitFor();
  const saved = await api(leader, "GET", `/teams/${team.id}`);
  if (saved.repeatLimit !== 2 || saved.repeatWeeks !== 6) throw new Error(JSON.stringify(saved));
});

await step("past the limit, the song is flagged in Add to set but can still be added", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  await page.getByTestId("add-to-set").click();
  const choice = page.locator(`[data-testid="add-to-set-choice"][data-set-id="${next.id}"]`);
  await choice.locator('[data-testid="recent-plays"][data-over="true"]').waitFor();
  await choice.click();
  await page.locator(`[data-testid="add-to-set-choice"][data-set-id="${next.id}"][data-state="in"]`).waitFor();
  await page.keyboard.press("Escape");
});

await step("and in the set, with the date it was last played", async () => {
  await page.goto(`${WEB}/sets/${next.id}`);
  const plays = page.getByTestId("set-song-row").filter({ hasText: `Often ${tag}` }).getByTestId("recent-plays");
  await plays.waitFor();
  if ((await plays.getAttribute("data-over")) !== "true") throw new Error("not flagged");
  if (!/Played 2 times in 6 weeks · last /.test(await plays.innerText())) throw new Error(await plays.innerText());
});

await browser.close();
finish();
