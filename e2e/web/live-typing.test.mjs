// Typing together (issue #27, phase 3), in two browsers: where Admin turned live co-editing on, what one types in the Editor
// shows in the other's as it's typed, with their caret; undo takes back one's own typing only; one save is everyone's; text
// mode only reads while others are there; a save from elsewhere starts everyone over; off, each editor works alone as before.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, tag, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

const admin = await user("Ada Typing");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const owner = await user("Olivia Typing");
const coAdmin = await user("Cleo Typing");
const team = await api(owner, "POST", "/teams", { name: `Typing band ${tag}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('lty${stamp}', '${team.id}', '${coAdmin.id}', 'ADMIN', now(), now())`);
const song = await api(owner, "POST", "/song-versions", { title: `Typed together ${tag}`, language: "en", artists: ["Someone"], teamId: team.id });
await api(owner, "PATCH", `/song-versions/${song.id}`, { contentFormat: "CHORDPRO", content: "{start_of_verse}\n[G]First words\n{end_of_verse}\n" });
await api(admin, "DELETE", "/admin/collaboration");

const browser = await chromium.launch();
const errors = [];
const open = async (who, path = `/library/${song.id}?tab=editor`) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await context.newPage();
  p.on("pageerror", (error) => errors.push(error.message));
  await signIn(p, who);
  await p.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
  await p.goto(`${WEB}${path}`);
  if (path.includes("tab=editor")) await p.locator(".ProseMirror").waitFor();
  return p;
};
const prose = (p) => p.locator(".ProseMirror");
/** The chart's words as typed, without the others' carets and their names. */
const chartText = (p) =>
  p.evaluate(() => {
    const copy = document.querySelector(".ProseMirror").cloneNode(true);
    copy.querySelectorAll(".collaboration-carets__caret, .collaboration-carets__label").forEach((caret) => caret.remove());
    return copy.textContent;
  });
const waitForText = (p, words, timeout = 5000) =>
  p.waitForFunction(
    (wanted) => {
      const copy = document.querySelector(".ProseMirror")?.cloneNode(true);
      if (!copy) return false;
      copy.querySelectorAll(".collaboration-carets__caret, .collaboration-carets__label").forEach((caret) => caret.remove());
      return copy.textContent.includes(wanted);
    },
    words,
    { timeout },
  );
/** Types at the end of the song's one line (its text, as typed so far, waited for first). */
const typeAtEndOf = async (p, text, words) => {
  await waitForText(p, text);
  await prose(p).locator("p").first().click();
  await p.keyboard.press("End");
  await p.keyboard.type(words, { delay: 20 });
};

