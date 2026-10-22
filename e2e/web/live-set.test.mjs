// A set in Live (issue #199): its songs in the sidebar - the one playing
// marked Now, the ones played quieter and ticked, "Start from the top"
// clearing them - reordered there by their handle, and songs found with
// Ctrl+K added after the one playing or at the end; for who can change the set.
// What happens after each song (stop, next, segue, a transition with its key
// change and note), its symbol beside it and Live saying it before the end;
// and the details each device picks to show beside the songs.
import { chromium } from "playwright";
import { WEB, api, call, check, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const leader = await user("Set leader");
const guest = await user("Set guest");

const song = (title, key, tempo = 72) =>
  api(leader, "POST", "/song-versions", { title: `${title} ${stamp}`, language: "en", artists: ["Band"], key, tempo, content: "{start_of_chorus}\n[G]Short [C]song\n{end_of_chorus}\n", contentFormat: "CHORDPRO" });
const [opener, middle, closer, called, encore] = await Promise.all([song("Opener", "G"), song("Middle", "D", 96), song("Closer", "C"), song("Called", "A"), song("Encore", "E")]);
const set = await api(leader, "POST", "/setlists", { name: `Live set ${stamp}` });
for (const one of [opener, middle, closer]) await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: one.id });
const order = async () => (await api(leader, "GET", `/setlists/${set.id}`)).items.map((item) => item.song.title.replace(` ${stamp}`, ""));
const itemOf = async (title) => (await api(leader, "GET", `/setlists/${set.id}`)).items.find((item) => item.song.title === `${title} ${stamp}`).id;

// Through the API: a song right after another.
const openerItem = await itemOf("Opener");
let r = await call(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: encore.id, afterItemId: openerItem });
check("a song added right after another", r.status === 201 && JSON.stringify(await order()) === JSON.stringify(["Opener", "Encore", "Middle", "Closer"]), JSON.stringify(await order()));
r = await call(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: encore.id, afterItemId: "nope" });
check("not after a song that isn't in the set", r.status === 404, String(r.status));
await call(leader, "DELETE", `/setlists/${set.id}/items/${await itemOf("Encore")}`);

// What happens after a song: kept on the set, and Live's view says it with the keys and tempos either side.
r = await call(leader, "PATCH", `/setlists/${set.id}/items/${openerItem}`, { transition: "TRANSITION", transitionNote: "  Pad under the prayer  " });
const saved = r.body.items?.find((item) => item.id === openerItem);
check("a transition and its note kept", r.status === 200 && saved?.transition === "TRANSITION" && saved.transitionNote === "Pad under the prayer", JSON.stringify(saved));
check("each song's tempo and key come with the set", saved?.song.tempo === 72 && saved.song.key === "G", JSON.stringify(saved?.song));
let liveView = await api(leader, "GET", `/setlists/${set.id}/items/${openerItem}/song`);
check(
  "Live's view: the transition, from G at 72 to D at 96",
  JSON.stringify(liveView.transition) === JSON.stringify({ kind: "TRANSITION", note: "Pad under the prayer", chords: [], fromKey: "G", toKey: "D", fromTempo: 72, toTempo: 96, lastChord: "C", firstChord: "G" }),
  JSON.stringify(liveView.transition),
);
r = await call(leader, "PATCH", `/setlists/${set.id}/items/${openerItem}`, { transition: "WHATEVER" });
check("only the four kinds", r.status === 400, String(r.status));
r = await call(guest, "PATCH", `/setlists/${set.id}/items/${openerItem}`, { transition: "STOP" });
check("only who can change the set", r.status === 403 || r.status === 404, String(r.status));

