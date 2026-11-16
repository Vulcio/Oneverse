// Finding a song by its words (issue #221): "In lyrics" in the search box
// (Alt+L) and the library, off unless turned on and remembered on the
// device; the words in order, case and accents ignored, quotes for a
// phrase, three letters at least; each song with its line, the words in
// bold; opened at that line. Kept up to date with each save, filled in for
// older songs by the Worker; only songs the user can see.
import { chromium } from "playwright";
import { WEB, api, call, check, finish, signIn, sql, stamp, stepper, user, chooseMode } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Lyrics searcher");
const other = await user("Lyrics stranger");
const chart = (words) => `{start_of_verse}\n[G]Amazing grace, how [C]sweet the sound\n{end_of_verse}\n{start_of_chorus}\n[C]${words}\n{end_of_chorus}\n`;
const song = (who, title, words) => api(who, "POST", "/song-versions", { title: `${title} ${stamp}`, language: "en", artists: ["Band"], content: chart(words), contentFormat: "CHORDPRO" });
const chains = await song(me, "Chains", `Zephyr ${stamp} my chains are gone, I've been set free`);
const accents = await song(me, "Accents", `Élévation ${stamp}, cœur à cœur`);
// Its title has the words; found as a song, not again in the lyrics.
const titled = await song(me, `Zephyr ${stamp} chains`, `Zephyr ${stamp} chains of mine`);
await song(other, "Hidden", `Zephyr ${stamp} my chains are gone, hidden`);
const found = (q) => api(me, "GET", `/song-versions?in=lyrics&sort=title&q=${encodeURIComponent(q)}`);
const titles = (pageOf) => pageOf.items.map((item) => item.title.replace(` ${stamp}`, ""));

// The API.
let r = await found(`zephyr${stamp} chains free`.replace(`zephyr${stamp}`, `zephyr ${stamp}`));
check("the words in order, apart, ignoring case: the song with its line", JSON.stringify(titles(r)) === JSON.stringify(["Chains"]), JSON.stringify(titles(r)));
const match = r.items[0]?.lyricsMatch;
check(
  "the line found, and where its words are",
  match?.text === `Zephyr ${stamp} my chains are gone, I've been set free` && match.found.length === 4 && match.text.slice(...match.found[2]) === "chains" && match.text.slice(...match.found[3]) === "free" && typeof match.lineId === "string",
  JSON.stringify(match),
);
r = await found(`${stamp} free chains`);
check("words out of order: not found", r.items.length === 0, JSON.stringify(titles(r)));
r = await found(`"${stamp} my chains"`);
check("a phrase in quotes, both songs that have it", JSON.stringify(titles(r).sort()) === JSON.stringify(["Chains"]), JSON.stringify(titles(r)));
r = await found(`${stamp} "chains free"`);
check("a phrase that isn't there as typed: not found", r.items.length === 0, JSON.stringify(titles(r)));
r = await found(`elevation ${stamp} coeur`);
check("accents and ligatures ignored", JSON.stringify(titles(r)) === JSON.stringify(["Accents"]), JSON.stringify(titles(r)));
r = await found(`ive been set free ${stamp}`);
check("not in the order sung: none", r.items.length === 0);
r = await found(`${stamp} ive been`);
check("an apostrophe left out", JSON.stringify(titles(r)) === JSON.stringify(["Chains"]), JSON.stringify(titles(r)));
r = await found("ab");
check("under three letters: nothing", r.items.length === 0 && r.total === 0);
r = await api(other, "GET", `/song-versions?in=lyrics&q=${encodeURIComponent(`zephyr ${stamp} chains gone`)}`);
check("only songs the user can see", JSON.stringify(r.items.map((item) => item.title)) === JSON.stringify([`Hidden ${stamp}`]), JSON.stringify(r.items.map((item) => item.title)));

// Kept with each save: the new words found, the old ones not.
await api(me, "PATCH", `/song-versions/${accents.id}`, { content: chart(`Quokka ${stamp} sings anew`) });
r = await found(`quokka ${stamp} anew`);
check("a save's new words are found", JSON.stringify(titles(r)) === JSON.stringify(["Accents"]), JSON.stringify(titles(r)));
r = await found(`elevation ${stamp} coeur`);
check("its old words aren't", r.items.length === 0);