try {
  const adminPage = await open(admin, "/admin/collaboration");
  page = adminPage;
  await step("Admin > Collaboration turns live co-editing on", async () => {
    const box = adminPage.getByTestId("collaboration-liveCoEditing");
    await box.waitFor();
    if (await box.isChecked()) throw new Error("on before it was turned on");
    await box.check();
    await adminPage.getByTestId("collaboration-save").click();
    await adminPage.getByTestId("collaboration-source").getByText("database").waitFor({ timeout: 5000 }).catch(() => undefined);
    const summary = await api(admin, "GET", "/admin/collaboration");
    if (summary.settings.liveCoEditing.value !== true || summary.source !== "database") throw new Error(JSON.stringify(summary));
  });
  await adminPage.context().close();

  const one = await open(owner);
  const two = await open(coAdmin);
  page = two;

  await step("what one types shows in the other's editor as it's typed", async () => {
    await typeAtEndOf(one, "First words", " and more");
    await prose(two).getByText("First words and more").waitFor({ timeout: 5000 });
  });

  await step("…with their caret, named", async () => {
    const label = two.locator(".collaboration-carets__label", { hasText: "Olivia Typing" });
    await label.waitFor({ timeout: 5000 });
  });

  await step("both typing at once: both kept", async () => {
    await prose(one).locator("p").first().click();
    await one.keyboard.press("End");
    await prose(two).locator("p").first().click();
    await two.keyboard.press("Home");
    await Promise.all([one.keyboard.type(" at the end", { delay: 30 }), two.keyboard.type("Start: ", { delay: 30 })]);
    for (const p of [one, two]) await waitForText(p, "Start: First words and more at the end").catch(async () => {
      throw new Error(`${await chartText(one)} | ${await chartText(two)}`);
    });
  });

  await step("undo takes back one's own typing, not the other's", async () => {
    // One step at a time: what arrives from the other closes one's current undo step (typed together, it can be a few letters).
    for (let i = 0; i < 12 && (await chartText(two)).includes("Start"); i++) {
      await two.getByTestId("editor-undo").click();
      await two.waitForTimeout(150);
    }
    for (const p of [one, two]) {
      await p.waitForFunction(() => !document.querySelector(".ProseMirror").textContent.includes("Start"), null, { timeout: 5000 }).catch(async () => {
        throw new Error(`not undone: ${await chartText(p)}`);
      });
      await waitForText(p, "First words and more at the end");
    }
  });

  await step("the key, and a transposition, are the others' too", async () => {
    await one.getByTestId("editor-key").selectOption("G");
    await two.waitForFunction(() => document.querySelector('[data-testid="editor-key"]')?.value === "G", null, { timeout: 5000 });
    await one.getByTestId("editor-transpose-up").click();
    await two.waitForFunction(() => !["G", ""].includes(document.querySelector('[data-testid="editor-key"]')?.value), null, { timeout: 5000 });
    const keys = [await one.getByTestId("editor-key").inputValue(), await two.getByTestId("editor-key").inputValue()];
    if (keys[0] !== keys[1]) throw new Error(keys.join(" / "));
    const chords = await two.locator(".ProseMirror .sv-chord-chip").allTextContents();
    if (chords.some((chord) => chord.trim() === "G")) throw new Error(`chords not transposed: ${chords.join(",")}`);
    // Back, for the steps after.
    await one.getByTestId("editor-transpose-down").click();
    await two.waitForFunction(() => document.querySelector('[data-testid="editor-key"]')?.value === "G", null, { timeout: 5000 });
  });

  await step("text mode only reads while someone else is in the song", async () => {
    await two.getByRole("radio", { name: "Text" }).click();
    await two.getByTestId("text-mode-locked").waitFor();
    if (!(await two.getByTestId("structured-editor-text").getAttribute("readonly") !== null)) throw new Error("editable");
    await two.getByRole("radio", { name: "Visual" }).click();
  });

  await step("one save is everyone's: no \"saved elsewhere\", and the other saves after it", async () => {
    await one.getByRole("button", { name: "Save song" }).first().click();
    await one.getByText("Saved.").first().waitFor({ timeout: 5000 }).catch(() => undefined);
    await two.waitForTimeout(1500);
    if (await two.getByTestId("saved-elsewhere").isVisible()) throw new Error("told it was saved elsewhere");
    const saved = sql(`select "documentJson"::text from "SongVersion" where id='${song.id}'`);
    if (!saved.includes("First words and more at the end")) throw new Error(saved);
    await typeAtEndOf(two, "First words and more at the end", " by Cleo");
    await two.getByRole("button", { name: "Save song" }).first().click();
    await two.getByText("Saved.").first().waitFor({ timeout: 5000 }).catch(() => undefined);
    await two.waitForTimeout(1000);
    if (await two.getByTestId("saved-elsewhere").isVisible()) throw new Error("the second save was refused");
    const after = sql(`select "documentJson"::text from "SongVersion" where id='${song.id}'`);
    if (!after.includes("by Cleo")) throw new Error(after);
  });

  page = one;
  await step("a save from elsewhere starts everyone over from it", async () => {
    await typeAtEndOf(one, "by Cleo", " unsaved");
    await waitForText(two, "unsaved");
    await api(admin, "PATCH", `/song-versions/${song.id}`, { contentFormat: "CHORDPRO", content: "{start_of_verse}\n[G]Restored words\n{end_of_verse}\n" });
    for (const p of [one, two]) {
      await waitForText(p, "Restored words", 10000).catch(async () => {
        throw new Error(await chartText(p));
      });
      const notice = p.getByTestId("started-over");
      await notice.waitFor({ timeout: 5000 });
      if (!(await notice.textContent()).includes("This song was changed somewhere else")) throw new Error(await notice.textContent());
    }
    await typeAtEndOf(one, "Restored words", " again");
    await waitForText(two, "Restored words again");
  });

  await step("off: each editor works alone, as before", async () => {
    await api(admin, "PUT", "/admin/collaboration", { liveCoEditing: false });
    for (const p of [one, two]) {
      await p.reload();
      await prose(p).waitFor();
    }
    await typeAtEndOf(one, "Restored words", " alone");
    await two.waitForTimeout(1500);
    if ((await prose(two).getByText("alone").count()) > 0) throw new Error("typed together while off");
  });

  page = one;
  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  await api(admin, "DELETE", "/admin/collaboration");
  await browser.close();
}
finish();
