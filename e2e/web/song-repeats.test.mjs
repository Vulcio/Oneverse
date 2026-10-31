// Repeated sections in the editor (issue #231): a song whose chorus is
// written out again a tone up shows it above the chart; Link makes it a
// pass of the chorus, transposed, and the message goes.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Repeats web");
const chorus = (id, chords, label = null) => ({
  id,
  type: "chorus",
  label,
  lines: [{ id: `${id}_a`, kind: "lyric", text: "Holy, holy", chords: [{ id: `${id}_1`, at: 0, raw: chords[0] }, { id: `${id}_2`, at: 7, raw: chords[1] }] }],
});
const sections = [chorus(`c1${stamp}`, ["G", "D"]), chorus(`c2${stamp}`, ["A", "E"], "Last chorus")];
const song = await api(me, "POST", "/song-versions", { title: `Repeats web ${stamp}`, language: "en", artists: ["Band"], key: "G" });
await api(me, "PATCH", `/song-versions/${song.id}`, { sections, flow: sections.map((s, i) => ({ id: `f${i}${stamp}`, sectionId: s.id })) });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await signIn(page, me);

  await step("the editor says which section repeats which, and how", async () => {
    await page.goto(`${WEB}/library/${song.id}?tab=editor`);
    const card = page.getByTestId("song-repeats");
    await card.getByText("A section repeats an earlier one").waitFor();
    await card.getByText("Last chorus is Chorus 1, 2 semitone(s) up").waitFor();
  });

  await step("Link: a pass of the chorus, a tone up, and the message goes", async () => {
    await page.getByTestId("repeat-link").click();
    await page.getByTestId("song-repeats").waitFor({ state: "detached" });
    const doc = (await api(me, "GET", `/song-versions/${song.id}`)).documentJson;
    if (doc.sections.length !== 1 || doc.flow[1]?.transpose !== 2 || doc.flow[1]?.label !== "Last chorus") throw new Error(JSON.stringify(doc.flow));
  });
} finally {
  await browser.close();
}
finish();