// Older songs: filled in by the Worker's backfill.
sql(`update "SongVersion" set "lyricsText" = null where id = '${chains.id}'`);
r = await found(`zephyr ${stamp} set free`);
check("a song not worked out yet isn't found by its words", r.items.length === 0);
const admin = await user("Lyrics admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
r = await call(admin, "POST", "/admin/lyrics/backfill");
check("an admin can start the backfill", r.status === 201, JSON.stringify(r.body));
r = await call(me, "POST", "/admin/lyrics/backfill");
check("only an admin", r.status === 403, String(r.status));
let filled = false;
for (let i = 0; i < 50 && !filled; i++) {
  filled = sql(`select "lyricsText" is not null from "SongVersion" where id = '${chains.id}'`) === "t";
  if (!filled) await new Promise((resolve) => setTimeout(resolve, 200));
}
r = await found(`zephyr ${stamp} set free`);
check("filled in by the Worker, found again", filled && JSON.stringify(titles(r)) === JSON.stringify(["Chains"]), JSON.stringify(titles(r)));

// The line opened at: on screen, lit up.
const litUp = () =>
  page.waitForFunction(() => {
    const id = /data-line-id="([^"]+)"/.exec(document.getElementById("found-line")?.textContent ?? "")?.[1];
    if (!id) return false;
    return [...document.querySelectorAll(`[data-line-id="${id}"], [data-sv-line][data-id="${id}"]`)].some(
      (line) => line.getClientRects().length > 0 && getComputedStyle(line).backgroundColor !== "rgba(0, 0, 0, 0)",
    );
  });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, me);
  const dialog = () => page.getByRole("dialog", { name: "Search songs, sets, songbooks and teams" });
  const field = () => dialog().getByRole("combobox");
  const toggle = () => dialog().getByTestId("search-in-lyrics");
  const group = (name) => dialog().getByRole("group", { name, exact: true });

  await step("the search box: off by default, so only titles", async () => {
    await page.goto(`${WEB}/library`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("command-search").click();
    await field().fill(`zephyr ${stamp} chains`);
    await group("Songs").getByRole("option").first().waitFor();
    if ((await toggle().getAttribute("aria-pressed")) !== "false") throw new Error("on by default");
    if (await dialog().getByTestId("search-lyrics").count()) throw new Error("lyrics searched while off");
  });

  await step("Alt+L: In the lyrics after Songs, the line with its words in bold; a title match not repeated", async () => {
    await field().press("Alt+KeyL");
    if ((await toggle().getAttribute("aria-pressed")) !== "true") throw new Error("not turned on");
    const lyrics = group("In the lyrics");
    await lyrics.getByRole("option", { name: new RegExp(`^Chains ${stamp}`) }).waitFor();
    if (await lyrics.getByRole("option", { name: new RegExp(`^Zephyr ${stamp} chains`) }).count()) throw new Error("the title match is repeated");
    const bold = await lyrics.getByTestId("lyrics-snippet").first().locator("strong").allTextContents();
    if (JSON.stringify(bold) !== JSON.stringify(["Zephyr", stamp.toString(), "chains"])) throw new Error(`in bold: ${bold}`);
    // After Songs.
    const order = await dialog().locator('[role="group"]').evaluateAll((groups) => groups.map((group) => group.getAttribute("aria-label")));
    if (order.indexOf("In the lyrics") !== order.indexOf("Songs") + 1) throw new Error(JSON.stringify(order));
  });

  await step("too short: it says so", async () => {
    await field().fill("ab");
    await dialog().getByTestId("search-lyrics-short").waitFor();
  });

  await step("opened at the line found, lit up for a moment", async () => {
    await field().fill(`${stamp} set free`);
    await group("In the lyrics").getByRole("option", { name: new RegExp(`^Chains ${stamp}`) }).click();
    await page.waitForURL(new RegExp(`/library/${chains.id}\\?line=`));
    await litUp();
  });

  await step("remembered on the device", async () => {
    await page.reload();
    // Before it's hydrated, the button doesn't open the dialog yet.
    await page.waitForLoadState("networkidle");
    await page.getByTestId("command-search").click();
    if ((await toggle().getAttribute("aria-pressed")) !== "true") throw new Error("forgotten");
    await page.keyboard.press("Escape");
  });

  await step("the library: the same toggle, the songs found by their words above the list", async () => {
    await page.goto(`${WEB}/library/songs?q=${encodeURIComponent(`${stamp} gone free`)}`);
    // The same choice as the search box's.
    await page.locator('[data-testid="library-in-lyrics"][aria-pressed="true"]').waitFor();
    await page.getByTestId("library-lyrics-song").filter({ hasText: `Chains ${stamp}` }).waitFor();
    await page.getByTestId("library-in-lyrics").click();
    await page.getByTestId("library-lyrics").waitFor({ state: "detached" });
    await page.getByTestId("library-in-lyrics").click();
    await page.getByTestId("library-lyrics-song").filter({ hasText: `Chains ${stamp}` }).click();
    await page.waitForURL(new RegExp(`/library/${chains.id}\\?line=`));
  });

  await step("Live: opened full screen at the line", async () => {
    await page.goto(`${WEB}/library`);
    await chooseMode(page, "Live");
    await page.getByTestId("command-search").click();
    await field().fill(`${stamp} been set free`);
    await group("In the lyrics").getByRole("option", { name: new RegExp(`^Chains ${stamp}`) }).click();
    await page.waitForURL(new RegExp(`/library/${chains.id}/live.*line=`));
    await litUp();
  });
} finally {
  await browser.close();
}
finish();
