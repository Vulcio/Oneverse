// A messy song file read into a new song (issue #438): a ChordPro file from an
// old Windows computer (Windows-1252), its details as directives, sections
// named in comments with no blank line between them, chords written above the
// words, a chorus called again in words. Its details fill the empty fields and
// say so; a file that isn't text (a ProPresenter 7 .pro) is refused by name.
import { chromium } from "playwright";
import { WEB, SP, tag, stepper, user, api, signIn, finish } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

const me = await user("File Importer");
const TITLE = `Grâce infinie ${tag}`;
const latin1 = (text) => Buffer.from([...text].map((c) => c.charCodeAt(0)));
const file = [
  `{title: ${TITLE}}`,
  "{artist: Chorale Élan}",
  "{key: D}",
  "{tempo: 88}",
  "{time: 3/4}",
  "{c: Couplet 1}",
  "D            G       D",
  "Grâce infinie, ô quel bonheur",
  "{c: Refrain}",
  "[G]Je suis [D]libre",
  "{c: Refrain x2}",
].join("\r\n");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await signIn(page, me);

await step("a file that isn't text is refused, saying why", async () => {
  await page.goto(`${WEB}/library/new`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("source-file-input").setInputFiles({ name: "Song.pro", mimeType: "application/octet-stream", buffer: Buffer.from([0x0a, 0x12, 0x08, 0x00, 0x01, 0x02, 0x03, 0x88, 0x00, 0x00, 0x12, 0x1a]) });
  await page.getByText(/isn't text Songverse can read/).waitFor();
});

await step("a messy ChordPro file fills the song's empty fields", async () => {
  await page.getByTestId("source-file-input").setInputFiles({ name: "grace.cho", mimeType: "text/plain", buffer: latin1(file) });
  await page.waitForFunction(() => document.querySelector("#song-content")?.value.includes("ô quel bonheur"));
  if ((await page.inputValue("#song-title")) !== TITLE) throw new Error(await page.inputValue("#song-title"));
  await page.getByRole("button", { name: "Remove Chorale Élan" }).waitFor();
  await page.getByTestId("file-details-filled").getByText(/Song name, Artist, Key, Tempo \(BPM\), Time signature/).waitFor();
  await page.screenshot({ path: `${SP}/song-file-import.png`, fullPage: true });
});

let songId;
await step("saved, the chart is as the file meant it", async () => {
  await page.getByRole("button", { name: "Save song" }).click();
  await page.waitForURL(/\/library\/(?!new)[a-z0-9]+/);
  songId = new URL(page.url()).pathname.split("/").pop();
  const song = await api(me, "GET", `/song-versions/${songId}`);
  const doc = song.documentJson;
  const types = doc.sections.map((s) => s.type).join(",");
  if (types !== "verse,chorus") throw new Error(types);
  const verse = doc.sections[0].lines[0];
  if (verse.text !== "Grâce infinie, ô quel bonheur" || JSON.stringify(verse.chords.map((c) => c.raw)) !== JSON.stringify(["D", "G", "D"])) throw new Error(JSON.stringify(verse));
  // Written once, called twice more.
  if (doc.flow.length !== 4 || doc.flow.slice(1).some((item) => item.sectionId !== doc.sections[1].id)) throw new Error(JSON.stringify(doc.flow));
  if (doc.defaults.key !== "D" || doc.defaults.tempo !== 88) throw new Error(JSON.stringify(doc.defaults));
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});

await browser.close();
finish();
