// Browser test for songbook catalogue editing, import and export (issue #8).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { WEB, SP, tag, sql, stepper, user, api, signIn, finish } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

// Fixtures
const admin = await user("Cat Admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const reader = await user("Cat Reader");
const abbr = `CB${tag}`;
const base = await api(admin, "POST", "/songbook-catalogs", { name: `Base Book ${tag}`, abbreviation: abbr });
await api(admin, "POST", `/songbook-catalogs/${base.id}/entries/import`, { content: "Number,Title,Lyricist\n5,Amazing Grace,John Newton\n" });
const cat = await api(admin, "POST", "/songbook-catalogs", { name: `Big Book ${tag}`, abbreviation: `BB${tag}` });
const rows = ["Number,Title,Composer,Key,Tempo,Tags,OriginalSong"];
for (let i = 1; i <= 250; i++) rows.push(`${i},Song ${String(i).padStart(3, "0")},Composer ${i},G,${60 + (i % 60)},tag${i % 3},`);
rows[2] = `2,Grâce étonnante,Trad.,G,72,grace,${abbr} 5`;
await api(admin, "POST", `/songbook-catalogs/${cat.id}/entries/import`, { content: rows.join("\n") });
const entryId = (code) => sql(`select id from "SongbookCatalogEntry" where "catalogId"='${cat.id}' and "entryCode"='${code}'`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await signIn(page, admin);
const table = () => page.getByTestId("catalog-entries");
const row = (code) => page.getByTestId("catalog-entry-row").filter({ has: page.locator('[data-field="entryCode"]', { hasText: new RegExp(`^${code}$`) }) });
const cell = (code, field) => row(code).locator(`[data-field="${field}"]`);
async function open() {
  await page.goto(`${WEB}/songbook-catalogs/${cat.id}`);
  await page.waitForLoadState("networkidle");
  // The list is for reading (issue #210); the table, for editing, is remembered once chosen.
  const tableView = page.getByRole("button", { name: "Table", exact: true });
  if ((await tableView.getAttribute("aria-pressed")) !== "true") await tableView.click();
  await table().waitFor();
}

await step("the table pages through 250 entries", async () => {
  await open();
  await page.getByText("1–100 of 250").first().waitFor();
  if ((await page.getByTestId("catalog-entry-row").count()) !== 100) throw new Error("expected 100 rows");
  await page.getByRole("button", { name: "Next page" }).first().click();
  await page.getByText("101–200 of 250").first().waitFor();
  await row("150").waitFor();
});

await step("search ignores accents and case", async () => {
  await page.getByRole("searchbox", { name: "Search entries…" }).fill("grace ETONNANTE");
  await page.getByText("1–1 of 1").first().waitFor();
  await row("2").waitFor();
  await page.getByRole("searchbox", { name: "Search entries…" }).fill("");
});

await step("edit a cell; Enter saves", async () => {
  await cell("1", "tempo").click();
  const input = row("1").getByRole("textbox", { name: "Tempo" });
  await input.fill("90");
  await input.press("Enter");
  await cell("1", "tempo").filter({ hasText: "90" }).waitFor();
  if (sql(`select tempo from "SongbookCatalogEntry" where id='${entryId("1")}'`) !== "90") throw new Error("not saved");
});

await step("an invalid value is refused and the cell stays open", async () => {
  await cell("1", "tempo").click();
  const input = row("1").getByRole("textbox", { name: "Tempo" });
  await input.fill("fast");
  await input.press("Enter");
  await page.getByRole("alert").filter({ hasText: "Tempo must be a whole number" }).waitFor();
  await input.waitFor();
  await input.press("Escape");
  await cell("1", "tempo").filter({ hasText: "90" }).waitFor();
});

await step("Tab saves and moves to the next cell", async () => {
  await cell("3", "key").click();
  const key = row("3").getByRole("textbox", { name: "Key" });
  await key.fill("Bb");
  await key.press("Tab");
  const tempo = row("3").getByRole("textbox", { name: "Tempo" });
  await tempo.waitFor();
  await tempo.press("Escape");
  if (sql(`select key from "SongbookCatalogEntry" where id='${entryId("3")}'`) !== "Bb") throw new Error("key not saved");
});

await step("tags edit as a semicolon list and show as badges", async () => {
  await cell("4", "tags").click();
  const input = row("4").getByRole("textbox", { name: "Tags" });
  await input.fill("hope; peace");
  await input.press("Enter");
  await cell("4", "tags").getByText("peace").waitFor();
});

await step("show another column; it's remembered", async () => {
  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("menuitem", { name: "Original song" }).click();
  await page.keyboard.press("Escape");
  await table().getByRole("button", { name: "Original song" }).waitFor();
  await open();
  await table().getByRole("button", { name: "Original song" }).waitFor();
});

await step("the original song links to the other catalogue, filtered to it", async () => {
  await row("2").getByRole("link", { name: `${abbr} 5` }).click();
  await page.waitForURL(new RegExp(`/songbook-catalogs/${base.id}\\?q=`));
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: `Base Book ${tag}` }).waitFor();
  await page.getByText("1–1 of 1").first().waitFor();
  await page.getByText("Amazing Grace").waitFor();
  if ((await page.getByLabel("Name").inputValue()) !== `Base Book ${tag}`) throw new Error("details form shows the previous catalogue");
});

