// Browser test for notes on songs (issue #256): adding one on a chord, a word or a pass (right-click, or press and hold on a touch screen),
// saved somewhere that decides who sees it; its thread with replies; resolving; the Display setting per mode; written offline, sent later.
import { chromium } from "playwright";
import { SP, WEB, api, displaySetting, finish, signIn, sql, stamp, stepper, tag, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

const owner = await user("Olivia Notes");
const member = await user("Milo Notes");
const team = await api(owner, "POST", "/teams", { name: `Band ${tag}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('wnm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const song = await api(owner, "POST", "/song-versions", { title: `Grace ${tag}`, language: "en", artists: ["Someone"], teamId: team.id });
await api(owner, "PATCH", `/song-versions/${song.id}`, { contentFormat: "CHORDPRO", content: "{start_of_verse}\n[G]Amazing [G7]grace how [C]sweet\n{end_of_verse}\n{start_of_chorus}\n[D]I once was lost\n{end_of_chorus}\n{chorus}\n" });
const songNotes = async (who) => (await api(who, "GET", `/song-versions/${song.id}/notes`)).notes;

const browser = await chromium.launch();
const errors = [];
const open = async (who, { mode = "practice", viewport = { width: 1280, height: 900 }, touch = false } = {}) => {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, who);
  await page.evaluate((m) => localStorage.setItem("songverse.mode", m), mode);
  await page.goto(`${WEB}/library/${song.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("song-chart").waitFor();
};
const chart = () => page.getByTestId("song-chart");
const addNote = async (text, place) => {
  const dialog = page.getByTestId("add-note");
  await dialog.waitFor();
  await page.getByTestId("add-note-input").fill(text);
  if (place) await page.getByTestId("add-note-places").locator(`[data-place="${place}"]`).click();
  await page.getByTestId("add-note-save").click();
  await dialog.waitFor({ state: "hidden" });
};

await step("Practice: right-click a chord, a note on it saved in the team", async () => {
  await open(owner);
  await chart().locator("[data-chord-ref]", { hasText: "G7" }).first().click({ button: "right" });
  if ((await page.getByTestId("add-note-target").textContent()) !== "On G7") throw new Error(await page.getByTestId("add-note-target").textContent());
  // Saved by default where one came from: here, just me; the team chosen instead.
  if ((await page.getByTestId("add-note-places").locator('[aria-checked="true"]').getAttribute("data-place")) !== "ME:") throw new Error("not just me by default");
  await addNote("Let ring", `TEAM:${team.id}`);
  const chip = chart().locator("[data-note-id]", { hasText: "Let ring" });
  await chip.waitFor();
  if (!(await chip.textContent()).includes("G7")) throw new Error("the chip doesn't say which chord");
  if ((await chart().locator("[data-chord-ref]", { hasText: "G7" }).first().getAttribute("data-note-mark")) !== "chord") throw new Error("the chord isn't marked");
});

await step("…a word, just for me", async () => {
  const word = chart().locator("[data-line] [data-at]", { hasText: "grace" }).first();
  const box = await word.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  const target = await page.getByTestId("add-note-target").textContent();
  if (target !== "On “grace”") throw new Error(target);
  await addNote("Hold it");
  await chart().locator("[data-note-id]", { hasText: "Hold it" }).waitFor();
});

await step("…the second chorus only (this time, not every time)", async () => {
  const second = chart().locator('[data-section="chorus"]').nth(1);
  await second.locator("[data-pass-heading]").click({ button: "right" });
  await page.getByRole("radio", { name: "This time only" }).waitFor();
  if ((await page.getByRole("radio", { name: "This time only" }).getAttribute("aria-checked")) !== "true") throw new Error("not this time by default");
  await addNote("Big ending");
  await second.locator("[data-note-id]", { hasText: "Big ending" }).waitFor();
  await page.screenshot({ path: `${SP}/notes-practice.png` });
  if ((await chart().locator('[data-section="chorus"]').first().locator("[data-note-id]").count()) !== 0) throw new Error("on the first chorus too");
});

await step("what each note is on is marked on the chart: the word, the section (issue #263)", async () => {
  await chart().locator('[data-note-mark="word"]', { hasText: "grace" }).waitFor();
  await chart().locator('[data-note-mark="section"]').first().waitFor();
  // Display > Marks: off takes the marks away, not the notes.
  await displaySetting(page, "notes", "display-noteMarks-off");
  await chart().locator("[data-note-mark]").first().waitFor({ state: "detached" });
  if ((await chart().locator("[data-note-id]").count()) === 0) throw new Error("the notes went with the marks");
  await displaySetting(page, "notes", "display-noteMarks-on");
  await chart().locator('[data-note-mark="word"]').first().waitFor();
});

await step("Display > Notes: beside what they're on, in the margin with numbered lines, or below; presets (issue #264)", async () => {
  const chart = () => page.getByTestId("song-chart");
  const sure = (label, promise) => promise.catch((error) => {
    throw new Error(`${label}: ${error.message.split("\n")[0]}`);
  });
  // Margin: on the right, each with a line and a number on what it's on.
  await sure("display-notesPreset-margin", displaySetting(page, "notes", "display-notesPreset-margin"));
  await sure("chart().locator('[data-notes-overlay='margin'] [data-note-placed]').fi", chart().locator('[data-notes-overlay="margin"] [data-note-placed]').first().waitFor());
  await sure("chart().locator('[data-note-connector]').first().waitFor()", chart().locator("[data-note-connector]").first().waitFor({ state: "attached" }));
  await sure("chart().getByTestId('note-number-1').waitFor()", chart().getByTestId("note-number-1").waitFor());
  await sure("chart().getByTestId('note-number-target-1').waitFor()", chart().getByTestId("note-number-target-1").waitFor());
  // Beside: under the word or chord, no lines; the line under it has room for them.
  await sure("display-notesPreset-stage", displaySetting(page, "notes", "display-notesPreset-stage"));
  await sure("chart().locator('[data-notes-overlay='beside'] [data-note-placed]', { ", chart().locator('[data-notes-overlay="beside"] [data-note-placed]', { hasText: "Hold it" }).waitFor());
  if ((await chart().locator("[data-note-connector]").count()) > 0) throw new Error("lines beside");
  const placed = await chart().locator("[data-note-placed]", { hasText: "Hold it" }).boundingBox();
  const word = await chart().locator('[data-note-mark="word"]', { hasText: "grace" }).boundingBox();
  if (!placed || !word || placed.y < word.y + word.height - 2 || Math.abs(placed.x - word.x) > 4) throw new Error(`not under its word: ${JSON.stringify({ placed, word })}`);
  if ((await chart().locator('[data-note-look="plain"]').count()) === 0) throw new Error("not plain");
  // A look changed: no preset any more, and back to the standard one.
  await sure("display-notesColor-blue", displaySetting(page, "notes", "display-notesColor-blue"));
  await sure("page.getByTestId('display-open').first().click()", page.getByTestId("display-open").first().click());
  await sure("page.getByTestId('display-panel').getByTestId('display-notesPreset-cus", page.getByTestId("display-panel").getByTestId("display-notesPreset-custom").waitFor());
  await sure("closing the panel", page.getByTestId("display-panel").getByTestId("display-close").click());
  await sure("the panel closed", page.getByTestId("display-panel").waitFor({ state: "detached" }));
  await sure("display-notesPreset-standard", displaySetting(page, "notes", "display-notesPreset-standard"));
  await sure("chart().locator('[data-notes] [data-note-look='card']').first().waitFo", chart().locator('[data-notes] [data-note-look="card"]').first().waitFor());
});

await step("a team member sees the team's note, not someone's own; replies in its thread", async () => {
  await open(member);
  const chip = chart().locator("[data-note-id]", { hasText: "Let ring" });
  await chip.waitFor();
  if ((await chart().getByText("Hold it").count()) + (await chart().getByText("Big ending").count()) > 0) throw new Error("sees another's own notes");
  await chip.click();
  await page.getByTestId("note-thread").getByText("Olivia Notes").first().waitFor();
  await page.getByTestId("note-reply-input").fill("Agreed, and fade out");
  await page.getByTestId("note-reply-send").click();
  await page.getByTestId("note-replies").getByText("Agreed, and fade out").waitFor();
  // Not the author: no edit, resolve or delete.
  if ((await page.getByTestId("note-resolve").count()) > 0) throw new Error("a member can resolve another's note");
  await page.keyboard.press("Escape");
  await chart().locator('[data-note-replies="1"]').waitFor();
});

await step("its author is told, and resolves it: off the chart, still in the list", async () => {
  const told = (await api(owner, "GET", "/users/me/notifications?limit=20")).items.find((item) => item.kind === "NOTE_REPLY");
  if (!told || !told.url.includes(`?note=`)) throw new Error(JSON.stringify(told));
  await open(owner);
  await page.goto(`${WEB}${told.url}`);
  await page.getByTestId("note-thread").getByText("Agreed, and fade out").waitFor();
  await page.getByTestId("note-resolve").click();
  await page.getByTestId("note-resolve").getByText("Reopen").waitFor();
  await page.keyboard.press("Escape");
  await chart().locator("[data-note-id]", { hasText: "Let ring" }).waitFor({ state: "detached" });
  await page.getByTestId("notes-button").click();
  await page.getByTestId("notes-sheet").getByText("Let ring").waitFor();
  await page.getByTestId("notes-sheet").getByText("· Resolved").waitFor();
  await page.keyboard.press("Escape");
});

await step("its author moves a note as they edit it: just them, then the team (issue #262)", async () => {
  // Owner's page from the step before.
  await chart().locator("[data-note-id]", { hasText: "Hold it" }).click();
  const thread = page.getByTestId("note-thread");
  await thread.waitFor();
  await page.getByTestId("note-edit").click();
  const places = page.getByTestId("note-edit-places");
  if ((await places.locator('[aria-checked="true"]').getAttribute("data-place")) !== "ME:") throw new Error("not starting from where it's saved");
  await page.getByTestId("note-edit-input").fill("Hold it, everyone");
  await places.locator(`[data-place="TEAM:${team.id}"]`).click();
  await page.getByTestId("note-edit-save").click();
  await page.getByTestId("note-edit-input").waitFor({ state: "detached" });
  await thread.getByTestId("note-content").getByText("Hold it, everyone").waitFor();
  if (!(await thread.getByRole("paragraph").or(thread.locator("[id]")).allTextContents()).join(" ").includes(`Band ${tag}`)) throw new Error("not said to be in the team");
  await page.keyboard.press("Escape");
  const moved = (await songNotes(member)).find((note) => note.content === "Hold it, everyone");
  if (moved?.place !== "TEAM") throw new Error(`not moved: ${JSON.stringify(moved ?? null)}`);
});

await step("someone else's note: a moderator edits it, without moving it", async () => {
  // The owner runs the team: they may edit a member's team note, not choose who sees it.
  await api(member, "POST", "/notes", { songVersionId: song.id, content: "Milo's cue", place: "TEAM", teamId: team.id });
  // The song's own address: the one before opened a note's thread (a notification's link).
  await page.goto(`${WEB}/library/${song.id}`);
  // On the whole song: above the chart.
  await page.locator("[data-note-id]", { hasText: "Milo's cue" }).first().click();
  await page.getByTestId("note-edit").click();
  await page.getByTestId("note-edit-input").waitFor();
  if ((await page.getByTestId("note-edit-places").count()) > 0) throw new Error("a moderator is offered to move it");
  await page.keyboard.press("Escape");
});

await step("Display: Practice shows only my notes; Live still shows all", async () => {
  await api(owner, "PATCH", `/notes/${(await songNotes(owner)).find((note) => note.content === "Let ring").id}`, { resolved: false });
  await open(member);
  await chart().locator("[data-note-id]", { hasText: "Let ring" }).waitFor();
  await page.getByTestId("display-open").click();
  const panel = page.getByTestId("display-panel");
  if (await panel.getByTestId("display-section").isVisible()) {
    await panel.getByTestId("display-section").click();
    await page.getByTestId("display-section-notes").click();
  }
  await panel.getByTestId("display-notes-MINE").click();
  await chart().locator("[data-note-id]").first().waitFor({ state: "detached" });
  await page.keyboard.press("Escape");
  await page.goto(`${WEB}/library/${song.id}/live`);
  await page.getByTestId("live-song").locator("[data-note-id]", { hasText: "Let ring" }).waitFor();
});

await step("on a touch screen: press and hold a chord to add a note", async () => {
  await open(member, { viewport: { width: 390, height: 844 }, touch: true });
  const chord = chart().locator("[data-chord-ref]", { hasText: /^C$/ }).first();
  await chord.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await chord.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
  await page.waitForTimeout(800);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  if ((await page.getByTestId("add-note-target").textContent()) !== "On C") throw new Error(await page.getByTestId("add-note-target").textContent());
  await page.keyboard.press("Escape");
});

await step("written offline: kept, then sent once back online", async () => {
  await open(member);
  await page.context().setOffline(true);
  await page.getByTestId("notes-button").click();
  await page.getByTestId("notes-add").click();
  await addNote("Written on the train");
  await page.getByTestId("song-notes-top").locator("[data-note-id]", { hasText: "Written on the train" }).waitFor();
  if ((await songNotes(member)).some((note) => note.content === "Written on the train")) throw new Error("sent while offline");
  await page.context().setOffline(false);
  await page.waitForFunction(() => !localStorage.getItem("songverse.notes.outbox"), null, { timeout: 10_000 });
  if (!(await songNotes(member)).some((note) => note.content === "Written on the train")) throw new Error("not sent");
});

await step("live: someone else's note appears without reloading (issue #27)", async () => {
  // Practice back to every note (the Display step left it on My notes).
  await api(member, "PATCH", "/users/me", { displaySettings: { PRACTICE: { notes: null } } });
  await open(member);
  await page.waitForTimeout(1000);
  await api(owner, "POST", "/notes", { songVersionId: song.id, content: "Live from Olivia", place: "TEAM", teamId: team.id });
  await page.getByTestId("song-notes-top").locator("[data-note-id]", { hasText: "Live from Olivia" }).waitFor({ timeout: 5000 });
});

await step("live in Live: held behind Notes changed, shown on a tap - nothing moves under the reader", async () => {
  await page.goto(`${WEB}/library/${song.id}/live`);
  const live = page.getByTestId("live-song");
  await live.locator("[data-note-id]").first().waitFor();
  await page.waitForTimeout(1000);
  const before = await live.locator("[data-pass]").first().boundingBox();
  await api(owner, "POST", "/notes", { songVersionId: song.id, content: "Held for later", place: "SONG" });
  await page.getByTestId("notes-incoming").waitFor({ timeout: 5000 });
  if ((await live.getByText("Held for later").count()) > 0) throw new Error("shown before the tap");
  const after = await live.locator("[data-pass]").first().boundingBox();
  if (Math.abs(after.y - before.y) > 1) throw new Error(`the chart moved: ${before.y} -> ${after.y}`);
  await page.getByTestId("notes-incoming").click();
  await live.getByText("Held for later").waitFor();
  await page.getByTestId("notes-incoming").waitFor({ state: "detached" });
});

await step("Live's Display: new notes at once, no button to tap (issue #263)", async () => {
  await displaySetting(page, "notes", "display-newNotes-SHOW");
  const live = page.getByTestId("live-song");
  await api(owner, "POST", "/notes", { songVersionId: song.id, content: "Straight in", place: "SONG" });
  await live.getByText("Straight in").waitFor({ timeout: 5000 });
  if ((await page.getByTestId("notes-incoming").count()) > 0) throw new Error("held anyway");
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});
await browser.close();
finish();