const guestSong = await api(guest, "POST", "/song-versions", { title: `Guest song ${stamp}`, language: "en", artists: ["Band"], content: "[G]Mine\n", contentFormat: "CHORDPRO" });
const shared = (await api(leader, "POST", `/setlists/${set.id}/share-link`)).link;
await api(guest, "POST", `/set-invites/${shared.token}/join`);

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, leader);
  const entries = () => page.getByTestId("sidebar-set-song");

  await step("Live's sidebar: the set's songs, the one playing marked Now", async () => {
    await page.goto(`${WEB}/sets/${set.id}/live/${openerItem}`);
    await page.getByTestId("live-view").waitFor();
    await page.waitForLoadState("networkidle");
    await entries().nth(2).waitFor();
    if ((await entries().count()) !== 3) throw new Error(String(await entries().count()));
    if (!(await entries().nth(0).getByTestId("sidebar-now").isVisible())) throw new Error("the song playing isn't marked");
    if (await entries().nth(1).getByTestId("sidebar-now").count()) throw new Error("another marked");
  });

  await step("moved on: the first is ticked as played, the Now mark follows", async () => {
    await page.getByTestId("live-next").click();
    // Stacked under the opener (a transition, issue #214): scrolled to, the address following.
    const middle = await itemOf("Middle");
    await page.waitForURL((url) => url.pathname.endsWith(`/live/${middle}`));
    await entries().nth(0).getByTestId("sidebar-played").waitFor();
    await entries().nth(1).getByTestId("sidebar-now").waitFor();
    await page.getByTestId("sidebar-reset-played").getByText("Start from the top").waitFor();
  });

  await step("Ctrl+K: a song called, played next - after the song playing", async () => {
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill(`Called ${stamp}`);
    const row = page.getByRole("option", { name: new RegExp(`Called ${stamp}`) });
    await row.getByTestId("search-play-next").click();
    await page.getByRole("combobox").waitFor({ state: "detached" });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="sidebar-set-song"]').length === 4);
    const now = JSON.stringify(await order());
    if (now !== JSON.stringify(["Opener", "Middle", "Called", "Closer"])) throw new Error(now);
    await page.getByTestId("live-next").getByText(`Next: Called ${stamp}`).waitFor();
  });

  await step("Ctrl+K: another, at the end of the set", async () => {
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill(`Encore ${stamp}`);
    await page.getByRole("option", { name: new RegExp(`Encore ${stamp}`) }).getByTestId("search-add-end").click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="sidebar-set-song"]').length === 5);
    const now = JSON.stringify(await order());
    if (now !== JSON.stringify(["Opener", "Middle", "Called", "Closer", "Encore"])) throw new Error(now);
  });

  await step("reordered by a song's handle (here with the keyboard): saved, and Live's Next follows", async () => {
    // The encore up two places, before the closer and the called one: right after the song playing.
    const handle = entries().nth(4).getByTestId("sidebar-drag-handle");
    await handle.focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(150);
    await page.keyboard.press("Space");
    for (let i = 0; i < 20 && JSON.stringify(await order()) !== JSON.stringify(["Opener", "Middle", "Encore", "Called", "Closer"]); i++) await page.waitForTimeout(250);
    const now = JSON.stringify(await order());
    if (now !== JSON.stringify(["Opener", "Middle", "Encore", "Called", "Closer"])) throw new Error(now);
    await page.getByTestId("live-next").getByText(`Next: Encore ${stamp}`).waitFor();
    if (!(await entries().nth(2).textContent()).includes(`Encore ${stamp}`)) throw new Error(await entries().nth(2).textContent());
  });

  await step("Live says what happens after the song, before its end", async () => {
    await page.goto(`${WEB}/sets/${set.id}/live/${openerItem}`);
    await page.getByTestId("live-view").waitFor();
    const said = page.getByTestId("live-transition");
    await said.waitFor();
    const text = await said.textContent();
    if (!/Transition into the next song/.test(text) || !/Key change G → D/.test(text) || !/72 → 96 BPM/.test(text) || !/Pad under the prayer/.test(text)) throw new Error(text);
  });

  await step("the sidebar: each song's transition beside it, changed from its symbol", async () => {
    const first = entries().nth(0);
    if ((await first.getByTestId("set-transition-picker").getAttribute("data-kind")) !== "TRANSITION") throw new Error("not shown");
    // The second: a segue, from its symbol's menu.
    await entries().nth(1).getByTestId("set-transition-picker").click();
    await page.getByTestId("set-transition-SEGUE").click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="set-transition-picker"]')[1]?.getAttribute("data-kind") === "SEGUE");
    // Shown as soon as it's picked; saved a moment after.
    let kept = null;
    for (let i = 0; i < 50 && kept !== "SEGUE"; i++) {
      if (i) await new Promise((resolve) => setTimeout(resolve, 100));
      kept = (await api(leader, "GET", `/setlists/${set.id}`)).items[1].transition;
    }
    if (kept !== "SEGUE") throw new Error(String(kept));
  });

  await step("the details beside each song, picked on this device: tempo added, key taken away", async () => {
    if ((await entries().nth(0).getByTestId("set-detail-KEY").textContent()) !== "G") throw new Error("no key");
    await page.getByTestId("sidebar-set-details").click();
    await page.getByTestId("sidebar-set-detail-TEMPO").click();
    await page.getByTestId("sidebar-set-detail-KEY").click();
    await page.keyboard.press("Escape");
    await entries().nth(1).getByTestId("set-detail-TEMPO").getByText("96").waitFor();
    if (await page.getByTestId("set-detail-KEY").count()) throw new Error("the key's still shown");
    const kept = await page.evaluate(() => localStorage.getItem("songverse.sets.details"));
    if (kept !== JSON.stringify(["TEMPO", "TRANSITION"])) throw new Error(kept);
  });

  await step("the set's page: a transition chosen there, with its note", async () => {
    // In Edit: in Live, a set opens straight into Live.
    await page.getByRole("radio", { name: "Edit" }).click();
    await page.goto(`${WEB}/sets/${set.id}`);
    await page.waitForLoadState("networkidle");
    const row = page.getByTestId("set-song-row").filter({ hasText: `Called ${stamp}` });
    await row.getByTestId("set-song-transition").selectOption("TRANSITION");
    await row.getByTestId("set-song-transition-note").fill("Modulate up a step");
    await row.getByTestId("set-song-transition-note").blur();
    for (let i = 0; i < 20; i++) {
      const item = (await api(leader, "GET", `/setlists/${set.id}`)).items.find((one) => one.song.title === `Called ${stamp}`);
      if (item.transition === "TRANSITION" && item.transitionNote === "Modulate up a step") return;
      await page.waitForTimeout(250);
    }
    throw new Error("not saved");
  });

  await step("Start from the top: nothing ticked any more", async () => {
    await page.goto(`${WEB}/sets/${set.id}/live/${await itemOf("Middle")}`);
    await page.getByTestId("live-view").waitFor();
    await page.waitForLoadState("networkidle");
    await page.getByTestId("sidebar-reset-played").click();
    await page.getByTestId("sidebar-reset-played").waitFor({ state: "detached" });
    if (await page.getByTestId("sidebar-played").count()) throw new Error("still ticked");
  });

  await step("a guest of the set: no handles, and Ctrl+K only opens songs", async () => {
    const other = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page = other;
    await signIn(page, guest);
    await page.goto(`${WEB}/sets/${set.id}/live/${openerItem}`);
    await page.getByTestId("live-view").waitFor();
    await page.waitForLoadState("networkidle");
    await page.getByTestId("sidebar-panel-list").waitFor();
    if (await page.getByTestId("sidebar-drag-handle").count()) throw new Error("a guest can move songs");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill(guestSong.title);
    await page.getByRole("option", { name: new RegExp(guestSong.title) }).waitFor();
    if (await page.getByTestId("search-play-next").count()) throw new Error("a guest can add songs");
  });
} finally {
  await browser.close();
}
finish();