await step("sort by title, descending", async () => {
  await open();
  await table().getByRole("button", { name: "Title" }).click();
  await table().getByRole("button", { name: "Title" }).click();
  const first = await page.getByTestId("catalog-entry-row").first().locator('[data-field="title"]').innerText();
  if (first !== "Song 250") throw new Error(first);
});

await step("add an entry", async () => {
  await page.getByRole("button", { name: "New entry" }).click();
  const newRow = page.getByTestId("catalog-new-entry");
  await newRow.getByRole("textbox", { name: "Number" }).fill("251");
  await newRow.getByRole("textbox", { name: "Title" }).fill("Brand new");
  await newRow.getByRole("textbox", { name: "Title" }).press("Enter");
  await newRow.waitFor({ state: "detached" });
  await page.getByText("of 251").first().waitFor();
});

await step("delete an entry", async () => {
  await page.getByRole("searchbox", { name: "Search entries…" }).fill("Brand new");
  await page.getByRole("button", { name: "Delete entry 251" }).click();
  await page.getByRole("button", { name: "Delete?" }).click();
  await page.getByText("No entries match.").waitFor();
  if (entryId("251") !== "") throw new Error("still there");
});

const importFile = `${SP}/cat-import-${tag}.csv`;
(await import("node:fs")).writeFileSync(importFile, "Number;Title;BPM;Mystery\n1;Song 001;100;x\n300;Imported song;80;x\n301;;fast;x\n");
await step("import a file: preview first, then import", async () => {
  await page.getByRole("button", { name: "Import file" }).click();
  const dialog = page.getByRole("dialog");
  await page.getByTestId("catalog-import-file").setInputFiles(importFile);
  const preview = page.getByTestId("catalog-import-preview");
  await preview.getByText("1 new · 1 changed · 0 unchanged").waitFor();
  await preview.getByText("Ignored columns: Mystery").waitFor();
  await preview.getByText("1 problem (those rows are skipped)").waitFor();
  await preview.getByText(/Row 4: Title is required; Tempo must be a whole number/).waitFor();
  if (entryId("300") !== "") throw new Error("preview saved something");
  await dialog.getByRole("radio", { name: /Replace/ }).check();
  await preview.getByText(/Fix these first/).waitFor();
  if (!(await dialog.getByRole("button", { name: "Import", exact: true }).isDisabled())) throw new Error("replace not blocked");
  await dialog.getByRole("radio", { name: /Add and update/ }).check();
  await preview.getByText("1 new · 1 changed · 0 unchanged").waitFor();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("Imported: 1 new, 1 changed, 0 removed.").waitFor();
  if (entryId("300") === "") throw new Error("not imported");
  await page.getByRole("searchbox", { name: "Search entries…" }).fill("Imported song");
  await row("300").waitFor();
});

