// The Bible in the sidebar (issue #310): off until a team's admin turns it on
// on the team's page; then its members find it under Tools, pick a version,
// a book (in the Bible's order or A-Z), a chapter and verses - all named in
// their own language - read the passage, and add it to one of their sets
// with the screen template it's shown with, which the set's page names - a
// YouVersion version's passage too.
import { chromium } from "playwright";
import { SP, WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { importBible } from "../lib/bibles.mjs";
import { startFakeProviders, youversionKey } from "../lib/fake-providers.mjs";

let page;
// The Bible's link: in the full sidebar, or in the rail beside a team's page.
const bibleLink = () => page.locator('[data-testid="nav-bible"], [data-testid="sidebar-bible"]').first();
const step = stepper(() => page);
const admin = await user("Bible page admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const abbreviation = `B${stamp % 10000}`;
const bible = await importBible(admin, `Sidebar Bible ${stamp}`, abbreviation, { canProject: true });
const leader = await user("Bible page leader");
const team = await api(leader, "POST", "/teams", { name: `Bible band ${stamp}` });
const set = await api(leader, "POST", "/setlists", { name: `Bible set ${stamp}`, teamId: team.id });

const fake = await startFakeProviders();
youversionKey.key = "yvp-e2e-bible-page-0123456789";
const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await step("off at first: no Bible in the sidebar", async () => {
    await signIn(page, leader);
    await page.goto(`${WEB}/teams/${team.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("bible-card").waitFor();
    if (await bibleLink().count()) throw new Error("the Bible shows before it's turned on");
  });

  await step("the team's admin turns it on: Bible under Tools", async () => {
    await page.getByTestId("bible-enabled").click();
    await bibleLink().waitFor();
    if ((await api(leader, "GET", `/teams/${team.id}`)).bible !== true) throw new Error("not saved");
  });

  await step("a passage picked: version, book in Bible order, chapter from the grid, verses", async () => {
    await bibleLink().click();
    await page.waitForURL(`${WEB}/bible`);
    await page.getByTestId("passage-picker").waitFor();
    await page.waitForLoadState("networkidle");
    await page.getByTestId("bible-version").click();
    await page.getByRole("option", { name: new RegExp(`${abbreviation}`) }).click();
    // Bible order: the Old Testament's books first, under its heading.
    await page.getByTestId("bible-book").click();
    await page.getByText("Old Testament", { exact: true }).waitFor();
    const order = await page.getByRole("option").allInnerTexts();
    if (order.indexOf("Psalms") > order.indexOf("John")) throw new Error(order.join(" | "));
    await page.screenshot({ path: `${SP}/bible-books.png` });
    await page.getByTestId("bible-book").fill("Joh");
    await page.getByRole("option", { name: "John", exact: true }).click();
    // The chapter grid opens on its own: John 3.
    await page.getByTestId("bible-chapters").getByRole("button", { name: "3", exact: true }).click();
    await page.getByTestId("bible-verse-from").fill("16");
    await page.getByTestId("bible-verse-to").fill("17");
    if ((await page.locator("#bible-reference").inputValue()) !== "John 3:16-17") throw new Error(await page.locator("#bible-reference").inputValue());
    await page.getByTestId("bible-read").click();
    const passage = page.getByTestId("bible-passage");
    await passage.getByText("For God sent not his Son into the world to condemn the world.").waitFor();
    await passage.getByText("Public Domain").waitFor();
    await page.screenshot({ path: `${SP}/bible-passage.png` });
  });

  await step("A-Z: the books sorted by name, kept on this device", async () => {
    await page.getByTestId("bible-order-alphabetical").click();
    await page.getByTestId("bible-book").fill("");
    await page.getByTestId("bible-book").click();
    const order = await page.getByRole("option").allInnerTexts();
    if (order.indexOf("John") > order.indexOf("Psalms")) throw new Error(order.join(" | "));
    await page.keyboard.press("Escape");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByTestId("bible-version").click();
    await page.getByRole("option", { name: new RegExp(`${abbreviation}`) }).click();
    if ((await page.getByTestId("bible-order-alphabetical").getAttribute("aria-pressed")) !== "true") throw new Error("the order wasn't kept");
  });

  await step("typed as French people write it: Jean 3,16 read, and added to the team's set with the Scripture template", async () => {
    await page.locator("#bible-reference").fill("Jean 3,16");
    await page.getByTestId("bible-read").click();
    await page.getByTestId("bible-passage").getByText("For God so loved the world", { exact: false }).waitFor();
    const card = page.getByTestId("bible-add-to-set");
    await card.locator("#bible-set").selectOption({ label: `Bible set ${stamp} (Bible band ${stamp})` });
    // Scripture's templates first, each saying how many verses it puts on a slide.
    const groups = await card.locator("#bible-template optgroup").evaluateAll((all) => all.map((group) => group.label));
    if (groups[0] !== "For scripture") throw new Error(groups.join(" | "));
    await card.locator("#bible-template").selectOption({ label: "Scripture - 2 verses a slide" });
    await card.getByTestId("bible-add").click();
    await card.getByTestId("bible-added").waitFor();
    const item = (await api(leader, "GET", `/setlists/${set.id}`)).items.find((one) => one.kind === "PASSAGE");
    if (item?.passage?.bibleId !== bible.id || item.passage.reference !== "John 3:16" || item.passage.template?.builtIn !== "scripture") throw new Error(JSON.stringify(item?.passage));
  });

  await step("the set's page names its template; its dialog keeps it, and the picked one is kept on this device", async () => {
    await page.getByTestId("bible-add-to-set").getByRole("link").click();
    await page.waitForURL(`${WEB}/sets/${set.id}`);
    const row = page.getByTestId("set-passage-row");
    await row.getByTestId("set-passage-template").getByText("Scripture").waitFor();
    await row.getByRole("button").click();
    const dialog = page.getByTestId("set-passage-dialog");
    if ((await dialog.locator("#set-passage-template").inputValue()) !== "b:scripture") throw new Error(await dialog.locator("#set-passage-template").inputValue());
    await dialog.locator("#set-passage-template").selectOption({ value: "" });
    await dialog.getByRole("button", { name: "Save" }).click();
    await row.getByTestId("set-passage-template").waitFor({ state: "detached" });
    const item = (await api(leader, "GET", `/setlists/${set.id}`)).items.find((one) => one.kind === "PASSAGE");
    if (item.passage.template !== null) throw new Error(JSON.stringify(item.passage.template));
    await page.goto(`${WEB}/bible`);
    await page.locator("#bible-reference").fill("John 3:16");
    await page.getByTestId("bible-read").click();
    if ((await page.locator("#bible-template").inputValue()) !== "b:scripture") throw new Error("the template wasn't kept");
  });

  await step("YouVersion's versions too: one read and added to the set, which says the screens leave it out", async () => {
    await api(admin, "PUT", "/admin/scriptures/youversion", { appKey: youversionKey.key });
    await page.goto(`${WEB}/bible`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("bible-version").click();
    await page.getByRole("option", { name: /BSB/ }).click();
    await page.locator("#bible-reference").fill("John 3:16");
    await page.getByTestId("bible-read").click();
    await page.getByTestId("bible-passage").getByText("BSB text of John 3:16.").waitFor();
    const card = page.getByTestId("bible-add-to-set");
    await card.getByTestId("bible-not-on-screens").waitFor();
    await card.getByTestId("bible-add").click();
    await card.getByTestId("bible-added").waitFor();
    const items = (await api(leader, "GET", `/setlists/${set.id}`)).items.filter((one) => one.kind === "PASSAGE");
    if (!items.some((one) => one.passage?.youversionId === 3034 && one.passage.reference === "John 3:16")) throw new Error(JSON.stringify(items.map((one) => one.passage)));
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  await browser.close();
  await api(admin, "DELETE", "/admin/scriptures/youversion");
  fake.close();
}
finish();
