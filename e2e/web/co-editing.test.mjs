// Two people on one song at once, one on a phone and one on a computer
// (issue #354): what each types reaches the other; a details change on one
// and the chart on the other are both kept when each saves; one drops off
// the network, types, and comes back with nothing lost on either side; who
// else is there is shown on both; the history has both saves, by each.
import { chromium, devices } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, tag, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

const admin = await user("Ada Coedit");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const owner = await user("Paula Phone");
const friend = await user("Carl Computer");
const team = await api(owner, "POST", "/teams", { name: `Coedit band ${tag}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('cet${stamp}', '${team.id}', '${friend.id}', 'ADMIN', now(), now())`);
const song = await api(owner, "POST", "/song-versions", { title: `Together ${tag}`, language: "en", artists: ["Someone"], teamId: team.id });
await api(owner, "PATCH", `/song-versions/${song.id}`, { contentFormat: "CHORDPRO", content: "{start_of_verse}\n[G]First line\n{end_of_verse}\n" });
await api(admin, "PUT", "/admin/collaboration", { liveCoEditing: true });

const browser = await chromium.launch();
const errors = [];
async function open(who, options) {
  const context = await browser.newContext(options);
  const p = await context.newPage();
  p.on("pageerror", (error) => errors.push(`${who.name}: ${error.message}`));
  await signIn(p, who);
  await p.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
  await p.goto(`${WEB}/library/${song.id}?tab=editor`);
  await p.locator(".ProseMirror").waitFor();
  return p;
}
const words = (p) =>
  p.evaluate(() => {
    const copy = document.querySelector(".ProseMirror")?.cloneNode(true);
    if (!copy) return "";
    copy.querySelectorAll(".collaboration-carets__caret, .collaboration-carets__label").forEach((caret) => caret.remove());
    return copy.textContent;
  });
const waitForWords = (p, wanted, timeout = 8000) =>
  p
    .waitForFunction(
      (text) => {
        const copy = document.querySelector(".ProseMirror")?.cloneNode(true);
        if (!copy) return false;
        copy.querySelectorAll(".collaboration-carets__caret, .collaboration-carets__label").forEach((caret) => caret.remove());
        return copy.textContent.includes(text);
      },
      wanted,
      { timeout },
    )
    .catch(async () => {
      throw new Error(`"${wanted}" not in: ${await words(p)}`);
    });
/** Types at the end of the line holding `after`. */
async function typeAfter(p, after, text) {
  await waitForWords(p, after);
  await p.locator(".ProseMirror p", { hasText: after }).first().click();
  await p.keyboard.press("End");
  await p.keyboard.type(text, { delay: 25 });
}
const saved = () => sql(`select "documentJson"::text from "SongVersion" where id='${song.id}'`);
async function saveOn(p) {
  await p.getByRole("button", { name: "Save song" }).first().click();
  await p.getByText("Saved.").first().waitFor({ timeout: 8000 });
}

try {
  const phone = await open(owner, { ...devices["iPhone 13"], browserName: undefined, defaultBrowserType: undefined });
  const computer = await open(friend, { viewport: { width: 1280, height: 900 } });
  page = phone;

  await step("typed on the phone, it shows on the computer, and back", async () => {
    await typeAfter(phone, "First line", " from the phone");
    await waitForWords(computer, "First line from the phone");
    await typeAfter(computer, "from the phone", " and the computer");
    await waitForWords(phone, "First line from the phone and the computer");
  });

  await step("each sees who else is in the song", async () => {
    await phone.getByTestId("presence-editing").getByText("Carl Computer", { exact: false }).first().waitFor({ timeout: 8000 });
    await computer.getByTestId("presence-editing").getByText("Paula Phone", { exact: false }).first().waitFor({ timeout: 8000 });
  });

  await step("a details change on one, the chart on the other: both saved, neither lost", async () => {
    await computer.getByRole("tab", { name: "Info" }).click();
    await computer.getByLabel("Song name").fill(`Together again ${tag}`);
    await typeAfter(phone, "and the computer", " (phone)");
    // The computer's chart stays the room's while it's on Info: its save carries what the phone typed.
    await waitForWords(computer, "(phone)");
    await saveOn(computer);
    const row = sql(`select title from "SongVersion" where id='${song.id}'`);
    if (row !== `Together again ${tag}`) throw new Error(`title: ${row}`);
    if (!saved().includes("and the computer (phone)")) throw new Error(saved());
    // So the phone has nothing left to save, and the new name shows there.
    await phone.locator('[data-testid="mobile-save-bar"]:not([data-dirty])').waitFor({ timeout: 8000 });
    await phone.getByRole("tab", { name: "Info" }).click();
    if ((await phone.getByLabel("Song name").inputValue()) !== `Together again ${tag}`) throw new Error("the phone kept the old name");
  });

  await step("both change the song name: the second is told, and takes theirs or keeps theirs own", async () => {
    await computer.getByLabel("Song name").fill(`Computer's name ${tag}`);
    await phone.getByLabel("Song name").fill(`Phone's name ${tag}`);
    await saveOn(computer);
    const clash = phone.getByTestId("detail-clash");
    await clash.waitFor({ timeout: 8000 });
    const said = await clash.textContent();
    if (!said.includes("Carl Computer") || !said.includes("Song name")) throw new Error(said);
    if ((await phone.getByLabel("Song name").inputValue()) !== `Phone's name ${tag}`) throw new Error("the phone's name was replaced without asking");
    await clash.getByRole("button", { name: "Use theirs" }).click();
    if ((await phone.getByLabel("Song name").inputValue()) !== `Computer's name ${tag}`) throw new Error("theirs not taken");
    await phone.getByRole("tab", { name: "Editor" }).click();
  });

  page = computer;
  await step("the computer drops off the network, types, comes back: nothing lost", async () => {
    await computer.getByRole("tab", { name: "Editor" }).click();
    await computer.locator(".ProseMirror").waitFor();
    await computer.context().setOffline(true);
    await typeAfter(computer, "(phone)", " offline words");
    await typeAfter(phone, "(phone)", " meanwhile");
    await computer.waitForTimeout(1000);
    await computer.context().setOffline(false);
    for (const p of [phone, computer]) {
      await waitForWords(p, "offline words", 20000);
      await waitForWords(p, "meanwhile", 20000);
    }
    await saveOn(phone);
    const doc = saved();
    if (!doc.includes("offline words") || !doc.includes("meanwhile")) throw new Error(doc);
  });

  await step("the history has the saves, by each of them", async () => {
    const authors = sql(`select string_agg(distinct "authorUserId", ',') from "SongVersionRevision" where "songVersionId"='${song.id}'`).split(",");
    if (!authors.includes(owner.id) || !authors.includes(friend.id)) throw new Error(authors.join());
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  await api(admin, "DELETE", "/admin/collaboration");
  await browser.close();
}
finish();