await step("export as CSV", async () => {
  const [download] = await Promise.all([page.waitForEvent("download"), (async () => {
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "CSV (spreadsheet)" }).click();
  })()]);
  if (download.suggestedFilename() !== `bb${tag}.csv`) throw new Error(download.suggestedFilename());
  const text = (await import("node:fs")).readFileSync(await download.path(), "utf8");
  if (!text.startsWith("﻿Number,Title,SortTitle") || !text.includes("Imported song")) throw new Error(text.slice(0, 60));
});

let exportedJson;
await step("export as JSON, and create a new catalogue from it", async () => {
  const [download] = await Promise.all([page.waitForEvent("download"), (async () => {
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "JSON (full backup)" }).click();
  })()]);
  exportedJson = JSON.parse((await import("node:fs")).readFileSync(await download.path(), "utf8"));
  exportedJson.catalog.name = `Copy ${tag}`;
  exportedJson.catalog.abbreviation = `CP${tag}`;
  const file = `${SP}/cat-copy-${tag}.json`;
  (await import("node:fs")).writeFileSync(file, JSON.stringify(exportedJson));
  await page.goto(`${WEB}/songbook-catalogs/new`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("catalog-create-file").setInputFiles(file);
  await page.getByRole("heading", { name: `Copy ${tag}` }).waitFor({ timeout: 15000 });
  await page.getByText("1–100 of 251").first().waitFor();
});

await step("the page fits a phone, with the list (issue #210)", async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`${WEB}/songbook-catalogs/${cat.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("catalog-list").waitFor();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 0) throw new Error(`overflows by ${over}px`);
  await page.screenshot({ path: `${SP}/catalog-mobile.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await open();
  await page.screenshot({ path: `${SP}/catalog-desktop.png` });
});

await step("a catalogue's printed volumes; a songbook imported before offers them", async () => {
  const earlier = await api(admin, "POST", "/songbooks/import-from-catalog", { catalogId: cat.id });
  await page.goto(`${WEB}/songbook-catalogs/${cat.id}`);
  await page.waitForLoadState("networkidle");
  const volumes = page.getByTestId("sections-editor");
  await volumes.getByLabel("Label, e.g. JEM1").fill(`BB${tag}1`);
  await volumes.getByLabel("Start").fill("1");
  await volumes.getByLabel("End").fill("500");
  await volumes.getByRole("button", { name: "Add" }).click();
  await volumes.getByText(`BB${tag}1`).waitFor();
  await page.goto(`${WEB}/songbooks/${earlier.id}`);
  await page.waitForLoadState("networkidle");
  // Under the songbook's details (issue #148).
  await page.getByTestId("songbook-details-toggle").click();
  await page.getByRole("button", { name: "Use the catalogue's volumes" }).click();
  await page.getByRole("button", { name: "Use the catalogue's volumes" }).waitFor({ state: "detached" });
  await page.getByTestId("sections-editor").getByText(`BB${tag}1`).waitFor();
});

const readerPage = await context.browser().newContext({ viewport: { width: 1280, height: 900 } }).then((c) => c.newPage());
page = readerPage;
await signIn(readerPage, reader);
await step("non-admins can read and export, but not edit", async () => {
  await readerPage.goto(`${WEB}/songbook-catalogs/${cat.id}`);
  await readerPage.waitForLoadState("networkidle");
  await readerPage.getByRole("button", { name: "Table", exact: true }).click();
  await readerPage.getByTestId("catalog-entries").waitFor();
  if ((await readerPage.getByRole("button", { name: "New entry" }).count()) > 0) throw new Error("can add");
  if ((await readerPage.getByRole("button", { name: "Import file" }).count()) > 0) throw new Error("can import");
  await readerPage.getByTestId("catalog-entry-row").first().locator('[data-field="tempo"]').click();
  if ((await readerPage.getByRole("textbox", { name: "Tempo" }).count()) > 0) throw new Error("cell became editable");
  await readerPage.getByRole("button", { name: "Export" }).waitFor();
});

await step("no page errors", async () => {
  const relevant = errors.filter((e) => !(e.includes("Hydration failed") && e.includes("Abkhazian")));
  if (relevant.length) throw new Error(relevant.slice(0, 2).join(" | "));
});

await browser.close();
finish();
