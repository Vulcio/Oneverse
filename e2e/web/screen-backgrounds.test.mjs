// Backgrounds that follow the words (issue #296): flow, strings, grid and bokeh, drawn on a canvas in the background
// theme's colours; each moves on its own, answers a slide coming, and is a still frame when the theme asks for no
// motion. Screenshots of each go to e2e/.artifacts for a look.
import { chromium } from "playwright";
import { SCREEN, SP, WEB, api, finish, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Backgrounds admin");
const set = await api(admin, "POST", "/setlists", { name: `Backgrounds ${stamp}` });
const song = await api(admin, "POST", "/song-versions", {
  title: `Backgrounds song ${stamp}`,
  language: "en",
  artists: ["Someone"],
  content: "{start_of_verse}\nAmazing grace how sweet the sound\nThat saved a wretch like me\nI once was lost but now am found\nWas blind but now I see\n{end_of_verse}\n",
  contentFormat: "CHORDPRO",
});
await api(admin, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
const [item] = (await api(admin, "GET", `/setlists/${set.id}`)).items;
const template = await api(admin, "POST", "/screen-themes", { name: `Moving ${stamp}`, content: { builtIn: "concert" }, background: { builtIn: "flow" }, effects: { builtIn: "concert" } });

const browser = await chromium.launch();
let leading;
try {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  tv.on("pageerror", (error) => errors.push(error.message));
  page = tv;
  // How much of the canvas isn't its base colour, and a fingerprint of it.
  const look = () =>
    tv.evaluate(() => {
      const canvas = document.querySelector('[data-testid="screen-text-background"]');
      if (!canvas) return null;
      const copy = document.createElement("canvas");
      copy.width = 64;
      copy.height = 36;
      const context = copy.getContext("2d");
      context.drawImage(canvas, 0, 0, 64, 36);
      const data = context.getImageData(0, 0, 64, 36).data;
      const [r0, g0, b0] = [data[0], data[1], data[2]];
      let lit = 0;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0) > 30) lit++;
        sum = (sum * 31 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) % 1000003;
      }
      return { lit, sum };
    });

  await step("a screen presenting a song over a background that follows the words", async () => {
    await tv.goto(`${SCREEN}/`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    await api(admin, "POST", `/screens/pairings/${code}/confirm`, { name: `Moving TV ${stamp}`, setlistId: set.id, themeId: template.id });
    leading = await syncDevice(admin);
    leading.send({ type: "join", setId: set.id });
    await leading.next((m) => m.type === "session");
    leading.send({ type: "lead" });
    await leading.next((m) => m.type === "session" && m.leading);
    leading.send({ type: "update", presenting: { itemId: item.id, slide: 0, black: false } });
    await tv.getByTestId("screen-lines").getByText("Amazing grace", { exact: false }).waitFor({ timeout: 15000 });
  });

  for (const kind of ["flow", "strings", "grid", "bokeh"]) {
    await step(`${kind}: drawn in its colours, moving, answering a slide`, async () => {
      await api(admin, "PATCH", `/screen-themes/${template.id}`, { background: { builtIn: kind } });
      await tv.locator(`[data-testid="screen-text-background"][data-kind="${kind}"]`).waitFor({ timeout: 10000 });
      leading.send({ type: "update", presenting: { itemId: item.id, slide: 1, black: false } });
      await tv.getByTestId("screen-lines").getByText("I once was lost", { exact: false }).waitFor();
      await tv.waitForTimeout(900);
      const first = await look();
      await tv.screenshot({ path: `${SP}/screen-background-${kind}.png` });
      await tv.waitForTimeout(700);
      const later = await look();
      if (!first || first.lit < 20) throw new Error(`hardly anything drawn: ${JSON.stringify(first)}`);
      if (first.sum === later?.sum) throw new Error("not moving");
      leading.send({ type: "update", presenting: { itemId: item.id, slide: 0, black: false } });
      await tv.getByTestId("screen-lines").getByText("Amazing grace", { exact: false }).waitFor();
    });
  }

  await step("no motion asked for: a still frame", async () => {
    const [part] = (await api(admin, "GET", "/screen-parts?kind=background")).filter((one) => one.name === `Still ${stamp}`);
    const still = part ?? (await api(admin, "POST", "/screen-parts", { kind: "background", name: `Still ${stamp}`, document: { background: { kind: "flow", colors: ["#000000", "#22d3ee"], motion: 0 } } }));
    await api(admin, "PATCH", `/screen-themes/${template.id}`, { background: { id: still.id } });
    await tv.locator('[data-testid="screen-text-background"][data-kind="flow"]').waitFor({ timeout: 10000 });
    await tv.waitForTimeout(800);
    const first = await look();
    await tv.waitForTimeout(600);
    const later = await look();
    if (first?.sum !== later?.sum) throw new Error("still moving");
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  leading?.close();
  await browser.close();
  for (const one of await api(admin, "GET", "/screens")) await api(admin, "DELETE", `/screens/${one.id}`);
}
finish();
