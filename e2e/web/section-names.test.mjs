// Section names (issue #344): one rule everywhere - a section is named by its type, numbered in the order the sections
// are written only when the song has more than one of that type, and a section sung again keeps the name of the one it
// repeats. An imported "Verse 2" that only says that isn't stored, so it follows the reader's language; an instrumental
// written in bars ("| G | C | D | G |") comes in with its bars.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Section names");
const content = [
  "Intro",
  "| G | C . D . | % |",
  "",
  "Verse 1",
  "G         C",
  "First verse words",
  "",
  "Chorus",
  "D         G",
  "Chorus words here",
  "",
  "Verse 2",
  "G         C",
  "Second verse words",
  "",
  "Chorus",
  "D         G",
  "Chorus words here",
  "",
].join("\n");
const song = await api(me, "POST", "/song-versions", { title: `Sections ${stamp}`, language: "en", artists: ["Someone"], content, contentFormat: "CHORDS_OVER_LYRICS" });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);

const headings = async () => {
  await page.locator("[data-pass-heading]").first().waitFor();
  return (await page.locator("[data-pass-heading] > p > span:first-child").allInnerTexts()).map((text) => text.trim().toLowerCase());
};

await step("imported: plain names aren't stored, the chorus sung again is one section, the intro has its bars", async () => {
  const stored = await api(me, "GET", `/song-versions/${song.id}`);
  const doc = stored.documentJson;
  const kinds = doc.sections.map((section) => `${section.type}:${section.label ?? ""}`);
  if (JSON.stringify(kinds) !== JSON.stringify(["intro:", "verse:", "chorus:", "verse:"])) throw new Error(JSON.stringify(kinds));
  if (doc.flow.length !== 5) throw new Error(`${doc.flow.length} passes`);
  const intro = doc.sections[0];
  const names = new Map(intro.lines.flatMap((line) => line.chords.map((chord) => [chord.id, chord.raw])));
  const bars = intro.rhythm?.bars.map((bar) => bar.chords.map((chord) => `${names.get(chord.chordId)}:${chord.beat}`).join(" "));
  if (JSON.stringify(bars) !== JSON.stringify(["G:1", "C:1 D:3", "C:1 D:3"])) throw new Error(JSON.stringify(bars));
  if (intro.lines[0].text !== "") throw new Error(`the bars came in as words: ${JSON.stringify(intro.lines[0].text)}`);
});

await step("the chart: Verse 1 and Verse 2 by where they're written, Chorus alone, sung again under the same name", async () => {
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  await page.goto(`${WEB}/library/${song.id}`);
  const names = await headings();
  if (JSON.stringify(names) !== JSON.stringify(["intro", "verse 1", "chorus", "verse 2", "chorus"])) throw new Error(JSON.stringify(names));
});

await step("in French, the same names in French", async () => {
  await api(me, "PATCH", "/users/me", { locale: "fr" });
  await page.reload();
  const names = await headings();
  if (JSON.stringify(names) !== JSON.stringify(["intro", "couplet 1", "refrain", "couplet 2", "refrain"])) throw new Error(JSON.stringify(names));
  await api(me, "PATCH", "/users/me", { locale: "en" });
});

await step("a name of its own is shown as written", async () => {
  const stored = await api(me, "GET", `/song-versions/${song.id}`);
  const doc = stored.documentJson;
  const flow = doc.flow.map((item, i) => (i === 4 ? { ...item, label: "Final chorus" } : item));
  await api(me, "PATCH", `/song-versions/${song.id}`, { flow, revision: doc.revision });
  await page.reload();
  const names = await headings();
  if (names.at(-1) !== "final chorus" || names[2] !== "chorus") throw new Error(JSON.stringify(names));
});

await browser.close();
finish();
